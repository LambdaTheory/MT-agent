const fs = require("fs");
const path = require("path");

const lifecycle = require("../../../scripts/lifecycle");
const { getInstallLayout, hashPath } = require("../../../scripts/lib/install-layout");

const REPO = "lcc0628/rental-price-agent";
const TAG = "v1.0.0";

function completeConfig() {
  return {
    configSchemaVersion: "1.0.0",
    saas: { baseUrl: "https://fixture.invalid", loginUrl: "https://fixture.invalid/login", productDetailUrl: "https://fixture.invalid/product/{productId}", productListUrl: "https://fixture.invalid/products", credentials: { username: "${SAAS_USERNAME}", password: "${SAAS_PASSWORD}" } },
    selectors: {}, vas: {}, rules: {}, taskStorage: { directory: "./tasks" },
    browser: { source: "chrome", allowFallback: false, headless: true },
    mirror: { baseUrl: "https://mirror.invalid", apiKey: "${MIRROR_API_KEY}" },
  };
}

function releaseRoutes(fixture) {
  const stem = "/lcc0628/rental-price-agent/releases/download/" + fixture.manifest.tag + "/";
  return {
    [stem + fixture.archiveName]: { body: fixture.archive, headers: { "content-type": "application/gzip" } },
    [stem + fixture.manifestName]: { body: fixture.manifestBody, headers: { "content-type": "application/json" } },
    [stem + fixture.checksumName]: { body: fixture.checksumBody, headers: { "content-type": "text/plain" } },
  };
}

function readinessRuntime(overrides = {}) {
  return {
    run(command, args, options) {
      if (args[0] === "ci") {
        const packageJson = JSON.parse(fs.readFileSync(path.join(options.cwd, "package.json"), "utf8"));
        const directory = path.join(options.cwd, "node_modules", "playwright");
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "playwright", version: packageJson.dependencies.playwright }));
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    probeBrowserPolicy: async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "C:\\fixture\\browser.exe", probes: {} }),
    platform: "win32",
    ...overrides,
  };
}

async function withInstaller(helpers, name, run, options = {}) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, options.targetName || "agent");
  const layout = getInstallLayout(target);
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  if (options.config !== false) fs.writeFileSync(layout.configPath, JSON.stringify(options.config || completeConfig(), null, 2) + "\n");
  const release = helpers.createReleaseFixture(options.release || {});
  const server = await helpers.startFakeGiteeServer({ routes: releaseRoutes(release) });
  try {
    return await run({ fixture, target, layout, release, server });
  } finally {
    await server.stop();
  }
}

