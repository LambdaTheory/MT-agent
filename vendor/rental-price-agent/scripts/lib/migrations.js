#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { compareSemver, parseSemver, readCurrentMetadata } = require("./version-contract");
const { acquireLeaseLock, attachLockReleaseFailure, heartbeatLeaseLock, lockReleaseFailureDetails, releaseLeaseLock } = require("./lease-lock");

const LEGACY_SCHEMA_VERSION = "0.0.0";
const metadata = readCurrentMetadata();
const CURRENT_CONFIG_SCHEMA_VERSION = metadata.configSchemaVersion;
const CURRENT_STATE_SCHEMA_VERSION = metadata.stateSchemaVersion;

class MigrationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new MigrationError(code, message, details);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) fail("MALFORMED_MIGRATION_OBJECT", label + " must be a JSON object");
}

function requireOwn(value, field, label) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) fail("MALFORMED_MIGRATION_OBJECT", label + " must contain " + field);
  return value[field];
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) fail("MALFORMED_MIGRATION_OBJECT", label + " must be a non-empty string");
}

function requireOptionalType(value, field, type, label) {
  if (value[field] !== undefined && typeof value[field] !== type) fail("MALFORMED_MIGRATION_OBJECT", label + " " + field + " must be a " + type);
}

function validateVersionField(value, field, allowMissing) {
  if (value === undefined && allowMissing) return LEGACY_SCHEMA_VERSION;
  if (typeof value !== "string") fail("MALFORMED_SCHEMA_VERSION", field + " must be a semantic-version string");
  try {
    parseSemver(value, field);
  } catch (error) {
    fail("MALFORMED_SCHEMA_VERSION", error.message, { field, value, causeCode: error.code });
  }
  return value;
}

function validateConfig(value, options = {}) {
  requirePlainObject(value, "config");
  const version = validateVersionField(value.configSchemaVersion, "configSchemaVersion", options.allowLegacy === true);
  if (options.allowLegacy !== true && options.allowNonCurrent !== true && version !== CURRENT_CONFIG_SCHEMA_VERSION) fail("MALFORMED_SCHEMA_VERSION", "configSchemaVersion must equal the current schema version", { expected: CURRENT_CONFIG_SCHEMA_VERSION, actual: version });
  for (const field of ["saas", "selectors", "vas", "rules", "taskStorage", "browser", "mirror"]) {
    requirePlainObject(requireOwn(value, field, "config"), "config " + field);
  }
  for (const field of ["baseUrl", "loginUrl", "productDetailUrl", "productListUrl", "productOutListUrl", "productStockListUrl"]) requireOptionalType(value.saas, field, "string", "config saas");
  if (value.saas.credentials !== undefined) {
    requirePlainObject(value.saas.credentials, "config saas credentials");
    requireOptionalType(value.saas.credentials, "username", "string", "config saas credentials");
    requireOptionalType(value.saas.credentials, "password", "string", "config saas credentials");
  }
  requireString(requireOwn(value.taskStorage, "directory", "config taskStorage"), "config taskStorage directory");
  requireString(requireOwn(value.browser, "source", "config browser"), "config browser source");
  if (typeof requireOwn(value.browser, "allowFallback", "config browser") !== "boolean") fail("MALFORMED_MIGRATION_OBJECT", "config browser allowFallback must be a boolean");
  if (typeof requireOwn(value.browser, "headless", "config browser") !== "boolean") fail("MALFORMED_MIGRATION_OBJECT", "config browser headless must be a boolean");
  for (const field of ["minPrice", "maxPrice", "maxChangePercent", "minStock", "maxBatchSize"]) {
    if (value.rules[field] !== undefined && (typeof value.rules[field] !== "number" || !Number.isFinite(value.rules[field]))) fail("MALFORMED_MIGRATION_OBJECT", "config rules " + field + " must be a finite number");
  }
  requireOptionalType(value.mirror, "baseUrl", "string", "config mirror");
  requireOptionalType(value.mirror, "apiKey", "string", "config mirror");
  return value;
}

function validStateId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
}

