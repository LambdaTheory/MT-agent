const fs = require("fs");
const http = require("http");
const path = require("path");
const childProcess = require("child_process");
const crypto = require("crypto");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");
const { getInstallLayout } = require("../../../scripts/lib/install-layout");
const { buildHandshakeMetadata } = require("../../../scripts/lib/version-contract");

function loadModules() {
  return {
    identity: require("../../../scripts/lib/daemon-identity"),
    restart: require("../../../scripts/lib/restart-session"),
  };
}

async function startHelloServer(token, handshake) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => body += chunk);
    request.on("end", () => {
      if (request.headers["x-rental-agent-token"] !== token) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "error", code: "DAEMON_AUTH_FAILED" }));
        return;
      }
      const command = JSON.parse(body || "{}");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(command.action === "hello"
        ? { status: "ok", hello: true, negotiationNonce: command.negotiationNonce, ...handshake }
        : { status: "ok", pong: true, ...handshake }));
    });
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    port: server.address().port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function makeDataFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const targetDir = path.join(fixture.root, "agent");
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, "release-manifest.json"), JSON.stringify({ skillVersion: "1.0.0" }));
  const layout = getInstallLayout(targetDir);
  fs.mkdirSync(layout.daemonDir, { recursive: true });
  return { fixture, targetDir, layout };
}

function hashControlPath(filePath) {
  if (!fs.existsSync(filePath)) return crypto.createHash("sha256").update("absent").digest("hex");
  const stat = fs.lstatSync(filePath);
  const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
  const value = stat.isFile() ? fs.readFileSync(filePath) : Buffer.from(kind);
  return crypto.createHash("sha256").update(kind).update(value).digest("hex");
}

