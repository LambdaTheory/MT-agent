const { classifyAction, classifyComposite } = require("./action-registry");
const {
  HANDSHAKE_FIELDS,
  compareSemver,
  parseSemver,
  readCurrentMetadata,
} = require("./version-contract");

const NEGOTIATION_FIELDS = new Set(["nonce", "expectedInstanceId", "expectedStateDigest", "actionClass", "client"]);
const CLIENT_FIELDS = new Set(["skillVersion", "protocolVersion", "configSchemaVersion", "stateSchemaVersion", "compatibility"]);
const COMPATIBILITY_DOMAINS = Object.freeze(["skill", "daemon", "protocol", "configSchema", "stateSchema"]);
const VERSION_FIELDS = Object.freeze([
  "skillVersion", "daemonVersion", "protocolVersion", "minClientProtocolVersion",
  "maxClientProtocolVersion", "configSchemaVersion", "stateSchemaVersion",
]);
const MISMATCH_CODES = Object.freeze({
  skill: "SKILL_VERSION_INCOMPATIBLE",
  daemon: "DAEMON_VERSION_INCOMPATIBLE",
  protocol: "PROTOCOL_INCOMPATIBLE",
  configSchema: "CONFIG_SCHEMA_INCOMPATIBLE",
  stateSchema: "STATE_SCHEMA_INCOMPATIBLE",
});
const VERSION_BY_DOMAIN = Object.freeze({
  skill: "skillVersion",
  daemon: "daemonVersion",
  protocol: "protocolVersion",
  configSchema: "configSchemaVersion",
  stateSchema: "stateSchemaVersion",
});

function protocolError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function errorResult(code, message, details) {
  return { status: "error", allowed: false, blocked: true, code, message, ...(details === undefined ? {} : { details }) };
}

function requireObject(value, fields, context, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError(code, context + " must be an object");
  const unknown = Object.keys(value).filter(field => !fields.has(field));
  if (unknown.length) throw protocolError(code, "Unknown " + context + " field: " + unknown[0], { field: unknown[0] });
  const missing = [...fields].filter(field => !Object.prototype.hasOwnProperty.call(value, field));
  if (missing.length) throw protocolError(code, "Missing " + context + " field: " + missing[0], { field: missing[0] });
}

function parseRange(range, field, code) {
  requireObject(range, new Set(["min", "max"]), field, code);
  const min = parseSemver(range.min, field + ".min");
  const max = parseSemver(range.max, field + ".max");
  if (compareSemver(min, max) > 0) throw protocolError(code, field + " minimum exceeds maximum");
  return { min, max };
}

function inRange(version, range) {
  const parsed = typeof version === "string" ? parseSemver(version, "version") : version;
  return compareSemver(parsed, range.min) >= 0 && compareSemver(parsed, range.max) <= 0;
}

function validateCompatibilityRanges(compatibility, code, context) {
  requireObject(compatibility, new Set(COMPATIBILITY_DOMAINS), context, code);
  return Object.fromEntries(COMPATIBILITY_DOMAINS.map(domain => [domain, parseRange(compatibility[domain], context + "." + domain, code)]));
}

function validateHandshakeShape(handshake) {
  try {
    requireObject(handshake, HANDSHAKE_FIELDS, "handshake", "DAEMON_HANDSHAKE_INVALID");
    for (const field of VERSION_FIELDS) parseSemver(handshake[field], "handshake." + field);
    if (typeof handshake.instanceId !== "string" || !handshake.instanceId.trim()) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake.instanceId must be a non-empty string");
    for (const field of ["browserSource", "browserVersion"]) {
      if (handshake[field] !== null && (typeof handshake[field] !== "string" || !handshake[field].trim())) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake." + field + " must be null or a non-empty string");
    }
    if (typeof handshake.upgradeLock !== "boolean" || typeof handshake.restartRequired !== "boolean") throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake flags must be boolean");
    if (typeof handshake.persistedStateReady !== "boolean" || !/^[a-f0-9]{64}$/.test(handshake.persistedStateDigest)) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake persisted state readiness is invalid");
    if (!Array.isArray(handshake.persistedStateBlockers) || handshake.persistedStateBlockers.some(code => typeof code !== "string" || !code)) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake persisted state blockers are invalid");
    if (!handshake.actualSchemaVersions || typeof handshake.actualSchemaVersions !== "object" || Array.isArray(handshake.actualSchemaVersions)
      || (handshake.actualSchemaVersions.config !== null && typeof handshake.actualSchemaVersions.config !== "string")
      || !Array.isArray(handshake.actualSchemaVersions.state)) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake actual schema versions are invalid");
    const min = parseSemver(handshake.minClientProtocolVersion, "handshake.minClientProtocolVersion");
    const max = parseSemver(handshake.maxClientProtocolVersion, "handshake.maxClientProtocolVersion");
    if (compareSemver(min, max) > 0 || !inRange(handshake.protocolVersion, { min, max })) throw protocolError("DAEMON_HANDSHAKE_INVALID", "handshake protocol range is invalid");
    return JSON.parse(JSON.stringify(handshake));
  } catch (error) {
    if (error && error.code === "DAEMON_HANDSHAKE_INVALID") throw error;
    throw protocolError("DAEMON_HANDSHAKE_INVALID", error.message, { causeCode: error.code });
  }
}

