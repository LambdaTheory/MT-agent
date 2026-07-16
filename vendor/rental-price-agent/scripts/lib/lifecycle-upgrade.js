const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const { prepareStagingReadiness } = require("./dependency-install");
const { stopValidatedDaemon } = require("./daemon-identity");
const { getInstallLayout } = require("./install-layout");
const { hashReleaseTree, readInstallReceipt, writeInstallReceipt, writeJsonAtomicDurable } = require("./install-receipt");
const { acquireLifecycleLock, assertSafePath, releaseLifecycleLockAfterFailure, releaseLifecycleLockForSuccess } = require("./lifecycle-install");
const { heartbeatLeaseLock, runWithLeaseHeartbeat } = require("./lease-lock");
const { stageGiteeRelease } = require("./release-source");
const { writeRestartMarker } = require("./restart-session");
const dataTransaction = require("./upgrade-data-transaction");
const { compareSemver, loadContractFiles, validateVersionContract } = require("./version-contract");
const upgradeSafety = require("./lifecycle-upgrade-safety");

const EXPECTED_REPO = "lcc0628/rental-price-agent";
const JOURNAL_SCHEMA_VERSION = 1;
const CONTROL_NAMES = new Set(["lifecycle.lock", "install-receipt.json", "lifecycle-journal.json", "restart-required.json", "daemon-stop.lock"]);
// allow: SIZE_OK — the crash-recovery state machine stays contiguous so every durable boundary is reviewable in execution order.
const UPGRADE_PHASES = Object.freeze([
  "locked", "recovered", "current-validated", "operations-clear", "daemon-draining", "daemon-stopped",
  "profile-released", "staged", "staging-ready", "temporary-data-migrated", "staging-doctor-passed",
  "data-backup-planned", "data-backed-up",
  "retention-planned", "retention-complete", "active-move-planned", "active-moved",
  "staging-move-planned", "staging-activated", "data-install-planned", "data-installed", "receipt-write-planned", "receipt-written",
  "restart-write-planned", "restart-written", "post-check-passed", "committed",
]);

function upgradeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function nowIso(options) {
  return new Date((options.now || Date.now)()).toISOString();
}

