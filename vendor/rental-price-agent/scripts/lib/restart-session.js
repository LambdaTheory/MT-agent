const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { classifyCommand, errorResult } = require("./daemon-compatibility");
const { hashReleaseTree, writeJsonAtomicDurable } = require("./install-receipt");

const RESTART_SCHEMA_VERSION = 1;
const clearOperations = new Map();

function markerPath(layout) { return path.join(layout.dataRoot, "restart-required.json"); }

function captureLoadedReleaseIdentity(options) {
  return Object.freeze({
    targetDir: path.resolve(options.targetDir),
    releaseTreeSha256: options.releaseTreeSha256 || hashReleaseTree(options.targetDir),
    sessionId: options.sessionId || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")),
    loadedAt: options.loadedAt || new Date().toISOString(),
  });
}

function writeRestartMarker(layout, value) {
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  const marker = {
    schemaVersion: RESTART_SCHEMA_VERSION,
    required: true,
    activatingReleaseTreeSha256: value.activatingReleaseTreeSha256,
    activationId: value.activationId,
    sessionId: value.sessionId,
    createdAt: value.createdAt || new Date().toISOString(),
    reason: value.reason,
  };
  writeJsonAtomicDurable(markerPath(layout), marker);
  return marker;
}

function readRestartMarker(layout) {
  const filePath = markerPath(layout);
  let stat;
  try { stat = fs.lstatSync(filePath); } catch (error) {
    if (error.code === "ENOENT") return { present: false, required: false, path: filePath };
    return { present: true, required: true, path: filePath, error: "RESTART_MARKER_UNREADABLE" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { present: true, required: true, path: filePath, error: "RESTART_MARKER_UNSAFE_PATH" };
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return { present: true, required: true, path: filePath, error: "RESTART_MARKER_MALFORMED" }; }
  if (!value || value.schemaVersion !== RESTART_SCHEMA_VERSION || value.required !== true
      || !/^[a-f0-9]{64}$/.test(String(value.activatingReleaseTreeSha256 || ""))
      || typeof value.activationId !== "string" || !value.activationId
      || typeof value.sessionId !== "string" || !value.sessionId
      || typeof value.reason !== "string" || !value.reason
      || typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return { present: true, required: true, path: filePath, error: "RESTART_MARKER_MALFORMED" };
  }
  return { present: true, required: true, path: filePath, value };
}

function restartError(reason) {
  return errorResult("SESSION_RESTART_REQUIRED", "OpenCode must be restarted by the user before lifecycle control or mutations", { reason, automaticRestartAttempted: false });
}

async function clearMatchingMarker(options, marker) {
  const key = markerPath(options.layout);
  if (clearOperations.has(key)) return clearOperations.get(key);
  const operation = (async () => {
    const doctor = options.validateDoctor ? await options.validateDoctor() : { readyForWrites: false, blockers: ["DOCTOR_VALIDATION_REQUIRED"] };
    const allowedDoctorBlockers = new Set(["RESTART_REQUIRED", ...(options.allowedDoctorBlockers || [])]);
    const blockers = Array.isArray(doctor.blockers) ? doctor.blockers.filter(code => !allowedDoctorBlockers.has(code)) : ["DOCTOR_VALIDATION_REQUIRED"];
    if (blockers.length) return restartError("DOCTOR_NOT_READY");
    const daemon = options.validateDaemon ? await options.validateDaemon() : { compatible: false };
    if (!daemon || (!daemon.compatible && !daemon.noDaemon)) return restartError("DAEMON_NOT_COMPATIBLE");
    const current = readRestartMarker(options.layout);
    if (!current.present) return { allowed: true, cleared: false };
    if (current.error || current.value.activationId !== marker.activationId || current.value.activatingReleaseTreeSha256 !== marker.activatingReleaseTreeSha256) return restartError("MARKER_CHANGED");
    try { fs.unlinkSync(current.path); } catch (error) { if (error.code !== "ENOENT") return restartError("MARKER_CLEAR_FAILED"); }
    return { allowed: true, cleared: true, activationId: marker.activationId };
  })();
  clearOperations.set(key, operation);
  try { return await operation; } finally { clearOperations.delete(key); }
}

async function enforceRestartForCommand(options) {
  const marker = readRestartMarker(options.layout);
  if (!marker.present) return { allowed: true, cleared: false };
  const classification = classifyCommand(options.command || {});
  if (classification.allowed && classification.classification === "safe-read") return { allowed: true, safeRead: true, cleared: false };
  if (marker.error) return restartError(marker.error);
  const loaded = options.loadedIdentity || {};
  if (loaded.releaseTreeSha256 !== marker.value.activatingReleaseTreeSha256 || loaded.sessionId === marker.value.sessionId) return restartError("LOADED_RELEASE_STALE");
  if (options.deferClear) return { allowed: true, pendingClear: true };
  return clearMatchingMarker(options, marker.value);
}

module.exports = {
  RESTART_SCHEMA_VERSION,
  captureLoadedReleaseIdentity,
  enforceRestartForCommand,
  markerPath,
  readRestartMarker,
  writeRestartMarker,
};
