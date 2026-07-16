const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createWindowsProcessInspector, inspectProcess } = require("./process-inspector");

const OWNER_SCHEMA_VERSION = 1;
const OWNER_FILE = "owner.json";

function lockError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function boundedCauseCode(error) {
  return error && typeof error.code === "string" && error.code.length <= 64 ? error.code : null;
}

function releaseFailure(stage, error, extra = {}) {
  return lockError("LOCK_RELEASE_FAILED", "Lease lock release failed at " + stage, {
    stage,
    ...(boundedCauseCode(error) ? { causeCode: error.code } : {}),
    ...extra,
  });
}

function lockReleaseFailureDetails(error) {
  const details = error && error.details && typeof error.details === "object" ? error.details : {};
  return {
    code: "LOCK_RELEASE_FAILED",
    ...(typeof details.stage === "string" ? { stage: details.stage } : {}),
    ...(typeof details.causeCode === "string" ? { causeCode: details.causeCode } : {}),
    ...(typeof details.claimRestored === "boolean" ? { claimRestored: details.claimRestored } : {}),
  };
}

function attachLockReleaseFailure(primaryError, releaseError) {
  const existing = primaryError.details && typeof primaryError.details === "object" && !Array.isArray(primaryError.details)
    ? primaryError.details
    : primaryError.details === undefined ? {} : { originalDetails: primaryError.details };
  primaryError.details = { ...existing, lockReleaseFailure: lockReleaseFailureDetails(releaseError) };
  return primaryError;
}

