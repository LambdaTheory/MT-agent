#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_TARGET_DIR = path.resolve(__dirname, "..", "..");
const IMPORT_JOURNAL_NAME = ".legacy-import-artifacts.json";
const IMPORT_OPERATION_PREFIX = ".legacy-import-operation-";
const IMPORT_OWNER_FILE = ".owner-token";

const RELEASE_TOP_LEVEL = new Set([
  ".git",
  ".gitignore",
  ".omo",
  "README.md",
  "SKILL.md",
  "config.example.json",
  "node_modules",
  "package-lock.json",
  "package.json",
  "references",
  "release-manifest.json",
  "scripts",
]);

function layoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function lstatIfExists(entryPath) {
  try {
    return fs.lstatSync(entryPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function canonicalPath(entryPath) {
  return fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
}

function comparablePath(entryPath) {
  const resolved = path.resolve(entryPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinPath(rootPath, candidatePath, allowEqual = false) {
  const root = comparablePath(rootPath);
  const candidate = comparablePath(candidatePath);
  const relative = path.relative(root, candidate);
  return (allowEqual && relative === "") || (relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function assertWithinPath(rootPath, candidatePath, code, label, allowEqual = false) {
  if (!isWithinPath(rootPath, candidatePath, allowEqual)) {
    throw layoutError(code, label + " escapes the installation data root: " + candidatePath);
  }
}

function validateWindowsPath(targetDir, resolved) {
  if (process.platform !== "win32") return;
  if (/^\\\\[?.]\\/.test(targetDir)) {
    throw layoutError("INVALID_INSTALL_TARGET", "Windows device paths are not valid install targets");
  }
  const root = path.parse(resolved).root;
  const segments = [];
  if (root.startsWith("\\\\")) segments.push(...root.slice(2).split(/[\\/]+/).filter(Boolean));
  segments.push(...resolved.slice(root.length).split(/[\\/]+/).filter(Boolean));
  const reservedDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  for (const segment of segments) {
    if (/[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || reservedDevice.test(segment)) {
      throw layoutError("INVALID_INSTALL_TARGET", "Install target contains an invalid Windows path segment: " + segment);
    }
  }
}

function normalizeTargetDir(targetDir) {
  if (typeof targetDir !== "string" || targetDir.trim() === "") {
    throw layoutError("INVALID_INSTALL_TARGET", "Install target must be a non-empty path");
  }
  if (targetDir.includes("\0")) {
    throw layoutError("INVALID_INSTALL_TARGET", "Install target contains a null byte");
  }
  const resolved = path.resolve(targetDir);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || !path.basename(resolved)) {
    throw layoutError("INVALID_INSTALL_TARGET", "Install target cannot be a filesystem root");
  }
  validateWindowsPath(targetDir, resolved);
  return resolved;
}

function getInstallLayout(targetDir = DEFAULT_TARGET_DIR) {
  const resolvedTarget = normalizeTargetDir(targetDir);
  const targetName = path.basename(resolvedTarget);
  const dataRoot = path.join(path.dirname(resolvedTarget), "." + targetName + "-data");
  const daemonDir = path.join(dataRoot, "daemon");
  const tasksDir = path.join(dataRoot, "tasks");

  return Object.freeze({
    targetDir: resolvedTarget,
    releaseRoot: resolvedTarget,
    dataRoot,
    configPath: path.join(dataRoot, "config.json"),
    envPath: path.join(dataRoot, ".env"),
    browserProfileDir: path.join(dataRoot, "browser-profile"),
    browserCacheDir: path.join(dataRoot, "browser-cache"),
    tasksDir,
    batchesDir: path.join(tasksDir, "batches"),
    daemonDir,
    daemonIdentityPath: path.join(daemonDir, "identity.json"),
    daemonPidPath: path.join(daemonDir, "daemon.pid"),
    daemonPortPath: path.join(daemonDir, "daemon.port"),
    daemonTokenPath: path.join(daemonDir, "daemon.token"),
    receiptPath: path.join(dataRoot, "install-receipt.json"),
    lockPath: path.join(dataRoot, "lifecycle.lock"),
    journalPath: path.join(dataRoot, "lifecycle-journal.json"),
    restartMarkerPath: path.join(dataRoot, "restart-required.json"),
    migrationBackupsDir: path.join(dataRoot, "migration-backups"),
  });
}

function getLegacyLayout(targetDir = DEFAULT_TARGET_DIR) {
  const resolvedTarget = normalizeTargetDir(targetDir);
  return Object.freeze({
    targetDir: resolvedTarget,
    configPath: path.join(resolvedTarget, "config.json"),
    envPath: path.join(resolvedTarget, ".env"),
    browserProfileDir: path.join(resolvedTarget, ".browser-data"),
    tasksDir: path.join(resolvedTarget, "tasks"),
    daemonPidPath: path.join(resolvedTarget, ".daemon.pid"),
    daemonPortPath: path.join(resolvedTarget, ".daemon.port"),
    daemonTokenPath: path.join(resolvedTarget, ".daemon.token"),
  });
}

function hashPath(entryPath) {
  const hash = crypto.createHash("sha256");

  function visit(currentPath, relativePath) {
    const stat = fs.lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw layoutError("LEGACY_IMPORT_SYMLINK", "Refusing to import symbolic link: " + currentPath);
    }
    if (stat.isDirectory()) {
      hash.update("directory\0" + relativePath + "\0");
      const names = fs.readdirSync(currentPath).sort((a, b) => a.localeCompare(b, "en"));
      for (const name of names) visit(path.join(currentPath, name), path.join(relativePath, name));
      return;
    }
    if (!stat.isFile()) {
      throw layoutError("LEGACY_IMPORT_UNSUPPORTED_ENTRY", "Unsupported legacy entry: " + currentPath);
    }
    hash.update("file\0" + relativePath + "\0" + String(stat.mode & 0o777) + "\0");
    hash.update(fs.readFileSync(currentPath));
  }

  visit(entryPath, "");
  return hash.digest("hex");
}

function removePath(entryPath) {
  fs.rmSync(entryPath, { recursive: true, force: true });
}

const LAYOUT_DESTINATION_FIELDS = [
  "configPath", "envPath", "browserProfileDir", "browserCacheDir", "tasksDir", "batchesDir",
  "daemonDir", "daemonIdentityPath", "daemonPidPath", "daemonPortPath", "daemonTokenPath",
  "receiptPath", "lockPath", "journalPath", "restartMarkerPath", "migrationBackupsDir",
];

function validateDestinationPath(destinationPath, dataRoot, canonicalDataRoot) {
  if (typeof destinationPath !== "string" || destinationPath.trim() === "") {
    throw layoutError("INSTALL_LAYOUT_MISMATCH", "Install layout contains an invalid destination path");
  }
  const resolvedDestination = path.resolve(destinationPath);
  assertWithinPath(dataRoot, resolvedDestination, "INSTALL_LAYOUT_ESCAPE", "Install layout destination");
  const relative = path.relative(dataRoot, resolvedDestination);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = dataRoot;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const stat = lstatIfExists(current);
    if (!stat) {
      const existingParent = path.dirname(current);
      const canonicalParent = canonicalPath(existingParent);
      const remaining = segments.slice(index).join(path.sep);
      assertWithinPath(canonicalDataRoot, path.join(canonicalParent, remaining), "INSTALL_LAYOUT_ESCAPE", "Canonical install destination");
      return resolvedDestination;
    }
    if (stat.isSymbolicLink()) {
      throw layoutError("UNSAFE_DESTINATION_ANCESTOR", "Install destination contains a symlink or junction: " + current);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw layoutError("UNSAFE_DESTINATION_ANCESTOR", "Install destination ancestor is not a directory: " + current);
    }
    assertWithinPath(canonicalDataRoot, canonicalPath(current), "INSTALL_LAYOUT_ESCAPE", "Canonical install destination", index === segments.length - 1 && current === dataRoot);
  }
  return resolvedDestination;
}

function prepareDataRoot(layout, expectedLayout) {
  if (path.resolve(layout.dataRoot) !== expectedLayout.dataRoot) {
    throw layoutError("INSTALL_LAYOUT_MISMATCH", "Install layout dataRoot does not match the target");
  }
  const existing = lstatIfExists(layout.dataRoot);
  if (existing && existing.isSymbolicLink()) {
    throw layoutError("UNSAFE_DATA_ROOT", "Installation data root cannot be a symlink or junction: " + layout.dataRoot);
  }
  if (existing && !existing.isDirectory()) {
    throw layoutError("UNSAFE_DATA_ROOT", "Installation data root is not a directory: " + layout.dataRoot);
  }
  if (!existing) fs.mkdirSync(layout.dataRoot, { recursive: true });
  const created = fs.lstatSync(layout.dataRoot);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw layoutError("UNSAFE_DATA_ROOT", "Installation data root is not a safe directory: " + layout.dataRoot);
  }
  const canonicalDataRoot = canonicalPath(layout.dataRoot);
  const canonicalParent = canonicalPath(path.dirname(layout.dataRoot));
  if (comparablePath(canonicalDataRoot) !== comparablePath(path.join(canonicalParent, path.basename(layout.dataRoot)))) {
    throw layoutError("UNSAFE_DATA_ROOT", "Installation data root resolves through a reparse-point escape: " + layout.dataRoot);
  }
  return canonicalDataRoot;
}

function validateLayout(targetDir, suppliedLayout) {
  const expected = getInstallLayout(targetDir);
  const layout = suppliedLayout || expected;
  if (!layout || path.resolve(layout.targetDir || "") !== expected.targetDir || path.resolve(layout.releaseRoot || "") !== expected.releaseRoot) {
    throw layoutError("INSTALL_LAYOUT_MISMATCH", "Install layout target does not match the legacy import target");
  }
  if (typeof layout.dataRoot !== "string" || path.resolve(layout.dataRoot) !== expected.dataRoot) {
    throw layoutError("INSTALL_LAYOUT_MISMATCH", "Install layout dataRoot does not match the target");
  }
  for (const field of LAYOUT_DESTINATION_FIELDS) {
    if (typeof layout[field] !== "string" || !isWithinPath(layout.dataRoot, path.resolve(layout[field]))) {
      throw layoutError("INSTALL_LAYOUT_ESCAPE", "Install layout destination escapes the installation data root: " + field);
    }
  }
  const canonicalDataRoot = prepareDataRoot(layout, expected);
  for (const field of LAYOUT_DESTINATION_FIELDS) {
    validateDestinationPath(layout[field], layout.dataRoot, canonicalDataRoot);
  }
  return { layout, canonicalDataRoot };
}

function ensureDestinationParent(destinationPath, dataRoot, canonicalDataRoot) {
  const parentPath = path.dirname(destinationPath);
  const relative = path.relative(dataRoot, parentPath);
  let current = dataRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) fs.mkdirSync(current);
    const currentStat = fs.lstatSync(current);
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw layoutError("UNSAFE_DESTINATION_ANCESTOR", "Install destination ancestor is unsafe: " + current);
    }
    assertWithinPath(canonicalDataRoot, canonicalPath(current), "INSTALL_LAYOUT_ESCAPE", "Canonical install destination");
  }
  validateDestinationPath(destinationPath, dataRoot, canonicalDataRoot);
}

function readImportJournal(journalPath) {
  const stat = lstatIfExists(journalPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import journal is not a regular file");
  }
  try {
    return JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  } catch {
    throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import journal is malformed");
  }
}

function cleanupRecordedImportTemps(dataRoot, canonicalDataRoot) {
  const journalPath = path.join(dataRoot, IMPORT_JOURNAL_NAME);
  const journal = readImportJournal(journalPath);
  if (!journal) return;
  const operation = journal.operation;
  if (journal.schemaVersion !== 1 || !operation || typeof operation.relativePath !== "string" || typeof operation.token !== "string") {
    throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import journal has invalid fields");
  }
  if (!operation.relativePath.startsWith(IMPORT_OPERATION_PREFIX) || path.basename(operation.relativePath) !== operation.relativePath || !/^[a-f0-9]{32}$/.test(operation.token)) {
    throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import journal does not identify an importer-owned artifact");
  }
  const operationDir = path.join(dataRoot, operation.relativePath);
  validateDestinationPath(operationDir, dataRoot, canonicalDataRoot);
  const operationStat = lstatIfExists(operationDir);
  if (operationStat) {
    if (operationStat.isSymbolicLink() || !operationStat.isDirectory()) {
      throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import artifact is not an owned directory");
    }
    const ownerPath = path.join(operationDir, IMPORT_OWNER_FILE);
    const ownerStat = lstatIfExists(ownerPath);
    if (!ownerStat || ownerStat.isSymbolicLink() || !ownerStat.isFile() || fs.readFileSync(ownerPath, "utf-8") !== operation.token) {
      throw layoutError("LEGACY_IMPORT_JOURNAL_INVALID", "Legacy import artifact ownership could not be verified");
    }
    removePath(operationDir);
  }
  fs.unlinkSync(journalPath);
}

function startImportOperation(dataRoot, canonicalDataRoot) {
  const token = crypto.randomBytes(16).toString("hex");
  const relativePath = IMPORT_OPERATION_PREFIX + process.pid + "-" + crypto.randomBytes(8).toString("hex");
  const operationDir = path.join(dataRoot, relativePath);
  const journalPath = path.join(dataRoot, IMPORT_JOURNAL_NAME);
  validateDestinationPath(operationDir, dataRoot, canonicalDataRoot);
  fs.writeFileSync(journalPath, JSON.stringify({ schemaVersion: 1, operation: { relativePath, token } }), "utf-8");
  fs.mkdirSync(operationDir);
  fs.writeFileSync(path.join(operationDir, IMPORT_OWNER_FILE), token, "utf-8");
  return { token, relativePath, operationDir, journalPath };
}

function finishImportOperation(operation) {
  if (lstatIfExists(operation.operationDir)) removePath(operation.operationDir);
  const journal = readImportJournal(operation.journalPath);
  if (journal && journal.operation && journal.operation.token === operation.token) fs.unlinkSync(operation.journalPath);
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw layoutError("LEGACY_IMPORT_CANCELLED", "Legacy data import was cancelled");
  }
}

