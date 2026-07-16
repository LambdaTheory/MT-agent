const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const { MAX_DEFINITION_BYTES, migrateValue, validateDefinition } = require("./declarative-migration");
const { validateRecovery } = require("./migrations");
const { compareSemver, parseSemver } = require("./version-contract");

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeFileNoReplaceDurable(filePath, bytes) {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function relativeManagedFiles(layout) {
  const files = [];
  function add(filePath, kind) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail("TARGET_MIGRATION_INPUT_INVALID", "Managed data file is unsafe", { path: filePath });
    const bytes = fs.readFileSync(filePath);
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("TARGET_MIGRATION_INPUT_INVALID", "Managed data file is malformed", { path: filePath }); }
    if (kind === "recovery") {
      try { validateRecovery(value); } catch (error) { fail("TARGET_MIGRATION_INPUT_INVALID", "Managed recovery data is malformed", { path: filePath, causeCode: error.code || null }); }
      files.push({ relativePath: path.relative(layout.dataRoot, filePath).replace(/\\/g, "/"), kind, sha256: sha256(bytes), schemaVersion: null });
      return;
    }
    const schemaVersion = kind === "config" ? value.configSchemaVersion : value.stateSchemaVersion;
    try { parseSemver(schemaVersion, kind + ".schemaVersion"); } catch { fail("TARGET_MIGRATION_INPUT_INVALID", "Managed data schema is malformed", { path: filePath }); }
    files.push({ relativePath: path.relative(layout.dataRoot, filePath).replace(/\\/g, "/"), kind, sha256: sha256(bytes), schemaVersion });
  }
  if (fs.existsSync(layout.configPath)) add(layout.configPath, "config");
  if (!fs.existsSync(layout.tasksDir)) return files;
  for (const entry of fs.readdirSync(layout.tasksDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const entryPath = path.join(layout.tasksDir, entry.name);
    if (entry.isSymbolicLink()) fail("TARGET_MIGRATION_INPUT_INVALID", "Managed data contains a link", { path: entryPath });
    if (entry.isFile() && entry.name.endsWith(".json")) add(entryPath, entry.name === "_index.json" ? "task-index" : entry.name.startsWith("changes_") ? "recovery" : "task");
    if (entry.isDirectory() && entry.name === "batches") {
      for (const batch of fs.readdirSync(entryPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        const batchPath = path.join(entryPath, batch.name);
        if (batch.isSymbolicLink()) fail("TARGET_MIGRATION_INPUT_INVALID", "Managed batch data contains a link", { path: batchPath });
        if (batch.isFile() && batch.name.endsWith(".json")) add(batchPath, batch.name.startsWith("changes_") ? "recovery" : "batch");
      }
    }
  }
  return files;
}

function inRanges(version, ranges) {
  return ranges.some(range => compareSemver(version, range.min) >= 0 && compareSemver(version, range.max) <= 0);
}

function assertPreMigrationCompatibility(files, targetContract) {
  for (const file of files) {
    if (file.kind === "recovery") continue;
    const domain = file.kind === "config" ? "configSchema" : "stateSchema";
    const readable = targetContract.compatibility[domain];
    if (compareSemver(file.schemaVersion, readable.min) >= 0 && compareSemver(file.schemaVersion, readable.max) <= 0) continue;
    if (!inRanges(file.schemaVersion, targetContract.migration.sources[domain])) {
      fail("TARGET_SCHEMA_INCOMPATIBLE", "Persisted schema is neither readable nor migratable by the target release", { relativePath: file.relativePath, version: file.schemaVersion, domain });
    }
  }
}

async function runTargetMigration(stagingDir, temporaryLayout, targetContract) {
  const files = relativeManagedFiles(temporaryLayout);
  assertPreMigrationCompatibility(files, targetContract);
  const definitionPath = path.join(stagingDir, ...targetContract.migration.definition.split("/"));
  const stat = fs.existsSync(definitionPath) ? fs.lstatSync(definitionPath) : null;
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_DEFINITION_BYTES) fail("TARGET_MIGRATION_DEFINITION_INVALID", "Verified staged release migration definition is missing, unsafe, or oversized");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
  } catch (error) {
    fail("TARGET_MIGRATION_DEFINITION_INVALID", "Verified staged release migration definition is malformed", { cause: error.message });
  }
  const targetSchemas = { configSchema: targetContract.configSchemaVersion, stateSchema: targetContract.stateSchemaVersion };
  const definition = validateDefinition(parsed, targetContract.migration, targetSchemas);
  for (const file of files) {
    if (file.kind === "recovery") continue;
    const filePath = path.join(temporaryLayout.dataRoot, ...file.relativePath.split("/"));
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const migrated = migrateValue(value, file, definition, targetSchemas);
    if (!isDeepStrictEqual(migrated, value)) fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2) + "\n");
  }
  const migratedFiles = relativeManagedFiles(temporaryLayout);
  if (migratedFiles.length !== files.length || migratedFiles.some((file, index) => file.relativePath !== files[index].relativePath || file.kind !== files[index].kind
      || (file.kind === "recovery" && file.sha256 !== files[index].sha256))) {
    fail("TARGET_MIGRATION_OUTPUT_INVALID", "Declarative migration changed the managed file inventory");
  }
  for (const file of migratedFiles) {
    if (file.kind === "recovery") continue;
    const domain = file.kind === "config" ? "configSchema" : "stateSchema";
    const readable = targetContract.compatibility[domain];
    if (compareSemver(file.schemaVersion, readable.min) < 0 || compareSemver(file.schemaVersion, readable.max) > 0) {
      fail("TARGET_SCHEMA_INCOMPATIBLE", "Migrated schema is outside the target readable range", { relativePath: file.relativePath, version: file.schemaVersion, domain });
    }
  }
  return { sourceFiles: files, migratedFiles };
}