function comparable(entryPath, platform = process.platform) {
  const resolved = path.resolve(entryPath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonical(entryPath, adapter = fs) {
  const realpath = adapter.realpathSync.native || adapter.realpathSync;
  return realpath(entryPath);
}

function canonicalPlannedPath(lockPath, adapter = fs, platform = process.platform) {
  const resolved = path.resolve(lockPath);
  const parent = path.dirname(resolved);
  const parentStat = adapter.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw lockError("LOCK_RECOVERY_REQUIRED", "Lock parent is unsafe", { lockPath: resolved });
  const canonicalParent = canonical(parent, adapter);
  if (comparable(canonicalParent, platform) !== comparable(parent, platform)) throw lockError("LOCK_RECOVERY_REQUIRED", "Lock parent resolves through a link or junction", { lockPath: resolved });
  return path.join(canonicalParent, path.basename(resolved));
}

function inspectLockPath(lockPath, adapter = fs, platform = process.platform) {
  let stat;
  try { stat = adapter.lstatSync(lockPath); } catch (error) {
    if (error.code === "ENOENT") return { present: false };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw lockError("LOCK_RECOVERY_REQUIRED", "Lock path is not a regular directory", { lockPath });
  const canonicalPath = canonical(lockPath, adapter);
  if (comparable(canonicalPath, platform) !== comparable(lockPath, platform)) throw lockError("LOCK_RECOVERY_REQUIRED", "Lock path resolves through a link or junction", { lockPath });
  return { present: true, stat, canonicalPath };
}

function validString(value, minimum = 1, maximum = 512) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function parseOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== OWNER_SCHEMA_VERSION) return null;
  if (!validString(value.lockKind, 1, 64) || !validString(value.lockPath) || !Number.isInteger(value.ownerPid) || value.ownerPid <= 0
      || !validString(value.processCreationToken, 1, 256) || !validString(value.ownerToken, 16, 128)
      || !validString(value.operationId, 8, 128) || !validString(value.acquiredAt, 20, 64) || !validString(value.heartbeatAt, 20, 64)) return null;
  if (Number.isNaN(Date.parse(value.acquiredAt)) || Number.isNaN(Date.parse(value.heartbeatAt))) return null;
  if (value.journalPath !== undefined && !validString(value.journalPath)) return null;
  if (value.operationPhase !== undefined && !validString(value.operationPhase, 1, 128)) return null;
  return value;
}

function readOwner(lockPath, adapter = fs) {
  try { return parseOwner(JSON.parse(adapter.readFileSync(path.join(lockPath, OWNER_FILE), "utf8"))); } catch { return null; }
}

function sameOwner(left, right) {
  return Boolean(left && right && left.ownerToken === right.ownerToken && left.ownerPid === right.ownerPid
    && left.processCreationToken === right.processCreationToken && left.operationId === right.operationId
    && comparable(left.lockPath) === comparable(right.lockPath));
}

function validateExistingOwner(owner, options, canonicalLockPath) {
  if (!owner || owner.lockKind !== options.lockKind || comparable(owner.lockPath, options.platform) !== comparable(canonicalLockPath, options.platform)) {
    throw lockError("LOCK_RECOVERY_REQUIRED", "Lock owner metadata is malformed or does not match the canonical lock", { lockPath: options.lockPath });
  }
}

function validateRecoveryEvidence(owner, options) {
  if (options.lockKind === "lifecycle") {
    if (!options.journalPath || !owner.journalPath
        || comparable(owner.journalPath, options.platform) !== comparable(path.resolve(options.journalPath), options.platform)
        || typeof options.validateRecovery !== "function" || options.validateRecovery(owner) !== true) {
      throw lockError("LOCK_RECOVERY_REQUIRED", "Lifecycle lock recovery requires an exact operation journal", { lockPath: options.lockPath, owner });
    }
  }
}

function quarantineExistingLock(options, owner) {
  const adapter = options.fs || fs;
  const quarantinePath = options.lockPath + ".recovery-" + crypto.randomBytes(12).toString("hex");
  try {
    adapter.renameSync(options.lockPath, quarantinePath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw lockError("LOCK_RECOVERY_REQUIRED", "Lock could not be quarantined atomically", { lockPath: options.lockPath, causeCode: error.code || null });
  }
  try {
    const names = adapter.readdirSync(quarantinePath);
    const quarantinedOwner = readOwner(quarantinePath, adapter);
    if (names.length !== 1 || names[0] !== OWNER_FILE || !sameOwner(quarantinedOwner, owner)) throw lockError("LOCK_RECOVERY_REQUIRED", "Quarantined lock contents changed during recovery", { lockPath: options.lockPath });
    if (typeof options.onRecover === "function") options.onRecover(owner);
    adapter.rmSync(quarantinePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    try { if (!adapter.existsSync(options.lockPath) && adapter.existsSync(quarantinePath)) adapter.renameSync(quarantinePath, options.lockPath); } catch {}
    if (error.code === "LOCK_RECOVERY_REQUIRED") throw error;
    throw lockError("LOCK_RECOVERY_REQUIRED", "Lock recovery failed after quarantine", { lockPath: options.lockPath, causeCode: error.code || null });
  }
}

function acquireLeaseLock(options) {
  const adapter = options.fs || fs;
  const inspector = options.processInspector || createWindowsProcessInspector({ platform: options.platform });
  const canonicalLockPath = canonicalPlannedPath(options.lockPath, adapter, options.platform);
  const current = inspectProcess(inspector, process.pid);
  if (current.inspectionFailed || !current.exists || !validString(current.creationToken, 1, 256)) {
    throw lockError("LOCK_RECOVERY_REQUIRED", "Current process identity could not be inspected", { pid: process.pid });
  }
  const now = options.now || Date.now;
  const timestamp = new Date(now()).toISOString();
  const owner = {
    schemaVersion: OWNER_SCHEMA_VERSION,
    lockKind: options.lockKind,
    lockPath: canonicalLockPath,
    ownerPid: process.pid,
    processCreationToken: current.creationToken,
    ownerToken: crypto.randomBytes(24).toString("hex"),
    operationId: options.operationId,
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
    ...(options.journalPath ? { journalPath: path.resolve(options.journalPath) } : {}),
    ...(options.operationPhase ? { operationPhase: options.operationPhase } : {}),
    ...(options.ownerMetadata ? { metadata: options.ownerMetadata } : {}),
  };
  if (!parseOwner(owner)) throw lockError("LOCK_RECOVERY_REQUIRED", "New lock owner metadata is invalid");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      adapter.mkdirSync(options.lockPath);
      try {
        adapter.writeFileSync(path.join(options.lockPath, OWNER_FILE), JSON.stringify(owner, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      } catch (error) {
        try { adapter.rmdirSync(options.lockPath); } catch {}
        throw error;
      }
      inspectLockPath(options.lockPath, adapter, options.platform);
      return { lockPath: options.lockPath, owner, processInspector: inspector, fs: adapter, platform: options.platform };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const inspectedPath = inspectLockPath(options.lockPath, adapter, options.platform);
      if (!inspectedPath.present) continue;
      const existingOwner = readOwner(options.lockPath, adapter);
      validateExistingOwner(existingOwner, options, inspectedPath.canonicalPath);
      const existingProcess = inspectProcess(inspector, existingOwner.ownerPid);
      if (existingProcess.inspectionFailed) throw lockError("LOCK_RECOVERY_REQUIRED", "Lock owner process could not be inspected", { owner: existingOwner });
      if (existingProcess.exists && existingProcess.creationToken === existingOwner.processCreationToken) {
        throw lockError("LOCKED", "Another live process owns the lock", { owner: existingOwner });
      }
      validateRecoveryEvidence(existingOwner, options);
      if (!quarantineExistingLock(options, existingOwner)) continue;
    }
  }
  throw lockError("LOCK_RECOVERY_REQUIRED", "Lock changed concurrently during bounded recovery", { lockPath: options.lockPath });
}

function heartbeatLeaseLock(lease, options = {}) {
  const adapter = options.fs || lease.fs || fs;
  const inspector = options.processInspector || lease.processInspector;
  const currentProcess = inspectProcess(inspector, lease.owner.ownerPid);
  if (currentProcess.inspectionFailed || !currentProcess.exists || currentProcess.creationToken !== lease.owner.processCreationToken) {
    throw lockError("LOCK_OWNERSHIP_LOST", "Lease owner process identity changed");
  }
  const ownerPath = path.join(lease.lockPath, OWNER_FILE);
  const suffix = lease.owner.ownerToken + "-" + crypto.randomBytes(8).toString("hex");
  const temporaryPath = path.join(lease.lockPath, ".owner-heartbeat-" + suffix);
  const claimedPath = path.join(lease.lockPath, ".owner-claimed-" + suffix);
  let descriptor;
  let temporaryDescriptor;
  try {
    const stat = adapter.lstatSync(ownerPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw lockError("LOCK_OWNERSHIP_LOST", "Lease owner metadata path changed");
    descriptor = adapter.openSync(ownerPath, "r");
    const currentOwner = parseOwner(JSON.parse(adapter.readFileSync(descriptor, "utf8")));
    if (!sameOwner(currentOwner, lease.owner)) throw lockError("LOCK_OWNERSHIP_LOST", "Lease owner metadata was replaced");
    adapter.closeSync(descriptor);
    descriptor = undefined;
    const updated = {
      ...currentOwner,
      heartbeatAt: new Date((options.now || Date.now)()).toISOString(),
      ...(options.operationPhase ? { operationPhase: options.operationPhase } : {}),
    };
    temporaryDescriptor = adapter.openSync(temporaryPath, "wx", 0o600);
    adapter.writeFileSync(temporaryDescriptor, JSON.stringify(updated, null, 2) + "\n", "utf8");
    adapter.fsyncSync(temporaryDescriptor);
    adapter.closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    if (!sameOwner(readOwner(lease.lockPath, adapter), lease.owner)) throw lockError("LOCK_OWNERSHIP_LOST", "Lease owner metadata changed before heartbeat commit");
    adapter.renameSync(ownerPath, claimedPath);
    if (!sameOwner(parseOwner(JSON.parse(adapter.readFileSync(claimedPath, "utf8"))), lease.owner)) throw lockError("LOCK_OWNERSHIP_LOST", "Lease owner metadata changed during heartbeat commit");
    adapter.renameSync(temporaryPath, ownerPath);
    adapter.unlinkSync(claimedPath);
    lease.owner = updated;
    return updated;
  } catch (error) {
    try { if (!adapter.existsSync(ownerPath) && adapter.existsSync(claimedPath)) adapter.renameSync(claimedPath, ownerPath); } catch {}
    try { if (adapter.existsSync(temporaryPath)) adapter.unlinkSync(temporaryPath); } catch {}
    if (error.code === "LOCK_OWNERSHIP_LOST") throw error;
    throw lockError("LOCK_HEARTBEAT_FAILED", "Lease heartbeat could not be written", { causeCode: error.code || null });
  } finally {
    if (descriptor !== undefined) adapter.closeSync(descriptor);
    if (temporaryDescriptor !== undefined) adapter.closeSync(temporaryDescriptor);
  }
}

async function runWithLeaseHeartbeat(lease, operationPhase, operation, options = {}) {
  heartbeatLeaseLock(lease, { operationPhase, now: options.now });
  let heartbeatFailure = null;
  const intervalMs = Math.max(50, Math.min(Number(options.heartbeatIntervalMs || 30_000), 60_000));
  const setTimer = options.setInterval || setInterval;
  const clearTimer = options.clearInterval || clearInterval;
  const timer = setTimer(() => {
    try { heartbeatLeaseLock(lease, { operationPhase, now: options.now }); } catch (error) { heartbeatFailure = error; }
  }, intervalMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  try {
    const result = await operation();
    if (heartbeatFailure) throw heartbeatFailure;
    heartbeatLeaseLock(lease, { operationPhase, now: options.now });
    return result;
  } finally {
    clearTimer(timer);
  }
}

function releaseLeaseLock(lease, options = {}) {
  if (!lease || !lease.owner || typeof lease.lockPath !== "string") throw releaseFailure("invalid-lease");
  const adapter = options.fs || lease.fs || fs;
  const inspector = options.processInspector || lease.processInspector;
  const currentProcess = inspectProcess(inspector, lease.owner.ownerPid);
  if (currentProcess.inspectionFailed) throw releaseFailure("process-inspection");
  if (!currentProcess.exists || currentProcess.creationToken !== lease.owner.processCreationToken) throw releaseFailure("process-identity");
  let inspected;
  try {
    inspected = inspectLockPath(lease.lockPath, adapter, lease.platform);
  } catch (error) {
    throw releaseFailure("lock-inspection", error);
  }
  if (!inspected.present) throw releaseFailure("lock-missing");
  if (!sameOwner(readOwner(lease.lockPath, adapter), lease.owner)) throw releaseFailure("owner-mismatch");

  const releasePath = lease.lockPath + ".release-" + lease.owner.ownerToken;
  try {
    adapter.renameSync(lease.lockPath, releasePath);
  } catch (error) {
    throw releaseFailure("claim-rename", error);
  }

  function restoreClaim() {
    try {
      if (!adapter.existsSync(lease.lockPath) && adapter.existsSync(releasePath)) {
        adapter.renameSync(releasePath, lease.lockPath);
        return true;
      }
    } catch {}
    return false;
  }

  try {
    const names = adapter.readdirSync(releasePath);
    const releasedOwner = readOwner(releasePath, adapter);
    if (names.length !== 1 || names[0] !== OWNER_FILE || !sameOwner(releasedOwner, lease.owner)) {
      throw releaseFailure("claimed-owner-validation", null, { claimRestored: restoreClaim() });
    }
  } catch (error) {
    if (error.code === "LOCK_RELEASE_FAILED") throw error;
    throw releaseFailure("claimed-owner-validation", error, { claimRestored: restoreClaim() });
  }

  try {
    adapter.rmSync(releasePath, { recursive: true, force: true });
    if (adapter.existsSync(releasePath)) throw releaseFailure("claim-removal", null, { claimRestored: restoreClaim() });
  } catch (error) {
    if (error.code === "LOCK_RELEASE_FAILED") throw error;
    throw releaseFailure("claim-removal", error, { claimRestored: restoreClaim() });
  }
  return true;
}

module.exports = {
  OWNER_SCHEMA_VERSION,
  attachLockReleaseFailure,
  acquireLeaseLock,
  createWindowsProcessInspector,
  heartbeatLeaseLock,
  lockReleaseFailureDetails,
  releaseLeaseLock,
  runWithLeaseHeartbeat,
};