function validateTaskIndex(value, options = {}) {
  if (Array.isArray(value)) {
    if (!options.allowLegacy) fail("MALFORMED_MIGRATION_OBJECT", "current task index must be an object");
    return value;
  }
  requirePlainObject(value, "task index");
  const version = validateVersionField(value.stateSchemaVersion, "stateSchemaVersion", options.allowLegacy === true);
  if (options.allowLegacy !== true && options.allowNonCurrent !== true && version !== CURRENT_STATE_SCHEMA_VERSION) fail("MALFORMED_SCHEMA_VERSION", "stateSchemaVersion must equal the current schema version", { expected: CURRENT_STATE_SCHEMA_VERSION, actual: version });
  if (!Array.isArray(value.tasks)) fail("MALFORMED_MIGRATION_OBJECT", "task index tasks must be an array");
  for (const task of value.tasks) {
    requirePlainObject(task, "task index entry");
    if (!validStateId(requireOwn(task, "taskId", "task index entry"))) fail("MALFORMED_MIGRATION_OBJECT", "task index entries must contain a safe taskId");
    requireString(requireOwn(task, "instruction", "task index entry"), "task index entry instruction");
    requireString(requireOwn(task, "createdAt", "task index entry"), "task index entry createdAt");
    validateTaskStatus(requireOwn(task, "status", "task index entry"), "task index entry status");
    requireOptionalType(task, "updatedAt", "string", "task index entry");
  }
  return value;
}

const TASK_STATUSES = new Set(["planned", "running", "in_progress", "completed", "failed", "cancelled", "stopped"]);

function validateTaskStatus(status, label) {
  if (typeof status !== "string" || !TASK_STATUSES.has(status)) fail("MALFORMED_MIGRATION_OBJECT", label + " is invalid");
}

function validateTask(value, options = {}) {
  requirePlainObject(value, "task state");
  const version = validateVersionField(value.stateSchemaVersion, "stateSchemaVersion", options.allowLegacy === true);
  if (options.allowLegacy !== true && options.allowNonCurrent !== true && version !== CURRENT_STATE_SCHEMA_VERSION) fail("MALFORMED_SCHEMA_VERSION", "stateSchemaVersion must equal the current schema version", { expected: CURRENT_STATE_SCHEMA_VERSION, actual: version });
  if (!validStateId(requireOwn(value, "taskId", "task state"))) fail("MALFORMED_MIGRATION_OBJECT", "task state taskId must be a safe identifier");
  requireString(requireOwn(value, "instruction", "task state"), "task state instruction");
  requirePlainObject(requireOwn(value, "changes", "task state"), "task state changes");
  requireString(requireOwn(value, "createdAt", "task state"), "task state createdAt");
  validateTaskStatus(requireOwn(value, "status", "task state"), "task state status");
  for (const field of ["history", "evidence"]) {
    if (!Array.isArray(requireOwn(value, field, "task state"))) fail("MALFORMED_MIGRATION_OBJECT", "task state " + field + " must be an array");
  }
  for (const entry of value.history) {
    requirePlainObject(entry, "task history entry");
    requireString(requireOwn(entry, "timestamp", "task history entry"), "task history timestamp");
    requireString(requireOwn(entry, "action", "task history entry"), "task history action");
    if (entry.status !== undefined) validateTaskStatus(entry.status, "task history status");
  }
  for (const entry of value.evidence) {
    requirePlainObject(entry, "task evidence entry");
    requireString(requireOwn(entry, "type", "task evidence entry"), "task evidence type");
    requireString(requireOwn(entry, "path", "task evidence entry"), "task evidence path");
    requireString(requireOwn(entry, "timestamp", "task evidence entry"), "task evidence timestamp");
  }
  requirePlainObject(requireOwn(value, "results", "task state"), "task state results");
  return value;
}

const BATCH_STATUSES = new Set(["running", "stopped", "partial", "completed", "completed_with_mismatch", "recovery_required", "delayed_verified", "delayed_verify_partial", "resumed"]);

function validProductId(value) {
  return (typeof value === "string" && value.length > 0) || (Number.isInteger(value) && value >= 0);
}