function installOptions(target, server, runtime = {}) {
  return {
    targetDir: target, repo: REPO, tag: TAG, browserSource: "chrome",
    releaseBaseUrl: server.url, ...readinessRuntime(runtime),
  };
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("lifecycle-install-fresh-and-same-version-noop", async () => {
    await withInstaller(helpers, "install-fresh", async ({ target, layout, server }) => {
      let stdout = "";
      const runtime = readinessRuntime({ releaseBaseUrl: server.url, writeStdout(value) { stdout += value; }, writeStderr() {} });
      const cli = await lifecycle.runLifecycleCli(["install", "--target", target, "--repo", REPO, "--tag", TAG, "--browser", "chrome", "--json"], runtime);
      const first = cli.result;
      const firstHash = await helpers.hashTree(path.dirname(target));
      const requests = server.counters.requests;
      const second = await lifecycle.runInstall(installOptions(target, server));
      const status = lifecycle.collectStatus({ targetDir: target });
      const doctor = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: readinessRuntime().probeBrowserPolicy });
      assert.equal(first.status, "installed");
      assert.equal(cli.exitCode, 0);
      assert.equal(JSON.parse(stdout).code, "INSTALL_OK");
      assert.equal(second.status, "noop");
      assert.equal(status.receipt.present, true);
      assert.equal(status.restartRequired, true);
      assert.deepEqual(doctor.blockers, ["ENV_MISSING", "RESTART_REQUIRED"]);
      assert.equal(server.counters.requests, requests);
      assert.equal(await helpers.hashTree(path.dirname(target)), firstHash);
      assert.equal(fs.existsSync(layout.receiptPath), true);
      assert.equal(fs.existsSync(path.join(layout.dataRoot, "restart-required.json")), true);
    });
  });

  test("lifecycle-install-supports-explicit-different-targets", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "install-two-targets" });
    const release = helpers.createReleaseFixture();
    const server = await helpers.startFakeGiteeServer({ routes: releaseRoutes(release) });
    try {
      for (const name of ["agent-a", "agent-b"]) {
        const target = path.join(fixture.root, name);
        const layout = getInstallLayout(target);
        fs.mkdirSync(layout.dataRoot);
        fs.writeFileSync(layout.configPath, JSON.stringify(completeConfig()));
        const result = await lifecycle.runInstall(installOptions(target, server, name === "agent-b" ? { browserSource: "chromium" } : {}));
        assert.equal(result.status, "installed");
        assert.equal(result.targetDir, fs.realpathSync(target));
      }
    } finally { await server.stop(); }
  });

  test("lifecycle-install-imports-legacy-data-with-user-hashes", async () => {
    await withInstaller(helpers, "install-legacy", async ({ target, layout, server }) => {
      fs.rmSync(layout.dataRoot, { recursive: true, force: true });
      fs.mkdirSync(target);
      const legacyConfig = completeConfig();
      delete legacyConfig.configSchemaVersion;
      fs.writeFileSync(path.join(target, "config.json"), JSON.stringify(legacyConfig));
      fs.mkdirSync(path.join(target, "tasks"));
      fs.writeFileSync(path.join(target, "tasks", "task.json"), JSON.stringify({
        taskId: "legacy", instruction: "legacy fixture", changes: {}, createdAt: "2026-01-01T00:00:00.000Z",
        status: "planned", history: [], evidence: [], results: {},
      }));
      fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "rental-price-agent", version: "0.9.0" }));
      fs.writeFileSync(path.join(target, "SKILL.md"), "# legacy\n");
      const configHash = hashPath(path.join(target, "config.json"));
      const result = await lifecycle.runInstall(installOptions(target, server));
      assert.equal(result.status, "installed");
      assert.equal(result.legacyImport.hashes["config.json"], configHash);
      assert.equal(hashPath(layout.configPath) === configHash, false);
      assert.equal(JSON.parse(fs.readFileSync(layout.configPath)).configSchemaVersion, "1.0.0");
      assert.equal(fs.existsSync(result.legacySourcePath), true);
    }, { config: false });
  });

  test("lifecycle-install-validates-and-preserves-schema-less-recovery-bytes", async () => {
    await withInstaller(helpers, "install-schema-less-recovery", async ({ target, layout, server }) => {
      const taskRecovery = Buffer.from('{\n  "__broadcast": true,\n  "stock": "5"\n}\n');
      const batchRecovery = Buffer.from('{"sku-basic":{"dailyPrice":"12.50"}}\n');
      fs.mkdirSync(layout.tasksDir);
      fs.mkdirSync(layout.batchesDir);
      const taskPath = path.join(layout.tasksDir, "changes_task.json");
      const batchPath = path.join(layout.batchesDir, "changes_batch.json");
      fs.writeFileSync(taskPath, taskRecovery);
      fs.writeFileSync(batchPath, batchRecovery);

      const result = await lifecycle.runInstall(installOptions(target, server));

      assert.equal(result.status, "installed");
      assert.deepEqual(fs.readFileSync(taskPath), taskRecovery);
      assert.deepEqual(fs.readFileSync(batchPath), batchRecovery);
      assert.equal(JSON.parse(fs.readFileSync(taskPath, "utf8")).stateSchemaVersion, undefined);
      assert.equal(JSON.parse(fs.readFileSync(batchPath, "utf8")).stateSchemaVersion, undefined);
    });
  });

  test("lifecycle-install-rejects-malformed-recovery-before-activation", async () => {
    for (const location of ["task", "batch"]) {
      await withInstaller(helpers, "install-malformed-recovery-" + location, async ({ target, layout, server }) => {
        fs.mkdirSync(layout.tasksDir);
        if (location === "batch") fs.mkdirSync(layout.batchesDir);
        const recoveryPath = path.join(location === "batch" ? layout.batchesDir : layout.tasksDir, "changes_bad.json");
        const malformed = Buffer.from("{}\n");
        fs.writeFileSync(recoveryPath, malformed);

        await assert.rejects(lifecycle.runInstall(installOptions(target, server)), error => error.code === "MALFORMED_MIGRATION_OBJECT");

        assert.equal(fs.existsSync(target), false);
        assert.deepEqual(fs.readFileSync(recoveryPath), malformed);
        assert.equal(fs.existsSync(layout.receiptPath), false);
      });
    }
  });

  test("lifecycle-install-refuses-foreign-nonempty-target", async () => {
    await withInstaller(helpers, "install-foreign", async ({ target, server }) => {
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "foreign.txt"), "keep");
      await assert.rejects(lifecycle.runInstall(installOptions(target, server)), error => error.code === "INSTALL_TARGET_NOT_RECOGNIZED");
      assert.equal(fs.readFileSync(path.join(target, "foreign.txt"), "utf8"), "keep");
      assert.equal(server.counters.requests, 0);
    });
  });

  test("lifecycle-install-refuses-target-links-and-ancestor-escapes", async () => {
    const fixture = await helpers.createLifecycleFixture({ name: "install-links" });
    const outside = path.join(fixture.root, "outside");
    const linkedParent = path.join(fixture.root, "linked-parent");
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");
      const target = path.join(linkedParent, "agent");
      await assert.rejects(lifecycle.runInstall({ ...installOptions(target, { url: "http://127.0.0.1" }), stageGiteeRelease: async () => assert.fail("must not stage") }), error => error.code === "INVALID_INSTALL_TARGET");
      assert.equal(fs.readdirSync(outside).length, 0);
    } finally {
      fs.rmSync(linkedParent, { recursive: true, force: true });
    }
  });

  test("lifecycle-install-rejects-invalid-cli-contract", async () => {
    const target = path.resolve("fixture-target");
    for (const argv of [
      ["install", "--target", "relative", "--repo", REPO, "--tag", TAG, "--browser", "chrome"],
      ["install", "--target", target, "--repo", "other/repo", "--tag", TAG, "--browser", "chrome"],
      ["install", "--target", target, "--repo", REPO, "--tag", "master", "--browser", "chrome"],
      ["install", "--target", target, "--repo", REPO, "--tag", TAG, "--browser", "firefox"],
    ]) {
      const outcome = await lifecycle.runLifecycleCli(argv, { writeStdout() {}, writeStderr() {} });
      assert.equal(outcome.exitCode, 2);
    }
  });

  test("lifecycle-install-failure-matrix-leaves-no-partial-install", async () => {
    const failures = [
      ["corrupt-release", { release: { routes: {} }, runtime: {}, expected: "RELEASE_HASH_MISMATCH" }],
      ["incomplete-config", { config: { ...completeConfig(), mirror: {} }, expected: "STAGING_DOCTOR_FAILED" }],
      ["dependency-failure", { runtime: { run: () => ({ status: 1, stderr: "fixture" }) }, expected: "DEPENDENCY_INSTALL_FAILED" }],
      ["browser-failure", { runtime: { probeBrowserPolicy: async () => ({ ok: false, error: { code: "SYSTEM_CHROME_UNAVAILABLE", message: "fixture" }, probes: {} }) }, expected: "SYSTEM_CHROME_UNAVAILABLE" }],
    ];
    for (const [name, spec] of failures) {
      await withInstaller(helpers, name, async ({ target, layout, server }) => {
        const before = hashPath(layout.configPath);
        if (name === "corrupt-release") {
          server.stop = server.stop;
          const archivePath = "/lcc0628/rental-price-agent/releases/download/v1.0.0/rental-price-agent-v1.0.0.sha256";
          void archivePath;
        }
        const options = installOptions(target, server, spec.runtime);
        if (name === "corrupt-release") options.stageGiteeRelease = async () => { const error = new Error("corrupt"); error.code = "RELEASE_HASH_MISMATCH"; throw error; };
        await assert.rejects(lifecycle.runInstall(options), error => error.code === spec.expected, name);
        assert.equal(fs.existsSync(target), false);
        assert.equal(hashPath(layout.configPath), before);
        assert.equal(fs.existsSync(layout.receiptPath), false);
      }, { config: spec.config });
    }
  });

  test("lifecycle-install-interruption-cleans-every-owned-phase", async () => {
    for (const phase of lifecycle.INSTALL_PHASES) {
      await withInstaller(helpers, "interrupt-" + phase, async ({ target, layout, server }) => {
        const before = hashPath(layout.configPath);
        await assert.rejects(lifecycle.runInstall(installOptions(target, server, { onPhase(current) { if (current === phase) { const error = new Error("interrupt"); error.code = "INSTALL_INTERRUPTED"; throw error; } } })), error => error.code === "INSTALL_INTERRUPTED", phase);
        assert.equal(fs.existsSync(target), false, phase);
        assert.equal(hashPath(layout.configPath), before, phase);
        assert.equal(fs.existsSync(layout.receiptPath), false, phase);
      });
    }
  });

  test("lifecycle-install-concurrent-and-stale-lock-policy", async () => {
    await withInstaller(helpers, "install-locks", async ({ target, layout, server }) => {
      const processInspector = {
        inspectSync(pid) {
          if (pid === process.pid) return { exists: true, creationToken: "install-test-runner" };
          if (pid === 7201) return { exists: true, creationToken: "live-install-process" };
          return { exists: false };
        },
      };
      fs.mkdirSync(layout.lockPath);
      fs.writeFileSync(path.join(layout.lockPath, "owner.json"), JSON.stringify({
        schemaVersion: 1, lockKind: "lifecycle", lockPath: layout.lockPath, ownerPid: 7201,
        processCreationToken: "live-install-process", ownerToken: "live-owner-token-0001",
        operationId: "live-install-operation", acquiredAt: new Date(1).toISOString(), heartbeatAt: new Date(1).toISOString(),
        journalPath: layout.journalPath, operationPhase: "staged",
      }));
      await assert.rejects(lifecycle.runInstall(installOptions(target, server, { processInspector })), error => error.code === "LIFECYCLE_LOCKED");
      fs.rmSync(layout.lockPath, { recursive: true, force: true });
      fs.mkdirSync(layout.lockPath);
      const abandonedOwner = {
        schemaVersion: 1, lockKind: "lifecycle", lockPath: layout.lockPath, ownerPid: 7202,
        processCreationToken: "dead-install-process", ownerToken: "dead-owner-token-0001",
        operationId: "dead-install-operation", acquiredAt: new Date(1).toISOString(), heartbeatAt: new Date(1).toISOString(),
        journalPath: layout.journalPath, operationPhase: "staged",
      };
      fs.writeFileSync(path.join(layout.lockPath, "owner.json"), JSON.stringify(abandonedOwner));
      await assert.rejects(
        lifecycle.runInstall(installOptions(target, server, { processInspector })),
        error => error.code === "LOCK_RECOVERY_REQUIRED",
      );
      fs.writeFileSync(layout.journalPath, JSON.stringify({ operationId: abandonedOwner.operationId, phase: "staged", status: "in-progress" }));
      const result = await lifecycle.runInstall(installOptions(target, server, { processInspector }));
      assert.equal(result.status, "installed");
    });
  });

  test("lifecycle-install-never-steals-live-lock-older-than-five-minutes", async () => {
    await withInstaller(helpers, "install-live-old-lock", async ({ target, layout, server }) => {
      const creationToken = "live-install-owner";
      fs.mkdirSync(layout.lockPath);
      fs.writeFileSync(path.join(layout.lockPath, "owner.json"), JSON.stringify({
        schemaVersion: 1,
        lockKind: "lifecycle",
        lockPath: layout.lockPath,
        ownerPid: 7301,
        processCreationToken: creationToken,
        ownerToken: "live-install-token",
        pid: 7301,
        token: "live-install-token",
        createdAt: 1,
        operationId: "live-install-operation",
        acquiredAt: new Date(1).toISOString(),
        heartbeatAt: new Date(1).toISOString(),
        journalPath: layout.journalPath,
        operationPhase: "staged",
      }));

      await assert.rejects(
        lifecycle.runInstall(installOptions(target, server, {
          now: () => 10 * 60 * 1000,
          processInspector: { inspectSync: pid => pid === process.pid ? { exists: true, creationToken: "test-runner-process" } : { exists: pid === 7301, creationToken } },
        })),
        error => error.code === "LIFECYCLE_LOCKED",
      );
      assert.equal(JSON.parse(fs.readFileSync(path.join(layout.lockPath, "owner.json"), "utf8")).ownerToken, "live-install-token");
    });
  });

  test("lifecycle-install-propagates-injected-process-inspector-to-nested-migrations", async () => {
    await withInstaller(helpers, "install-process-inspector", async ({ target, server }) => {
      let inspections = 0;
      let beforeMigration = 0;
      let afterMigration = 0;
      const processInspector = {
        inspectSync(pid) {
          inspections++;
          return pid === process.pid
            ? { exists: true, creationToken: "install-test-runner" }
            : { exists: false };
        },
      };

      const result = await lifecycle.runInstall(installOptions(target, server, {
        processInspector,
        onPhase(phase) {
          if (phase === "data-prepared") beforeMigration = inspections;
          if (phase === "migrated") afterMigration = inspections;
        },
      }));

      assert.equal(result.status, "installed");
      assert.ok(afterMigration - beforeMigration >= 6, "nested migration lease must use the injected process inspector");
    });
  });

  test("lifecycle-install-rejects-cross-volume-and-conflicting-version", async () => {
    await withInstaller(helpers, "install-cross-volume", async ({ target, server }) => {
      await assert.rejects(lifecycle.runInstall(installOptions(target, server, { volumeResolver: value => value.includes("install-stage") ? "D:" : "C:" })), error => error.code === "CROSS_VOLUME_STAGING");
      const installed = await lifecycle.runInstall(installOptions(target, server));
      assert.equal(installed.status, "installed");
      await assert.rejects(lifecycle.runInstall({ ...installOptions(target, server), tag: "v2.0.0" }), error => error.code === "UPGRADE_REQUIRED");
    });
  });

  test("lifecycle-install-release-failure-is-fail-closed-and-keeps-owned-cleanup-evidence", async () => {
    await withInstaller(helpers, "install-release-failure", async ({ fixture, target, layout, server }) => {
      const lockFs = Object.create(fs);
      lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
      await assert.rejects(
        lifecycle.runInstall(installOptions(target, server, { lockFs })),
        error => error.code === "LIFECYCLE_LOCK_RELEASE_FAILED"
          && error.details.operationCommitted === true
          && error.details.recoveryRequired === true
          && error.details.lockReleaseFailure.stage === "claim-removal",
      );
      assert.equal(fs.existsSync(layout.lockPath), true);
      assert.equal(JSON.parse(fs.readFileSync(layout.journalPath, "utf8")).status, "committed");
      assert.equal(fs.readdirSync(fixture.root).some(name => name.includes(".install-backup-")), true);
    });
  });

  test("lifecycle-install-primary-error-keeps-code-when-release-also-fails", async () => {
    await withInstaller(helpers, "install-primary-release-failure", async ({ target, layout, server }) => {
      const lockFs = Object.create(fs);
      lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
      await assert.rejects(
        lifecycle.runInstall(installOptions(target, server, {
          lockFs,
          onPhase(phase) { if (phase === "staged") throw Object.assign(new Error("primary install failure"), { code: "INSTALL_PRIMARY_FAILURE" }); },
        })),
        error => error.code === "INSTALL_PRIMARY_FAILURE" && error.details.lockReleaseFailure.stage === "claim-removal",
      );
      assert.equal(fs.existsSync(layout.lockPath), true);
    });
  });
};
