const fs = require("fs");
const path = require("path");

const { getInstallLayout } = require("../../../scripts/lib/install-layout");
const { buildHandshakeMetadata } = require("../../../scripts/lib/version-contract");

async function createStopFixture(helpers, name, identity, overrides = {}) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const targetDir = path.join(fixture.root, "agent");
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, "release-manifest.json"), JSON.stringify({ skillVersion: "1.0.0" }));
  const layout = getInstallLayout(targetDir);
  fs.mkdirSync(layout.daemonDir, { recursive: true });
  const token = "fixture-token-" + name;
  const releaseTreeSha256 = identity.releaseTreeSha256 || "a".repeat(64);
  const handshake = { ...buildHandshakeMetadata({ instanceId: identity.instanceId }), releaseTreeSha256 };
  const processInspector = overrides.processInspector || {
    async inspect() {
      return { exists: true, creationToken: identity.creationToken, creationTime: "now", executablePath: process.execPath };
    },
    inspectSync(pid) {
      if (pid === process.pid) return { exists: true, creationToken: "test-runner-process" };
      return { exists: true, creationToken: identity.creationToken, creationTime: "now", executablePath: process.execPath };
    },
  };
  const daemonIdentity = require("../../../scripts/lib/daemon-identity");
  await daemonIdentity.createDaemonIdentity({
    layout,
    targetDir,
    pid: identity.pid,
    port: identity.port || 6201,
    token,
    instanceId: identity.instanceId,
    releaseTreeSha256,
    processInspector,
  });
  return {
    daemonIdentity,
    layout,
    targetDir,
    processInspector,
    requestHello: async () => ({ value: handshake }),
  };
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("daemon-stop-windows-adapter-bounds-identity-check-and-stop-in-one-command", async () => {
    const daemonIdentity = require("../../../scripts/lib/daemon-identity");
    const calls = [];
    const adapter = daemonIdentity.createWindowsProcessTerminator({
      platform: "win32",
      execFileSync(command, args, options) {
        calls.push({ command, args, options });
        return JSON.stringify({ outcome: "terminated" });
      },
    });

    const result = await adapter.terminateIfIdentityMatches(5100, "f".repeat(64));

    assert.deepEqual(result, { outcome: "terminated" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "powershell.exe");
    assert.equal(calls[0].args.some(argument => String(argument).includes("Stop-Process")), true);
    assert.equal(calls[0].args.some(argument => String(argument).toLowerCase().includes("taskkill")), false);
    assert.equal(calls[0].options.timeout, 5000);
  });

  test("daemon-stop-final-boundary-pid-reuse-never-terminates", async () => {
    const created = { pid: 5101, creationToken: "created-final", instanceId: "instance-final" };
    const fixture = await createStopFixture(helpers, "stop-final-reuse", created);
    let finalCreationToken = "reused-final";
    const terminated = [];
    const killAdapter = {
      async terminateIfIdentityMatches(pid, expectedCreationToken) {
        if (finalCreationToken !== expectedCreationToken) return { outcome: "identity_mismatch" };
        terminated.push(pid);
        return { outcome: "terminated" };
      },
    };

    const result = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter,
    });

    assert.equal(result.code, "PROCESS_IDENTITY_MISMATCH");
    assert.deepEqual(terminated, []);
    assert.equal(fs.existsSync(fixture.layout.daemonIdentityPath), true);
  });

  test("daemon-stop-concurrent-calls-serialize-termination", async () => {
    const created = { pid: 5102, creationToken: "created-concurrent", instanceId: "instance-concurrent" };
    const fixture = await createStopFixture(helpers, "stop-concurrent", created);
    let releaseTermination;
    const terminationStarted = new Promise(resolve => { releaseTermination = resolve; });
    let continueTermination;
    const terminationGate = new Promise(resolve => { continueTermination = resolve; });
    const terminated = [];
    const killAdapter = {
      async terminateIfIdentityMatches(pid) {
        terminated.push(pid);
        releaseTermination();
        await terminationGate;
        return { outcome: "terminated" };
      },
    };

    const first = fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter,
    });
    await terminationStarted;
    const second = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter,
    });
    continueTermination();
    const completed = await first;

    assert.equal(second.code, "DAEMON_STOP_IN_PROGRESS");
    assert.equal(completed.code, "DAEMON_STOPPED");
    assert.deepEqual(terminated, [5102]);
  });

  test("daemon-stop-after-completion-is-stably-already-stopped", async () => {
    const created = { pid: 5103, creationToken: "created-complete", instanceId: "instance-complete" };
    const fixture = await createStopFixture(helpers, "stop-complete", created);
    const killAdapter = { async terminateIfIdentityMatches() { return { outcome: "terminated" }; } };

    const first = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout, targetDir: fixture.targetDir, processInspector: fixture.processInspector,
      requestHello: fixture.requestHello, killAdapter,
    });
    const second = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout, targetDir: fixture.targetDir, processInspector: fixture.processInspector,
      requestHello: fixture.requestHello, killAdapter,
    });

    assert.equal(first.code, "DAEMON_STOPPED");
    assert.equal(second.code, "DAEMON_ALREADY_STOPPED");
  });

  test("daemon-stop-recovers-stale-stop-lock", async () => {
    const created = { pid: 5104, creationToken: "created-stale-lock", instanceId: "instance-stale-lock" };
    const processInspector = {
      async inspect(pid) {
        if (pid === created.pid) return { exists: true, creationToken: created.creationToken, creationTime: "daemon", executablePath: process.execPath };
        return { exists: false };
      },
      inspectSync(pid) {
        if (pid === process.pid) return { exists: true, creationToken: "test-runner-process" };
        return { exists: false };
      },
    };
    const fixture = await createStopFixture(helpers, "stop-stale-lock", created, { processInspector });
    const stopLockPath = path.join(fixture.layout.dataRoot, "daemon-stop.lock");
    fs.mkdirSync(stopLockPath);
    fs.writeFileSync(path.join(stopLockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1, lockKind: "daemon-stop", lockPath: stopLockPath, ownerPid: 9999,
      processCreationToken: "dead-stop-process", ownerToken: "abandoned-owner-token",
      operationId: "abandoned-stop-operation", acquiredAt: new Date(1).toISOString(), heartbeatAt: new Date(1).toISOString(),
    }));
    const terminated = [];

    const result = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches(pid) { terminated.push(pid); return { outcome: "terminated" }; } },
      now: () => 10_000,
    });

    assert.equal(result.code, "DAEMON_STOPPED");
    assert.deepEqual(terminated, [5104]);
    assert.equal(fs.existsSync(stopLockPath), false);
  });

  test("daemon-stop-never-steals-live-lock-older-than-five-minutes", async () => {
    const created = { pid: 5106, creationToken: "created-live-old-lock", instanceId: "instance-live-old-lock" };
    const lockCreationToken = "live-stop-owner";
    const fixture = await createStopFixture(helpers, "stop-live-old-lock", created, {
      processInspector: {
        async inspect(pid) {
          if (pid === created.pid) return { exists: true, creationToken: created.creationToken, creationTime: "daemon", executablePath: process.execPath };
          return { exists: pid === 7303, creationToken: lockCreationToken, creationTime: "lock", executablePath: process.execPath };
        },
        inspectSync(pid) {
          if (pid === process.pid) return { exists: true, creationToken: "test-runner-process" };
          return { exists: pid === 7303, creationToken: lockCreationToken };
        },
      },
    });
    const stopLockPath = path.join(fixture.layout.dataRoot, "daemon-stop.lock");
    fs.mkdirSync(stopLockPath);
    fs.writeFileSync(path.join(stopLockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1,
      lockKind: "daemon-stop",
      lockPath: stopLockPath,
      ownerPid: 7303,
      processCreationToken: lockCreationToken,
      ownerToken: "live-stop-owner-token",
      pid: 7303,
      token: "live-stop-owner-token",
      createdAt: 1,
      operationId: "live-stop-operation",
      acquiredAt: new Date(1).toISOString(),
      heartbeatAt: new Date(1).toISOString(),
    }));
    const terminated = [];

    const result = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches(pid) { terminated.push(pid); return { outcome: "terminated" }; } },
      now: () => 10 * 60 * 1000,
    });

    assert.equal(result.code, "DAEMON_STOP_IN_PROGRESS");
    assert.deepEqual(terminated, []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stopLockPath, "owner.json"), "utf8")).ownerToken, "live-stop-owner-token");
  });

  test("daemon-stop-interruption-releases-lock-for-retry", async () => {
    const created = { pid: 5105, creationToken: "created-interrupt", instanceId: "instance-interrupt" };
    const fixture = await createStopFixture(helpers, "stop-interrupt", created);
    const stopLockPath = path.join(fixture.layout.dataRoot, "daemon-stop.lock");
    const interrupted = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches() { throw Object.assign(new Error("interrupted"), { code: "EINJECTED_INTERRUPTION" }); } },
    });
    const retried = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches() { return { outcome: "terminated" }; } },
    });

    assert.equal(interrupted.code, "DAEMON_STOP_FAILED");
    assert.equal(retried.code, "DAEMON_STOPPED");
    assert.equal(fs.existsSync(stopLockPath), false);
  });

  test("daemon-stop-release-failure-retains-identity-evidence-and-never-reports-success", async () => {
    const created = { pid: 5107, creationToken: "created-release-failure", instanceId: "instance-release-failure" };
    const fixture = await createStopFixture(helpers, "stop-release-failure", created);
    const stopLockPath = path.join(fixture.layout.dataRoot, "daemon-stop.lock");
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };

    const result = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches() { return { outcome: "terminated" }; } },
      lockFs,
    });

    assert.equal(result.code, "DAEMON_STOP_LOCK_RELEASE_FAILED");
    assert.equal(result.stopped, false);
    assert.equal(result.details.operationCommitted, true);
    assert.equal(result.details.lockReleaseFailure.stage, "claim-removal");
    assert.equal(fs.existsSync(stopLockPath), true);
    assert.equal(fs.existsSync(fixture.layout.daemonIdentityPath), true);
    assert.equal(fs.existsSync(fixture.layout.daemonTokenPath), true);
  });

  test("daemon-stop-primary-result-keeps-code-when-release-also-fails", async () => {
    const created = { pid: 5108, creationToken: "created-primary-release", instanceId: "instance-primary-release" };
    const fixture = await createStopFixture(helpers, "stop-primary-release", created);
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };

    const result = await fixture.daemonIdentity.stopValidatedDaemon({
      layout: fixture.layout,
      targetDir: fixture.targetDir,
      processInspector: fixture.processInspector,
      requestHello: fixture.requestHello,
      killAdapter: { async terminateIfIdentityMatches() { return { outcome: "identity_mismatch" }; } },
      lockFs,
    });

    assert.equal(result.code, "PROCESS_IDENTITY_MISMATCH");
    assert.equal(result.details.lockReleaseFailure.stage, "claim-removal");
    assert.equal(fs.existsSync(fixture.layout.daemonIdentityPath), true);
  });
};