function validateBatch(value, options = {}) {
  requirePlainObject(value, "batch state");
  const version = validateVersionField(value.stateSchemaVersion, "stateSchemaVersion", options.allowLegacy === true);
  if (options.allowLegacy !== true && options.allowNonCurrent !== true && version !== CURRENT_STATE_SCHEMA_VERSION) fail("MALFORMED_SCHEMA_VERSION", "stateSchemaVersion must equal the current schema version", { expected: CURRENT_STATE_SCHEMA_VERSION, actual: version });
  if (!validStateId(requireOwn(value, "batchId", "batch state"))) fail("MALFORMED_MIGRATION_OBJECT", "batch state batchId must be a safe identifier");
  const status = requireOwn(value, "status", "batch state");
  if (typeof status !== "string" || !BATCH_STATUSES.has(status)) fail("MALFORMED_MIGRATION_OBJECT", "batch state status is invalid");
  requirePlainObject(requireOwn(value, "spec", "batch state"), "batch state spec");
  if (!Number.isInteger(requireOwn(value, "total", "batch state")) || value.total < 0) fail("MALFORMED_MIGRATION_OBJECT", "batch state total must be a non-negative integer");
  for (const field of ["completed", "previewOnly", "verifyFailed", "failed"]) {
    if (!Array.isArray(requireOwn(value, field, "batch state"))) fail("MALFORMED_MIGRATION_OBJECT", "batch state " + field + " must be an array");
    for (const entry of value[field]) {
      requirePlainObject(entry, "batch state " + field + " entry");
      if (!validProductId(requireOwn(entry, "productId", "batch state " + field + " entry"))) fail("MALFORMED_MIGRATION_OBJECT", "batch result productId is invalid");
      requireString(requireOwn(entry, "status", "batch state " + field + " entry"), "batch result status");
    }
  }
  const current = requireOwn(value, "current", "batch state");
  if (current !== null && !validProductId(current)) fail("MALFORMED_MIGRATION_OBJECT", "batch state current is invalid");
  const inFlight = requireOwn(value, "inFlight", "batch state");
  if (inFlight !== null) {
    requirePlainObject(inFlight, "batch state inFlight");
    if (!validProductId(requireOwn(inFlight, "productId", "batch state inFlight"))) fail("MALFORMED_MIGRATION_OBJECT", "batch state inFlight productId is invalid");
    if (!["submitting", "submitted"].includes(requireOwn(inFlight, "phase", "batch state inFlight"))) fail("MALFORMED_MIGRATION_OBJECT", "batch state inFlight phase is invalid");
    requirePlainObject(requireOwn(inFlight, "result", "batch state inFlight"), "batch state inFlight result");
  }
  requireString(requireOwn(value, "startedAt", "batch state"), "batch state startedAt");
  return value;
}

function validateRecovery(value) {
  requirePlainObject(value, "recovery state");
  const entries = Object.entries(value).filter(([field]) => field !== "__broadcast");
  const broadcast = value.__broadcast === true && entries.length > 0;
  const nested = value.__broadcast === undefined && entries.length > 0 && entries.every(([, fields]) => isPlainObject(fields) && Object.keys(fields).length > 0);
  if (!broadcast && !nested) fail("MALFORMED_MIGRATION_OBJECT", "recovery state must be a non-empty broadcast or per-spec changes object");
  return value;
}

const STATE_VALIDATORS = Object.freeze({
  "task-index": validateTaskIndex,
  task: validateTask,
  batch: validateBatch,
});

function getStateValidator(kind) {
  const validator = STATE_VALIDATORS[kind];
  if (!validator) fail("UNSUPPORTED_STATE_KIND", "Unsupported persisted state kind: " + kind, { kind });
  return validator;
}

function stateVersion(value) {
  if (Array.isArray(value)) return LEGACY_SCHEMA_VERSION;
  return value.stateSchemaVersion === undefined ? LEGACY_SCHEMA_VERSION : value.stateSchemaVersion;
}

function addConfigVersion(value) {
  return { ...value, configSchemaVersion: CURRENT_CONFIG_SCHEMA_VERSION };
}

function addStateVersion(value, context) {
  if (context.kind === "task-index" && Array.isArray(value)) {
    return { stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION, tasks: value };
  }
  return { ...value, stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION };
}

const CONFIG_MIGRATIONS = new Map([
  [LEGACY_SCHEMA_VERSION, Object.freeze({ to: CURRENT_CONFIG_SCHEMA_VERSION, migrate: addConfigVersion })],
]);
const STATE_MIGRATIONS = new Map([
  [LEGACY_SCHEMA_VERSION, Object.freeze({ to: CURRENT_STATE_SCHEMA_VERSION, migrate: addStateVersion })],
]);
const DEFAULT_MIGRATION_MAPS = Object.freeze({ config: CONFIG_MIGRATIONS, state: STATE_MIGRATIONS });