function copyEntry(sourcePath, destinationPath, options) {
  throwIfCancelled(options.signal);
  validateDestinationPath(destinationPath, options.dataRoot, options.canonicalDataRoot);
  const sourceHash = hashPath(sourcePath);
  if (fs.existsSync(destinationPath)) {
    const destinationHash = hashPath(destinationPath);
    if (sourceHash === destinationHash) {
      return { status: "unchanged", sourceHash, destinationHash };
    }
    throw layoutError("LEGACY_IMPORT_CONFLICT", "Destination already contains different data: " + destinationPath);
  }

  ensureDestinationParent(destinationPath, options.dataRoot, options.canonicalDataRoot);
  const tempPath = path.join(options.operationDir, crypto.randomBytes(8).toString("hex"));

  try {
    fs.cpSync(sourcePath, tempPath, { recursive: true, errorOnExist: true, preserveTimestamps: true });
    if (options.onProgress) options.onProgress({ phase: "copied-to-temp", sourcePath, destinationPath, tempPath });
    throwIfCancelled(options.signal);
    const tempHash = hashPath(tempPath);
    if (tempHash !== sourceHash) {
      throw layoutError("LEGACY_IMPORT_HASH_MISMATCH", "Copied legacy data failed SHA-256 verification: " + sourcePath);
    }
    fs.renameSync(tempPath, destinationPath);
    const destinationHash = hashPath(destinationPath);
    if (destinationHash !== sourceHash) {
      removePath(destinationPath);
      throw layoutError("LEGACY_IMPORT_HASH_MISMATCH", "Imported legacy data failed destination SHA-256 verification: " + destinationPath);
    }
    if (options.onProgress) options.onProgress({ phase: "committed", sourcePath, destinationPath, sourceHash });
    return { status: "imported", sourceHash, destinationHash };
  } finally {
    if (fs.existsSync(tempPath)) removePath(tempPath);
  }
}