function classifyCommand(command) {
  const root = classifyAction(command && command.action);
  if (!root.allowed || !root.surfaces.includes("daemon")) return { ...root, allowed: false, blocked: true, reason: "ACTION_NOT_CLASSIFIED" };
  const nested = command && Array.isArray(command.commands) ? command.commands : null;
  if (!nested) return root;
  if (nested.some(child => {
    const decision = classifyAction(child && child.action);
    return !decision.allowed || !decision.surfaces.includes("daemon");
  })) return { action: root.action, classification: null, allowed: false, blocked: true, reason: "ACTION_NOT_CLASSIFIED" };
  const composite = classifyComposite([{ action: root.action }, ...nested]);
  return composite.allowed ? { ...root, classification: composite.classification, children: composite.children } : composite;
}

function mismatchForHandshake(handshake, manifest) {
  const ranges = validateCompatibilityRanges(manifest.compatibility, "CLIENT_VERSION_METADATA_INVALID", "manifest.compatibility");
  const daemonProtocolRange = {
    min: parseSemver(handshake.minClientProtocolVersion, "handshake.minClientProtocolVersion"),
    max: parseSemver(handshake.maxClientProtocolVersion, "handshake.maxClientProtocolVersion"),
  };
  if (!inRange(handshake.protocolVersion, ranges.protocol) || !inRange(manifest.protocolVersion, daemonProtocolRange)) return "PROTOCOL_INCOMPATIBLE";
  for (const domain of ["skill", "daemon", "configSchema", "stateSchema"]) {
    if (!inRange(handshake[VERSION_BY_DOMAIN[domain]], ranges[domain])) return MISMATCH_CODES[domain];
  }
  if (handshake.upgradeLock) return "DAEMON_UPGRADE_LOCKED";
  if (handshake.restartRequired) return "DAEMON_RESTART_REQUIRED";
  if (!handshake.persistedStateReady) return "PERSISTED_STATE_NOT_READY";
  return null;
}

function evaluateClientCompatibility({ action, commands, handshake, manifest = readCurrentMetadata() }) {
  const parsedHandshake = validateHandshakeShape(handshake);
  const command = commands === undefined ? { action } : { action, commands };
  const classification = classifyCommand(command);
  if (!classification.allowed) return { ...classification, code: "ACTION_NOT_CLASSIFIED" };
  const mismatch = mismatchForHandshake(parsedHandshake, manifest);
  const readCompatible = mismatch !== "PROTOCOL_INCOMPATIBLE";
  const writeCompatible = mismatch === null;
  const allowed = classification.classification === "safe-read" ? readCompatible : writeCompatible;
  return {
    action: classification.action,
    classification: classification.classification,
    allowed,
    blocked: !allowed,
    readCompatible,
    writeCompatible,
    code: allowed ? null : mismatch,
  };
}

function clientMetadata(manifest) {
  return {
    skillVersion: manifest.skillVersion,
    protocolVersion: manifest.protocolVersion,
    configSchemaVersion: manifest.configSchemaVersion,
    stateSchemaVersion: manifest.stateSchemaVersion,
    compatibility: JSON.parse(JSON.stringify(manifest.compatibility)),
  };
}

function attachNegotiation(command, { handshake, nonce, manifest = readCurrentMetadata() }) {
  const decision = evaluateClientCompatibility({ action: command.action, commands: command.commands, handshake, manifest });
  return {
    ...command,
    _negotiation: {
      nonce,
      expectedInstanceId: handshake.instanceId,
      expectedStateDigest: handshake.persistedStateDigest,
      actionClass: decision.classification,
      client: clientMetadata(manifest),
    },
  };
}

function validateClientMetadata(client) {
  try {
    requireObject(client, CLIENT_FIELDS, "negotiation.client", "CLIENT_VERSION_METADATA_INVALID");
    for (const field of ["skillVersion", "protocolVersion", "configSchemaVersion", "stateSchemaVersion"]) parseSemver(client[field], "negotiation.client." + field);
    return { ...client, ranges: validateCompatibilityRanges(client.compatibility, "CLIENT_VERSION_METADATA_INVALID", "negotiation.client.compatibility") };
  } catch (error) {
    if (error && error.code === "CLIENT_VERSION_METADATA_INVALID") throw error;
    throw protocolError("CLIENT_VERSION_METADATA_INVALID", error.message, { causeCode: error.code });
  }
}