function currentVersionFor(domain) {
  if (domain === "config") return CURRENT_CONFIG_SCHEMA_VERSION;
  if (domain === "state") return CURRENT_STATE_SCHEMA_VERSION;
  fail("UNSUPPORTED_MIGRATION_DOMAIN", "Unsupported migration domain: " + domain, { domain });
}

function checkSchemaCompatibility(domain, version, options = {}) {
  const currentVersion = options.currentVersion || currentVersionFor(domain);
  const sourceVersion = validateVersionField(version, domain + "SchemaVersion", true);
  const comparison = compareSemver(sourceVersion, currentVersion);
  if (comparison > 0) {
    fail("FUTURE_SCHEMA_VERSION", domain + " schema " + sourceVersion + " is newer than supported " + currentVersion, { domain, sourceVersion, currentVersion });
  }
  if (comparison === 0) return { domain, sourceVersion, targetVersion: currentVersion, status: "current" };
  const maps = options.migrationMaps || DEFAULT_MIGRATION_MAPS;
  const map = maps[domain];
  if (!(map instanceof Map) || !map.has(sourceVersion)) {
    fail("UNSUPPORTED_SCHEMA_GAP", "No forward migration path for " + domain + " schema " + sourceVersion, { domain, sourceVersion, currentVersion });
  }
  return { domain, sourceVersion, targetVersion: currentVersion, status: "migration-required" };
}

function migrateValue(value, options) {
  const { domain, kind } = options;
  const currentVersion = currentVersionFor(domain);
  const maps = options.migrationMaps || DEFAULT_MIGRATION_MAPS;
  const map = maps[domain];
  const validate = domain === "config" ? validateConfig : getStateValidator(kind);
  validate(value, { allowLegacy: true });
  const sourceVersion = domain === "config"
    ? validateVersionField(value.configSchemaVersion, "configSchemaVersion", true)
    : validateVersionField(stateVersion(value), "stateSchemaVersion", true);
  checkSchemaCompatibility(domain, sourceVersion, { currentVersion, migrationMaps: maps });

  let working = clone(value);
  let version = sourceVersion;
  const steps = [];
  const seen = new Set();
  while (version !== currentVersion) {
    if (seen.has(version)) fail("MIGRATION_CYCLE", "Migration path contains a cycle at " + version);
    seen.add(version);
    const step = map && map.get(version);
    if (!step || typeof step.to !== "string" || typeof step.migrate !== "function") {
      fail("UNSUPPORTED_SCHEMA_GAP", "No forward migration step from " + version, { domain, version, currentVersion });
    }
    if (compareSemver(step.to, version) <= 0 || compareSemver(step.to, currentVersion) > 0) {
      fail("INVALID_MIGRATION_STEP", "Migration step must move forward toward the current schema", { domain, from: version, to: step.to });
    }
    const stepInput = clone(working);
    const migrated = step.migrate(stepInput, { domain, kind, from: version, to: step.to });
    working = migrated === undefined ? stepInput : migrated;
    validate(working, { allowLegacy: false });
    const actualVersion = domain === "config" ? working.configSchemaVersion : working.stateSchemaVersion;
    if (actualVersion !== step.to) {
      fail("MIGRATION_VERSION_MISMATCH", "Migration step did not produce its declared target version", { domain, from: version, expected: step.to, actual: actualVersion });
    }
    steps.push({ from: version, to: step.to });
    version = step.to;
  }
  validate(working, { allowLegacy: false });
  return {
    value: working,
    changed: steps.length > 0,
    sourceVersion,
    targetVersion: currentVersion,
    steps,
    migrationRecord: { domain, kind: kind || null, sourceVersion, targetVersion: currentVersion, steps: clone(steps) },
  };
}

function migrateConfig(value, options = {}) {
  return migrateValue(value, { ...options, domain: "config" });
}

function migrateState(value, options = {}) {
  return migrateValue(value, { ...options, domain: "state", kind: options.kind });
}

