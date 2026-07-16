const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { stopValidatedDaemon } = require("./daemon-identity");
const { getInstallLayout } = require("./install-layout");
const { hashReleaseTree, readInstallReceipt, sha256File, validateReceipt, writeInstallReceipt, writeJsonAtomicDurable } = require("./install-receipt");
const { acquireLifecycleLock, assertSafePath, releaseLifecycleLockAfterFailure, releaseLifecycleLockForSuccess } = require("./lifecycle-install");
const { heartbeatLeaseLock, runWithLeaseHeartbeat } = require("./lease-lock");
const { readJournal: readUpgradeJournal } = require("./lifecycle-upgrade");
const { buildLiveStateSnapshot, enumerateDocuments } = require("./lifecycle-live-state");
const { writeRestartMarker } = require("./restart-session");
const { compareSemver, loadContractFiles, validateVersionContract } = require("./version-contract");

const JOURNAL_SCHEMA_VERSION = 1;
const ROLLBACK_PHASES = Object.freeze([
  "locked", "validated", "daemon-stopped", "candidate-move-planned", "current-candidate",
  "previous-move-planned", "previous-active", "doctor-passed", "receipt-write-planned",
  "receipt-written", "restart-write-planned", "restart-written", "previous-retain-planned",
  "previous-retained", "committed", "recovered",
]);
const JOURNAL_FIELDS = new Set([
  "schemaVersion", "operation", "operationId", "targetDir", "dataRoot", "previousDir", "candidateDir",
  "receiptPath", "restartMarkerPath", "journalPath", "currentVersion", "previousVersion",
  "currentTreeSha256", "previousTreeSha256", "currentReceipt", "previousReceipt", "originalReceipt",
  "originalRestartMarker", "phase", "status", "createdAt", "updatedAt", "completedAt", "error",
  "transitionHistory", "recoveryIntent",
]);
const REQUIRED_RELEASE_FILES = ["SKILL.md", "config.example.json", "package.json", "package-lock.json", "release-manifest.json"];

