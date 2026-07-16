const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  checkSchemaCompatibility,
  validateBatch,
  validateConfig,
  validateRecovery,
  validateTask,
  validateTaskIndex,
} = require("./migrations");
const { readRestartMarker } = require("./restart-session");

const LEGACY_SCHEMA_VERSION = "0.0.0";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stateOf(filePath, fileSystem = fs) {
  try {
    const stat = fileSystem.lstatSync(filePath);
    return { present: true, stat };
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, stat: null };
    return { present: false, stat: null, error: error.code || "STAT_FAILED" };
  }
}

function parseJsonFile(filePath, fileSystem = fs) {
  const state = stateOf(filePath, fileSystem);
  if (!state.present) return { present: false };
  if (state.stat.isSymbolicLink() || !state.stat.isFile()) return { present: true, error: "UNSAFE" };
  try {
    const text = fileSystem.readFileSync(filePath, "utf8");
    return { present: true, text, value: JSON.parse(text) };
  } catch (error) {
    return { present: true, error: error instanceof SyntaxError ? "MALFORMED" : "UNREADABLE" };
  }
}

function incompleteConfigFields(config) {
  const fields = [
    ["saas.baseUrl", config?.saas?.baseUrl],
    ["saas.loginUrl", config?.saas?.loginUrl],
    ["saas.productDetailUrl", config?.saas?.productDetailUrl],
    ["saas.credentials.username", config?.saas?.credentials?.username],
    ["saas.credentials.password", config?.saas?.credentials?.password],
    ["mirror.baseUrl", config?.mirror?.baseUrl],
    ["mirror.apiKey", config?.mirror?.apiKey],
  ];
  return fields.filter(([, value]) => typeof value !== "string" || !value.trim() || value.includes("<")).map(([field]) => field).sort();
}

function parseEnv(filePath, requiredNames, fileSystem = fs) {
  const state = stateOf(filePath, fileSystem);
  if (!state.present) return { blocker: requiredNames.size ? "ENV_MISSING" : null, digest: null };
  if (state.stat.isSymbolicLink() || !state.stat.isFile()) return { blocker: "ENV_UNSAFE_PATH", digest: null };
  let text;
  try { text = fileSystem.readFileSync(filePath, "utf8"); } catch { return { blocker: "ENV_UNREADABLE", digest: null }; }
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/);
    if (!match) return { blocker: "ENV_MALFORMED", digest: sha256(text) };
    names.add(match[1]);
  }
  return { blocker: [...requiredNames].some(name => !names.has(name)) ? "ENV_INCOMPLETE" : null, digest: sha256(text) };
}

function collectStateDocuments(layout, fileSystem = fs) {
  const documents = [];
  const unknown = [];
  const tasks = stateOf(layout.tasksDir, fileSystem);
  if (!tasks.present) return { documents, unknown };
  if (tasks.stat.isSymbolicLink() || !tasks.stat.isDirectory()) return { documents, unknown, storageError: "STATE_STORAGE_UNSAFE" };

  function add(filePath, kind) {
    const parsed = parseJsonFile(filePath, fileSystem);
    const relativePath = path.relative(layout.dataRoot, filePath).split(path.sep).join("/");
    if (parsed.error) documents.push({ path: filePath, relativePath, kind, error: "STATE_DOCUMENT_" + parsed.error });
    else documents.push({ path: filePath, relativePath, kind, value: parsed.value, digest: sha256(JSON.stringify(stableValue(parsed.value))) });
  }

  function scan(directory, inBatches) {
    for (const entry of fileSystem.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (!inBatches && entry.name === "batches") {
        const batchState = stateOf(entryPath, fileSystem);
        if (batchState.stat.isSymbolicLink() || !batchState.stat.isDirectory()) unknown.push(entryPath);
        else scan(entryPath, true);
      } else if (entry.name === "_index.json" && !inBatches) add(entryPath, "task-index");
      else if (entry.name.endsWith(".json")) add(entryPath, entry.name.startsWith("changes_") ? "recovery" : inBatches ? "batch" : "task");
      else unknown.push(entryPath);
    }
  }

  try { scan(layout.tasksDir, false); } catch { return { documents, unknown, storageError: "STATE_STORAGE_UNREADABLE" }; }
  return { documents, unknown };
}

function validateStateDocument(document, releaseContract) {
  if (document.kind === "recovery") {
    validateRecovery(document.value);
    return null;
  }
  const version = document.value?.stateSchemaVersion;
  const compatibility = checkSchemaCompatibility("state", version, { currentVersion: releaseContract.stateSchemaVersion });
  if (compatibility.status !== "current") return "STATE_SCHEMA_MIGRATION_REQUIRED";
  if (document.kind === "task-index") validateTaskIndex(document.value);
  else if (document.kind === "batch") validateBatch(document.value);
  else validateTask(document.value);
  return null;
}

