const http = require("http");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");
const { buildHandshakeMetadata } = require(path.join(SKILL_DIR, "scripts", "lib", "version-contract.js"));

function buildHandshake(overrides = {}) {
  return { ...buildHandshakeMetadata({ instanceId: overrides.instanceId || "test-instance" }), ...overrides };
}

function loadProtocol() {
  return require(path.join(SKILL_DIR, "scripts", "lib", "daemon-protocol.js"));
}

async function startServer(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => body += chunk);
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function register({ test, assert, helpers }) {
  test("daemon-negotiation: ping/hello remain browser-free and every shared send path negotiates", async () => {
    const fs = require("fs");
    const runner = fs.readFileSync(path.join(SKILL_DIR, "scripts", "playwright-runner.js"), "utf8");
    const batch = fs.readFileSync(path.join(SKILL_DIR, "scripts", "batch-runner.js"), "utf8");
    assert.match(runner, /cmd && cmd\.action === "hello"/);
    assert.match(runner, /function sendCommand\(port, cmd\)[\s\S]*sendNegotiatedCommand/);
    assert.match(batch, /function send\(cmd\)[\s\S]*sendNegotiatedCommand/);
    const dispatch = runner.slice(runner.indexOf("async function handleCommand"), runner.indexOf("function sendCommand"));
    assert.ok(dispatch.indexOf("validateDaemonCommand(cmd") < dispatch.indexOf("await ensureBrowser()"));
  });

  test("daemon-start: recovery-required cleanup blocks token creation bind and replacement identity", async () => {
    const fs = require("fs");
    const runner = fs.readFileSync(path.join(SKILL_DIR, "scripts", "playwright-runner.js"), "utf8");
    const start = runner.slice(runner.indexOf("async function startDaemon"), runner.indexOf("let browserInitPromise"));
    const recoveryGuard = start.indexOf('cleanup.reason === "DAEMON_RECOVERY_REQUIRED"');

    assert.ok(recoveryGuard >= 0);
    assert.match(start, /code:\s*"DAEMON_RECOVERY_REQUIRED"[\s\S]*causeCode:\s*cleanup\.causeCode/);
    assert.ok(recoveryGuard < start.indexOf("crypto.randomBytes(24)"));
    assert.ok(recoveryGuard < start.indexOf("http.createServer"));
    assert.ok(recoveryGuard < start.indexOf("server.listen"));
    assert.ok(recoveryGuard < start.indexOf("createDaemonIdentity({"));
  });

  test("mismatch-safe-read-allowed", async () => {
    const protocol = loadProtocol();
    const manifest = protocol.readClientManifest();
    const handshake = buildHandshake({ skillVersion: "2.0.0", daemonVersion: "2.0.0", instanceId: "read-instance" });
    const decision = protocol.evaluateClientCompatibility({ action: "read", handshake, manifest });
    assert.equal(decision.allowed, true);
    assert.equal(decision.classification, "safe-read");
    assert.equal(decision.writeCompatible, false);
  });

  test("daemon-negotiation: every mutation and lifecycle-control class fails closed on mismatch", async () => {
    const protocol = loadProtocol();
    const manifest = protocol.readClientManifest();
    const handshake = buildHandshake({ configSchemaVersion: "2.0.0", instanceId: "blocked-instance" });
    for (const action of ["apply", "submit", "image-upload", "vas-apply", "login", "navigate", "discard-current-form"]) {
      const decision = protocol.evaluateClientCompatibility({ action, handshake, manifest });
      assert.equal(decision.allowed, false, action);
      assert.equal(decision.code, "CONFIG_SCHEMA_INCOMPATIBLE", action);
    }
  });

  test("daemon-negotiation: old/new daemon and schema combinations return stable write blockers", async () => {
    const protocol = loadProtocol();
    const manifest = protocol.readClientManifest();
    const cases = [
      [{ daemonVersion: "0.9.0" }, "DAEMON_VERSION_INCOMPATIBLE"],
      [{ daemonVersion: "2.0.0" }, "DAEMON_VERSION_INCOMPATIBLE"],
      [{ skillVersion: "0.9.0" }, "SKILL_VERSION_INCOMPATIBLE"],
      [{ skillVersion: "2.0.0" }, "SKILL_VERSION_INCOMPATIBLE"],
      [{ stateSchemaVersion: "0.9.0" }, "STATE_SCHEMA_INCOMPATIBLE"],
      [{ stateSchemaVersion: "2.0.0" }, "STATE_SCHEMA_INCOMPATIBLE"],
      [{ upgradeLock: true }, "DAEMON_UPGRADE_LOCKED"],
      [{ restartRequired: true }, "DAEMON_RESTART_REQUIRED"],
    ];
    for (const [overrides, code] of cases) {
      const handshake = buildHandshake({ ...overrides, instanceId: "version-case" });
      const decision = protocol.evaluateClientCompatibility({ action: "submit", handshake, manifest });
      assert.equal(decision.allowed, false, JSON.stringify(overrides));
      assert.equal(decision.code, code, JSON.stringify(overrides));
    }
  });

  test("daemon-negotiation: incompatible protocol blocks reads while version-only mismatch retains reads", async () => {
    const protocol = loadProtocol();
    const manifest = protocol.readClientManifest();
    const handshake = buildHandshake({
      protocolVersion: "2.0.0",
      minClientProtocolVersion: "2.0.0",
      maxClientProtocolVersion: "2.0.0",
      instanceId: "protocol-mismatch",
    });
    const decision = protocol.evaluateClientCompatibility({ action: "read", handshake, manifest });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "PROTOCOL_INCOMPATIBLE");
  });

  test("daemon-negotiation: malformed and old handshakes fail before command dispatch", async () => {
    const protocol = loadProtocol();
    const manifest = protocol.readClientManifest();
    for (const handshake of [
      { status: "ok", hello: true, protocolVersion: "1.0.0" },
      buildHandshake({ protocolVersion: "old", instanceId: "malformed" }),
      { ...buildHandshake({ instanceId: "unknown-field" }), surprise: true },
    ]) {
      assert.throws(
        () => protocol.evaluateClientCompatibility({ action: "read", handshake, manifest }),
        error => error.code === "DAEMON_HANDSHAKE_INVALID",
      );
    }
  });

  test("daemon-negotiation: unknown and composite mutation actions remain blocked", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({ instanceId: "action-instance" });
    const manifest = protocol.readClientManifest();
    assert.equal(protocol.evaluateClientCompatibility({ action: "future-read", handshake, manifest }).code, "ACTION_NOT_CLASSIFIED");
    assert.equal(protocol.evaluateClientCompatibility({ action: "screenshot", handshake, manifest }).code, "ACTION_NOT_CLASSIFIED");
    const composite = protocol.evaluateClientCompatibility({ action: "read", commands: [{ action: "read" }, { action: "submit" }], handshake, manifest });
    assert.equal(composite.classification, "mutation");
    assert.equal(composite.allowed, true);
  });

  test("protocol-daemon-replaced-after-handshake", async () => {
    const protocol = loadProtocol();
    const nonceStore = protocol.createNonceStore();
    const first = buildHandshake({ instanceId: "instance-a" });
    const second = buildHandshake({ instanceId: "instance-b" });
    const nonce = "nonce-instance-swap";
    nonceStore.issue(nonce);
    const command = protocol.attachNegotiation({ action: "submit", expectedProductId: "761" }, { handshake: first, nonce });
    const decision = protocol.validateDaemonCommand(command, { handshake: second, nonceStore });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "DAEMON_INSTANCE_MISMATCH");
  });

  test("daemon-negotiation: nonce is single-use and restart flags block writes without invoking handler", async () => {
    const protocol = loadProtocol();
    const nonceStore = protocol.createNonceStore();
    const handshake = buildHandshake({ instanceId: "nonce-instance", restartRequired: true });
    const nonce = "nonce-single-use";
    nonceStore.issue(nonce);
    const command = protocol.attachNegotiation({ action: "apply", productId: "761" }, { handshake, nonce });
    const first = protocol.validateDaemonCommand(command, { handshake, nonceStore });
    const second = protocol.validateDaemonCommand(command, { handshake, nonceStore });
    assert.equal(first.code, "DAEMON_RESTART_REQUIRED");
    assert.equal(second.code, "NEGOTIATION_NONCE_INVALID");
    const malformedNonce = "nonce-malformed-client";
    nonceStore.issue(malformedNonce);
    const malformed = protocol.attachNegotiation({ action: "read", productId: "761" }, { handshake, nonce: malformedNonce });
    malformed._negotiation.client.protocolVersion = "broken";
    assert.equal(protocol.validateDaemonCommand(malformed, { handshake, nonceStore }).code, "CLIENT_VERSION_METADATA_INVALID");
  });

  test("daemon-negotiation: daemon rejects missing negotiation before any browser path", async () => {
    const runner = require(path.join(SKILL_DIR, "scripts", "playwright-runner.js"));
    const result = await runner.handleCommand({ action: "submit", expectedProductId: "761" });
    assert.equal(result.status, "error");
    assert.equal(result.code, "NEGOTIATION_REQUIRED");
  });

  test("daemon-negotiation: fake HTTP client accepts safe read and sends bound metadata", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({ skillVersion: "2.0.0", daemonVersion: "2.0.0", instanceId: "http-read" });
    const received = [];
    const fake = await startServer(async (request, response) => {
      const body = await readJson(request);
      received.push(body);
      if (request.headers["x-rental-agent-token"] !== "valid-token") return json(response, 403, { status: "error", code: "DAEMON_AUTH_FAILED" });
      if (body.action === "hello") return json(response, 200, { status: "ok", hello: true, negotiationNonce: body.negotiationNonce, ...handshake });
      return json(response, 200, { status: "ok", productId: body.productId });
    });
    try {
      const result = await protocol.sendNegotiatedCommand({ port: fake.port, token: "valid-token", command: { action: "read", productId: "761" } });
      assert.equal(result.status, "ok");
      assert.equal(received.length, 2);
      assert.equal(received[1]._negotiation.expectedInstanceId, "http-read");
      assert.equal(received[1]._negotiation.actionClass, "safe-read");
      assert.equal(received[1]._negotiation.nonce, received[0].negotiationNonce);
    } finally {
      await fake.stop();
    }
  });

  test("daemon-negotiation: fake HTTP client blocks incompatible mutation with zero command invocation", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({ stateSchemaVersion: "2.0.0", instanceId: "http-write" });
    let commandCount = 0;
    const fake = await startServer(async (request, response) => {
      const body = await readJson(request);
      if (body.action === "hello") return json(response, 200, { status: "ok", hello: true, negotiationNonce: body.negotiationNonce, ...handshake });
      commandCount++;
      return json(response, 200, { status: "ok" });
    });
    try {
      const result = await protocol.sendNegotiatedCommand({ port: fake.port, token: "valid-token", command: { action: "submit", expectedProductId: "761" } });
      assert.equal(result.status, "error");
      assert.equal(result.code, "STATE_SCHEMA_INCOMPATIBLE");
      assert.equal(commandCount, 0);
    } finally {
      await fake.stop();
    }
  });

  test("daemon-negotiation: invalid token and HTML on daemon port are detected", async () => {
    const protocol = loadProtocol();
    const auth = await startServer((request, response) => json(response, 403, { status: "error", message: "Forbidden" }));
    const html = await startServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>not the daemon</html>");
    });
    try {
      const denied = await protocol.sendNegotiatedCommand({ port: auth.port, token: "bad", command: { action: "read", productId: "761" } });
      const unrelated = await protocol.sendNegotiatedCommand({ port: html.port, token: "token", command: { action: "read", productId: "761" } });
      assert.equal(denied.code, "DAEMON_AUTH_FAILED");
      assert.equal(unrelated.code, "DAEMON_RESPONSE_INVALID");
    } finally {
      await auth.stop();
      await html.stop();
    }
  });

  test("daemon-negotiation: token rotation between hello and command is rejected", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({ instanceId: "token-rotation" });
    let activeToken = "token-a";
    const fake = await startServer(async (request, response) => {
      const body = await readJson(request);
      if (request.headers["x-rental-agent-token"] !== activeToken) return json(response, 403, { status: "error", code: "DAEMON_AUTH_FAILED" });
      if (body.action === "hello") return json(response, 200, { status: "ok", hello: true, negotiationNonce: body.negotiationNonce, ...handshake });
      return json(response, 200, { status: "ok" });
    });
    try {
      const result = await protocol.sendNegotiatedCommand({
        port: fake.port,
        token: "token-a",
        command: { action: "read", productId: "761" },
        beforeCommand() { activeToken = "token-b"; },
      });
      assert.equal(result.code, "DAEMON_AUTH_FAILED");
    } finally {
      await fake.stop();
    }
  });

  test("daemon-negotiation: persisted readiness blocks writes but retains safe reads", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({
      instanceId: "persisted-not-ready",
      persistedStateReady: false,
      persistedStateDigest: "a".repeat(64),
      persistedStateBlockers: ["STATE_DOCUMENT_MALFORMED"],
      actualSchemaVersions: { config: "1.0.0", state: ["1.0.0"] },
    });
    const write = protocol.evaluateClientCompatibility({ action: "submit", handshake });
    const read = protocol.evaluateClientCompatibility({ action: "read", handshake });

    assert.equal(write.allowed, false);
    assert.equal(write.code, "PERSISTED_STATE_NOT_READY");
    assert.equal(read.allowed, true);
  });

  test("daemon-negotiation: state changes after hello block before handler or browser invocation", async () => {
    const protocol = loadProtocol();
    const nonceStore = protocol.createNonceStore();
    const hello = buildHandshake({
      instanceId: "digest-bound",
      persistedStateReady: true,
      persistedStateDigest: "a".repeat(64),
      persistedStateBlockers: [],
      actualSchemaVersions: { config: "1.0.0", state: [] },
    });
    const current = { ...hello, persistedStateDigest: "b".repeat(64) };
    const nonce = "digest-change";
    nonceStore.issue(nonce);
    const command = protocol.attachNegotiation({ action: "submit", expectedProductId: "761" }, { handshake: hello, nonce });
    const decision = protocol.validateDaemonCommand(command, { handshake: current, nonceStore });

    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "PERSISTED_STATE_CHANGED");
  });

  test("daemon-negotiation: runner recomputes readiness immediately before browser initialization", async () => {
    const protocol = loadProtocol();
    const runner = require(path.join(SKILL_DIR, "scripts", "playwright-runner.js"));
    let readiness = {
      readyForWrites: true,
      blockers: [],
      stateDigest: "c".repeat(64),
      actualSchemaVersions: { config: "1.0.0", state: [] },
    };
    runner.__setReadinessEvaluatorForTest(() => readiness);
    const hello = runner.currentHandshakeMetadata();
    const nonce = "runner-live-change";
    protocol.createNonceStore;
    const command = protocol.attachNegotiation({ action: "submit", expectedProductId: "761" }, { handshake: hello, nonce });
    runner.__issueNegotiationNonceForTest(nonce);
    readiness = { ...readiness, stateDigest: "d".repeat(64) };

    const result = await runner.handleCommand(command);

    assert.equal(result.code, "PERSISTED_STATE_CHANGED");
    runner.__resetReadinessEvaluatorForTest();
  });

  test("daemon-negotiation: persisted binding can be rechecked after browser login without consuming nonce", async () => {
    const protocol = loadProtocol();
    const handshake = buildHandshake({
      instanceId: "post-login-binding",
      persistedStateReady: true,
      persistedStateDigest: "e".repeat(64),
      persistedStateBlockers: [],
      actualSchemaVersions: { config: "1.0.0", state: [] },
    });
    const command = protocol.attachNegotiation({ action: "apply", productId: "761" }, { handshake, nonce: "unused-for-binding" });
    const changed = { ...handshake, persistedStateDigest: "f".repeat(64) };

    assert.equal(protocol.validatePersistedStateBinding(command, handshake).allowed, true);
    assert.equal(protocol.validatePersistedStateBinding(command, changed).code, "PERSISTED_STATE_CHANGED");
  });

  helpers.recordProof("daemonNegotiationNoSaas", helpers.counters.saasRequests === 0);
  helpers.recordProof("liveReadinessRejectedBrowserLaunches", helpers.counters.browserLaunches === 0);
  helpers.recordProof("liveReadinessRejectedMutationInvocations", helpers.counters.mutationInvocations === 0);
}

module.exports = { register };