function lstat(entryPath) {
  try { return fs.lstatSync(entryPath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function canonicalExisting(entryPath, code) {
  const stat = lstat(entryPath);
  if (!stat || stat.isSymbolicLink()) throw upgradeError(code, "Path must exist and cannot be a link or junction", { path: entryPath });
  return fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
}

function snapshotFile(filePath) {
  const stat = lstat(filePath);
  if (!stat) return { exists: false, base64: null };
  if (stat.isSymbolicLink() || !stat.isFile()) throw upgradeError("LIFECYCLE_CONTROL_FILE_UNSAFE", "Lifecycle control file must be a regular file", { path: filePath });
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
    throw upgradeError("PARENT_FSYNC_FAILED", "Containing directory could not be synchronized", { path: directoryPath, causeCode: error && error.code });
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

function readJournal(layout) {
  const stat = lstat(layout.journalPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw upgradeError("LIFECYCLE_JOURNAL_UNSAFE_PATH", "Lifecycle journal must be a regular non-link file");
  let value;
  try { value = JSON.parse(fs.readFileSync(layout.journalPath, "utf8")); } catch { throw upgradeError("LIFECYCLE_JOURNAL_MALFORMED", "Lifecycle journal is not valid JSON"); }
  if (value.operation !== "upgrade") {
    if (value.operation === "install" && value.schemaVersion === 1 && value.status === "complete") return null;
    if (value.operation === "rollback" && value.schemaVersion === 1 && ["committed", "recovered"].includes(value.status)) return null;
    throw upgradeError("LIFECYCLE_JOURNAL_INTERRUPTED", "A different lifecycle operation is incomplete");
  }
  return upgradeSafety.validateJournal(value, layout, UPGRADE_PHASES, JOURNAL_SCHEMA_VERSION);
}

function writeTransition(options, layout, journal, phase, patch = {}) {
  if (options.leaseLock) heartbeatLeaseLock(options.leaseLock, { operationPhase: phase, now: options.now });
  const previous = journal.transitionHistory[journal.transitionHistory.length - 1];
  const forward = previous === undefined || UPGRADE_PHASES.indexOf(phase) === UPGRADE_PHASES.indexOf(previous) + 1;
  const recovery = phase === "recovered" && journal.status === "recovered";
  if (!forward && !recovery) throw upgradeError("LIFECYCLE_JOURNAL_MALFORMED", "Invalid upgrade transition", { previous, phase });
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
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      if (attempt + 1 < attempts) await sleep(Math.min(250, 20 * (2 ** attempt)));
    }
  }
  throw upgradeError("ACTIVATION_SHARING_VIOLATION", "Windows sharing violation did not clear within bounded retries", { from, to, causeCode: last && last.code });
}

async function restoreOldActive(options, layout, journal) {
  const verified = upgradeSafety.verifyRecoveryCandidates(options, layout, journal);
  const allowed = [verified.expectedPaths.stagingDir, verified.expectedPaths.retainedPreviousDir, verified.expectedPaths.temporaryDataRoot];
  if (!verified.source) throw upgradeError("UPGRADE_RECOVERY_SOURCE_INVALID", "No independently verified source tree exists");
  if (verified.source.directory !== verified.expectedPaths.targetDir) {
    if (verified.source.directory !== verified.expectedPaths.previousDir) throw upgradeError("UPGRADE_RECOVERY_SOURCE_INVALID", "Verified source is in an impossible slot");
    if (verified.target && verified.target.directory === verified.expectedPaths.targetDir) {
      if (fs.existsSync(verified.expectedPaths.stagingDir)) throw upgradeError("UPGRADE_RECOVERY_BLOCKED", "Recovery staging path is occupied");
      const markerPath = path.join(verified.expectedPaths.targetDir, upgradeSafety.OWNER_FILE);
      if (!fs.existsSync(markerPath)) upgradeSafety.writeOwnerMarker(journal.operationId, verified.expectedPaths.targetDir, writeJsonAtomicDurable);
      await retryRename(options, verified.expectedPaths.targetDir, verified.expectedPaths.stagingDir);
    } else if (fs.existsSync(verified.expectedPaths.targetDir)) {
      throw upgradeError("UPGRADE_RECOVERY_AMBIGUOUS", "Active slot contains an unverified tree");
    }
    await retryRename(options, verified.expectedPaths.previousDir, verified.expectedPaths.targetDir);
  }
  restoreSnapshot(options, layout.receiptPath, journal.originalReceipt);
  restoreSnapshot(options, layout.restartMarkerPath, journal.originalRestartMarker);
  if (UPGRADE_PHASES.indexOf(journal.phase) >= UPGRADE_PHASES.indexOf("data-backed-up")) {
    dataTransaction.restoreDataFiles(layout, journal.dataFiles, journal.dataBackupRoot, directory => fsyncParent(options, directory));
  }
  if (fs.existsSync(verified.expectedPaths.retainedPreviousDir)) {
    upgradeSafety.assertOwnerMarker(journal.operationId, verified.expectedPaths.retainedPreviousDir);
    if (fs.existsSync(verified.expectedPaths.previousDir)) throw upgradeError("UPGRADE_RECOVERY_AMBIGUOUS", "Previous and retained previous both exist");
    fs.rmSync(path.join(verified.expectedPaths.retainedPreviousDir, upgradeSafety.OWNER_FILE), { force: true });
    await retryRename(options, verified.expectedPaths.retainedPreviousDir, verified.expectedPaths.previousDir);
  }
  upgradeSafety.removeOwned(journal.operationId, verified.expectedPaths.stagingDir, allowed, directory => fsyncParent(options, directory));
  upgradeSafety.removeOwned(journal.operationId, verified.expectedPaths.temporaryDataRoot, allowed, directory => fsyncParent(options, directory));
  journal.status = "recovered";
  journal.recoveryIntent = "restore-source";
  journal.error = null;
  writeTransition(options, layout, journal, "recovered");
  return { recovered: true, sourceTreeSha256: journal.sourceTreeSha256 };
}

async function recoverPriorJournal(options, layout) {
  const journal = readJournal(layout);
  if (!journal) return { recovered: false };
  if (journal.status === "committed") {
    const verified = upgradeSafety.verifyRecoveryCandidates(options, layout, journal);
    if (!verified.target || verified.target.directory !== verified.expectedPaths.targetDir) throw upgradeError("UPGRADE_RECOVERY_TARGET_INVALID", "Committed active tree is not the verified target");
    if (!verified.source || verified.source.directory !== verified.expectedPaths.previousDir) throw upgradeError("UPGRADE_RECOVERY_SOURCE_INVALID", "Committed previous tree is not the verified source");
    const allowed = [verified.expectedPaths.stagingDir, verified.expectedPaths.retainedPreviousDir, verified.expectedPaths.temporaryDataRoot];
    upgradeSafety.removeOwned(journal.operationId, verified.expectedPaths.retainedPreviousDir, allowed, directory => fsyncParent(options, directory));
    upgradeSafety.removeOwned(journal.operationId, verified.expectedPaths.stagingDir, allowed, directory => fsyncParent(options, directory));
    upgradeSafety.removeOwned(journal.operationId, verified.expectedPaths.temporaryDataRoot, allowed, directory => fsyncParent(options, directory));
    fs.rmSync(layout.journalPath, { force: true });
    fsyncParent(options, path.dirname(layout.journalPath));
    return { recovered: false, committed: true };
  }
  return restoreOldActive(options, layout, journal);
}

function enumerateUnresolved(layout) {
  const unresolved = [];
  if (!fs.existsSync(layout.tasksDir)) return unresolved;
  const pendingStates = new Set(["pending", "running", "active", "applying", "recovering", "rollback-pending", "interrupted"]);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw upgradeError("STATE_STORAGE_UNSAFE", "State storage contains a link", { path: entryPath });
      if (entry.isDirectory()) { visit(entryPath); continue; }
      if (!entry.isFile()) continue;
      if (/recover|rollback|pending/i.test(entry.name) && !entry.name.endsWith(".json")) unresolved.push(entryPath);
      if (!entry.name.endsWith(".json") || entry.name.startsWith("changes_")) continue;
      let value;
      try { value = JSON.parse(fs.readFileSync(entryPath, "utf8")); } catch { throw upgradeError("STATE_DOCUMENT_MALFORMED", "Persisted operation state is malformed", { path: entryPath }); }
      const state = String(value.status || value.state || value.phase || "").toLowerCase();
      if (pendingStates.has(state) || value.recoveryRequired === true || value.rollbackRequired === true) unresolved.push(entryPath);
    }
  }
  visit(layout.tasksDir);
  return [...new Set(unresolved)].sort();
}

function copyTemporaryData(layout, temporaryDataRoot, files) {
  fs.mkdirSync(temporaryDataRoot, { recursive: true });
  for (const file of files) {
    const source = path.join(layout.dataRoot, ...file.relativePath.split("/"));
    const destination = path.join(temporaryDataRoot, ...file.relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

function defaultProfileReleased(layout) {
  const lockNames = ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"];
  const locked = lockNames.filter(name => fs.existsSync(path.join(layout.browserProfileDir, name)));
  return locked.length ? { released: false, code: "BROWSER_PROFILE_LOCKED", locked } : { released: true };
}

async function defaultDrain(options, layout) {
  const identityPath = layout.daemonIdentityPath;
  if (!fs.existsSync(identityPath)) return { drained: true, code: "DAEMON_ALREADY_STOPPED" };
  let identity;
  let token;
  try {
    identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    token = fs.readFileSync(layout.daemonTokenPath, "utf8").trim();
  } catch { return { drained: false, code: "DAEMON_IDENTITY_MALFORMED" }; }
  return new Promise(resolve => {
    const request = http.request({ hostname: "127.0.0.1", port: identity.port, path: "/", method: "POST", headers: { "content-type": "application/json", "x-rental-agent-token": token } }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        try {
          const result = JSON.parse(body);
          resolve(result.status === "ok" && result.drained === true ? { drained: true, code: "DAEMON_DRAINED" } : { drained: false, code: result.code || "DAEMON_DRAIN_FAILED" });
        } catch { resolve({ drained: false, code: "DAEMON_DRAIN_FAILED" }); }
      });
    });
    request.setTimeout(options.drainTimeoutMs || 5000, () => request.destroy(upgradeError("DAEMON_DRAIN_TIMEOUT", "Daemon drain timed out")));
    request.on("error", error => resolve({ drained: false, code: error.code === "DAEMON_DRAIN_TIMEOUT" ? error.code : "DAEMON_DRAIN_FAILED" }));
    request.end(JSON.stringify({ action: "lifecycle-drain", expectedInstanceId: identity.instanceId, releaseTreeSha256: identity.releaseTreeSha256 }));
  });
}

async function validateStagingDoctor(options, stagingDir) {
  const doctor = await options.runDoctor({ targetDir: stagingDir, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions, nodeVersion: options.nodeVersion });
  const allowed = new Set(["INSTALL_RECEIPT_MISSING", "RESTART_NOT_REQUIRED", "ENV_MISSING", "ENV_INCOMPLETE"]);
  const blockers = doctor.blockers.filter(code => !allowed.has(code));
  if (blockers.length) throw upgradeError("STAGING_DOCTOR_FAILED", "Staged release failed offline doctor", { blockers });
  return doctor;
}

async function runUpgrade(options = {}) {
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) throw upgradeError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  if (options.repo !== EXPECTED_REPO) throw upgradeError("INVALID_RELEASE_REPOSITORY", "--repo must be exactly " + EXPECTED_REPO);
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(String(options.tag || ""))) throw upgradeError("INVALID_RELEASE_TAG", "--tag must be an immutable v<semver> release tag");
  if (!["chrome", "chromium"].includes(options.browserSource)) throw upgradeError("INVALID_BROWSER_SOURCE", "--browser must be chrome or chromium");
  const layout = getInstallLayout(options.targetDir);
  assertSafePath(path.dirname(layout.targetDir), "INVALID_INSTALL_TARGET");
  assertSafePath(layout.dataRoot, "UNSAFE_DATA_ROOT");
  const lock = acquireLifecycleLock(layout, options);
  options.leaseLock = lock;
  let journal;
  let activated = false;
  let lockReleased = false;
  try {
    await recoverPriorJournal(options, layout);
    if (options.recoverOnly) {
      const result = { command: "upgrade", status: "recovered", code: "UPGRADE_RECOVERED", targetDir: layout.targetDir };
      releaseLifecycleLockForSuccess(layout, lock, false, upgradeError);
      lockReleased = true;
      delete options.leaseLock;
      return result;
    }
    const receipt = readInstallReceipt({ targetDir: layout.targetDir });
    if (!receipt) throw upgradeError("INSTALL_RECEIPT_MISSING", "Current installation receipt is required for upgrade");
    const sourceHash = hashReleaseTree(layout.targetDir);
    if (sourceHash !== receipt.releaseTreeSha256) throw upgradeError("RELEASE_TREE_DRIFT", "Current release tree differs from its receipt");
    const currentContract = validateVersionContract({ ...loadContractFiles({ skillDir: layout.targetDir }), nodeVersion: options.nodeVersion || process.versions.node });
    const requestedVersion = options.tag.slice(1);
    const precedence = compareSemver(requestedVersion, currentContract.skillVersion);
    if (precedence === 0) throw upgradeError("UPGRADE_SAME_VERSION", "Upgrade target equals the installed version");
    if (precedence < 0) throw upgradeError("UPGRADE_DOWNGRADE_FORBIDDEN", "Upgrade cannot route to an older release");
    const unresolved = enumerateUnresolved(layout);
    if (unresolved.length) throw upgradeError("UNRESOLVED_OPERATIONS", "Persisted task, batch, or recovery operations must be resolved before upgrade", { paths: unresolved.map(item => path.relative(layout.dataRoot, item)) });

    const operationId = lock.owner.operationId;
    const operationPaths = upgradeSafety.deriveOperationPaths(layout, operationId);
    const { stagingDir, previousDir, retainedPreviousDir, temporaryDataRoot, dataBackupRoot } = operationPaths;
    const volumeResolver = options.volumeResolver || (value => path.parse(path.resolve(value)).root.toLowerCase());
    if (volumeResolver(layout.targetDir) !== volumeResolver(stagingDir)) throw upgradeError("CROSS_VOLUME_STAGING", "Upgrade staging must be on the same volume as the active target");
    journal = {
      schemaVersion: JOURNAL_SCHEMA_VERSION, operation: "upgrade", operationId,
      targetDir: canonicalExisting(layout.targetDir, "INSTALL_TARGET_MISSING"), dataRoot: canonicalExisting(layout.dataRoot, "INSTALL_DATA_ROOT_MISSING"),
      stagingDir, previousDir, retainedPreviousDir, temporaryDataRoot, dataBackupRoot,
      receiptPath: operationPaths.receiptPath, restartMarkerPath: operationPaths.restartMarkerPath, journalPath: operationPaths.journalPath,
      sourceVersion: currentContract.skillVersion, targetVersion: requestedVersion,
      sourceTreeSha256: sourceHash, targetTreeSha256: null, phase: "locked", status: "in-progress",
      createdAt: nowIso(options), updatedAt: nowIso(options), recoveryIntent: "restore-source", error: null,
      sourceReceipt: receipt, targetReceipt: null, targetSource: null,
      originalReceipt: snapshotFile(layout.receiptPath), originalRestartMarker: snapshotFile(layout.restartMarkerPath),
      migrations: [], dataFiles: [], transitionHistory: [],
    };
    writeTransition(options, layout, journal, "locked");
    writeTransition(options, layout, journal, "recovered");
    writeTransition(options, layout, journal, "current-validated");
    writeTransition(options, layout, journal, "operations-clear");

    writeTransition(options, layout, journal, "daemon-draining");
    const drain = await runWithLeaseHeartbeat(lock, "daemon-draining", () => (options.requestDaemonDrain || defaultDrain)(options, layout), options);
    if (!drain || !drain.drained) throw upgradeError(drain && drain.code || "DAEMON_DRAIN_FAILED", "Daemon did not drain and refuse new commands");
    const stopped = await runWithLeaseHeartbeat(lock, "daemon-stopping", () => (options.stopValidatedDaemon || stopValidatedDaemon)({ layout, targetDir: layout.targetDir, processInspector: options.processInspector, requestHello: options.requestHello, killAdapter: options.killAdapter, now: options.now }), options);
    if (!stopped || !["DAEMON_STOPPED", "DAEMON_ALREADY_STOPPED"].includes(stopped.code)) throw upgradeError(stopped && stopped.code || "DAEMON_STOP_FAILED", "Validated daemon stop failed");
    writeTransition(options, layout, journal, "daemon-stopped");
    const profile = await runWithLeaseHeartbeat(lock, "profile-release-check", () => (options.verifyProfileReleased || (async () => defaultProfileReleased(layout)))(layout, options), options);
    if (!profile || !profile.released) throw upgradeError(profile && profile.code || "BROWSER_PROFILE_LOCKED", "Browser profile remains locked", profile);
    writeTransition(options, layout, journal, "profile-released");

    const staged = await runWithLeaseHeartbeat(lock, "staging", () => (options.stageGiteeRelease || stageGiteeRelease)({
      owner: "lcc0628", repo: "rental-price-agent", tag: options.tag, targetDir: layout.targetDir, stagingDir,
      baseUrl: options.releaseBaseUrl, platform: options.platform, volumeResolver: options.volumeResolver,
      timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, maxExpandedBytes: options.maxExpandedBytes, maxRedirects: options.maxRedirects,
    }), options);
    upgradeSafety.writeOwnerMarker(operationId, stagingDir, writeJsonAtomicDurable);
    journal.targetTreeSha256 = hashReleaseTree(stagingDir);
    const targetContract = validateVersionContract({ ...loadContractFiles({ skillDir: stagingDir }), nodeVersion: options.nodeVersion || process.versions.node });
    if (targetContract.skillVersion !== requestedVersion) throw upgradeError("RELEASE_TAG_VERSION_MISMATCH", "Staged release version does not match requested tag");
    journal.targetSource = { owner: "lcc0628", repo: "rental-price-agent", tag: options.tag, asset: staged.archiveName, sha256: staged.sha256 };
    writeTransition(options, layout, journal, "staged");
    const liveFiles = dataTransaction.relativeManagedFiles(layout);
    dataTransaction.assertPreMigrationCompatibility(liveFiles, targetContract);
    const readiness = await runWithLeaseHeartbeat(lock, "staging-readiness", () => prepareStagingReadiness({ stagingDir, dataRoot: temporaryDataRoot, browserPolicy: { source: options.browserSource, allowFallback: false }, run: options.run, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions }), options);
    fs.mkdirSync(temporaryDataRoot, { recursive: true });
    upgradeSafety.writeOwnerMarker(operationId, temporaryDataRoot, writeJsonAtomicDurable);
    writeTransition(options, layout, journal, "staging-ready");
    copyTemporaryData(layout, temporaryDataRoot, liveFiles);
    const migrationLayout = { ...getInstallLayout(stagingDir), dataRoot: temporaryDataRoot, configPath: path.join(temporaryDataRoot, "config.json"), tasksDir: path.join(temporaryDataRoot, "tasks"), batchesDir: path.join(temporaryDataRoot, "tasks", "batches") };
    const migrationResult = await runWithLeaseHeartbeat(lock, "temporary-data-migration", () => dataTransaction.runTargetMigration(stagingDir, migrationLayout, targetContract), options);
    journal.migrations = migrationResult.migratedFiles.map(file => ({ relativePath: file.relativePath, kind: file.kind, sourceVersion: migrationResult.sourceFiles.find(source => source.relativePath === file.relativePath).schemaVersion, targetVersion: file.schemaVersion }));
    journal.dataFiles = migrationResult.sourceFiles.map(file => ({ ...file, targetSha256: migrationResult.migratedFiles.find(target => target.relativePath === file.relativePath).sha256 }));
    upgradeSafety.assertSchemaCompatibility(migrationLayout, targetContract);
    writeTransition(options, layout, journal, "temporary-data-migrated");
    await runWithLeaseHeartbeat(lock, "staging-doctor", () => validateStagingDoctor({ ...options, runDoctor: options.runDoctor }, stagingDir), options);
    writeTransition(options, layout, journal, "staging-doctor-passed");
    writeTransition(options, layout, journal, "data-backup-planned");
    dataTransaction.backupDataFiles(layout, migrationLayout, journal.dataFiles, dataBackupRoot, directory => fsyncParent(options, directory));
    writeTransition(options, layout, journal, "data-backed-up");

    writeTransition(options, layout, journal, "retention-planned");
    if (fs.existsSync(previousDir)) {
      hashReleaseTree(previousDir);
      await retryRename(options, previousDir, retainedPreviousDir);
      upgradeSafety.writeOwnerMarker(operationId, retainedPreviousDir, writeJsonAtomicDurable);
    }
    writeTransition(options, layout, journal, "retention-complete");
    writeTransition(options, layout, journal, "active-move-planned");
    await retryRename(options, layout.targetDir, previousDir);
    writeTransition(options, layout, journal, "active-moved");
    writeTransition(options, layout, journal, "staging-move-planned");
    fs.rmSync(path.join(stagingDir, upgradeSafety.OWNER_FILE), { force: true });
    fsyncParent(options, stagingDir);
    await retryRename(options, stagingDir, layout.targetDir);
    activated = true;
    writeTransition(options, layout, journal, "staging-activated");
    writeTransition(options, layout, journal, "data-install-planned");
    dataTransaction.installMigratedData(layout, migrationLayout, journal.dataFiles, directory => fsyncParent(options, directory));
    writeTransition(options, layout, journal, "data-installed");

    writeTransition(options, layout, journal, "receipt-write-planned");
    const writeReceipt = options.writeReceipt || writeInstallReceipt;
    const newReceipt = await writeReceipt({ targetDir: layout.targetDir, source: { owner: "lcc0628", repo: "rental-price-agent", tag: options.tag, asset: staged.archiveName, sha256: staged.sha256 }, browser: { policy: { source: options.browserSource, allowFallback: false }, selectedSource: readiness.readiness.selectedSource, version: readiness.readiness.version }, installedAt: options.installedAt, nodeVersion: options.nodeVersion });
    fsyncParent(options, path.dirname(layout.receiptPath));
    journal.targetReceipt = newReceipt;
    writeTransition(options, layout, journal, "receipt-written");
    writeTransition(options, layout, journal, "restart-write-planned");
    const marker = (options.writeRestartMarker || writeRestartMarker)(layout, { activatingReleaseTreeSha256: newReceipt.releaseTreeSha256, activationId: operationId, sessionId: options.sessionId || process.env.OPENCODE_SESSION_ID || "upgrade-process-" + process.pid, reason: "upgrade", createdAt: nowIso(options) });
    fsyncParent(options, path.dirname(layout.restartMarkerPath));
    writeTransition(options, layout, journal, "restart-written");
    const postDoctor = await runWithLeaseHeartbeat(lock, "post-activation-doctor", () => (options.postActivationDoctor || options.runDoctor)({ targetDir: layout.targetDir, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions, nodeVersion: options.nodeVersion }), options);
    const allowedPost = new Set(["RESTART_REQUIRED", "LIFECYCLE_LOCK_PRESENT", "LIFECYCLE_JOURNAL_INTERRUPTED"]);
    const postBlockers = postDoctor.blockers.filter(code => !allowedPost.has(code));
    if (postBlockers.length) throw upgradeError("POST_ACTIVATION_CHECK_FAILED", "Activated release failed post-check", { blockers: postBlockers });
    writeTransition(options, layout, journal, "post-check-passed");
    journal.status = "committed";
    journal.recoveryIntent = "keep-target";
    writeTransition(options, layout, journal, "committed", { completedAt: nowIso(options) });
    releaseLifecycleLockForSuccess(layout, lock, true, upgradeError);
    lockReleased = true;
    delete options.leaseLock;
    const cleanupPaths = [stagingDir, retainedPreviousDir, temporaryDataRoot];
    upgradeSafety.removeOwned(operationId, retainedPreviousDir, cleanupPaths, directory => fsyncParent(options, directory));
    upgradeSafety.removeOwned(operationId, temporaryDataRoot, cleanupPaths, directory => fsyncParent(options, directory));
    return { command: "upgrade", status: "upgraded", code: "UPGRADE_OK", targetDir: newReceipt.targetDir, dataRoot: newReceipt.dataRoot, version: targetContract.skillVersion, receipt: newReceipt, previous: { path: previousDir, version: currentContract.skillVersion, releaseTreeSha256: sourceHash }, restartRequired: marker.required, doctor: { blockers: postDoctor.blockers, warnings: postDoctor.warnings } };
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
      journal.error = { code: error.code || "UPGRADE_FAILED", message: error.message, at: nowIso(options) };
      try {
        writeJsonAtomicDurable(layout.journalPath, journal);
        await restoreOldActive(options, layout, journal);
      } catch (recoveryError) {
        journal.status = "recovery-required";
        journal.recoveryIntent = "restore-source";
        journal.error.recoveryCode = recoveryError.code || "UPGRADE_RECOVERY_FAILED";
        try { writeJsonAtomicDurable(layout.journalPath, journal); } catch {}
        primaryError = upgradeError("UPGRADE_RECOVERY_FAILED", "Upgrade failed and immediate restoration could not complete", { originalCode: error.code || null, recoveryCode: recoveryError.code || null, activated });
      }
    }
    releaseLifecycleLockAfterFailure(layout, lock, primaryError);
    delete options.leaseLock;
    throw primaryError;
  }
}

module.exports = { JOURNAL_SCHEMA_VERSION, UPGRADE_PHASES, enumerateUnresolved, readJournal, recoverPriorJournal, runUpgrade };
