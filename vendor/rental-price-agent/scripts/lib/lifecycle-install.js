const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { prepareStagingReadiness } = require("./dependency-install");
const { getInstallLayout, importLegacyData } = require("./install-layout");
const { hashReleaseTree, readInstallReceipt, writeInstallReceipt, writeJsonAtomicDurable } = require("./install-receipt");
const { migrateJsonFile, validateRecovery } = require("./migrations");
const { stageGiteeRelease } = require("./release-source");
const { loadContractFiles, validateVersionContract } = require("./version-contract");
const { writeRestartMarker } = require("./restart-session");
const { acquireLeaseLock, attachLockReleaseFailure, heartbeatLeaseLock, lockReleaseFailureDetails, releaseLeaseLock, runWithLeaseHeartbeat } = require("./lease-lock");

const EXPECTED_REPO = "lcc0628/rental-price-agent";
const INSTALL_PHASES = Object.freeze([
  "locked", "classified", "staged", "readiness", "data-prepared", "migrated",
  "doctor-validated", "target-activated", "data-activated", "receipt-written",
  "journal-written", "restart-written",
]);
const CONTROL_NAMES = new Set(["lifecycle.lock", "install-receipt.json", "lifecycle-journal.json", "restart-required.json"]);

function installError(code, message, details) {
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

function assertSafePath(entryPath, code) {
  const resolved = path.resolve(entryPath);
  let current = resolved;
  while (!lstat(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw installError(code, "Install path has no existing ancestor");
    current = parent;
  }
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw installError(code, "Install path contains a link or non-directory ancestor", { path: current });
  const canonical = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
  if (comparable(canonical) !== comparable(current)) throw installError(code, "Install path resolves through a link or junction", { path: current });
  const targetStat = lstat(resolved);
  if (targetStat && targetStat.isSymbolicLink()) throw installError(code, "Install path cannot be a link or junction", { path: resolved });
}

function validateLifecycleLockRecovery(layout, owner) {
  let journal;
  try {
    const stat = fs.lstatSync(layout.journalPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    journal = JSON.parse(fs.readFileSync(layout.journalPath, "utf8"));
  } catch { return false; }
  return journal && journal.operationId === owner.operationId && journal.phase === owner.operationPhase
    && ["in-progress", "recovery-required", "committed", "recovered"].includes(journal.status);
}

function acquireLifecycleLock(layout, options) {
  const dataExisted = Boolean(lstat(layout.dataRoot));
  if (!dataExisted) fs.mkdirSync(layout.dataRoot);
  assertSafePath(layout.dataRoot, "UNSAFE_DATA_ROOT");
  try {
    const lock = acquireLeaseLock({
      lockPath: layout.lockPath,
      lockKind: "lifecycle",
      operationId: options.operationId || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")),
      operationPhase: "locked",
      journalPath: layout.journalPath,
      processInspector: options.processInspector,
      now: options.now,
      fs: options.lockFs,
      validateRecovery: owner => validateLifecycleLockRecovery(layout, owner),
    });
    lock.dataExisted = dataExisted;
    return lock;
  } catch (error) {
    if (error.code === "LOCKED") throw installError("LIFECYCLE_LOCKED", "Another lifecycle operation owns this target", error.details);
    throw error;
  }
}

function releaseLifecycleLock(layout, lock) {
  return releaseLeaseLock(lock);
}

function releaseLifecycleLockForSuccess(layout, lock, operationCommitted, errorFactory = installError) {
  try {
    return releaseLifecycleLock(layout, lock);
  } catch (error) {
    throw errorFactory("LIFECYCLE_LOCK_RELEASE_FAILED", "Lifecycle operation completed but its owned lock could not be released", {
      operationCommitted: Boolean(operationCommitted),
      recoveryRequired: true,
      lockReleaseFailure: lockReleaseFailureDetails(error),
    });
  }
}

function releaseLifecycleLockAfterFailure(layout, lock, primaryError) {
  try {
    releaseLifecycleLock(layout, lock);
    return true;
  } catch (releaseError) {
    attachLockReleaseFailure(primaryError, releaseError);
    return false;
  }
}

function emitPhase(options, phase) {
  if (options.leaseLock) heartbeatLeaseLock(options.leaseLock, { operationPhase: phase, now: options.now });
  if (typeof options.onPhase === "function") options.onPhase(phase);
}

function targetClassification(layout, tag) {
  const stat = lstat(layout.targetDir);
  if (!stat) return { kind: "missing" };
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw installError("INVALID_INSTALL_TARGET", "Install target must be a regular directory path");
  const names = fs.readdirSync(layout.targetDir);
  if (!names.length) return { kind: "empty" };
  if (fs.existsSync(layout.receiptPath)) {
    const receipt = readInstallReceipt({ targetDir: layout.targetDir });
    if (receipt.source.owner !== "lcc0628" || receipt.source.repo !== "rental-price-agent") throw installError("INSTALL_RECEIPT_RELEASE_MISMATCH", "Existing receipt belongs to a different release source");
    if (receipt.source.tag !== tag) throw installError("UPGRADE_REQUIRED", "A different installed version must be handled by the upgrade command", { installedTag: receipt.source.tag, requestedTag: tag });
    return { kind: "installed", receipt };
  }
  const packagePath = path.join(layout.targetDir, "package.json");
  const skillPath = path.join(layout.targetDir, "SKILL.md");
  if (fs.existsSync(packagePath) && fs.existsSync(skillPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (packageJson.name === "rental-price-agent") return { kind: "legacy" };
    } catch {}
  }
  throw installError("INSTALL_TARGET_NOT_RECOGNIZED", "Refusing to install over an unrecognized nonempty target");
}

function copyDataRoot(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  if (!fs.existsSync(sourceRoot)) return;
  for (const name of fs.readdirSync(sourceRoot)) {
    if (CONTROL_NAMES.has(name)) continue;
    const source = path.join(sourceRoot, name);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw installError("UNSAFE_DATA_ROOT", "Installation data contains a link or junction", { path: source });
    fs.cpSync(source, path.join(destinationRoot, name), { recursive: true, errorOnExist: true, preserveTimestamps: true });
  }
}

function migrateWorkData(layout, options) {
  const migrations = [];
  const lockOptions = { processInspector: options.processInspector, now: options.now };
  function validateRecoveryFile(filePath) {
    let value;
    try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { throw installError("MALFORMED_MIGRATION_OBJECT", "Recovery state must be valid JSON", { path: filePath }); }
    validateRecovery(value);
  }
  if (fs.existsSync(layout.configPath)) migrations.push(migrateJsonFile(layout.configPath, { domain: "config", ...lockOptions }));
  if (!fs.existsSync(layout.tasksDir)) return migrations;
  const tasksStat = fs.lstatSync(layout.tasksDir);
  if (tasksStat.isSymbolicLink() || !tasksStat.isDirectory()) throw installError("STATE_STORAGE_UNSAFE", "Persisted task storage is unsafe");
  for (const entry of fs.readdirSync(layout.tasksDir, { withFileTypes: true })) {
    if (entry.name === "_index.json") migrations.push(migrateJsonFile(path.join(layout.tasksDir, entry.name), { domain: "state", kind: "task-index", ...lockOptions }));
    else if (entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("changes_")) validateRecoveryFile(path.join(layout.tasksDir, entry.name));
    else if (entry.isFile() && entry.name.endsWith(".json")) migrations.push(migrateJsonFile(path.join(layout.tasksDir, entry.name), { domain: "state", kind: "task", ...lockOptions }));
    else if (entry.name === "batches" && entry.isDirectory()) {
      for (const batch of fs.readdirSync(path.join(layout.tasksDir, entry.name), { withFileTypes: true })) {
        const batchPath = path.join(layout.tasksDir, entry.name, batch.name);
        if (batch.isFile() && batch.name.endsWith(".json") && batch.name.startsWith("changes_")) validateRecoveryFile(batchPath);
        else if (batch.isFile() && batch.name.endsWith(".json")) migrations.push(migrateJsonFile(batchPath, { domain: "state", kind: "batch", ...lockOptions }));
      }
    }
  }
  return migrations;
}

async function validateStagingDoctor(options, stagingDir) {
  const doctor = await options.runDoctor({
    targetDir: stagingDir, probeBrowserPolicy: options.probeBrowserPolicy,
    probeOptions: options.probeOptions, nodeVersion: options.nodeVersion,
  });
  const allowed = new Set(["INSTALL_RECEIPT_MISSING", "RESTART_NOT_REQUIRED", "ENV_MISSING", "ENV_INCOMPLETE"]);
  const blockers = doctor.blockers.filter(code => !allowed.has(code));
  if (blockers.length) throw installError("STAGING_DOCTOR_FAILED", "Staged release or migrated data is not ready", { blockers });
  return doctor;
}

async function verifyNoop(options, layout, receipt) {
  const contract = validateVersionContract({ ...loadContractFiles({ skillDir: layout.targetDir }), nodeVersion: options.nodeVersion || process.versions.node });
  if (contract.releaseTag !== options.tag || hashReleaseTree(layout.targetDir) !== receipt.releaseTreeSha256) {
    throw installError("INSTALLED_RELEASE_DRIFT", "Existing same-version installation does not match its receipt");
  }
  if (receipt.browser.policy.source !== options.browserSource) throw installError("INSTALL_OPTIONS_CONFLICT", "Existing install uses a different browser policy", { installed: receipt.browser.policy.source, requested: options.browserSource });
  const configPath = layout.configPath;
  if (!fs.existsSync(configPath)) throw installError("CONFIG_MISSING", "Existing installation config is missing");
  const doctor = await options.runDoctor({ targetDir: layout.targetDir, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions, nodeVersion: options.nodeVersion });
  const blockers = doctor.blockers.filter(code => !["RESTART_REQUIRED", "LIFECYCLE_LOCK_PRESENT", "ENV_MISSING", "ENV_INCOMPLETE"].includes(code));
  if (blockers.length) throw installError("INSTALLED_DATA_INVALID", "Existing same-version installation failed verification", { blockers });
  return { command: "install", status: "noop", code: "ALREADY_INSTALLED", targetDir: fs.realpathSync(layout.targetDir), dataRoot: fs.realpathSync(layout.dataRoot), version: contract.skillVersion, receipt };
}

function installLockInWork(workLayout, lock) {
  fs.mkdirSync(workLayout.lockPath);
  fs.writeFileSync(path.join(workLayout.lockPath, "owner.json"), JSON.stringify(lock.owner, null, 2) + "\n", { flag: "wx" });
}

async function runInstall(options = {}) {
  if (!options.targetDir || !path.isAbsolute(options.targetDir)) throw installError("INVALID_INSTALL_TARGET", "--target must be an absolute path");
  if (options.repo !== EXPECTED_REPO) throw installError("INVALID_RELEASE_REPOSITORY", "--repo must be exactly " + EXPECTED_REPO);
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(String(options.tag || ""))) throw installError("INVALID_RELEASE_TAG", "--tag must be an immutable v<semver> release tag");
  if (!["chrome", "chromium"].includes(options.browserSource)) throw installError("INVALID_BROWSER_SOURCE", "--browser must be chrome or chromium");
  if (typeof options.runDoctor !== "function") throw installError("INVALID_INSTALL_RUNTIME", "runDoctor is required");

  const layout = getInstallLayout(options.targetDir);
  assertSafePath(path.dirname(layout.targetDir), "INVALID_INSTALL_TARGET");
  assertSafePath(path.dirname(layout.dataRoot), "UNSAFE_DATA_ROOT");
  const lock = acquireLifecycleLock(layout, options);
  options.leaseLock = lock;
  const token = lock.owner.ownerToken.slice(0, 12);
  const stagingDir = path.join(path.dirname(layout.targetDir), "." + path.basename(layout.targetDir) + "-install-stage-" + token);
  const workLayout = getInstallLayout(stagingDir);
  const dataBackup = layout.dataRoot + ".install-backup-" + token;
  const targetBackup = layout.targetDir + ".legacy-source-" + token;
  let classification;
  let staged;
  let readiness;
  let legacyImport = null;
  let targetActivated = false;
  let dataActivated = false;
  let targetMoved = false;
  let lockReleased = false;
  try {
    emitPhase(options, "locked");
    classification = targetClassification(layout, options.tag);
    emitPhase(options, "classified");
    if (classification.kind === "installed") {
      const result = await verifyNoop(options, layout, classification.receipt);
      releaseLifecycleLockForSuccess(layout, lock, false);
      lockReleased = true;
      delete options.leaseLock;
      return result;
    }

    const stage = options.stageGiteeRelease || stageGiteeRelease;
    staged = await runWithLeaseHeartbeat(lock, "staging", () => stage({
      owner: "lcc0628", repo: "rental-price-agent", tag: options.tag,
      targetDir: layout.targetDir, stagingDir, baseUrl: options.releaseBaseUrl,
      platform: options.platform, volumeResolver: options.volumeResolver,
      timeoutMs: options.timeoutMs, maxBytes: options.maxBytes,
      maxExpandedBytes: options.maxExpandedBytes, maxRedirects: options.maxRedirects,
    }), options);
    emitPhase(options, "staged");
    readiness = await runWithLeaseHeartbeat(lock, "readiness", () => prepareStagingReadiness({
      stagingDir, dataRoot: workLayout.dataRoot,
      browserPolicy: { source: options.browserSource, allowFallback: false },
      run: options.run, probeBrowserPolicy: options.probeBrowserPolicy, probeOptions: options.probeOptions,
    }), options);
    emitPhase(options, "readiness");
    copyDataRoot(layout.dataRoot, workLayout.dataRoot);
    if (classification.kind === "legacy") {
      legacyImport = await importLegacyData({ targetDir: layout.targetDir, destinationTargetDir: stagingDir, layout: workLayout });
    }
    if (!fs.existsSync(workLayout.configPath)) fs.copyFileSync(path.join(stagingDir, "config.example.json"), workLayout.configPath);
    emitPhase(options, "data-prepared");
    const migrations = migrateWorkData(workLayout, options);
    emitPhase(options, "migrated");
    const doctor = await validateStagingDoctor(options, stagingDir);
    emitPhase(options, "doctor-validated");

    if (classification.kind === "legacy" || classification.kind === "empty") {
      fs.renameSync(layout.targetDir, targetBackup);
      targetMoved = true;
    }
    fs.renameSync(stagingDir, layout.targetDir);
    targetActivated = true;
    emitPhase(options, "target-activated");

    installLockInWork(workLayout, lock);
    fs.renameSync(layout.dataRoot, dataBackup);
    fs.renameSync(workLayout.dataRoot, layout.dataRoot);
    dataActivated = true;
    emitPhase(options, "data-activated");

    const receipt = await writeInstallReceipt({
      targetDir: layout.targetDir,
      source: { owner: "lcc0628", repo: "rental-price-agent", tag: options.tag, asset: staged.archiveName, sha256: staged.sha256 },
      browser: { policy: { source: options.browserSource, allowFallback: false }, selectedSource: readiness.readiness.selectedSource, version: readiness.readiness.version },
      installedAt: options.installedAt, nodeVersion: options.nodeVersion,
    });
    emitPhase(options, "receipt-written");
    const journal = {
      schemaVersion: 1, operation: "install", operationId: lock.owner.operationId, phase: "restart-written", status: "committed", targetDir: receipt.targetDir,
      source: receipt.source, completedAt: new Date().toISOString(),
      legacyImport: legacyImport ? { hashes: legacyImport.hashes, sourceDeleted: false } : null,
      migrations: migrations.map(item => item.migrationRecord),
    };
    writeJsonAtomicDurable(layout.journalPath, journal);
    emitPhase(options, "journal-written");
    writeRestartMarker(layout, {
      activatingReleaseTreeSha256: receipt.releaseTreeSha256,
      activationId: options.activationId || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")),
      sessionId: options.sessionId || process.env.OPENCODE_SESSION_ID || "install-process-" + process.pid,
      reason: "install",
      createdAt: new Date().toISOString(),
    });
    emitPhase(options, "restart-written");

    releaseLifecycleLockForSuccess(layout, lock, true);
    lockReleased = true;
    delete options.leaseLock;
    fs.rmSync(dataBackup, { recursive: true, force: true });
    if (classification.kind === "empty") fs.rmSync(targetBackup, { recursive: true, force: true });
    return {
      command: "install", status: "installed", code: "INSTALL_OK",
      targetDir: receipt.targetDir, dataRoot: receipt.dataRoot, version: receipt.versions.skill,
      source: receipt.source, browser: receipt.browser, restartRequired: true,
      legacyImport, legacySourcePath: classification.kind === "legacy" ? targetBackup : null,
      doctor: { blockers: doctor.blockers, warnings: doctor.warnings },
    };
  } catch (error) {
    if (error.code === "LIFECYCLE_LOCK_RELEASE_FAILED") {
      delete options.leaseLock;
      throw error;
    }
    if (lockReleased) {
      delete options.leaseLock;
      throw error;
    }
    let primaryError = error;
    try {
      if (dataActivated) {
        fs.rmSync(layout.dataRoot, { recursive: true, force: true });
        if (fs.existsSync(dataBackup)) fs.renameSync(dataBackup, layout.dataRoot);
      }
      if (targetActivated) fs.rmSync(layout.targetDir, { recursive: true, force: true });
      if (targetMoved && fs.existsSync(targetBackup) && !fs.existsSync(layout.targetDir)) fs.renameSync(targetBackup, layout.targetDir);
      if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
      if (fs.existsSync(workLayout.dataRoot)) fs.rmSync(workLayout.dataRoot, { recursive: true, force: true });
      if (fs.existsSync(dataBackup) && !dataActivated) fs.rmSync(dataBackup, { recursive: true, force: true });
    } catch (cleanupError) {
      primaryError = installError("INSTALL_ROLLBACK_FAILED", "Install failed and owned artifacts could not be restored", { originalCode: error.code || null, cleanupCode: cleanupError.code || null });
    }
    delete options.leaseLock;
    const released = releaseLifecycleLockAfterFailure(layout, lock, primaryError);
    if (released && !lock.dataExisted && fs.existsSync(layout.dataRoot) && fs.readdirSync(layout.dataRoot).length === 0) fs.rmdirSync(layout.dataRoot);
    throw primaryError;
  }
}

module.exports = {
  EXPECTED_REPO,
  INSTALL_PHASES,
  acquireLifecycleLock,
  assertSafePath,
  releaseLifecycleLock,
  releaseLifecycleLockAfterFailure,
  releaseLifecycleLockForSuccess,
  runInstall,
};