function fsyncDirectory(directoryPath, adapter) {
  let descriptor;
  try {
    descriptor = adapter.openSync(directoryPath, "r");
    adapter.fsyncSync(descriptor);
  } catch (error) {
    if (!error || !["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) adapter.closeSync(descriptor);
  }
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameStat(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

function sourceSnapshot(filePath, adapter) {
  const bytes = adapter.readFileSync(filePath);
  return { bytes, hash: hashBytes(bytes), stat: statIdentity(adapter.statSync(filePath)) };
}

function assertSourceUnchanged(filePath, expected, adapter) {
  const current = sourceSnapshot(filePath, adapter);
  if (current.hash !== expected.hash || !sameStat(current.stat, expected.stat)) {
    fail("MIGRATION_SOURCE_CHANGED", "Persisted JSON changed while migration was being prepared: " + filePath, {
      filePath,
      expectedHash: expected.hash,
      actualHash: current.hash,
      expectedStat: expected.stat,
      actualStat: current.stat,
    });
  }
}

function migrationArtifactPaths(filePath, token) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  return {
    temporary: path.join(directory, "." + basename + ".migration-" + token + ".tmp"),
    backup: path.join(directory, "." + basename + ".backup-" + token + ".tmp"),
  };
}

function validArtifactOwner(filePath, owner) {
  return owner
    && path.resolve(owner.metadata && owner.metadata.resourcePath || owner.resourcePath || owner.filePath || "") === path.resolve(filePath)
    && typeof (owner.ownerToken || owner.token) === "string"
    && /^[A-Za-z0-9_-]{1,128}$/.test(owner.ownerToken || owner.token);
}

function cleanupStaleOperationArtifacts(filePath, owner, adapter) {
  if (!validArtifactOwner(filePath, owner)) return;
  const artifacts = migrationArtifactPaths(filePath, owner.ownerToken || owner.token);
  if (adapter.existsSync(artifacts.backup) && !adapter.existsSync(filePath)) {
    try {
      adapter.linkSync(artifacts.backup, filePath);
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }
  }
  try { if (adapter.existsSync(artifacts.temporary)) adapter.unlinkSync(artifacts.temporary); } catch {}
  try { if (adapter.existsSync(artifacts.backup) && adapter.existsSync(filePath)) adapter.unlinkSync(artifacts.backup); } catch {}
}

function acquireMigrationLock(filePath, options = {}) {
  const adapter = options.fs || fs;
  const lockPath = filePath + ".migration.lock";
  try {
    return acquireLeaseLock({
      lockPath,
      lockKind: "migration",
      operationId: options.operationId || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")),
      operationPhase: "migrating",
      processInspector: options.processInspector,
      now: options.now,
      fs: options.lockFs || fs,
      ownerMetadata: { resourcePath: path.resolve(filePath) },
      onRecover: owner => cleanupStaleOperationArtifacts(filePath, owner, adapter),
    });
  } catch (error) {
    if (error.code === "LOCKED") fail("MIGRATION_LOCKED", "Another migration owns the persisted JSON lock: " + filePath, { filePath, owner: error.details && error.details.owner });
    throw error;
  }
}

function releaseMigrationLock(lock) {
  return releaseLeaseLock(lock);
}

function writeJsonAtomic(filePath, value, options = {}) {
  const adapter = options.fs || fs;
  const directory = path.dirname(filePath);
  const operationToken = options.operationOwner && options.operationOwner.ownerToken
    ? options.operationOwner.ownerToken
    : crypto.randomBytes(16).toString("hex");
  const { temporary, backup } = migrationArtifactPaths(filePath, operationToken);
  const expectedSource = options.expectedSource || sourceSnapshot(filePath, adapter);
  let descriptor;
  let sourceMoved = false;
  let installed = false;
  try {
    descriptor = adapter.openSync(temporary, "wx");
    adapter.writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n", "utf8");
    adapter.fsyncSync(descriptor);
    adapter.closeSync(descriptor);
    descriptor = undefined;

    try {
      adapter.renameSync(filePath, backup);
      sourceMoved = true;
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
      fail("MIGRATION_SOURCE_CHANGED", "Persisted JSON disappeared while migration was being prepared: " + filePath, { filePath });
    }

    const capturedBytes = adapter.readFileSync(backup);
    if (!capturedBytes.equals(expectedSource.bytes)) {
      fail("MIGRATION_SOURCE_CHANGED", "Persisted JSON changed while migration was being prepared: " + filePath, {
        filePath,
        expectedHash: expectedSource.hash,
        actualHash: hashBytes(capturedBytes),
      });
    }

    try {
      adapter.linkSync(temporary, filePath);
      installed = true;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      fail("MIGRATION_SOURCE_CHANGED", "Persisted JSON was replaced while migration was being installed: " + filePath, { filePath });
    }
    fsyncDirectory(directory, adapter);
    adapter.unlinkSync(backup);
    adapter.unlinkSync(temporary);
  } catch (error) {
    if (descriptor !== undefined) {
      try { adapter.closeSync(descriptor); } catch {}
    }
    if (sourceMoved && adapter.existsSync(backup)) {
      try {
        if (installed && adapter.existsSync(filePath)) {
          const targetStat = adapter.statSync(filePath);
          const temporaryStat = adapter.statSync(temporary);
          if (targetStat.dev !== temporaryStat.dev || targetStat.ino !== temporaryStat.ino) {
            fail("MIGRATION_SOURCE_CHANGED", "Persisted JSON changed after migration installation: " + filePath, { filePath });
          }
          adapter.unlinkSync(filePath);
        }
        if (!adapter.existsSync(filePath)) adapter.linkSync(backup, filePath);
        if (adapter.existsSync(backup) && adapter.existsSync(filePath)) adapter.unlinkSync(backup);
        fsyncDirectory(directory, adapter);
      } catch (restoreError) {
        try { if (adapter.existsSync(temporary)) adapter.unlinkSync(temporary); } catch {}
        try { if (adapter.existsSync(backup)) adapter.unlinkSync(backup); } catch {}
        fail("MIGRATION_RESTORE_FAILED", "Migration failed after replace and the original bytes could not be restored: " + filePath, {
          filePath,
          originalCode: error.code || "POST_REPLACE_FAILURE",
          originalMessage: error.message,
          restoreCode: restoreError.code || "RESTORE_FAILURE",
          restoreMessage: restoreError.message,
        });
      }
    }
    try { if (adapter.existsSync(temporary)) adapter.unlinkSync(temporary); } catch {}
    try { if (adapter.existsSync(backup)) adapter.unlinkSync(backup); } catch {}
    throw error;
  }
}

function migrateJsonFile(filePath, options = {}) {
  const adapter = options.fs || fs;
  let lock;
  let result;
  let primaryError;
  try {
    lock = acquireMigrationLock(filePath, options);
    heartbeatLeaseLock(lock, { operationPhase: "reading-source", now: options.now });
    const original = sourceSnapshot(filePath, adapter);
    let parsed;
    try {
      parsed = JSON.parse(original.bytes.toString("utf8"));
    } catch (error) {
      fail("MALFORMED_MIGRATION_JSON", "Persisted JSON is malformed: " + filePath, { cause: error.message });
    }
    result = options.domain === "config"
      ? migrateConfig(parsed, options)
      : options.domain === "state"
        ? migrateState(parsed, options)
        : fail("UNSUPPORTED_MIGRATION_DOMAIN", "Unsupported migration domain: " + options.domain);
    heartbeatLeaseLock(lock, { operationPhase: "writing-result", now: options.now });
    if (result.changed) writeJsonAtomic(filePath, result.value, { fs: adapter, expectedSource: original, operationOwner: lock.owner });
    heartbeatLeaseLock(lock, { operationPhase: "complete", now: options.now });
    result = { ...result, filePath, originalHash: original.hash };
  } catch (error) {
    primaryError = error;
  }
  if (lock) {
    try {
      releaseMigrationLock(lock);
    } catch (releaseError) {
      if (primaryError) throw attachLockReleaseFailure(primaryError, releaseError);
      throw new MigrationError("MIGRATION_LOCK_RELEASE_FAILED", "Migration completed but its owned lock could not be released", {
        operationCommitted: true,
        recoveryRequired: true,
        lockReleaseFailure: lockReleaseFailureDetails(releaseError),
      });
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

module.exports = {
  CONFIG_MIGRATIONS,
  CURRENT_CONFIG_SCHEMA_VERSION,
  CURRENT_STATE_SCHEMA_VERSION,
  DEFAULT_MIGRATION_MAPS,
  LEGACY_SCHEMA_VERSION,
  MigrationError,
  STATE_MIGRATIONS,
  checkSchemaCompatibility,
  migrateConfig,
  migrateJsonFile,
  migrateState,
  validateBatch,
  validateConfig,
  validateRecovery,
  validateTask,
  validateTaskIndex,
  writeJsonAtomic,
};
