const fs = require("fs");
const path = require("path");

const leaseLock = require("../../../scripts/lib/lease-lock");

function fakeInspector(records, options = {}) {
  return {
    inspectSync(pid) {
      if (options.unavailable) return { exists: false, inspectionFailed: true };
      return records.get(pid) || { exists: false };
    },
  };
}

function leaseOptions(root, kind, inspector, overrides = {}) {
  return {
    lockPath: path.join(root, kind + ".lock"),
    lockKind: kind,
    operationId: kind + "-operation-current",
    operationPhase: "starting",
    processInspector: inspector,
    now: () => Date.parse("2026-07-15T00:10:00.000Z"),
    ...overrides,
  };
}

function writeOwner(lockPath, owner) {
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify(owner, null, 2) + "\n");
}

function ownerRecord(lockPath, kind, overrides = {}) {
  return {
    schemaVersion: 1,
    lockKind: kind,
    lockPath,
    ownerPid: 7401,
    processCreationToken: "old-process-token",
    ownerToken: "old-owner-token-0001",
    operationId: kind + "-operation-old",
    acquiredAt: "2026-07-15T00:00:00.000Z",
    heartbeatAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("lease-lock-dead-owner-and-pid-reuse-recover-without-touching-new-process", async () => {
    for (const [name, processState] of [
      ["dead", { exists: false }],
      ["pid-reuse", { exists: true, creationToken: "new-process-token" }],
    ]) {
      const fixture = await helpers.createLifecycleFixture({ name: "lease-" + name });
      const inspector = fakeInspector(new Map([
        [process.pid, { exists: true, creationToken: "current-process-token" }],
        [7401, processState],
      ]));
      const options = leaseOptions(fixture.root, "migration", inspector);
      writeOwner(options.lockPath, ownerRecord(options.lockPath, "migration"));

      const lease = leaseLock.acquireLeaseLock(options);

      assert.equal(lease.owner.ownerPid, process.pid);
      assert.equal(fs.existsSync(options.lockPath), true);
      assert.equal(leaseLock.releaseLeaseLock(lease, { processInspector: inspector }), true);
      assert.equal(fs.existsSync(options.lockPath), false);
    }
  });

  test("lease-lock-malformed-ownerless-and-inspector-unavailable-fail-closed", async () => {
    for (const [name, ownerContent, unavailable] of [
      ["ownerless", null, false],
      ["malformed", "{bad", false],
      ["inspector-unavailable", JSON.stringify(ownerRecord("placeholder", "migration")), true],
    ]) {
      const fixture = await helpers.createLifecycleFixture({ name: "lease-" + name });
      const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]), { unavailable });
      const options = leaseOptions(fixture.root, "migration", inspector);
      fs.mkdirSync(options.lockPath);
      if (ownerContent !== null) {
        const content = name === "inspector-unavailable"
          ? JSON.stringify(ownerRecord(options.lockPath, "migration"))
          : ownerContent;
        fs.writeFileSync(path.join(options.lockPath, "owner.json"), content);
      }

      assert.throws(() => leaseLock.acquireLeaseLock(options), error => error.code === "LOCK_RECOVERY_REQUIRED", name);
      assert.equal(fs.existsSync(options.lockPath), true, name);
    }
  });

  test("lease-lock-lifecycle-recovery-requires-exact-matching-journal", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-lifecycle-journal" });
    const inspector = fakeInspector(new Map([
      [process.pid, { exists: true, creationToken: "current-process-token" }],
      [7401, { exists: false }],
    ]));
    const journalPath = path.join(fixture.root, "lifecycle-journal.json");
    const options = leaseOptions(fixture.root, "lifecycle", inspector, { journalPath });
    const oldOwner = ownerRecord(options.lockPath, "lifecycle", { journalPath, operationPhase: "staged" });
    writeOwner(options.lockPath, oldOwner);

    assert.throws(() => leaseLock.acquireLeaseLock(options), error => error.code === "LOCK_RECOVERY_REQUIRED");
    fs.writeFileSync(journalPath, JSON.stringify({ operationId: oldOwner.operationId, phase: "staged", status: "in-progress" }));
    options.validateRecovery = owner => {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      return journal.operationId === owner.operationId && journal.phase === owner.operationPhase && journal.status === "in-progress";
    };

    const lease = leaseLock.acquireLeaseLock(options);
    assert.equal(lease.owner.operationId, options.operationId);
    leaseLock.releaseLeaseLock(lease, { processInspector: inspector });
  });

  test("lease-lock-heartbeat-and-release-use-owner-and-process-identity-cas", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-heartbeat-cas" });
    const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
    const options = leaseOptions(fixture.root, "daemon-stop", inspector);
    const lease = leaseLock.acquireLeaseLock(options);
    const refreshed = leaseLock.heartbeatLeaseLock(lease, { operationPhase: "terminating", now: () => Date.parse("2026-07-15T00:11:00.000Z") });
    assert.equal(refreshed.operationPhase, "terminating");
    assert.equal(refreshed.heartbeatAt, "2026-07-15T00:11:00.000Z");

    const replacement = { ...refreshed, ownerToken: "replacement-owner-token", operationId: "replacement-operation" };
    fs.writeFileSync(path.join(options.lockPath, "owner.json"), JSON.stringify(replacement));
    assert.throws(() => leaseLock.heartbeatLeaseLock(lease, { operationPhase: "late" }), error => error.code === "LOCK_OWNERSHIP_LOST");
    assert.throws(
      () => leaseLock.releaseLeaseLock(lease, { processInspector: inspector }),
      error => error.code === "LOCK_RELEASE_FAILED" && error.details.stage === "owner-mismatch",
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(options.lockPath, "owner.json"), "utf8")).ownerToken, "replacement-owner-token");
  });

  test("lease-lock-release-failures-are-typed-bounded-and-preserve-locks", async () => {
    const scenarios = [
      {
        name: "process-inspection",
        expectedStage: "process-inspection",
        prepare() { return { releaseInspector: fakeInspector(new Map(), { unavailable: true }) }; },
      },
      {
        name: "process-identity",
        expectedStage: "process-identity",
        prepare() { return { releaseInspector: fakeInspector(new Map([[process.pid, { exists: true, creationToken: "replacement-process" }]])) }; },
      },
      {
        name: "missing-lock",
        expectedStage: "lock-missing",
        prepare({ lockPath }) { fs.rmSync(lockPath, { recursive: true, force: true }); return {}; },
        lockExpected: false,
      },
      {
        name: "owner-mismatch",
        expectedStage: "owner-mismatch",
        replacementToken: "replacement-owner-token-private",
        prepare({ lockPath, lease }) {
          fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ ...lease.owner, ownerToken: this.replacementToken }));
          return {};
        },
      },
      {
        name: "claim-rename",
        expectedStage: "claim-rename",
        prepare({ lockPath }) {
          const adapter = Object.create(fs);
          adapter.renameSync = (source, destination) => {
            if (source === lockPath) throw Object.assign(new Error("injected claim rename"), { code: "EACCES" });
            return fs.renameSync(source, destination);
          };
          return { releaseFs: adapter };
        },
      },
      {
        name: "claimed-owner-validation",
        expectedStage: "claimed-owner-validation",
        replacementToken: "claimed-replacement-token-private",
        prepare({ lockPath }) {
          const adapter = Object.create(fs);
          adapter.renameSync = (source, destination) => {
            const result = fs.renameSync(source, destination);
            if (source === lockPath) {
              const ownerPath = path.join(destination, "owner.json");
              const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
              fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, ownerToken: this.replacementToken }));
            }
            return result;
          };
          return { releaseFs: adapter };
        },
      },
      {
        name: "claim-removal",
        expectedStage: "claim-removal",
        prepare() {
          const adapter = Object.create(fs);
          adapter.rmSync = () => { throw Object.assign(new Error("injected claim removal"), { code: "EIO" }); };
          return { releaseFs: adapter };
        },
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await helpers.createLifecycleFixture({ name: "lease-release-" + scenario.name });
      const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
      const options = leaseOptions(fixture.root, "migration", inspector);
      const lease = leaseLock.acquireLeaseLock(options);
      const prepared = scenario.prepare.call(scenario, { lockPath: options.lockPath, lease });
      let releaseError;
      try {
        leaseLock.releaseLeaseLock(lease, {
          processInspector: prepared.releaseInspector || inspector,
          fs: prepared.releaseFs,
        });
      } catch (error) {
        releaseError = error;
      }
      assert.equal(releaseError && releaseError.code, "LOCK_RELEASE_FAILED", scenario.name);
      assert.equal(releaseError && releaseError.details.stage, scenario.expectedStage, scenario.name);
      const serialized = JSON.stringify({ message: releaseError.message, details: releaseError.details });
      assert.equal(serialized.includes(lease.owner.ownerToken), false, scenario.name + " owner token");
      if (scenario.replacementToken) assert.equal(serialized.includes(scenario.replacementToken), false, scenario.name + " replacement token");
      assert.equal(fs.existsSync(options.lockPath), scenario.lockExpected !== false, scenario.name + " lock preservation");
      if (scenario.replacementToken && fs.existsSync(options.lockPath)) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(options.lockPath, "owner.json"), "utf8")).ownerToken, scenario.replacementToken, scenario.name);
      }
    }
  });

  test("lease-lock-release-failure-attaches-to-primary-error-without-replacement", () => {
    const primary = Object.assign(new Error("primary"), { code: "PRIMARY_FAILURE", details: { existing: true } });
    const release = Object.assign(new Error("release"), { code: "LOCK_RELEASE_FAILED", details: { stage: "claim-removal", causeCode: "EIO" } });
    const attached = leaseLock.attachLockReleaseFailure(primary, release);
    assert.equal(attached, primary);
    assert.equal(attached.code, "PRIMARY_FAILURE");
    assert.equal(attached.details.existing, true);
    assert.deepEqual(attached.details.lockReleaseFailure, { code: "LOCK_RELEASE_FAILED", stage: "claim-removal", causeCode: "EIO" });
  });

  test("lease-lock-atomic-exclusive-create-serializes-concurrent-operations", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-concurrent" });
    const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
    const firstOptions = leaseOptions(fixture.root, "migration", inspector, { operationId: "first-operation" });
    const first = leaseLock.acquireLeaseLock(firstOptions);

    assert.throws(
      () => leaseLock.acquireLeaseLock({ ...firstOptions, operationId: "second-operation" }),
      error => error.code === "LOCKED",
    );
    assert.equal(leaseLock.releaseLeaseLock(first, { processInspector: inspector }), true);
  });

  test("lease-lock-heartbeat-write-failure-fails-closed-and-retains-owner", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-heartbeat-failure" });
    const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
    const adapter = Object.create(fs);
    let failWrite = false;
    adapter.writeFileSync = (...args) => {
      if (failWrite && typeof args[0] === "number") throw Object.assign(new Error("disk failure"), { code: "EIO" });
      return fs.writeFileSync(...args);
    };
    const options = leaseOptions(fixture.root, "migration", inspector, { fs: adapter });
    const lease = leaseLock.acquireLeaseLock(options);
    failWrite = true;

    assert.throws(() => leaseLock.heartbeatLeaseLock(lease, { operationPhase: "writing" }), error => error.code === "LOCK_HEARTBEAT_FAILED");
    assert.equal(fs.existsSync(options.lockPath), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(options.lockPath, "owner.json"), "utf8")).ownerToken, lease.owner.ownerToken);
  });

  test("lease-lock-symlink-or-reparse-shaped-lock-fails-closed", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-link" });
    const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
    const options = leaseOptions(fixture.root, "migration", inspector);
    const outside = path.join(fixture.root, "outside-lock");
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, options.lockPath, "junction");
    } catch (error) {
      if (error.code === "EPERM") return;
      throw error;
    }
    assert.throws(() => leaseLock.acquireLeaseLock(options), error => error.code === "LOCK_RECOVERY_REQUIRED");
    assert.equal(fs.existsSync(outside), true);
  });

  test("lease-lock-long-operation-runs-bounded-periodic-heartbeats", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "lease-periodic-heartbeat" });
    const inspector = fakeInspector(new Map([[process.pid, { exists: true, creationToken: "current-process-token" }]]));
    const options = leaseOptions(fixture.root, "migration", inspector);
    const lease = leaseLock.acquireLeaseLock(options);
    let tick;
    let cleared = false;
    let clock = Date.parse("2026-07-15T00:20:00.000Z");

    const result = await leaseLock.runWithLeaseHeartbeat(lease, "long-operation", async () => {
      tick();
      return "complete";
    }, {
      now: () => clock += 1000,
      heartbeatIntervalMs: 50,
      setInterval(callback, intervalMs) {
        assert.equal(intervalMs, 50);
        tick = callback;
        return { unref() {} };
      },
      clearInterval() { cleared = true; },
    });

    assert.equal(result, "complete");
    assert.equal(cleared, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(options.lockPath, "owner.json"), "utf8")).operationPhase, "long-operation");
    assert.equal(leaseLock.releaseLeaseLock(lease, { processInspector: inspector }), true);
  });
};