async function importLegacyData(options = {}) {
  const targetDir = options.targetDir || DEFAULT_TARGET_DIR;
  const legacy = getLegacyLayout(targetDir);
  const destinationTargetDir = options.destinationTargetDir || legacy.targetDir;
  const prepared = validateLayout(destinationTargetDir, options.layout);
  const layout = prepared.layout;
  const canonicalDataRoot = prepared.canonicalDataRoot;
  cleanupRecordedImportTemps(layout.dataRoot, canonicalDataRoot);
  throwIfCancelled(options.signal);

  const mappings = [
    ["config.json", legacy.configPath, layout.configPath],
    [".env", legacy.envPath, layout.envPath],
    [".browser-data", legacy.browserProfileDir, layout.browserProfileDir],
    ["tasks", legacy.tasksDir, layout.tasksDir],
    [".daemon.pid", legacy.daemonPidPath, layout.daemonPidPath],
    [".daemon.port", legacy.daemonPortPath, layout.daemonPortPath],
    [".daemon.token", legacy.daemonTokenPath, layout.daemonTokenPath],
  ];
  const knownLegacyNames = new Set(mappings.map(([name]) => name));
  const result = {
    targetDir: legacy.targetDir,
    dataRoot: layout.dataRoot,
    imported: [],
    unchanged: [],
    missing: [],
    unknown: [],
    hashes: {},
    sourceDeleted: false,
  };

  if (fs.existsSync(legacy.targetDir)) {
    for (const name of fs.readdirSync(legacy.targetDir).sort((a, b) => a.localeCompare(b, "en"))) {
      if (!knownLegacyNames.has(name) && !RELEASE_TOP_LEVEL.has(name)) result.unknown.push(name);
    }
  }

  const operation = startImportOperation(layout.dataRoot, canonicalDataRoot);
  try {
    for (const [name, sourcePath, destinationPath] of mappings) {
      throwIfCancelled(options.signal);
      if (!fs.existsSync(sourcePath)) {
        result.missing.push(name);
        continue;
      }
      if (options.onProgress) options.onProgress({ phase: "before-copy", name, sourcePath, destinationPath });
      const copied = copyEntry(sourcePath, destinationPath, { ...options, operationDir: operation.operationDir, dataRoot: layout.dataRoot, canonicalDataRoot });
      result[copied.status].push(name);
      result.hashes[name] = copied.sourceHash;
    }
  } finally {
    finishImportOperation(operation);
  }

  return result;
}

function parseCliArguments(argv) {
  const command = argv[0];
  let targetDir;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--target") targetDir = argv[++index];
    else if (argv[index].startsWith("--target=")) targetDir = argv[index].slice("--target=".length);
  }
  return { command, targetDir };
}

async function main() {
  const { command, targetDir } = parseCliArguments(process.argv.slice(2));
  if (command !== "import-legacy" || !targetDir) {
    throw layoutError("INVALID_ARGUMENT", "Usage: node scripts/lib/install-layout.js import-legacy --target <absolute-path>");
  }
  if (!path.isAbsolute(targetDir)) {
    throw layoutError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  }
  const result = await importLegacyData({ targetDir });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ status: "error", code: error.code || "LEGACY_IMPORT_FAILED", message: error.message }) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TARGET_DIR,
  cleanupRecordedImportTemps,
  getInstallLayout,
  getLegacyLayout,
  hashPath,
  importLegacyData,
  normalizeTargetDir,
};
