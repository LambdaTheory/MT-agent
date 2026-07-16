const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getInstallLayout } = require("./install-layout");
const { hashReleaseTree, validateReceipt } = require("./install-receipt");
const { compareSemver, loadContractFiles, parseSemver, validateVersionContract } = require("./version-contract");

const OWNER_FILE = ".upgrade-owner.json";
const JOURNAL_STATUSES = new Set(["in-progress", "recovered", "recovery-required", "committed"]);
const JOURNAL_FIELDS = new Set([
  "schemaVersion", "operation", "operationId", "targetDir", "dataRoot", "stagingDir", "previousDir",
  "retainedPreviousDir", "temporaryDataRoot", "receiptPath", "restartMarkerPath", "journalPath",
  "dataBackupRoot",
  "sourceVersion", "targetVersion", "sourceTreeSha256", "targetTreeSha256", "phase", "status",
  "createdAt", "updatedAt", "completedAt", "recoveryIntent", "error", "sourceReceipt", "targetReceipt",
  "targetSource", "originalReceipt", "originalRestartMarker", "migrations", "transitionHistory",
  "dataFiles",
]);
const REQUIRED_RELEASE_FILES = ["SKILL.md", "config.example.json", "package.json", "package-lock.json", "release-manifest.json"];

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function comparable(entryPath) {
  const resolved = path.resolve(entryPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function lstat(entryPath) {
  try { return fs.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function canonical(entryPath, code) {
  const stat = lstat(entryPath);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(code, "Path must be a regular directory", { path: entryPath });
  return fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
}

function operationToken(operationId) {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) fail("LIFECYCLE_JOURNAL_MALFORMED", "operationId is invalid");
  return crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 16);
}

function deriveOperationPaths(layout, operationId) {
  const token = operationToken(operationId);
  const parent = path.dirname(layout.targetDir);
  const stagingDir = path.join(parent, "." + path.basename(layout.targetDir) + "-upgrade-stage-" + token);
  return Object.freeze({
    targetDir: path.resolve(layout.targetDir),
    dataRoot: path.resolve(layout.dataRoot),
    stagingDir,
    previousDir: path.resolve(layout.targetDir + ".previous"),
    retainedPreviousDir: path.resolve(layout.targetDir + ".previous.retained-" + token),
    temporaryDataRoot: path.resolve(getInstallLayout(stagingDir).dataRoot),
    dataBackupRoot: path.resolve(path.join(getInstallLayout(stagingDir).dataRoot, ".original-data")),
    receiptPath: path.resolve(layout.receiptPath),
    restartMarkerPath: path.resolve(layout.restartMarkerPath),
    journalPath: path.resolve(layout.journalPath),
  });
}

function assertExactPaths(value, layout) {
  const expected = deriveOperationPaths(layout, value.operationId);
  const canonicalParent = canonical(path.dirname(layout.targetDir), "INVALID_INSTALL_TARGET");
  for (const [field, expectedPath] of Object.entries(expected)) {
    if (typeof value[field] !== "string" || comparable(value[field]) !== comparable(expectedPath)) {
      fail("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Upgrade journal path does not match the canonical operation path", { field, expected: expectedPath });
    }
  }
  if (comparable(canonical(layout.dataRoot, "INSTALL_DATA_ROOT_MISSING")) !== comparable(expected.dataRoot)) {
    fail("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Data root resolves through a link or reparse point");
  }
  if (comparable(canonical(path.dirname(layout.dataRoot), "INSTALL_DATA_ROOT_MISSING")) !== comparable(canonicalParent)) {
    fail("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Data root is not a canonical sibling of the target");
  }
  const volume = path.parse(canonicalParent).root.toLowerCase();
  for (const field of ["stagingDir", "previousDir", "retainedPreviousDir", "temporaryDataRoot", "dataBackupRoot"]) {
    if (path.parse(path.resolve(expected[field])).root.toLowerCase() !== volume) fail("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Upgrade artifact crosses volumes", { field });
  }
  return expected;
}

function validSnapshot(snapshot) {
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    && typeof snapshot.exists === "boolean"
    && ((snapshot.exists && typeof snapshot.base64 === "string") || (!snapshot.exists && snapshot.base64 === null));
}

function validateHistory(value, phases) {
  if (!Array.isArray(value.transitionHistory) || value.transitionHistory.length === 0 || value.transitionHistory.some(phase => !phases.includes(phase))) {
    fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade transition history is invalid");
  }
  for (let index = 1; index < value.transitionHistory.length; index++) {
    const previous = value.transitionHistory[index - 1];
    const current = value.transitionHistory[index];
    const forward = phases.indexOf(current) === phases.indexOf(previous) + 1;
    const recovery = current === "recovered" && value.status === "recovered" && index === value.transitionHistory.length - 1;
    if (!forward && !recovery) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal contains a skipped or backward transition");
  }
  if (value.transitionHistory[value.transitionHistory.length - 1] !== value.phase) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade phase does not match transition history");
}

function validateJournal(value, layout, phases, schemaVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal must be an object");
  const unknown = Object.keys(value).filter(field => !JOURNAL_FIELDS.has(field));
  if (unknown.length || value.schemaVersion !== schemaVersion || value.operation !== "upgrade") fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal schema is invalid", { field: unknown[0] });
  for (const field of ["operationId", "sourceVersion", "targetVersion", "sourceTreeSha256", "phase", "status", "createdAt", "updatedAt", "recoveryIntent"]) {
    if (typeof value[field] !== "string" || !value[field]) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal field is invalid", { field });
  }
  if (!phases.includes(value.phase) || !JOURNAL_STATUSES.has(value.status)) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal enum is unknown");
  if (!/^[a-f0-9]{64}$/.test(value.sourceTreeSha256) || (value.targetTreeSha256 !== null && !/^[a-f0-9]{64}$/.test(value.targetTreeSha256))) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal hash is invalid");
  if (!validSnapshot(value.originalReceipt) || !validSnapshot(value.originalRestartMarker) || !Array.isArray(value.migrations) || !Array.isArray(value.dataFiles)) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal snapshots, migrations, or data transaction are invalid");
  for (const file of value.dataFiles) {
    if (!file || typeof file.relativePath !== "string" || file.relativePath.includes("\\") || file.relativePath.split("/").some(segment => !segment || segment === "." || segment === "..")
        || !/^[a-f0-9]{64}$/.test(String(file.sha256 || "")) || (file.targetSha256 !== undefined && !/^[a-f0-9]{64}$/.test(String(file.targetSha256)))) {
      fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal data file manifest is invalid");
    }
  }
  let originalReceipt;
  try { originalReceipt = validateReceipt(JSON.parse(Buffer.from(value.originalReceipt.base64, "base64").toString("utf8"))); } catch (error) { fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal original receipt is invalid", { causeCode: error.code }); }
  let sourceReceipt;
  try { sourceReceipt = validateReceipt(value.sourceReceipt); } catch (error) { fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal source receipt is invalid", { causeCode: error.code }); }
  if (JSON.stringify(sourceReceipt) !== JSON.stringify(originalReceipt)) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal source receipt does not match its restoration snapshot");
  const staged = value.transitionHistory.includes("staged");
  if (staged) {
    const source = value.targetSource;
    if (!source || source.owner !== sourceReceipt.source.owner || source.repo !== sourceReceipt.source.repo
        || source.tag !== "v" + value.targetVersion || source.asset !== "rental-price-agent-v" + value.targetVersion + ".tgz"
        || !/^[a-f0-9]{64}$/.test(String(source.sha256 || ""))) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal target release source is invalid");
  } else if (value.targetSource !== null) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal target source exists before staging");
  if (value.targetReceipt !== null) {
    let targetReceipt;
    try { targetReceipt = validateReceipt(value.targetReceipt); } catch (error) { fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal target receipt is invalid", { causeCode: error.code }); }
    if (!value.targetSource || JSON.stringify(targetReceipt.source) !== JSON.stringify({ provider: "gitee", ...value.targetSource })
        || targetReceipt.versions.skill !== value.targetVersion || targetReceipt.releaseTreeSha256 !== value.targetTreeSha256) {
      fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal target receipt does not match the verified staged release metadata");
    }
  }
  validateHistory(value, phases);
  if ((value.status === "committed") !== (value.phase === "committed") || (value.status === "recovered" && value.phase !== "recovered")) fail("LIFECYCLE_JOURNAL_MALFORMED", "Upgrade journal status/phase combination is impossible");
  assertExactPaths(value, layout);
  return value;
}

function ownerValue(operationId, directory) {
  return { schemaVersion: 1, operationId, canonicalParent: canonical(path.dirname(directory), "LIFECYCLE_OWNER_INVALID") };
}

function writeOwnerMarker(operationId, directory, writeJson) {
  writeJson(path.join(directory, OWNER_FILE), ownerValue(operationId, directory));
}

function assertOwnerMarker(operationId, directory) {
  const markerPath = path.join(directory, OWNER_FILE);
  const stat = lstat(markerPath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail("LIFECYCLE_OWNER_INVALID", "Upgrade temporary directory has no safe ownership marker", { path: directory });
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { fail("LIFECYCLE_OWNER_INVALID", "Upgrade ownership marker is malformed", { path: directory }); }
  const expected = ownerValue(operationId, directory);
  if (!marker || marker.schemaVersion !== 1 || marker.operationId !== expected.operationId || comparable(marker.canonicalParent) !== comparable(expected.canonicalParent)) {
    fail("LIFECYCLE_OWNER_INVALID", "Upgrade ownership marker does not match the operation", { path: directory });
  }
  return markerPath;
}

function removeOwned(operationId, directory, allowedPaths, fsyncParent) {
  if (!lstat(directory)) return;
  if (!allowedPaths.some(candidate => comparable(candidate) === comparable(directory))) fail("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Cleanup path is not allowlisted", { path: directory });
  assertOwnerMarker(operationId, directory);
  fs.rmSync(directory, { recursive: true, force: true });
  fsyncParent(path.dirname(directory));
}

function inspectRelease(directory, sourceReceipt, expectedTargetVersion, expectedPaths, operationId) {
  const stat = lstat(directory);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UPGRADE_RECOVERY_TREE_INVALID", "Recovery candidate is not a regular directory", { path: directory });
  const canonicalDirectory = canonical(directory, "UPGRADE_RECOVERY_TREE_INVALID");
  if (comparable(canonicalDirectory) !== comparable(path.resolve(directory))) fail("UPGRADE_RECOVERY_TREE_INVALID", "Recovery candidate resolves through a link or reparse point", { path: directory });
  for (const name of REQUIRED_RELEASE_FILES) {
    const fileStat = lstat(path.join(directory, name));
    if (!fileStat || fileStat.isSymbolicLink() || !fileStat.isFile()) fail("UPGRADE_RECOVERY_TREE_INVALID", "Recovery candidate release file is unsafe", { path: path.join(directory, name) });
  }
  const contract = validateVersionContract({ ...loadContractFiles({ skillDir: directory }), nodeVersion: process.versions.node });
  const hash = hashReleaseTree(directory);
  const source = hash === sourceReceipt.releaseTreeSha256
    && contract.skillVersion === sourceReceipt.versions.skill
    && contract.configSchemaVersion === sourceReceipt.versions.configSchema
    && contract.stateSchemaVersion === sourceReceipt.versions.stateSchema;
  const target = contract.skillVersion === expectedTargetVersion && contract.releaseTag === "v" + expectedTargetVersion;
  if (target && comparable(directory) === comparable(expectedPaths.stagingDir)) assertOwnerMarker(operationId, directory);
  return { directory, contract, hash, source, target };
}

function verifyRecoveryCandidates(options, layout, journal) {
  const expectedPaths = assertExactPaths(journal, layout);
  let sourceReceipt;
  try { sourceReceipt = validateReceipt(JSON.parse(Buffer.from(journal.originalReceipt.base64, "base64").toString("utf8"))); } catch (error) { fail("UPGRADE_RECOVERY_SOURCE_INVALID", "Original install receipt is invalid", { causeCode: error.code }); }
  if (comparable(sourceReceipt.targetDir) !== comparable(expectedPaths.targetDir) || comparable(sourceReceipt.dataRoot) !== comparable(expectedPaths.dataRoot)
      || sourceReceipt.source.owner !== "lcc0628" || sourceReceipt.source.repo !== "rental-price-agent") fail("UPGRADE_RECOVERY_SOURCE_INVALID", "Original install receipt does not own this installation");
  const expectedTargetVersion = journal.targetVersion;
  if (journal.sourceVersion !== sourceReceipt.versions.skill) fail("UPGRADE_RECOVERY_TARGET_INVALID", "Journal versions do not match the verified source");
  if (journal.targetSource && (journal.targetSource.tag !== "v" + journal.targetVersion || journal.targetSource.owner !== sourceReceipt.source.owner || journal.targetSource.repo !== sourceReceipt.source.repo)) {
    fail("UPGRADE_RECOVERY_TARGET_INVALID", "Journal target source does not match its recorded release identity");
  }
  const candidates = [expectedPaths.targetDir, expectedPaths.stagingDir, expectedPaths.previousDir]
    .map(directory => inspectRelease(directory, sourceReceipt, expectedTargetVersion, expectedPaths, journal.operationId)).filter(Boolean);
  const sources = candidates.filter(candidate => candidate.source);
  const targets = candidates.filter(candidate => candidate.target);
  if (sources.length > 1 || targets.length > 1 || candidates.some(candidate => candidate.source && candidate.target)) fail("UPGRADE_RECOVERY_AMBIGUOUS", "Multiple independently valid recovery trees exist");
  if (journal.targetTreeSha256 && targets.length === 1 && journal.targetTreeSha256 !== targets[0].hash) fail("UPGRADE_RECOVERY_TARGET_INVALID", "Journal target hash does not corroborate the verified target tree");
  if (journal.sourceTreeSha256 !== sourceReceipt.releaseTreeSha256) fail("UPGRADE_RECOVERY_SOURCE_INVALID", "Journal source hash does not corroborate the verified receipt");
  return { expectedPaths, source: sources[0] || null, target: targets[0] || null };
}

function enumerateSchemaVersions(layout) {
  const versions = [];
  function readVersion(filePath, domain, field) {
    const stat = lstat(filePath);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile()) fail("TARGET_SCHEMA_INCOMPATIBLE", "Persisted schema document is unsafe", { path: filePath });
    let value;
    try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { fail("TARGET_SCHEMA_INCOMPATIBLE", "Persisted schema document is malformed", { path: filePath }); }
    const version = Array.isArray(value) || value[field] === undefined ? "0.0.0" : value[field];
    try { parseSemver(version, field); } catch { fail("TARGET_SCHEMA_INCOMPATIBLE", "Persisted schema version is malformed", { path: filePath, version }); }
    versions.push({ domain, path: filePath, version });
  }
  readVersion(layout.configPath, "configSchema", "configSchemaVersion");
  if (!lstat(layout.tasksDir)) return versions;
  for (const entry of fs.readdirSync(layout.tasksDir, { withFileTypes: true })) {
    const entryPath = path.join(layout.tasksDir, entry.name);
    if (entry.isSymbolicLink()) fail("TARGET_SCHEMA_INCOMPATIBLE", "State storage contains a link", { path: entryPath });
    if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("changes_")) readVersion(entryPath, "stateSchema", "stateSchemaVersion");
    if (entry.isDirectory() && entry.name === "batches") for (const batch of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (batch.isSymbolicLink()) fail("TARGET_SCHEMA_INCOMPATIBLE", "Batch storage contains a link", { path: path.join(entryPath, batch.name) });
      if (batch.isFile() && batch.name.endsWith(".json") && !batch.name.startsWith("changes_")) readVersion(path.join(entryPath, batch.name), "stateSchema", "stateSchemaVersion");
    }
  }
  return versions;
}

function assertSchemaCompatibility(layout, targetContract) {
  for (const item of enumerateSchemaVersions(layout)) {
    const range = targetContract.compatibility[item.domain];
    if (!range || compareSemver(item.version, range.min) < 0 || compareSemver(item.version, range.max) > 0) {
      fail("TARGET_SCHEMA_INCOMPATIBLE", "Persisted schema is outside the target release compatibility range", { domain: item.domain, path: item.path, version: item.version, range });
    }
  }
}

module.exports = {
  OWNER_FILE,
  assertOwnerMarker,
  assertSchemaCompatibility,
  deriveOperationPaths,
  enumerateSchemaVersions,
  removeOwned,
  validateJournal,
  verifyRecoveryCandidates,
  writeOwnerMarker,
};
