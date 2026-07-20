const crypto = require("crypto");
const http = require("http");

const { HANDSHAKE_FIELDS, readCurrentMetadata } = require("./version-contract");
const {
  attachNegotiation,
  errorResult,
  evaluateClientCompatibility,
  validateHandshakeShape,
} = require("./daemon-compatibility");
const { LAYOUT, SKILL_DIR } = require("./config-loader");
const { captureLoadedReleaseIdentity, enforceRestartForCommand } = require("./restart-session");

const LOADED_RELEASE_IDENTITY = captureLoadedReleaseIdentity({ targetDir: SKILL_DIR });
const DEFAULT_DAEMON_COMMAND_TIMEOUT_MS = 60000;

function requestJson({ port, token, body, timeoutMs = DEFAULT_DAEMON_COMMAND_TIMEOUT_MS }) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
        "x-rental-agent-token": token,
      },
    }, response => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", chunk => responseBody += chunk);
      response.on("end", () => {
        if (response.statusCode === 401 || response.statusCode === 403) return resolve(errorResult("DAEMON_AUTH_FAILED", "Daemon token was rejected"));
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        if (!contentType.includes("application/json")) return resolve(errorResult("DAEMON_RESPONSE_INVALID", "Daemon response was not JSON"));
        try {
          const parsed = JSON.parse(responseBody);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return resolve(errorResult("DAEMON_RESPONSE_INVALID", "Daemon response must be a JSON object"));
          resolve(parsed);
        } catch {
          resolve(errorResult("DAEMON_RESPONSE_INVALID", "Daemon response contained malformed JSON"));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Daemon request timed out")));
    request.on("error", error => resolve(errorResult("DAEMON_UNREACHABLE", error.message)));
    request.end(data);
  });
}

function extractHandshake(response, nonce) {
  if (!response || response.status !== "ok" || response.hello !== true) throw Object.assign(new Error("Daemon hello was not accepted"), { code: response && response.code || "DAEMON_HANDSHAKE_INVALID" });
  if (response.negotiationNonce !== nonce) throw Object.assign(new Error("Daemon did not echo the negotiation nonce"), { code: "NEGOTIATION_NONCE_INVALID" });
  const handshake = Object.fromEntries([...HANDSHAKE_FIELDS].map(field => [field, response[field]]));
  return validateHandshakeShape(handshake);
}

async function sendNegotiatedCommand({ port, token, command, manifest = readCurrentMetadata(), timeoutMs = DEFAULT_DAEMON_COMMAND_TIMEOUT_MS, beforeCommand }) {
  if (command && (command.action === "ping" || command.action === "hello")) return requestJson({ port, token, body: command, timeoutMs });
  const preflight = await enforceRestartForCommand({ layout: LAYOUT, command, loadedIdentity: LOADED_RELEASE_IDENTITY, deferClear: true });
  if (!preflight.allowed) return preflight;
  const nonce = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const hello = await requestJson({ port, token, body: { action: "hello", negotiationNonce: nonce }, timeoutMs });
  if (hello.status === "error") return hello;
  let handshake;
  let decision;
  try {
    handshake = extractHandshake(hello, nonce);
    decision = evaluateClientCompatibility({ action: command && command.action, commands: command && command.commands, handshake, manifest });
  } catch (error) {
    return errorResult(error.code || "DAEMON_HANDSHAKE_INVALID", error.message, error.details);
  }
  if (!decision.allowed) return errorResult(decision.code || "DAEMON_COMPATIBILITY_MISMATCH", "Command blocked by client compatibility policy", { classification: decision.classification });
  if (preflight.pendingClear) {
    const lifecycle = require("../lifecycle");
    const clearance = await enforceRestartForCommand({
      layout: LAYOUT,
      command,
      loadedIdentity: LOADED_RELEASE_IDENTITY,
      validateDoctor: () => lifecycle.runDoctor({ targetDir: SKILL_DIR }),
      validateDaemon: async () => ({ compatible: handshake.releaseTreeSha256 === LOADED_RELEASE_IDENTITY.releaseTreeSha256 }),
    });
    if (!clearance.allowed) return clearance;
  }
  if (beforeCommand) await beforeCommand({ handshake, nonce });
  const negotiated = attachNegotiation(command, { handshake, nonce, manifest });
  return requestJson({ port, token, body: negotiated, timeoutMs });
}

module.exports = { DEFAULT_DAEMON_COMMAND_TIMEOUT_MS, LOADED_RELEASE_IDENTITY, requestJson, sendNegotiatedCommand };