function findMigrationArtifacts(dataRoot, fileSystem = fs) {
  const found = [];
  const root = stateOf(dataRoot, fileSystem);
  if (!root.present || !root.stat.isDirectory() || root.stat.isSymbolicLink()) return found;
  function visit(directory) {
    for (const entry of fileSystem.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.name === ".legacy-import-artifacts.json" || entry.name.startsWith(".legacy-import-operation-")
          || entry.name.endsWith(".migration.lock") || /\.migration-[^.]+\.tmp$/.test(entry.name) || /\.backup-[^.]+\.tmp$/.test(entry.name)) found.push(entryPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(entryPath);
    }
  }
  try { visit(dataRoot); } catch { found.push(dataRoot); }
  return found.sort();
}

function evaluateLiveStateReadiness(layout, releaseContract, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const blockers = [];
  const digestEntries = [];
  let configVersion = null;
  const stateVersions = new Set();
  const config = parseJsonFile(layout.configPath, fileSystem);
  if (!config.present) blockers.push("CONFIG_MISSING");
  else if (config.error) blockers.push("CONFIG_" + config.error + (config.error === "UNSAFE" ? "_PATH" : ""));
  else {
    configVersion = config.value?.configSchemaVersion ?? LEGACY_SCHEMA_VERSION;
    digestEntries.push(["config.json", sha256(JSON.stringify(stableValue(config.value)))]);
    try {
      const compatibility = checkSchemaCompatibility("config", config.value?.configSchemaVersion, { currentVersion: releaseContract.configSchemaVersion });
      if (compatibility.status !== "current") blockers.push("CONFIG_SCHEMA_MIGRATION_REQUIRED");
      else validateConfig(config.value);
    } catch (error) {
      blockers.push(error.code === "FUTURE_SCHEMA_VERSION" ? "CONFIG_SCHEMA_FUTURE" : "CONFIG_INVALID");
    }
    if (incompleteConfigFields(config.value).length) blockers.push("CONFIG_INCOMPLETE");
    const requiredNames = new Set([...JSON.stringify(config.value).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]));
    const env = parseEnv(layout.envPath, requiredNames, fileSystem);
    if (env.blocker) blockers.push(env.blocker);
    if (env.digest) digestEntries.push([".env", env.digest]);
  }

  const collected = collectStateDocuments(layout, fileSystem);
  if (collected.storageError) blockers.push(collected.storageError);
  if (collected.unknown.length) blockers.push("STATE_DOCUMENT_UNKNOWN");
  for (const document of collected.documents) {
    if (document.error) {
      blockers.push(document.error);
      continue;
    }
    digestEntries.push([document.relativePath, document.digest]);
    if (document.kind !== "recovery") stateVersions.add(document.value?.stateSchemaVersion ?? LEGACY_SCHEMA_VERSION);
    try {
      const blocker = validateStateDocument(document, releaseContract);
      if (blocker) blockers.push(blocker);
    } catch (error) {
      blockers.push(error.code === "FUTURE_SCHEMA_VERSION" ? "STATE_SCHEMA_FUTURE"
        : document.value?.stateSchemaVersion === undefined && document.kind !== "recovery" ? "STATE_SCHEMA_MISSING"
          : "STATE_DOCUMENT_INVALID");
    }
  }
  for (const unknownPath of collected.unknown) digestEntries.push([path.relative(layout.dataRoot, unknownPath).split(path.sep).join("/"), "unknown"]);

  if (findMigrationArtifacts(layout.dataRoot, fileSystem).length) blockers.push("MIGRATION_INTERRUPTED");
  const journal = parseJsonFile(layout.journalPath, fileSystem);
  if (journal.error) blockers.push(journal.error === "MALFORMED" ? "LIFECYCLE_JOURNAL_MALFORMED" : "LIFECYCLE_JOURNAL_UNSAFE");
  else if (journal.present && !["complete", "completed", "committed"].includes(journal.value?.status)) blockers.push("LIFECYCLE_JOURNAL_INTERRUPTED");
  if (journal.present && !journal.error) digestEntries.push(["lifecycle-journal.json", sha256(JSON.stringify(stableValue(journal.value)))]);
  if (stateOf(layout.lockPath, fileSystem).present) blockers.push("LIFECYCLE_LOCK_PRESENT");
  const restart = readRestartMarker(layout);
  if (restart.error) blockers.push(restart.error);
  else if (restart.required) blockers.push("RESTART_REQUIRED");

  const stableBlockers = [...new Set(blockers)].sort();
  const actualSchemaVersions = { config: configVersion, state: [...stateVersions].sort() };
  const stateDigest = sha256(JSON.stringify(stableValue({ blockers: stableBlockers, schemas: actualSchemaVersions, entries: digestEntries.sort((left, right) => left[0].localeCompare(right[0])) })));
  return { readyForReads: true, readyForWrites: stableBlockers.length === 0, blockers: stableBlockers, actualSchemaVersions, stateDigest };
}

module.exports = {
  collectStateDocuments,
  evaluateLiveStateReadiness,
  findMigrationArtifacts,
  incompleteConfigFields,
  validateStateDocument,
};
