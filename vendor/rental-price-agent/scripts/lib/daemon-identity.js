const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const { acquireStopLock, createWindowsProcessTerminator, releaseStopLock } = require("./daemon-stop-control");
const { attachLockReleaseFailure, createWindowsProcessInspector, lockReleaseFailureDetails, runWithLeaseHeartbeat } = require("./lease-lock");
const { writeJsonAtomicDurable } = require("./install-receipt");
const { readCurrentMetadata } = require("./version-contract");

const IDENTITY_SCHEMA_VERSION = 1;

function fingerprintToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function comparable(entryPath) {
  const resolved = path.resolve(entryPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonical(entryPath) {
  return fs.realpathSync.native ? fs.realpathSync.native(entryPath) : fs.realpathSync(entryPath);
}

function identityResult(code, details) {
  return {
    valid: false,
    code,
    liveProcessConfirmed: Boolean(details && details.liveProcessConfirmed),
    ...(details === undefined ? {} : { details }),
    ...(details && details.identity ? { identity: details.identity } : {}),
  };
}

function inspectIdentityPath(layout) {
  let stat;
  try { stat = fs.lstatSync(layout.daemonIdentityPath); } catch (error) {
    if (error.code === "ENOENT") return { present: false };
    return { present: true, error: "DAEMON_IDENTITY_UNREADABLE" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { present: true, error: "DAEMON_IDENTITY_UNSAFE_PATH" };
  try {
    const daemonDir = canonical(layout.daemonDir);
    const identityPath = canonical(layout.daemonIdentityPath);
    if (comparable(path.dirname(identityPath)) !== comparable(daemonDir)
        || comparable(identityPath) !== comparable(path.join(daemonDir, path.basename(layout.daemonIdentityPath)))) {
      return { present: true, error: "DAEMON_IDENTITY_UNSAFE_PATH" };
    }
  } catch {
    return { present: true, error: "DAEMON_IDENTITY_UNSAFE_PATH" };
  }
  return { present: true };
}

function readDaemonIdentity(layout) {
  const inspected = inspectIdentityPath(layout);
  if (!inspected.present || inspected.error) return inspected;
  let identity;
  try { identity = JSON.parse(fs.readFileSync(layout.daemonIdentityPath, "utf8")); } catch { return { present: true, error: "DAEMON_IDENTITY_MALFORMED" }; }
  const requiredStrings = ["targetDir", "dataRoot", "creationToken", "instanceId", "tokenFingerprint", "executablePath", "releaseTreeSha256", "startedAt"];
  if (!identity || identity.schemaVersion !== IDENTITY_SCHEMA_VERSION || !Number.isInteger(identity.pid) || identity.pid <= 0
      || !Number.isInteger(identity.port) || identity.port <= 0 || identity.port > 65535
      || requiredStrings.some(field => typeof identity[field] !== "string" || !identity[field])
      || !identity.versions || typeof identity.versions !== "object") return { present: true, error: "DAEMON_IDENTITY_MALFORMED" };
  return { present: true, identity };
}

function writeSecretAtomic(filePath, value) {
  const temporary = path.join(path.dirname(filePath), "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"));
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

async function createDaemonIdentity(options) {
  const layout = options.layout;
  fs.mkdirSync(layout.daemonDir, { recursive: true });
  const daemonStat = fs.lstatSync(layout.daemonDir);
  if (daemonStat.isSymbolicLink() || !daemonStat.isDirectory()) throw Object.assign(new Error("Daemon data directory is unsafe"), { code: "DAEMON_IDENTITY_UNSAFE_PATH" });
  const processInspector = options.processInspector || createWindowsProcessInspector();
  const processIdentity = await processInspector.inspect(options.pid);
  if (!processIdentity.exists || !processIdentity.creationToken) throw Object.assign(new Error("Daemon process identity could not be inspected"), { code: "DAEMON_PROCESS_NOT_VERIFIABLE" });
  const metadata = options.manifest || readCurrentMetadata();
  const identity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    pid: options.pid,
    creationToken: processIdentity.creationToken,
    creationTime: processIdentity.creationTime || null,
    instanceId: options.instanceId,
    port: options.port,
    tokenFingerprint: fingerprintToken(options.token),
    executablePath: processIdentity.executablePath || process.execPath,
    targetDir: canonical(options.targetDir),
    dataRoot: canonical(layout.dataRoot),
    releaseTreeSha256: options.releaseTreeSha256,
    versions: {
      skill: metadata.skillVersion,
      daemon: metadata.daemonVersion,
      protocol: metadata.protocolVersion,
      configSchema: metadata.configSchemaVersion,
      stateSchema: metadata.stateSchemaVersion,
    },
    startedAt: options.startedAt || new Date().toISOString(),
  };
  writeSecretAtomic(layout.daemonTokenPath, options.token);
  writeSecretAtomic(layout.daemonPidPath, String(options.pid));
  writeSecretAtomic(layout.daemonPortPath, String(options.port));
  writeJsonAtomicDurable(layout.daemonIdentityPath, identity);
  return identity;
}

function requestHello(port, token, timeoutMs = 1500) {
  return new Promise(resolve => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const data = JSON.stringify({ action: "hello", negotiationNonce: nonce });
    const request = http.request({ hostname: "127.0.0.1", port, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), "x-rental-agent-token": token } }, response => {
      let body = "";
      response.on("data", chunk => body += chunk);
      response.on("end", () => {
        if (response.statusCode === 401 || response.statusCode === 403) return resolve({ error: "DAEMON_AUTH_FAILED" });
        try {
          const value = JSON.parse(body);
          if (!value || value.status !== "ok" || value.hello !== true || value.negotiationNonce !== nonce) return resolve({ error: "DAEMON_HELLO_MISMATCH" });
          resolve({ value });
        } catch { resolve({ error: "DAEMON_HELLO_MISMATCH" }); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve({ error: "DAEMON_UNREACHABLE" }));
    request.end(data);
  });
}

async function validateDaemonIdentity(options) {
  const read = readDaemonIdentity(options.layout);
  if (!read.present) return identityResult("DAEMON_IDENTITY_ABSENT");
  if (read.error) return identityResult(read.error);
  const identity = read.identity;
  let expectedTarget;
  let expectedDataRoot;
  try { expectedTarget = canonical(options.targetDir); expectedDataRoot = canonical(options.layout.dataRoot); } catch { return identityResult("DAEMON_IDENTITY_PATH_MISMATCH"); }
  if (comparable(identity.targetDir) !== comparable(expectedTarget) || comparable(identity.dataRoot) !== comparable(expectedDataRoot)) return identityResult("DAEMON_IDENTITY_PATH_MISMATCH", { identity });
  const processInspector = options.processInspector || createWindowsProcessInspector();
  const current = await processInspector.inspect(identity.pid);
  if (current.inspectionFailed) return identityResult("PROCESS_INSPECTION_FAILED", { identity });
  if (!current.exists) return identityResult("DAEMON_PROCESS_ABSENT", { identity });
  if (!current.creationToken || current.creationToken !== identity.creationToken) return identityResult("PROCESS_IDENTITY_MISMATCH", { identity });
  if (current.executablePath && identity.executablePath && comparable(current.executablePath) !== comparable(identity.executablePath)) return identityResult("PROCESS_IDENTITY_MISMATCH", { identity, liveProcessConfirmed: true });
  let token;
  try {
    const stat = fs.lstatSync(options.layout.daemonTokenPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return identityResult("DAEMON_TOKEN_UNSAFE_PATH", { identity, liveProcessConfirmed: true });
    token = fs.readFileSync(options.layout.daemonTokenPath, "utf8").trim();
  } catch { return identityResult("DAEMON_TOKEN_MISSING", { identity, liveProcessConfirmed: true }); }
  if (!token || fingerprintToken(token) !== identity.tokenFingerprint) return identityResult("DAEMON_TOKEN_MISMATCH", { identity, liveProcessConfirmed: true });
  const hello = await (options.requestHello || requestHello)(identity.port, token);
  if (hello.error) return identityResult(hello.error, { identity, liveProcessConfirmed: true });
  const value = hello.value;
  const versions = identity.versions;
  if (value.instanceId !== identity.instanceId || value.releaseTreeSha256 !== identity.releaseTreeSha256
      || value.skillVersion !== versions.skill || value.daemonVersion !== versions.daemon || value.protocolVersion !== versions.protocol
      || value.configSchemaVersion !== versions.configSchema || value.stateSchemaVersion !== versions.stateSchema) return identityResult("DAEMON_HELLO_MISMATCH", { identity, liveProcessConfirmed: true });
  return { valid: true, code: "DAEMON_IDENTITY_VALID", liveProcessConfirmed: true, identity, token, hello: value };
}

function removeDaemonFiles(layout) {
  for (const filePath of [layout.daemonIdentityPath, layout.daemonPidPath, layout.daemonPortPath, layout.daemonTokenPath]) {
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isSymbolicLink() && stat.isFile()) fs.unlinkSync(filePath);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function cleanupDaemonState(options) {
  const result = await validateDaemonIdentity(options);
  if (result.valid) return { cleaned: false, reason: "DAEMON_LIVE", identity: result.identity };
  if (result.liveProcessConfirmed) {
    return { cleaned: false, reason: "DAEMON_RECOVERY_REQUIRED", causeCode: result.code, identity: result.identity };
  }
  const removable = new Set(["DAEMON_IDENTITY_ABSENT", "DAEMON_PROCESS_ABSENT", "PROCESS_IDENTITY_MISMATCH"]);
  if (!removable.has(result.code)) return { cleaned: false, reason: result.code };
  removeDaemonFiles(options.layout);
  return { cleaned: true, reason: result.code };
}

async function stopValidatedDaemon(options) {
  let lock;
  try {
    lock = acquireStopLock(options.layout, options);
  } catch (error) {
    return { stopped: false, code: error.code === "LOCK_RECOVERY_REQUIRED" ? error.code : "DAEMON_STOP_LOCK_FAILED" };
  }
  if (!lock) return { stopped: false, code: "DAEMON_STOP_IN_PROGRESS" };
  let result;
  let primaryError;
  let removeFiles = false;
  let operationCommitted = false;
  try {
    const validation = await runWithLeaseHeartbeat(lock, "validating", () => validateDaemonIdentity(options), options);
    if (!validation.valid) {
      if (validation.code === "DAEMON_IDENTITY_ABSENT" || validation.code === "DAEMON_PROCESS_ABSENT") {
        removeFiles = true;
        result = { stopped: false, code: "DAEMON_ALREADY_STOPPED" };
      } else {
        result = { stopped: false, code: validation.code };
      }
    } else {
      const killAdapter = options.killAdapter || createWindowsProcessTerminator();
      let termination;
      try {
        termination = await runWithLeaseHeartbeat(lock, "terminating", () => killAdapter.terminateIfIdentityMatches(validation.identity.pid, validation.identity.creationToken), options);
      } catch {
        result = { stopped: false, code: "DAEMON_STOP_FAILED" };
      }
      if (!result) {
        if (!termination || termination.outcome === "failed") result = { stopped: false, code: "DAEMON_STOP_FAILED" };
        else if (termination.outcome === "identity_mismatch") result = { stopped: false, code: "PROCESS_IDENTITY_MISMATCH" };
        else if (termination.outcome === "absent") {
          removeFiles = true;
          result = { stopped: false, code: "DAEMON_ALREADY_STOPPED", pid: validation.identity.pid };
        } else if (termination.outcome === "terminated") {
          operationCommitted = true;
          removeFiles = true;
          result = { stopped: true, code: "DAEMON_STOPPED", pid: validation.identity.pid };
        } else {
          result = { stopped: false, code: "DAEMON_STOP_FAILED" };
        }
      }
    }
  } catch (error) {
    primaryError = error;
  }
  try {
    releaseStopLock(lock);
  } catch (releaseError) {
    if (primaryError) throw attachLockReleaseFailure(primaryError, releaseError);
    const releaseDetails = lockReleaseFailureDetails(releaseError);
    if (result && !["DAEMON_STOPPED", "DAEMON_ALREADY_STOPPED"].includes(result.code)) {
      result.details = { ...(result.details || {}), lockReleaseFailure: releaseDetails };
      return result;
    }
    return {
      stopped: false,
      code: "DAEMON_STOP_LOCK_RELEASE_FAILED",
      ...(result && result.pid ? { pid: result.pid } : {}),
      details: { operationCommitted, recoveryRequired: true, lockReleaseFailure: releaseDetails },
    };
  }
  if (primaryError) throw primaryError;
  if (removeFiles) removeDaemonFiles(options.layout);
  return result;
}

module.exports = {
  IDENTITY_SCHEMA_VERSION,
  cleanupDaemonState,
  createDaemonIdentity,
  createWindowsProcessInspector,
  createWindowsProcessTerminator,
  fingerprintToken,
  readDaemonIdentity,
  removeDaemonFiles,
  stopValidatedDaemon,
  validateDaemonIdentity,
};