function daemonMismatch(client, handshake, manifest) {
  const daemonRanges = validateCompatibilityRanges(manifest.compatibility, "CLIENT_VERSION_METADATA_INVALID", "manifest.compatibility");
  if (!inRange(client.protocolVersion, { min: parseSemver(handshake.minClientProtocolVersion, "minClientProtocolVersion"), max: parseSemver(handshake.maxClientProtocolVersion, "maxClientProtocolVersion") })
    || !inRange(handshake.protocolVersion, client.ranges.protocol)) return "CLIENT_PROTOCOL_INCOMPATIBLE";
  const pairs = [
    ["skill", client.skillVersion, handshake.skillVersion],
    ["configSchema", client.configSchemaVersion, handshake.configSchemaVersion],
    ["stateSchema", client.stateSchemaVersion, handshake.stateSchemaVersion],
  ];
  for (const [domain, clientVersion, daemonVersion] of pairs) {
    if (!inRange(clientVersion, daemonRanges[domain]) || !inRange(daemonVersion, client.ranges[domain])) return MISMATCH_CODES[domain];
  }
  if (!inRange(handshake.daemonVersion, client.ranges.daemon)) return "DAEMON_VERSION_INCOMPATIBLE";
  if (handshake.upgradeLock) return "DAEMON_UPGRADE_LOCKED";
  if (handshake.restartRequired) return "DAEMON_RESTART_REQUIRED";
  return null;
}

function validatePersistedStateBinding(command, handshake) {
  const classification = classifyCommand(command);
  if (!classification.allowed) return errorResult("ACTION_NOT_CLASSIFIED", "Action is not registered", { action: classification.action });
  if (classification.classification === "safe-read" || classification.classification === "diagnostic") return { status: "ok", allowed: true, classification: classification.classification };
  const negotiation = command && command._negotiation;
  if (!negotiation || negotiation.expectedStateDigest !== handshake.persistedStateDigest) {
    return errorResult("PERSISTED_STATE_CHANGED", "Persisted state changed after hello", {
      expectedStateDigest: negotiation && negotiation.expectedStateDigest,
      actualStateDigest: handshake.persistedStateDigest,
    });
  }
  if (!handshake.persistedStateReady) return errorResult("PERSISTED_STATE_NOT_READY", "Persisted state is not ready for mutations", { blockers: handshake.persistedStateBlockers });
  return { status: "ok", allowed: true, classification: classification.classification };
}

function validateDaemonCommand(command, { handshake, nonceStore, manifest = readCurrentMetadata() }) {
  const classification = classifyCommand(command);
  if (!classification.allowed) return errorResult("ACTION_NOT_CLASSIFIED", "Action is not registered", { action: classification.action });
  try {
    requireObject(command && command._negotiation, NEGOTIATION_FIELDS, "negotiation", "NEGOTIATION_REQUIRED");
    const negotiation = command._negotiation;
    if (negotiation.expectedInstanceId !== handshake.instanceId) return errorResult("DAEMON_INSTANCE_MISMATCH", "Daemon instance changed after hello");
    if (typeof negotiation.nonce !== "string" || !negotiation.nonce.trim() || !nonceStore.consume(negotiation.nonce)) return errorResult("NEGOTIATION_NONCE_INVALID", "Negotiation nonce is missing, expired, or already used");
    if (negotiation.actionClass !== classification.classification) return errorResult("ACTION_CLASS_MISMATCH", "Client action class does not match daemon registry");
    const binding = validatePersistedStateBinding(command, handshake);
    if (!binding.allowed) return binding;
    const client = validateClientMetadata(negotiation.client);
    const mismatch = daemonMismatch(client, handshake, manifest);
    const protocolCompatible = mismatch !== "CLIENT_PROTOCOL_INCOMPATIBLE";
    const allowed = classification.classification === "safe-read" ? protocolCompatible : mismatch === null;
    return allowed
      ? { status: "ok", allowed: true, classification: classification.classification }
      : errorResult(mismatch, "Command blocked by daemon compatibility policy", { classification: classification.classification });
  } catch (error) {
    return errorResult(error.code || "NEGOTIATION_REQUIRED", error.message, error.details);
  }
}

module.exports = {
  attachNegotiation,
  classifyCommand,
  clientMetadata,
  errorResult,
  evaluateClientCompatibility,
  protocolError,
  validateDaemonCommand,
  validateHandshakeShape,
  validatePersistedStateBinding,
};