function controlFileHashes(layout) {
  return Object.fromEntries([
    layout.daemonIdentityPath,
    layout.daemonPidPath,
    layout.daemonPortPath,
    layout.daemonTokenPath,
  ].map(filePath => [path.basename(filePath), hashControlPath(filePath)]));
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("session-reattach-compatible-daemon", async () => {
    const { identity } = loadModules();
    const { targetDir, layout } = await makeDataFixture(helpers, "identity-reattach");
    const token = "fixture-token-a";
    const releaseTreeSha256 = "a".repeat(64);
    const handshake = { ...buildHandshakeMetadata({ instanceId: "instance-a" }), releaseTreeSha256 };
    const server = await startHelloServer(token, handshake);
    const inspector = { inspect: async () => ({ exists: true, creationToken: "created-a", creationTime: "20260714120000.000000+000", executablePath: process.execPath }) };
    try {
      await identity.createDaemonIdentity({ layout, targetDir, pid: 4101, port: server.port, token, instanceId: "instance-a", releaseTreeSha256, processInspector: inspector });
      const result = await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector });
      assert.equal(result.valid, true);
      assert.equal(result.identity.instanceId, "instance-a");
      assert.equal(JSON.stringify(result.identity).includes(token), false);
    } finally { await server.stop(); }
  });

  test("daemon-identity-valid-stop-and-absent-cleanup", async () => {
    const { identity } = loadModules();
    const { targetDir, layout } = await makeDataFixture(helpers, "identity-stop");
    const token = "fixture-token-stop";
    const releaseTreeSha256 = "b".repeat(64);
    const handshake = { ...buildHandshakeMetadata({ instanceId: "instance-stop" }), releaseTreeSha256 };
    const server = await startHelloServer(token, handshake);
    let exists = true;
    const killed = [];
    const inspector = {
      inspect: async () => exists ? ({ exists: true, creationToken: "created-stop", creationTime: "now", executablePath: process.execPath }) : ({ exists: false }),
      inspectSync(pid) {
        if (pid === process.pid) return { exists: true, creationToken: "test-runner-process" };
        return exists ? { exists: true, creationToken: "created-stop" } : { exists: false };
      },
    };
    try {
      await identity.createDaemonIdentity({ layout, targetDir, pid: 4102, port: server.port, token, instanceId: "instance-stop", releaseTreeSha256, processInspector: inspector });
      const stopped = await identity.stopValidatedDaemon({
        layout,
        targetDir,
        processInspector: inspector,
        requestHello: async () => ({ value: handshake }),
        killAdapter: { async terminateIfIdentityMatches(pid) { killed.push(pid); exists = false; return { outcome: "terminated" }; } },
      });
      assert.equal(stopped.stopped, true);
      assert.deepEqual(killed, [4102]);
      assert.equal(fs.existsSync(layout.daemonIdentityPath), false);
      await identity.cleanupDaemonState({ layout, targetDir, processInspector: inspector });
    } finally { await server.stop(); }
  });

  test("session-reject-stale-daemon-state", async () => {
    const { identity } = loadModules();
    const { targetDir, layout } = await makeDataFixture(helpers, "identity-stale");
    const token = "fixture-token-stale";
    const releaseTreeSha256 = "c".repeat(64);
    const handshake = { ...buildHandshakeMetadata({ instanceId: "instance-stale" }), releaseTreeSha256 };
    const server = await startHelloServer(token, handshake);
    const killed = [];
    try {
      await identity.createDaemonIdentity({ layout, targetDir, pid: 4103, port: server.port, token, instanceId: "instance-stale", releaseTreeSha256, processInspector: { inspect: async () => ({ exists: true, creationToken: "old", creationTime: "old", executablePath: process.execPath }) } });
      const mismatchedInspector = { inspect: async () => ({ exists: true, creationToken: "reused", creationTime: "new", executablePath: process.execPath }) };
      const result = await identity.cleanupDaemonState({ layout, targetDir, processInspector: mismatchedInspector, killAdapter: { async terminate(pid) { killed.push(pid); } } });
      assert.equal(result.cleaned, true);
      assert.equal(result.reason, "PROCESS_IDENTITY_MISMATCH");
      assert.deepEqual(killed, []);
      assert.equal(fs.existsSync(layout.daemonIdentityPath), false);
    } finally { await server.stop(); }
  });

  test("daemon-live-confirmed-negotiation-failures-require-recovery-and-preserve-control-files", async () => {
    const { identity } = loadModules();
    const cases = [
      { name: "token-missing", expectedCode: "DAEMON_TOKEN_MISSING", mutate(layout) { fs.unlinkSync(layout.daemonTokenPath); } },
      { name: "token-unsafe", expectedCode: "DAEMON_TOKEN_UNSAFE_PATH", mutate(layout) { fs.unlinkSync(layout.daemonTokenPath); fs.mkdirSync(layout.daemonTokenPath); } },
      { name: "token-mismatch", expectedCode: "DAEMON_TOKEN_MISMATCH", mutate(layout) { fs.writeFileSync(layout.daemonTokenPath, "rotated-token"); } },
      { name: "auth-failure", expectedCode: "DAEMON_AUTH_FAILED", requestHello: async () => ({ error: "DAEMON_AUTH_FAILED" }) },
      { name: "hello-mismatch", expectedCode: "DAEMON_HELLO_MISMATCH", requestHello: async () => ({ error: "DAEMON_HELLO_MISMATCH" }) },
      { name: "hello-unreachable", expectedCode: "DAEMON_UNREACHABLE", requestHello: async () => ({ error: "DAEMON_UNREACHABLE" }) },
      { name: "executable-mismatch", expectedCode: "PROCESS_IDENTITY_MISMATCH", processInspector: { inspect: async () => ({ exists: true, creationToken: "confirmed-live", creationTime: "now", executablePath: path.join(path.dirname(process.execPath), "other-node.exe") }) } },
    ];
    const killed = [];

    for (const scenario of cases) {
      const { targetDir, layout } = await makeDataFixture(helpers, "identity-live-" + scenario.name);
      const token = "fixture-live-token-" + scenario.name;
      const identityInspector = { inspect: async () => ({ exists: true, creationToken: "confirmed-live", creationTime: "now", executablePath: process.execPath }) };
      await identity.createDaemonIdentity({
        layout,
        targetDir,
        pid: 4200,
        port: 6200,
        token,
        instanceId: "live-" + scenario.name,
        releaseTreeSha256: "7".repeat(64),
        processInspector: identityInspector,
      });
      const processInspector = scenario.processInspector || identityInspector;
      if (scenario.mutate) scenario.mutate(layout);
      const beforeHashes = controlFileHashes(layout);

      const validation = await identity.validateDaemonIdentity({
        layout,
        targetDir,
        processInspector,
        requestHello: scenario.requestHello || (async () => { throw new Error("hello must not run"); }),
      });
      const cleanup = await identity.cleanupDaemonState({
        layout,
        targetDir,
        processInspector,
        requestHello: scenario.requestHello || (async () => { throw new Error("hello must not run"); }),
        killAdapter: { async terminateIfIdentityMatches(pid) { killed.push(pid); return { outcome: "terminated" }; } },
      });

      assert.equal(validation.code, scenario.expectedCode, scenario.name);
      assert.equal(validation.liveProcessConfirmed, true, scenario.name);
      assert.equal(cleanup.cleaned, false, scenario.name);
      assert.equal(cleanup.reason, "DAEMON_RECOVERY_REQUIRED", scenario.name);
      assert.equal(cleanup.causeCode, scenario.expectedCode, scenario.name);
      assert.equal(cleanup.identity.pid, 4200, scenario.name);
      assert.deepEqual(controlFileHashes(layout), beforeHashes, scenario.name);
    }
    assert.deepEqual(killed, []);
  });

  test("daemon-identity-rejects-unrelated-port-stale-token-instance-release-and-symlink", async () => {
    const { identity } = loadModules();
    const { targetDir, layout } = await makeDataFixture(helpers, "identity-mismatch");
    const token = "fixture-token-match";
    const releaseTreeSha256 = "d".repeat(64);
    const handshake = { ...buildHandshakeMetadata({ instanceId: "expected-instance" }), releaseTreeSha256 };
    const server = await startHelloServer("other-token", { ...buildHandshakeMetadata({ instanceId: "other-instance" }), releaseTreeSha256: "e".repeat(64) });
    const inspector = { inspect: async () => ({ exists: true, creationToken: "created", creationTime: "now", executablePath: process.execPath }) };
    try {
      await identity.createDaemonIdentity({ layout, targetDir, pid: 4104, port: server.port, token, instanceId: "expected-instance", releaseTreeSha256, processInspector: inspector });
      const result = await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector });
      assert.equal(result.valid, false);
      assert.ok(["DAEMON_AUTH_FAILED", "DAEMON_HELLO_MISMATCH"].includes(result.code));
      fs.writeFileSync(layout.daemonTokenPath, "rotated-token");
      assert.equal((await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector })).code, "DAEMON_TOKEN_MISMATCH");
      fs.writeFileSync(layout.daemonTokenPath, token);
      const wrongInstance = await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector, requestHello: async () => ({ value: { ...handshake, instanceId: "wrong-instance" } }) });
      assert.equal(wrongInstance.code, "DAEMON_HELLO_MISMATCH");
      const wrongRelease = await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector, requestHello: async () => ({ value: { ...handshake, releaseTreeSha256: "f".repeat(64) } }) });
      assert.equal(wrongRelease.code, "DAEMON_HELLO_MISMATCH");
      fs.unlinkSync(layout.daemonIdentityPath);
      const outside = path.join(path.dirname(layout.dataRoot), "outside-identity.json");
      fs.writeFileSync(outside, "{}\n");
      try {
        fs.symlinkSync(outside, layout.daemonIdentityPath, "file");
        const linked = await identity.validateDaemonIdentity({ layout, targetDir, processInspector: inspector });
        assert.equal(linked.code, "DAEMON_IDENTITY_UNSAFE_PATH");
      } catch (error) {
        if (error.code !== "EPERM") throw error;
      }
    } finally { await server.stop(); }
  });

  test("daemon-identity-child-process-reuse-never-kills-unrelated-process", async () => {
    const { identity } = loadModules();
    const { targetDir, layout } = await makeDataFixture(helpers, "identity-child");
    const child = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
    const killed = [];
    try {
      await identity.createDaemonIdentity({
        layout,
        targetDir,
        pid: child.pid,
        port: 6553,
        token: "fixture-child-token",
        instanceId: "child-instance",
        releaseTreeSha256: "9".repeat(64),
        processInspector: { inspect: async () => ({ exists: true, creationToken: "original-child", creationTime: "old", executablePath: process.execPath }) },
      });
      const result = await identity.cleanupDaemonState({
        layout,
        targetDir,
        processInspector: { inspect: async () => ({ exists: true, creationToken: "reused-child", creationTime: "new", executablePath: process.execPath }) },
        killAdapter: { async terminate(pid) { killed.push(pid); } },
      });
      assert.equal(result.reason, "PROCESS_IDENTITY_MISMATCH");
      assert.deepEqual(killed, []);
      assert.equal(child.exitCode, null);
    } finally {
      child.kill("SIGTERM");
      await new Promise(resolve => child.once("exit", resolve));
    }
  });

  test("restart-session-old-write-blocked-safe-read-retained-and-new-session-clears", async () => {
    const { restart } = loadModules();
    const { layout } = await makeDataFixture(helpers, "restart-session");
    const oldClient = { releaseTreeSha256: "1".repeat(64), sessionId: "old-session" };
    const nextClient = { releaseTreeSha256: "2".repeat(64), sessionId: "new-session" };
    restart.writeRestartMarker(layout, { activatingReleaseTreeSha256: nextClient.releaseTreeSha256, activationId: "activation-a", sessionId: oldClient.sessionId, reason: "install", createdAt: "2026-07-14T12:00:00.000Z" });
    assert.equal((await restart.enforceRestartForCommand({ layout, command: { action: "submit" }, loadedIdentity: oldClient })).code, "SESSION_RESTART_REQUIRED");
    assert.equal((await restart.enforceRestartForCommand({ layout, command: { action: "read" }, loadedIdentity: oldClient })).allowed, true);
    const cleared = await restart.enforceRestartForCommand({ layout, command: { action: "submit" }, loadedIdentity: nextClient, validateDoctor: async () => ({ readyForWrites: false, blockers: ["RESTART_REQUIRED"] }), validateDaemon: async () => ({ compatible: true }) });
    assert.equal(cleared.allowed, true);
    assert.equal(fs.existsSync(restart.markerPath(layout)), false);
  });

  test("restart-session-malformed-interrupted-and-concurrent-clearance", async () => {
    const beforeSaas = helpers.counters.saasRequests;
    const beforeMutations = helpers.counters.mutationInvocations;
    const beforeBrowsers = helpers.counters.browserLaunches;
    const { restart } = loadModules();
    const { layout } = await makeDataFixture(helpers, "restart-concurrent");
    fs.writeFileSync(restart.markerPath(layout), "{interrupted");
    const malformed = await restart.enforceRestartForCommand({ layout, command: { action: "submit" }, loadedIdentity: { releaseTreeSha256: "3".repeat(64), sessionId: "new" } });
    assert.equal(malformed.code, "SESSION_RESTART_REQUIRED");
    restart.writeRestartMarker(layout, { activatingReleaseTreeSha256: "3".repeat(64), activationId: "activation-b", sessionId: "old", reason: "upgrade", createdAt: "2026-07-14T12:00:00.000Z" });
    const options = { layout, command: { action: "submit" }, loadedIdentity: { releaseTreeSha256: "3".repeat(64), sessionId: "new" }, validateDoctor: async () => ({ readyForWrites: false, blockers: ["RESTART_REQUIRED"] }), validateDaemon: async () => ({ compatible: true }) };
    const results = await Promise.all([restart.enforceRestartForCommand(options), restart.enforceRestartForCommand(options)]);
    assert.equal(results.every(result => result.allowed), true);
    assert.equal(fs.readdirSync(layout.dataRoot).some(name => name.includes("restart-required.json.tmp")), false);
    helpers.recordProof("daemonIdentityNoRealKill", true);
    helpers.recordProof("restartNoBrowserOrSaas", helpers.counters.saasRequests === beforeSaas && helpers.counters.mutationInvocations === beforeMutations && helpers.counters.browserLaunches === beforeBrowsers);
  });
};