function rollbackError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function comparable(entryPath) {
  const resolved = path.resolve(entryPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function lstat(entryPath) {
  try { return fs.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function canonicalDirectory(entryPath, code) {
  const stat = lstat(entryPath);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw rollbackError(code, "Release slot must be a regular non-link directory", { path: entryPath });
  const canonical = fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
  if (comparable(canonical) !== comparable(entryPath)) throw rollbackError(code, "Release slot resolves through a link or junction", { path: entryPath });
  return canonical;
}

function nowIso(options) {
  return new Date((options.now || Date.now)()).toISOString();
}

function snapshotFile(filePath) {
  const stat = lstat(filePath);
  if (!stat) return { exists: false, base64: null };
  if (stat.isSymbolicLink() || !stat.isFile()) throw rollbackError("LIFECYCLE_CONTROL_FILE_UNSAFE", "Lifecycle control file must be a regular file", { path: filePath });
  return { exists: true, base64: fs.readFileSync(filePath).toString("base64") };
}

function fsyncParent(options, directoryPath) {
  try {
    if (typeof options.fsyncParent === "function") options.fsyncParent(directoryPath);
    else {
      const descriptor = fs.openSync(directoryPath, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
  } catch (error) {
    if (error && ["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
    throw rollbackError("PARENT_FSYNC_FAILED", "Containing directory could not be synchronized", { path: directoryPath, causeCode: error && error.code });
  }
}

function writeBufferAtomic(options, filePath, buffer) {
  const temporary = filePath + ".restore-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, buffer);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fsyncParent(options, path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

function restoreSnapshot(options, filePath, snapshot) {
  if (snapshot.exists) writeBufferAtomic(options, filePath, Buffer.from(snapshot.base64, "base64"));
  else if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
    fsyncParent(options, path.dirname(filePath));
  }
}

function operationToken(operationId) {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "operationId is invalid");
  return crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 16);
}

function derivePaths(layout, operationId) {
  const token = operationToken(operationId);
  return Object.freeze({
    targetDir: path.resolve(layout.targetDir), dataRoot: path.resolve(layout.dataRoot),
    previousDir: path.resolve(layout.targetDir + ".previous"),
    candidateDir: path.join(path.dirname(layout.targetDir), "." + path.basename(layout.targetDir) + "-rollback-candidate-" + token),
    receiptPath: path.resolve(layout.receiptPath), restartMarkerPath: path.resolve(layout.restartMarkerPath), journalPath: path.resolve(layout.journalPath),
  });
}

function assertExactPaths(value, layout) {
  const expected = derivePaths(layout, value.operationId);
  canonicalDirectory(path.dirname(layout.targetDir), "INVALID_INSTALL_TARGET");
  canonicalDirectory(layout.dataRoot, "INSTALL_DATA_ROOT_MISSING");
  for (const [field, expectedPath] of Object.entries(expected)) {
    if (typeof value[field] !== "string" || comparable(value[field]) !== comparable(expectedPath)) {
      throw rollbackError("LIFECYCLE_JOURNAL_PATH_MISMATCH", "Rollback journal path does not match its canonical operation path", { field, expected: expectedPath });
    }
  }
  return expected;
}

function validSnapshot(value) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.exists === "boolean"
    && ((value.exists && typeof value.base64 === "string") || (!value.exists && value.base64 === null));
}

function validateRollbackJournal(value, layout) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal must be an object");
  const unknown = Object.keys(value).filter(field => !JOURNAL_FIELDS.has(field));
  if (unknown.length || value.schemaVersion !== JOURNAL_SCHEMA_VERSION || value.operation !== "rollback") throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal schema is invalid", { field: unknown[0] });
  for (const field of ["operationId", "currentVersion", "previousVersion", "currentTreeSha256", "previousTreeSha256", "phase", "status", "createdAt", "updatedAt", "recoveryIntent"]) {
    if (typeof value[field] !== "string" || !value[field]) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal field is invalid", { field });
  }
  if (!["in-progress", "recovery-required", "committed", "recovered"].includes(value.status) || !ROLLBACK_PHASES.includes(value.phase)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal enum is invalid");
  if (!/^[a-f0-9]{64}$/.test(value.currentTreeSha256) || !/^[a-f0-9]{64}$/.test(value.previousTreeSha256)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal hash is invalid");
  if (!validSnapshot(value.originalReceipt) || !validSnapshot(value.originalRestartMarker)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal snapshot is invalid");
  let currentReceipt;
  let previousReceipt;
  let originalReceipt;
  try {
    currentReceipt = validateReceipt(value.currentReceipt);
    previousReceipt = validateReceipt(value.previousReceipt);
    originalReceipt = validateReceipt(JSON.parse(Buffer.from(value.originalReceipt.base64, "base64").toString("utf8")));
  } catch (error) { throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal receipt is invalid", { causeCode: error.code }); }
  if (JSON.stringify(currentReceipt) !== JSON.stringify(originalReceipt)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback current receipt does not match its durable restoration snapshot");
  if (!Array.isArray(value.transitionHistory) || !value.transitionHistory.length || value.transitionHistory[value.transitionHistory.length - 1] !== value.phase) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback transition history is invalid");
  for (let index = 1; index < value.transitionHistory.length; index++) {
    const before = value.transitionHistory[index - 1];
    const after = value.transitionHistory[index];
    const forward = ROLLBACK_PHASES.indexOf(after) === ROLLBACK_PHASES.indexOf(before) + 1;
    const recovered = after === "recovered" && value.status === "recovered" && index === value.transitionHistory.length - 1;
    if (!forward && !recovered) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal contains a skipped transition");
  }
  if ((value.status === "committed") !== (value.phase === "committed") || (value.status === "recovered" && value.phase !== "recovered")) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback journal status and phase disagree");
  const expected = assertExactPaths(value, layout);
  for (const receipt of [currentReceipt, previousReceipt]) {
    if (comparable(receipt.targetDir) !== comparable(expected.targetDir) || comparable(receipt.dataRoot) !== comparable(expected.dataRoot)) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Rollback receipt does not own the canonical installation");
  }
  return value;
}

function readRawJournal(layout) {
  const stat = lstat(layout.journalPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw rollbackError("LIFECYCLE_JOURNAL_UNSAFE_PATH", "Lifecycle journal must be a regular non-link file");
  try { return JSON.parse(fs.readFileSync(layout.journalPath, "utf8")); } catch { throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Lifecycle journal is not valid JSON"); }
}

function writeTransition(options, layout, journal, phase, patch = {}) {
  if (options.leaseLock) heartbeatLeaseLock(options.leaseLock, { operationPhase: phase, now: options.now });
  const previous = journal.transitionHistory[journal.transitionHistory.length - 1];
  const forward = previous === undefined || ROLLBACK_PHASES.indexOf(phase) === ROLLBACK_PHASES.indexOf(previous) + 1;
  const recovered = phase === "recovered" && journal.status === "recovered";
  if (!forward && !recovered) throw rollbackError("LIFECYCLE_JOURNAL_MALFORMED", "Invalid rollback transition", { previous, phase });
  journal.transitionHistory.push(phase);
  Object.assign(journal, patch, { phase, updatedAt: nowIso(options) });
  writeJsonAtomicDurable(layout.journalPath, journal);
  fsyncParent(options, path.dirname(layout.journalPath));
  if (typeof options.onPhase === "function") options.onPhase(phase, JSON.parse(JSON.stringify(journal)));
}

async function retryRename(options, from, to) {
  const renameSync = options.fsAdapter && options.fsAdapter.renameSync ? options.fsAdapter.renameSync : fs.renameSync.bind(fs);
  const attempts = options.retryAttempts === undefined ? 5 : options.retryAttempts;
  const sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      renameSync(from, to);
      fsyncParent(options, path.dirname(to));
      return;
    } catch (error) {
      if (error && error.code === "PARENT_FSYNC_FAILED") throw error;
      last = error;
      if (!error || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      if (attempt + 1 < attempts) await sleep(Math.min(250, 20 * (2 ** attempt)));
    }
  }
  throw rollbackError("ROLLBACK_SHARING_VIOLATION", "Windows sharing violation did not clear within bounded retries", { from, to, causeCode: last && last.code });
}

function inspectRelease(directory, receipt, invalidCode) {
  canonicalDirectory(directory, invalidCode);
  for (const name of REQUIRED_RELEASE_FILES) {
    const stat = lstat(path.join(directory, name));
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw rollbackError(invalidCode, "Release slot contains an unsafe required file", { path: path.join(directory, name) });
  }
  let contract;
  try { contract = validateVersionContract({ ...loadContractFiles({ skillDir: directory }), nodeVersion: process.versions.node }); } catch (error) { throw rollbackError(invalidCode, "Release contract is invalid", { causeCode: error.code }); }
  const treeSha256 = hashReleaseTree(directory);
  const sourceVerified = receipt.source.owner === "lcc0628" && receipt.source.repo === "rental-price-agent"
    && receipt.source.tag === contract.releaseTag && receipt.source.asset === "rental-price-agent-" + contract.releaseTag + ".tgz";
  const receiptVerified = receipt.versions.skill === contract.skillVersion && receipt.versions.daemon === contract.daemonVersion
    && receipt.versions.protocol === contract.protocolVersion && receipt.versions.configSchema === contract.configSchemaVersion
    && receipt.versions.stateSchema === contract.stateSchemaVersion && receipt.dependencyLockSha256 === sha256File(path.join(directory, "package-lock.json"));
  const treeVerified = receipt.releaseTreeSha256 === treeSha256;
  return { directory, contract, treeSha256, sourceVerified, receiptVerified, treeVerified };
}

function requireVerifiedRelease(release, code) {
  if (!release.sourceVerified) throw rollbackError(code === "ROLLBACK_CURRENT_INVALID" ? code : "ROLLBACK_PREVIOUS_SOURCE_MISMATCH", "Release source identity does not match its independently retained receipt");
  if (!release.receiptVerified || !release.treeVerified) throw rollbackError(code, "Release tree or receipt does not match", { treeVerified: release.treeVerified, receiptVerified: release.receiptVerified });
  return release;
}

function schemaReport(layout, previousContract) {
  let documents;
  try {
    documents = enumerateDocuments(layout).filter(item => item.schemaVersion !== null).map(item => ({
      domain: item.kind === "config" ? "configSchema" : "stateSchema",
      path: item.path,
      version: item.schemaVersion,
      kind: item.kind,
    }));
  } catch (error) {
    if (error.code === "ROLLBACK_STATE_INVALID") throw error;
    throw rollbackError("ROLLBACK_STATE_INVALID", "Mutable state documents could not be safely enumerated", { causeCode: error.code });
  }
  const blockers = [];
  const incompatible = [];
  for (const item of documents) {
    const range = previousContract.compatibility[item.domain];
    if (!range || compareSemver(item.version, range.min) < 0 || compareSemver(item.version, range.max) > 0) incompatible.push({ domain: item.domain, path: path.relative(layout.dataRoot, item.path), version: item.version, range });
  }
  if (incompatible.length) blockers.push("ROLLBACK_SCHEMA_INCOMPATIBLE");
  const relative = domain => [...new Set(documents.filter(item => item.domain === domain).map(item => item.version))].sort();
  const taskVersions = [];
  const batchVersions = [];
  for (const item of documents.filter(entry => entry.domain === "stateSchema")) {
    if (item.kind === "batch") batchVersions.push(item.version);
    else taskVersions.push(item.version);
  }
  return {
    schemas: { config: relative("configSchema"), task: [...new Set(taskVersions)].sort(), batch: [...new Set(batchVersions)].sort(), documents: documents.map(item => ({ domain: item.domain, path: path.relative(layout.dataRoot, item.path), version: item.version })) },
    compatibility: { compatible: incompatible.length === 0, readableRanges: previousContract.compatibility, incompatible }, blockers,
  };
}

function validatePlan(layout) {
  const raw = readRawJournal(layout);
  if (!raw || raw.operation !== "upgrade" || raw.status !== "committed") throw rollbackError("ROLLBACK_PREVIOUS_UNAVAILABLE", "Rollback requires the one retained previous release from the last committed upgrade");
  let upgradeJournal;
  try { upgradeJournal = readUpgradeJournal(layout); } catch (error) { throw rollbackError("ROLLBACK_PREVIOUS_INVALID", "Committed upgrade provenance is invalid", { causeCode: error.code }); }
  if (!upgradeJournal || upgradeJournal.status !== "committed" || !upgradeJournal.targetReceipt) throw rollbackError("ROLLBACK_PREVIOUS_UNAVAILABLE", "Committed upgrade does not retain a rollback receipt");
  const currentReceipt = readInstallReceipt({ targetDir: layout.targetDir });
  if (!currentReceipt || JSON.stringify(currentReceipt) !== JSON.stringify(upgradeJournal.targetReceipt)) throw rollbackError("ROLLBACK_CURRENT_INVALID", "Current receipt does not match the committed upgrade target receipt");
  const previousReceipt = validateReceipt(upgradeJournal.sourceReceipt);
  if (comparable(previousReceipt.targetDir) !== comparable(currentReceipt.targetDir) || comparable(previousReceipt.dataRoot) !== comparable(currentReceipt.dataRoot)) throw rollbackError("ROLLBACK_PREVIOUS_SOURCE_MISMATCH", "Previous receipt does not own this installation");
  const previousStat = lstat(layout.targetDir + ".previous");
  if (!previousStat) throw rollbackError("ROLLBACK_PREVIOUS_UNAVAILABLE", "No retained previous release exists");
  if (previousStat.isSymbolicLink() || !previousStat.isDirectory()) throw rollbackError("ROLLBACK_PREVIOUS_INVALID", "Retained previous release is not a regular non-link directory");
  const current = requireVerifiedRelease(inspectRelease(layout.targetDir, currentReceipt, "ROLLBACK_CURRENT_INVALID"), "ROLLBACK_CURRENT_INVALID");
  let previous;
  try { previous = requireVerifiedRelease(inspectRelease(layout.targetDir + ".previous", previousReceipt, "ROLLBACK_PREVIOUS_INVALID"), "ROLLBACK_PREVIOUS_INVALID"); }
  catch (error) {
    if (error.code === "ROLLBACK_PREVIOUS_INVALID" && lstat(layout.targetDir + ".previous")) {
      try {
        const candidate = inspectRelease(layout.targetDir + ".previous", currentReceipt, "ROLLBACK_PREVIOUS_INVALID");
        if (candidate.treeVerified && candidate.receiptVerified && candidate.sourceVerified) throw rollbackError("ROLLBACK_RELEASE_AMBIGUOUS", "Current release also occupies the previous slot");
      } catch (candidateError) { if (candidateError.code === "ROLLBACK_RELEASE_AMBIGUOUS") throw candidateError; }
    }
    throw error;
  }
  if (current.treeSha256 === previous.treeSha256 || current.contract.skillVersion === previous.contract.skillVersion) throw rollbackError("ROLLBACK_RELEASE_AMBIGUOUS", "Current and previous release identities are ambiguous");
  if (compareSemver(previous.contract.skillVersion, current.contract.skillVersion) >= 0) throw rollbackError("ROLLBACK_PREVIOUS_SOURCE_MISMATCH", "Retained previous release is not the immediately older source release");
  if (upgradeJournal.sourceTreeSha256 !== previous.treeSha256 || upgradeJournal.targetTreeSha256 !== current.treeSha256
      || upgradeJournal.sourceVersion !== previous.contract.skillVersion || upgradeJournal.targetVersion !== current.contract.skillVersion) {
    throw rollbackError("ROLLBACK_PREVIOUS_SOURCE_MISMATCH", "Retained release identities do not match the committed upgrade");
  }
  const schema = schemaReport(layout, previous.contract);
  return { currentReceipt, previousReceipt, current, previous, schema };
}

function dryRunResult(layout, plan, liveState) {
  return {
    command: "rollback", status: plan.schema.blockers.length ? "blocked" : "dry-run", code: plan.schema.blockers[0] || "ROLLBACK_DRY_RUN", dryRun: true,
    targetDir: layout.targetDir, dataRoot: layout.dataRoot,
    current: { version: plan.current.contract.skillVersion, releaseTreeSha256: plan.current.treeSha256, receipt: plan.currentReceipt, receiptVerified: true, treeVerified: true, sourceIdentityVerified: true },
    previous: { version: plan.previous.contract.skillVersion, path: layout.targetDir + ".previous", releaseTreeSha256: plan.previous.treeSha256, receipt: plan.previousReceipt, receiptVerified: true, treeVerified: true, sourceIdentityVerified: true },
    schemas: plan.schema.schemas, compatibility: plan.schema.compatibility, blockers: plan.schema.blockers,
    snapshot: liveState.snapshot,
    confirmationToken: liveState.confirmationToken,
    confirmation: { argument: "--confirm", version: plan.previous.contract.skillVersion, token: liveState.confirmationToken, exact: "--confirm " + liveState.confirmationToken },
    reverseMigrationsApplied: false,
  };
}

function identifyRecoveryTrees(layout, journal) {
  const paths = assertExactPaths(journal, layout);
  const found = [];
  for (const directory of [paths.targetDir, paths.previousDir, paths.candidateDir]) {
    if (!lstat(directory)) continue;
    canonicalDirectory(directory, "ROLLBACK_RECOVERY_TREE_INVALID");
    let hash;
    try { hash = hashReleaseTree(directory); } catch (error) { throw rollbackError("ROLLBACK_RECOVERY_TREE_INVALID", "Rollback recovery tree is invalid", { path: directory, causeCode: error.code }); }
    const kind = hash === journal.currentTreeSha256 ? "current" : hash === journal.previousTreeSha256 ? "previous" : "unknown";
    if (kind === "unknown") throw rollbackError("ROLLBACK_RECOVERY_TREE_INVALID", "Rollback recovery found an unverified release tree", { path: directory });
    const receipt = kind === "current" ? journal.currentReceipt : journal.previousReceipt;
    const release = requireVerifiedRelease(inspectRelease(directory, receipt, "ROLLBACK_RECOVERY_TREE_INVALID"), "ROLLBACK_RECOVERY_TREE_INVALID");
    found.push({ directory, kind, release });
  }
  if (found.filter(item => item.kind === "current").length !== 1 || found.filter(item => item.kind === "previous").length !== 1) throw rollbackError("ROLLBACK_RECOVERY_AMBIGUOUS", "Rollback recovery requires exactly one independently valid tree of each release");
  return { paths, current: found.find(item => item.kind === "current"), previous: found.find(item => item.kind === "previous") };
}

async function restoreOriginal(options, layout, journal) {
  const trees = identifyRecoveryTrees(layout, journal);
  const target = trees.paths.targetDir;
  const previous = trees.paths.previousDir;
  const candidate = trees.paths.candidateDir;
  if (comparable(trees.current.directory) !== comparable(target)) {
    if (comparable(trees.previous.directory) === comparable(target)) {
      if (comparable(trees.current.directory) === comparable(previous)) {
        if (lstat(candidate)) throw rollbackError("ROLLBACK_RECOVERY_AMBIGUOUS", "Rollback recovery candidate path is occupied");
        await retryRename(options, target, candidate);
        await retryRename(options, previous, target);
        await retryRename(options, candidate, previous);
      } else {
        if (lstat(previous)) throw rollbackError("ROLLBACK_RECOVERY_AMBIGUOUS", "Rollback previous path is occupied");
        await retryRename(options, target, previous);
        await retryRename(options, trees.current.directory, target);
      }
    } else {
      if (lstat(target)) throw rollbackError("ROLLBACK_RECOVERY_AMBIGUOUS", "Rollback active path contains an unexpected release");
      await retryRename(options, trees.current.directory, target);
    }
  }
  const verified = identifyRecoveryTrees(layout, journal);
  if (comparable(verified.current.directory) !== comparable(target) || comparable(verified.previous.directory) !== comparable(previous)) throw rollbackError("ROLLBACK_RECOVERY_FAILED", "Rollback recovery did not restore canonical slots");
  restoreSnapshot(options, layout.receiptPath, journal.originalReceipt);
  restoreSnapshot(options, layout.restartMarkerPath, journal.originalRestartMarker);
  journal.status = "recovered";
  journal.recoveryIntent = "restore-current";
  journal.error = null;
  writeTransition(options, layout, journal, "recovered");
  return { command: "rollback", status: "recovered", code: "ROLLBACK_RECOVERED", version: journal.currentVersion };
}

async function recoverPriorRollback(options, layout) {
  const raw = readRawJournal(layout);
  if (!raw || raw.operation !== "rollback") return { recovered: false };
  const journal = validateRollbackJournal(raw, layout);
  if (journal.status === "committed" || journal.status === "recovered") return { recovered: false, terminal: true, status: journal.status };
  return { recovered: true, result: await restoreOriginal(options, layout, journal) };
}

async function validateRollbackDoctor(options, layout) {
  const doctor = await options.runDoctor({ targetDir: layout.targetDir, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions, nodeVersion: options.nodeVersion });
  const allowed = new Set(["INSTALL_RECEIPT_RELEASE_MISMATCH", "RELEASE_TREE_DRIFT", "DEPENDENCY_LOCK_DRIFT", "LIFECYCLE_LOCK_PRESENT", "LIFECYCLE_JOURNAL_INTERRUPTED", "RESTART_REQUIRED", "ENV_MISSING", "ENV_INCOMPLETE"]);
  const blockers = (doctor.blockers || []).filter(code => !allowed.has(code));
  if (blockers.length) throw rollbackError("ROLLBACK_POST_CHECK_FAILED", "Previous release failed offline doctor against unchanged mutable data", { blockers });
  return doctor;
}

async function runRollback(options = {}) {
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) throw rollbackError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  if (options.dryRun === true && options.confirm !== undefined) throw rollbackError("INVALID_ARGUMENT", "Dry-run cannot be combined with rollback confirmation");
  if (options.confirm !== undefined && (typeof options.confirm !== "string" || !options.confirm)) throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "--confirm requires the exact preview token");
  if (typeof options.runDoctor !== "function") throw rollbackError("INVALID_ROLLBACK_RUNTIME", "runDoctor is required");
  const layout = getInstallLayout(options.targetDir);
  assertSafePath(path.dirname(layout.targetDir), "INVALID_INSTALL_TARGET");
  assertSafePath(layout.dataRoot, "UNSAFE_DATA_ROOT");
  let rawJournal;
  try { rawJournal = readRawJournal(layout); } catch (error) {
    if (options.confirm !== undefined) throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "Lifecycle journal changed after preview", { causeCode: error.code });
    throw error;
  }
  if (!options.recoverOnly && lstat(layout.lockPath)) {
    if (options.confirm !== undefined) throw rollbackError("LIFECYCLE_LOCKED", "Another lifecycle operation owns the target");
    return {
      command: "rollback", status: "blocked", code: "LIFECYCLE_LOCK_PRESENT", dryRun: true,
      targetDir: layout.targetDir, dataRoot: layout.dataRoot, blockers: ["LIFECYCLE_LOCK_PRESENT"], reverseMigrationsApplied: false,
    };
  }
  if (!options.recoverOnly && rawJournal && rawJournal.status !== "committed") {
    if (options.confirm !== undefined) throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "Lifecycle journal changed after preview");
    return {
      command: "rollback", status: "blocked", code: "LIFECYCLE_JOURNAL_INTERRUPTED", dryRun: true,
      targetDir: layout.targetDir, dataRoot: layout.dataRoot, blockers: ["LIFECYCLE_JOURNAL_INTERRUPTED"],
      lifecycle: { operation: rawJournal.operation || null, status: rawJournal.status || null }, reverseMigrationsApplied: false,
    };
  }
  if (!options.recoverOnly) {
    let preflightPlan;
    let preflightState;
    try {
      preflightPlan = validatePlan(layout);
      preflightState = buildLiveStateSnapshot(layout, preflightPlan);
    } catch (error) {
      if (options.confirm !== undefined && error.code !== "ROLLBACK_STATE_INVALID") {
        throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "Rollback state changed after preview", { causeCode: error.code });
      }
      throw error;
    }
    if (options.confirm === undefined) return dryRunResult(layout, preflightPlan, preflightState);
    if (!/^.+@[a-f0-9]{64}$/.test(options.confirm) || options.confirm !== preflightState.confirmationToken) {
      throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "--confirm must exactly match the current dry-run snapshot", { expected: preflightState.confirmationToken, actual: options.confirm });
    }
    if (preflightPlan.schema.blockers.length) throw rollbackError("ROLLBACK_SCHEMA_INCOMPATIBLE", "Current mutable schemas are outside the previous release readable range", preflightPlan.schema.compatibility);
  }
  const lock = acquireLifecycleLock(layout, options);
  options.leaseLock = lock;
  let journal;
  let swapped = false;
  let lockReleased = false;
  try {
    const recovery = await recoverPriorRollback(options, layout);
    if (recovery.recovered || options.recoverOnly) {
      const result = recovery.recovered
        ? recovery.result
        : { command: "rollback", status: "noop", code: "ROLLBACK_RECOVERY_NOT_REQUIRED" };
      releaseLifecycleLockForSuccess(layout, lock, false, rollbackError);
      lockReleased = true;
      delete options.leaseLock;
      return result;
    }
    const plan = validatePlan(layout);
    const lockedState = buildLiveStateSnapshot(layout, plan);
    if (options.confirm !== lockedState.confirmationToken) throw rollbackError("ROLLBACK_CONFIRMATION_STALE", "Live state changed after rollback confirmation", { expected: lockedState.confirmationToken, actual: options.confirm });
    if (plan.schema.blockers.length) throw rollbackError("ROLLBACK_SCHEMA_INCOMPATIBLE", "Current mutable schemas are outside the previous release readable range", plan.schema.compatibility);

    const operationId = lock.owner.operationId;
    const paths = derivePaths(layout, operationId);
    if (lstat(paths.candidateDir)) throw rollbackError("ROLLBACK_CANDIDATE_OCCUPIED", "Rollback candidate path is already occupied");
    journal = {
      schemaVersion: JOURNAL_SCHEMA_VERSION, operation: "rollback", operationId,
      ...paths, currentVersion: plan.current.contract.skillVersion, previousVersion: plan.previous.contract.skillVersion,
      currentTreeSha256: plan.current.treeSha256, previousTreeSha256: plan.previous.treeSha256,
      currentReceipt: plan.currentReceipt, previousReceipt: plan.previousReceipt,
      originalReceipt: snapshotFile(layout.receiptPath), originalRestartMarker: snapshotFile(layout.restartMarkerPath),
      phase: "locked", status: "in-progress", createdAt: nowIso(options), updatedAt: nowIso(options),
      completedAt: null, error: null, transitionHistory: [], recoveryIntent: "restore-current",
    };
    writeTransition(options, layout, journal, "locked");
    writeTransition(options, layout, journal, "validated");
    const stopped = await runWithLeaseHeartbeat(lock, "daemon-stopping", () => (options.stopValidatedDaemon || stopValidatedDaemon)({ layout, targetDir: layout.targetDir, processInspector: options.processInspector, requestHello: options.requestHello, killAdapter: options.killAdapter, now: options.now }), options);
    if (!stopped || !["DAEMON_STOPPED", "DAEMON_ALREADY_STOPPED"].includes(stopped.code)) throw rollbackError(stopped && stopped.code || "DAEMON_STOP_FAILED", "Validated daemon stop failed");
    writeTransition(options, layout, journal, "daemon-stopped");
    writeTransition(options, layout, journal, "candidate-move-planned");
    await retryRename(options, layout.targetDir, paths.candidateDir);
    requireVerifiedRelease(inspectRelease(paths.candidateDir, plan.currentReceipt, "ROLLBACK_CURRENT_INVALID"), "ROLLBACK_CURRENT_INVALID");
    writeTransition(options, layout, journal, "current-candidate");
    writeTransition(options, layout, journal, "previous-move-planned");
    await retryRename(options, paths.previousDir, layout.targetDir);
    swapped = true;
    requireVerifiedRelease(inspectRelease(layout.targetDir, plan.previousReceipt, "ROLLBACK_PREVIOUS_INVALID"), "ROLLBACK_PREVIOUS_INVALID");
    writeTransition(options, layout, journal, "previous-active");
    const doctor = await runWithLeaseHeartbeat(lock, "rollback-doctor", () => validateRollbackDoctor(options, layout), options);
    writeTransition(options, layout, journal, "doctor-passed");
    writeTransition(options, layout, journal, "receipt-write-planned");
    const source = { ...plan.previousReceipt.source };
    delete source.provider;
    const receipt = await (options.writeReceipt || writeInstallReceipt)({ targetDir: layout.targetDir, source, browser: plan.currentReceipt.browser, installedAt: options.installedAt, nodeVersion: options.nodeVersion });
    fsyncParent(options, path.dirname(layout.receiptPath));
    if (receipt.releaseTreeSha256 !== plan.previous.treeSha256 || receipt.versions.skill !== plan.previous.contract.skillVersion) throw rollbackError("ROLLBACK_RECEIPT_INVALID", "Rollback receipt does not identify the activated previous release");
    writeTransition(options, layout, journal, "receipt-written");
    writeTransition(options, layout, journal, "restart-write-planned");
    const marker = (options.writeRestartMarker || writeRestartMarker)(layout, { activatingReleaseTreeSha256: receipt.releaseTreeSha256, activationId: operationId, sessionId: options.sessionId || process.env.OPENCODE_SESSION_ID || "rollback-process-" + process.pid, reason: "rollback", createdAt: nowIso(options) });
    fsyncParent(options, path.dirname(layout.restartMarkerPath));
    writeTransition(options, layout, journal, "restart-written");
    writeTransition(options, layout, journal, "previous-retain-planned");
    requireVerifiedRelease(inspectRelease(paths.candidateDir, plan.currentReceipt, "ROLLBACK_CURRENT_INVALID"), "ROLLBACK_CURRENT_INVALID");
    if (lstat(paths.previousDir)) throw rollbackError("ROLLBACK_PREVIOUS_OCCUPIED", "Previous slot was unexpectedly recreated");
    await retryRename(options, paths.candidateDir, paths.previousDir);
    requireVerifiedRelease(inspectRelease(paths.previousDir, plan.currentReceipt, "ROLLBACK_CURRENT_INVALID"), "ROLLBACK_CURRENT_INVALID");
    writeTransition(options, layout, journal, "previous-retained");
    journal.status = "committed";
    journal.recoveryIntent = "keep-previous-active";
    writeTransition(options, layout, journal, "committed", { completedAt: nowIso(options) });
    releaseLifecycleLockForSuccess(layout, lock, true, rollbackError);
    lockReleased = true;
    delete options.leaseLock;
    return {
      command: "rollback", status: "rolled-back", code: "ROLLBACK_OK", targetDir: layout.targetDir, dataRoot: layout.dataRoot,
      version: plan.previous.contract.skillVersion, releaseTreeSha256: plan.previous.treeSha256,
      previous: { path: paths.previousDir, version: plan.current.contract.skillVersion, releaseTreeSha256: plan.current.treeSha256 },
      receipt, restartRequired: marker.required, reverseMigrationsApplied: false,
      schemas: plan.schema.schemas, compatibility: plan.schema.compatibility, doctor: { blockers: doctor.blockers || [], warnings: doctor.warnings || [] },
    };
  } catch (error) {
    if (error.code === "LIFECYCLE_LOCK_RELEASE_FAILED" || lockReleased) {
      delete options.leaseLock;
      throw error;
    }
    let primaryError = error;
    if (error && error.simulatedCrash === true) {
      releaseLifecycleLockAfterFailure(layout, lock, primaryError);
      delete options.leaseLock;
      throw primaryError;
    }
    if (journal) {
      journal.error = { code: error.code || "ROLLBACK_FAILED", message: error.message, at: nowIso(options) };
      try {
        writeJsonAtomicDurable(layout.journalPath, journal);
        fsyncParent(options, path.dirname(layout.journalPath));
        await restoreOriginal(options, layout, journal);
      } catch (recoveryError) {
        journal.status = "recovery-required";
        journal.recoveryIntent = "restore-current";
        if (journal.error) journal.error.recoveryCode = recoveryError.code || "ROLLBACK_RECOVERY_FAILED";
        try { writeJsonAtomicDurable(layout.journalPath, journal); fsyncParent(options, path.dirname(layout.journalPath)); } catch {}
        primaryError = rollbackError("ROLLBACK_RECOVERY_FAILED", "Rollback failed and original current release could not be restored", { originalCode: error.code || null, recoveryCode: recoveryError.code || null, swapped });
      }
    }
    releaseLifecycleLockAfterFailure(layout, lock, primaryError);
    delete options.leaseLock;
    throw primaryError;
  }
}

module.exports = { JOURNAL_SCHEMA_VERSION, ROLLBACK_PHASES, derivePaths, recoverPriorRollback, runRollback, validateRollbackJournal };