function backupDataFiles(layout, temporaryLayout, files, backupRoot, fsyncParent) {
  fs.mkdirSync(backupRoot, { recursive: true });
  for (const file of files) {
    const livePath = path.join(layout.dataRoot, ...file.relativePath.split("/"));
    const backupPath = path.join(backupRoot, ...file.relativePath.split("/"));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    const bytes = fs.readFileSync(livePath);
    if (sha256(bytes) !== file.sha256) fail("MIGRATION_SOURCE_CHANGED", "Live data changed before backup", { relativePath: file.relativePath });
    writeFileNoReplaceDurable(backupPath, bytes);
    fsyncParent(path.dirname(backupPath));
  }
  return files.map(file => ({ ...file, targetSha256: temporaryLayout && relativeManagedFiles(temporaryLayout).find(item => item.relativePath === file.relativePath).sha256 }));
}

function installMigratedData(layout, temporaryLayout, files, fsyncParent) {
  for (const file of files) {
    const livePath = path.join(layout.dataRoot, ...file.relativePath.split("/"));
    const migratedPath = path.join(temporaryLayout.dataRoot, ...file.relativePath.split("/"));
    const current = fs.readFileSync(livePath);
    if (sha256(current) !== file.sha256) fail("MIGRATION_SOURCE_CHANGED", "Live data changed before installation", { relativePath: file.relativePath });
    const temporary = livePath + ".upgrade-install-" + crypto.randomBytes(8).toString("hex");
    writeFileNoReplaceDurable(temporary, fs.readFileSync(migratedPath));
    fs.unlinkSync(livePath);
    try { fs.linkSync(temporary, livePath); } catch (error) { if (!fs.existsSync(livePath)) fs.writeFileSync(livePath, current, { flag: "wx" }); throw error; }
    fs.unlinkSync(temporary);
    fsyncParent(path.dirname(livePath));
  }
}

function restoreDataFiles(layout, files, backupRoot, fsyncParent) {
  if (!Array.isArray(files) || !files.length) return;
  for (const file of files) {
    const livePath = path.join(layout.dataRoot, ...file.relativePath.split("/"));
    const backupPath = path.join(backupRoot, ...file.relativePath.split("/"));
    if (!fs.existsSync(backupPath) || sha256(fs.readFileSync(backupPath)) !== file.sha256) fail("UPGRADE_DATA_RESTORE_FAILED", "Original data backup is missing or corrupt", { relativePath: file.relativePath });
    if (fs.existsSync(livePath)) fs.unlinkSync(livePath);
    fs.linkSync(backupPath, livePath);
    fsyncParent(path.dirname(livePath));
  }
}

module.exports = { assertPreMigrationCompatibility, backupDataFiles, installMigratedData, relativeManagedFiles, restoreDataFiles, runTargetMigration };
