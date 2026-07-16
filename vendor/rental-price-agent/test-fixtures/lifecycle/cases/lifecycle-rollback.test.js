const fs = require("fs");
const path = require("path");

const lifecycle = require("../../../scripts/lifecycle");
const { getInstallLayout, hashPath } = require("../../../scripts/lib/install-layout");
const { hashReleaseTree, writeInstallReceipt } = require("../../../scripts/lib/install-receipt");

const REPO = "lcc0628/rental-price-agent";

function config(version = "1.0.0") {
  return {
    configSchemaVersion: version,
    saas: {}, selectors: {}, vas: {}, rules: {}, taskStorage: { directory: "./tasks" },
    browser: { source: "chrome", allowFallback: false, headless: true }, mirror: {},
  };
}

function completeConfig(version = "1.0.0") {
  const value = config(version);
  value.saas = { baseUrl: "https://fixture.invalid", loginUrl: "https://fixture.invalid/login", productDetailUrl: "https://fixture.invalid/product/{productId}", credentials: { username: "${SAAS_USERNAME}", password: "${SAAS_PASSWORD}" } };
  value.mirror = { baseUrl: "https://mirror.invalid", apiKey: "${MIRROR_API_KEY}" };
  return value;
}

function writeRelease(target, version, compatibility = { min: "1.0.0", max: "1.0.0" }) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const manifest = {
    manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v" + version,
    skillVersion: version, daemonVersion: version, protocolVersion: version,
    configSchemaVersion: compatibility.max, stateSchemaVersion: compatibility.max,
    nodeRange: ">=18.0.0 <25.0.0", playwrightVersion: "1.60.0",
    browserPolicy: { supported: ["managed-chromium", "system-chrome"], default: "system-chrome", allowFallback: false },
    compatibility: {
      skill: { min: version, max: version }, daemon: { min: version, max: version }, protocol: { min: version, max: version },
      configSchema: compatibility, stateSchema: compatibility,
    },
    migration: {
      contractVersion: 2, definition: "scripts/lib/target-migration.json",
      sources: { configSchema: [compatibility], stateSchema: [compatibility] },
    },
  };
  const packageJson = { name: "rental-price-agent", version, engines: { node: manifest.nodeRange }, dependencies: { playwright: "1.60.0" } };
  const lockfile = { name: "rental-price-agent", version, lockfileVersion: 3, requires: true, packages: {
    "": { ...packageJson, dependencies: { playwright: "1.60.0" } },
    "node_modules/playwright": { version: "1.60.0" },
  } };
  for (const [name, value] of Object.entries({
    "SKILL.md": "# Fixture " + version + "\n", "config.example.json": JSON.stringify(config(compatibility.max)) + "\n",
    "package.json": JSON.stringify(packageJson) + "\n", "package-lock.json": JSON.stringify(lockfile) + "\n",
    "release-manifest.json": JSON.stringify(manifest) + "\n",
  })) fs.writeFileSync(path.join(target, name), value);
  fs.mkdirSync(path.join(target, "scripts"));
  fs.writeFileSync(path.join(target, "scripts", "lifecycle.js"), "module.exports = {};\n");
  fs.mkdirSync(path.join(target, "scripts", "lib"));
  fs.writeFileSync(path.join(target, "scripts", "lib", "target-migration.json"), JSON.stringify({ contractVersion: 2, sources: manifest.migration.sources, steps: [] }) + "\n");
  fs.mkdirSync(path.join(target, "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(target, "node_modules", "playwright", "package.json"), JSON.stringify({ name: "playwright", version: "1.60.0" }));
}

function runtime(overrides = {}) {
  return {
    platform: "win32", operationId: "todo13-upgrade-operation", run() { return { status: 0, stdout: "", stderr: "" }; },
    probeBrowserPolicy: async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "C:\\fixture\\browser.exe", probes: {} }),
    requestDaemonDrain: async () => ({ drained: true, code: "DAEMON_ALREADY_STOPPED" }),
    stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_ALREADY_STOPPED" }),
    verifyProfileReleased: async () => ({ released: true }), sleep: async () => {},
    runDoctor: async () => ({ blockers: [], warnings: [] }),
    stageGiteeRelease: async stage => {
      writeRelease(stage.stagingDir, "2.0.0", { min: "1.0.0", max: "2.0.0" });
      return { archiveName: "rental-price-agent-v2.0.0.tgz", sha256: "2".repeat(64), stagingDir: stage.stagingDir };
    },
    ...overrides,
  };
}

async function upgradedFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, "agent");
  const layout = getInstallLayout(target);
  for (const candidate of [fixture.paths.active, fixture.paths.staging, fixture.paths.previous]) fs.rmSync(candidate, { recursive: true, force: true });
  writeRelease(target, "1.0.0");
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  fs.writeFileSync(layout.configPath, JSON.stringify(config(), null, 2) + "\n");
  fs.writeFileSync(layout.envPath, "SECRET=unchanged\n");
  fs.mkdirSync(layout.browserProfileDir);
  fs.writeFileSync(path.join(layout.browserProfileDir, "Cookies"), "cookie-bytes");
  fs.mkdirSync(layout.browserCacheDir);
  fs.writeFileSync(path.join(layout.browserCacheDir, "cache.bin"), "cache-bytes");
  fs.mkdirSync(layout.tasksDir);
  fs.writeFileSync(path.join(layout.tasksDir, "_index.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", tasks: [] }));
  fs.mkdirSync(layout.batchesDir);
  fs.writeFileSync(path.join(layout.batchesDir, "done.json"), JSON.stringify({
    stateSchemaVersion: "1.0.0", batchId: "done", status: "completed", spec: {}, total: 0,
    completed: [], previewOnly: [], verifyFailed: [], failed: [], current: null, inFlight: null,
    startedAt: "2026-07-14T00:00:00.000Z",
  }));
  await writeInstallReceipt({
    targetDir: target,
    source: { owner: "lcc0628", repo: "rental-price-agent", tag: "v1.0.0", asset: "rental-price-agent-v1.0.0.tgz", sha256: "1".repeat(64) },
    browser: { policy: { source: "chrome", allowFallback: false }, selectedSource: "chrome", version: "149.0.0.0" },
  });
  const v1Hash = hashReleaseTree(target);
  await lifecycle.runUpgrade({ targetDir: target, repo: REPO, tag: "v2.0.0", browserSource: "chrome", ...runtime() });
  return { fixture, target, layout, v1Hash, v2Hash: hashReleaseTree(target) };
}

function rollbackOptions(installed, overrides = {}) {
  return {
    targetDir: installed.target, operationId: "todo13-rollback-operation", sleep: async () => {},
    stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_ALREADY_STOPPED" }),
    runDoctor: async () => ({ blockers: [], warnings: [] }),
    ...overrides,
  };
}

function mutableHashes(layout) {
  return {
    config: hashPath(layout.configPath), env: hashPath(layout.envPath), profile: hashPath(layout.browserProfileDir),
    cache: hashPath(layout.browserCacheDir), tasks: hashPath(layout.tasksDir),
  };
}

async function withFilesystemMutationSpy(action) {
  const calls = [];
  const originals = new Map();
  const methods = [
    "appendFileSync", "chmodSync", "chownSync", "copyFileSync", "cpSync", "createWriteStream",
    "fchmodSync", "fchownSync", "fdatasyncSync", "fsyncSync", "linkSync", "lutimesSync",
    "mkdirSync", "mkdtempSync", "renameSync", "rmSync", "rmdirSync", "symlinkSync",
    "truncateSync", "unlinkSync", "utimesSync", "writeFileSync",
  ];
  for (const method of methods) {
    if (typeof fs[method] !== "function") continue;
    originals.set(method, fs[method]);
    fs[method] = function forbiddenMutation(...args) {
      calls.push({ method, path: String(args[0]) });
      const error = new Error("filesystem mutation attempted by dry-run: " + method);
      error.code = "DRY_RUN_MUTATION";
      throw error;
    };
  }
  originals.set("openSync", fs.openSync);
  fs.openSync = function guardedOpen(filePath, flags, ...rest) {
    const flagText = String(flags);
    if (/[wax+]/.test(flagText) || (typeof flags === "number" && flags !== fs.constants.O_RDONLY)) {
      calls.push({ method: "openSync", path: String(filePath) });
      const error = new Error("filesystem mutation attempted by dry-run: openSync");
      error.code = "DRY_RUN_MUTATION";
      throw error;
    }
    return originals.get("openSync").call(fs, filePath, flags, ...rest);
  };
  try {
    return { result: await action(), calls };
  } finally {
    for (const [method, original] of originals) fs[method] = original;
  }
}

function writeValidTask(layout, taskId) {
  fs.writeFileSync(path.join(layout.tasksDir, taskId + ".json"), JSON.stringify({
    stateSchemaVersion: "1.0.0", taskId, instruction: "fixture", changes: {}, createdAt: "2026-07-14T00:00:00.000Z", status: "planned",
    history: [], evidence: [], results: {},
  }));
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("rollback-cli-requires-explicit-absolute-target-and-exact-confirm-value", async () => {
    assert.throws(() => lifecycle.parseArgs(["rollback", "--target", "relative"]), error => error.code === "INVALID_INSTALL_TARGET");
    assert.throws(() => lifecycle.parseArgs(["rollback", "--target", path.resolve("fixture"), "--confirm"]), error => error.code === "ROLLBACK_CONFIRMATION_MISMATCH");
    assert.throws(() => lifecycle.parseArgs(["rollback", "--target", path.resolve("fixture"), "--dry-run", "--confirm", "1.0.0"]), error => error.code === "INVALID_ARGUMENT");
    const parsed = lifecycle.parseArgs(["rollback", "--target", path.resolve("fixture")]);
    assert.equal(parsed.command, "rollback");
    assert.equal(parsed.confirm, undefined);
  });

  test("rollback-dry-run-reports-independent-identities-schemas-and-confirmation", async () => {
    const installed = await upgradedFixture(helpers, "rollback-dry-run");
    const before = { active: hashReleaseTree(installed.target), previous: hashReleaseTree(installed.target + ".previous"), mutable: mutableHashes(installed.layout) };
    const result = await lifecycle.runRollback(rollbackOptions(installed));
    assert.equal(result.code, "ROLLBACK_DRY_RUN");
    assert.equal(result.dryRun, true);
    assert.equal(result.current.version, "2.0.0");
    assert.equal(result.previous.version, "1.0.0");
    assert.equal(result.current.receiptVerified, true);
    assert.equal(result.previous.receiptVerified, true);
    assert.equal(result.current.treeVerified, true);
    assert.equal(result.previous.treeVerified, true);
    assert.equal(result.current.sourceIdentityVerified, true);
    assert.equal(result.previous.sourceIdentityVerified, true);
    assert.deepEqual(result.schemas.config, ["1.0.0"]);
    assert.deepEqual(result.schemas.task, ["1.0.0"]);
    assert.deepEqual(result.schemas.batch, ["1.0.0"]);
    assert.equal(result.compatibility.compatible, true);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.confirmation.version, "1.0.0");
    assert.match(result.confirmation.token, /^1\.0\.0@[a-f0-9]{64}$/);
    assert.equal(hashReleaseTree(installed.target), before.active);
    assert.equal(hashReleaseTree(installed.target + ".previous"), before.previous);
    assert.deepEqual(mutableHashes(installed.layout), before.mutable);
  });

  test("rollback-dry-run-uses-only-read-operations-and-does-not-recover-an-incomplete-journal", async () => {
    const installed = await upgradedFixture(helpers, "rollback-read-only-preview");
    const observed = await withFilesystemMutationSpy(() => lifecycle.runRollback(rollbackOptions(installed)));
    assert.equal(observed.result.code, "ROLLBACK_DRY_RUN");
    assert.deepEqual(observed.calls, []);

    const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
    journal.status = "recovery-required";
    fs.writeFileSync(installed.layout.journalPath, JSON.stringify(journal));
    const blocked = await withFilesystemMutationSpy(() => lifecycle.runRollback(rollbackOptions(installed)));
    assert.equal(blocked.result.status, "blocked");
    assert.ok(blocked.result.blockers.includes("LIFECYCLE_JOURNAL_INTERRUPTED"));
    assert.deepEqual(blocked.calls, []);
    assert.equal(JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8")).status, "recovery-required");
  });

  test("rollback-confirmation-is-bound-to-the-complete-live-state-snapshot", async () => {
    const installed = await upgradedFixture(helpers, "rollback-state-bound-confirmation");
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    assert.match(preview.confirmation.token, /^1\.0\.0@[a-f0-9]{64}$/);
    await assert.rejects(
      lifecycle.runRollback(rollbackOptions(installed, { confirm: "1.0.0" })),
      error => error.code === "ROLLBACK_CONFIRMATION_STALE",
    );

    const configValue = JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8"));
    configValue.rules.previewCompatibleChange = true;
    fs.writeFileSync(installed.layout.configPath, JSON.stringify(configValue));
    let stopCalls = 0;
    await assert.rejects(
      lifecycle.runRollback(rollbackOptions(installed, {
        confirm: preview.confirmation.token,
        stopValidatedDaemon: async () => { stopCalls++; return { stopped: false, code: "DAEMON_ALREADY_STOPPED" }; },
      })),
      error => error.code === "ROLLBACK_CONFIRMATION_STALE",
    );
    assert.equal(stopCalls, 0);
  });

  test("rollback-confirmation-binds-canonical-env-state-without-exposing-secret-bytes", async () => {
    const mutations = [
      ["content", installed => fs.writeFileSync(installed.layout.envPath, "SECRET=changed-after-preview\n")],
      ["remove", installed => fs.rmSync(installed.layout.envPath)],
      ["add", installed => { fs.rmSync(installed.layout.envPath); fs.writeFileSync(installed.layout.envPath, "SECRET=recreated\n"); }],
      ["link", installed => {
        const replacement = path.join(installed.fixture.root, "replacement.env");
        fs.writeFileSync(replacement, "SECRET=linked\n");
        fs.rmSync(installed.layout.envPath);
        fs.symlinkSync(replacement, installed.layout.envPath, "file");
      }],
    ];
    for (const [name, mutate] of mutations) {
      const installed = await upgradedFixture(helpers, "rollback-env-" + name);
      const preview = await lifecycle.runRollback(rollbackOptions(installed));
      const serialized = JSON.stringify(preview);
      assert.equal(serialized.includes("unchanged"), false, name);
      assert.equal(serialized.includes("SECRET="), false, name);
      assert.equal(preview.snapshot.mutable.env.exists, true, name);
      assert.equal(preview.snapshot.mutable.env.type, "file", name);
      assert.match(preview.snapshot.mutable.env.sha256, /^[a-f0-9]{64}$/, name);
      try { mutate(installed); } catch (error) {
        if (name === "link" && error.code === "EPERM") continue;
        throw error;
      }
      let stopCalls = 0;
      await assert.rejects(
        lifecycle.runRollback(rollbackOptions(installed, {
          confirm: preview.confirmation.token,
          stopValidatedDaemon: async () => { stopCalls++; return { code: "DAEMON_ALREADY_STOPPED" }; },
        })),
        error => error.code === "ROLLBACK_CONFIRMATION_STALE"
          && !JSON.stringify(error).includes("SECRET=")
          && !JSON.stringify(error).includes("changed-after-preview"),
        name,
      );
      assert.equal(stopCalls, 0, name);
      assert.equal(fs.existsSync(installed.layout.lockPath), false, name);
    }
  });

  test("rollback-confirmation-detects-live-document-add-remove-rename-and-replay", async () => {
    const mutations = [
      ["add", installed => writeValidTask(installed.layout, "added-task")],
      ["remove", installed => fs.rmSync(path.join(installed.layout.batchesDir, "done.json"))],
      ["rename", installed => fs.renameSync(path.join(installed.layout.batchesDir, "done.json"), path.join(installed.layout.batchesDir, "renamed.json"))],
    ];
    for (const [name, mutate] of mutations) {
      const installed = await upgradedFixture(helpers, "rollback-state-file-" + name);
      const preview = await lifecycle.runRollback(rollbackOptions(installed));
      mutate(installed);
      await assert.rejects(
        lifecycle.runRollback(rollbackOptions(installed, { confirm: preview.confirmation.token })),
        error => error.code === "ROLLBACK_CONFIRMATION_STALE",
        name,
      );
    }

    const replay = await upgradedFixture(helpers, "rollback-token-replay");
    const preview = await lifecycle.runRollback(rollbackOptions(replay));
    await lifecycle.runRollback(rollbackOptions(replay, { confirm: preview.confirmation.token }));
    await assert.rejects(
      lifecycle.runRollback(rollbackOptions(replay, { confirm: preview.confirmation.token })),
      error => ["ROLLBACK_CONFIRMATION_STALE", "ROLLBACK_PREVIOUS_UNAVAILABLE"].includes(error.code),
    );
  });

  test("rollback-confirmation-detects-release-receipt-journal-daemon-and-restart-state-changes", async () => {
    const mutations = [
      ["tree", installed => fs.writeFileSync(path.join(installed.target, "SKILL.md"), "changed after preview\n")],
      ["receipt", installed => { const value = JSON.parse(fs.readFileSync(installed.layout.receiptPath, "utf8")); value.installedAt = "2026-07-14T01:00:00.000Z"; fs.writeFileSync(installed.layout.receiptPath, JSON.stringify(value)); }],
      ["journal", installed => { const value = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8")); value.updatedAt = "2026-07-14T01:00:00.000Z"; fs.writeFileSync(installed.layout.journalPath, JSON.stringify(value)); }],
      ["daemon", installed => { fs.mkdirSync(installed.layout.daemonDir, { recursive: true }); fs.writeFileSync(installed.layout.daemonPidPath, "4242"); }],
      ["restart", installed => fs.writeFileSync(installed.layout.restartMarkerPath, JSON.stringify({ schemaVersion: 1, required: true, activatingReleaseTreeSha256: installed.v2Hash, activationId: "changed", sessionId: "other", createdAt: "2026-07-14T00:00:00.000Z", reason: "upgrade" }))],
    ];
    for (const [name, mutate] of mutations) {
      const installed = await upgradedFixture(helpers, "rollback-control-state-" + name);
      const preview = await lifecycle.runRollback(rollbackOptions(installed));
      mutate(installed);
      let stopCalls = 0;
      await assert.rejects(
        lifecycle.runRollback(rollbackOptions(installed, { confirm: preview.confirmation.token, stopValidatedDaemon: async () => { stopCalls++; return { code: "DAEMON_ALREADY_STOPPED" }; } })),
        error => error.code === "ROLLBACK_CONFIRMATION_STALE",
        name,
      );
      assert.equal(stopCalls, 0, name);
    }
  });

  test("rollback-cli-returns-nonzero-for-read-only-preview-blockers", async () => {
    const installed = await upgradedFixture(helpers, "rollback-preview-blocker-exit");
    fs.mkdirSync(installed.layout.lockPath);
    fs.writeFileSync(path.join(installed.layout.lockPath, "owner.json"), "{}");
    const observed = await withFilesystemMutationSpy(() => lifecycle.runLifecycleCli(
      ["rollback", "--target", installed.target, "--dry-run", "--json"],
      { writeStdout() {}, writeStderr() {} },
    ));
    assert.equal(observed.result.exitCode, 1);
    assert.deepEqual(observed.result.result.blockers, ["LIFECYCLE_LOCK_PRESENT"]);
    assert.deepEqual(observed.calls, []);
  });

  test("rollback-preview-structurally-validates-config-index-task-batch-and-recovery-json", async () => {
    const cases = [
      ["config", installed => fs.writeFileSync(installed.layout.configPath, JSON.stringify({ configSchemaVersion: "1.0.0", rules: [] }))],
      ["index", installed => fs.writeFileSync(path.join(installed.layout.tasksDir, "_index.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", tasks: [{}] }))],
      ["task", installed => { writeValidTask(installed.layout, "bad-task"); const file = path.join(installed.layout.tasksDir, "bad-task.json"); const value = JSON.parse(fs.readFileSync(file, "utf8")); value.taskId = "../escape"; fs.writeFileSync(file, JSON.stringify(value)); }],
      ["batch", installed => { const file = path.join(installed.layout.batchesDir, "done.json"); const value = JSON.parse(fs.readFileSync(file, "utf8")); delete value.completed; fs.writeFileSync(file, JSON.stringify(value)); }],
      ["recovery", installed => fs.writeFileSync(path.join(installed.layout.tasksDir, "changes_bad.json"), "{not-json")],
    ];
    for (const [name, mutate] of cases) {
      const installed = await upgradedFixture(helpers, "rollback-structural-" + name);
      mutate(installed);
      await assert.rejects(
        lifecycle.runRollback(rollbackOptions(installed)),
        error => error.code === "ROLLBACK_STATE_INVALID",
        name,
      );
    }
  });

  test("rollback-missing-confirm-is-dry-run-and-wrong-confirm-fails-before-mutation", async () => {
    const installed = await upgradedFixture(helpers, "rollback-confirm");
    const active = hashReleaseTree(installed.target);
    assert.equal((await lifecycle.runRollback(rollbackOptions(installed))).dryRun, true);
    await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, { confirm: "9.9.9" })), error => error.code === "ROLLBACK_CONFIRMATION_STALE");
    assert.equal(hashReleaseTree(installed.target), active);
  });

  test("rollback-compatible-state-restores-one-version-and-preserves-all-mutable-data", async () => {
    const installed = await upgradedFixture(helpers, "rollback-compatible-state");
    const mutable = mutableHashes(installed.layout);
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    const result = await lifecycle.runRollback(rollbackOptions(installed, { confirm: preview.confirmation.token }));
    assert.equal(result.code, "ROLLBACK_OK");
    assert.equal(result.version, "1.0.0");
    assert.equal(hashReleaseTree(installed.target), installed.v1Hash);
    assert.equal(hashReleaseTree(installed.target + ".previous"), installed.v2Hash);
    assert.deepEqual(mutableHashes(installed.layout), mutable);
    assert.equal(result.reverseMigrationsApplied, false);
    assert.equal(result.restartRequired, true);
    await assert.rejects(lifecycle.runRollback(rollbackOptions(installed)), error => error.code === "ROLLBACK_PREVIOUS_UNAVAILABLE");
  });

  test("rollback-manual-cli-v1-to-v2-to-v1-keeps-data-byte-identical", async () => {
    const installed = await upgradedFixture(helpers, "rollback-manual-cli");
    fs.writeFileSync(installed.layout.configPath, JSON.stringify(completeConfig(), null, 2) + "\n");
    const mutable = mutableHashes(installed.layout);
    const output = [];
    const cliRuntime = {
      writeStdout(value) { output.push(value); }, writeStderr(value) { output.push(value); },
      stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_ALREADY_STOPPED" }),
      probeBrowserPolicy: async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "C:\\fixture\\browser.exe", probes: {} }),
      runDoctor: lifecycle.runDoctor, operationId: "todo13-manual-rollback", sleep: async () => {},
    };
    const preview = await lifecycle.runLifecycleCli(["rollback", "--target", installed.target, "--dry-run", "--json"], cliRuntime);
    assert.equal(preview.exitCode, 0);
    assert.match(preview.result.confirmation.exact, /^--confirm 1\.0\.0@[a-f0-9]{64}$/);
    const executed = await lifecycle.runLifecycleCli(["rollback", "--target", installed.target, "--confirm", preview.result.confirmation.token, "--json"], cliRuntime);
    assert.equal(executed.exitCode, 0, JSON.stringify(executed));
    assert.equal(executed.result.code, "ROLLBACK_OK");
    assert.equal(hashReleaseTree(installed.target), installed.v1Hash);
    assert.equal(hashReleaseTree(installed.target + ".previous"), installed.v2Hash);
    assert.deepEqual(mutableHashes(installed.layout), mutable);
    assert.ok(output.length >= 2);
  });

  test("rollback-incompatible-state-fails-before-any-release-or-data-mutation", async () => {
    const installed = await upgradedFixture(helpers, "rollback-incompatible-state");
    const value = JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8"));
    value.configSchemaVersion = "2.0.0";
    fs.writeFileSync(installed.layout.configPath, JSON.stringify(value));
    const before = { active: hashReleaseTree(installed.target), previous: hashReleaseTree(installed.target + ".previous"), mutable: mutableHashes(installed.layout) };
    const dryRun = await lifecycle.runRollback(rollbackOptions(installed));
    assert.equal(dryRun.compatibility.compatible, false);
    assert.ok(dryRun.blockers.includes("ROLLBACK_SCHEMA_INCOMPATIBLE"));
    await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, { confirm: dryRun.confirmation.token })), error => error.code === "ROLLBACK_SCHEMA_INCOMPATIBLE");
    assert.equal(hashReleaseTree(installed.target), before.active);
    assert.equal(hashReleaseTree(installed.target + ".previous"), before.previous);
    assert.deepEqual(mutableHashes(installed.layout), before.mutable);
  });

  test("rollback-rejects-missing-corrupt-linked-mismatched-and-ambiguous-previous", async () => {
    const cases = ["missing", "corrupt", "source-mismatch", "ambiguous"];
    for (const kind of cases) {
      const installed = await upgradedFixture(helpers, "rollback-invalid-previous-" + kind);
      const previous = installed.target + ".previous";
      if (kind === "missing") fs.rmSync(previous, { recursive: true, force: true });
      if (kind === "corrupt") fs.writeFileSync(path.join(previous, "SKILL.md"), "corrupt");
      if (kind === "source-mismatch") writeRelease(previous, "0.9.0");
      if (kind === "ambiguous") { fs.rmSync(previous, { recursive: true, force: true }); fs.cpSync(installed.target, previous, { recursive: true }); }
      await assert.rejects(lifecycle.runRollback(rollbackOptions(installed)), error => ["ROLLBACK_PREVIOUS_UNAVAILABLE", "ROLLBACK_PREVIOUS_INVALID", "ROLLBACK_PREVIOUS_SOURCE_MISMATCH", "ROLLBACK_RELEASE_AMBIGUOUS"].includes(error.code), kind);
      assert.equal(hashReleaseTree(installed.target), installed.v2Hash, kind);
    }
    const linked = await upgradedFixture(helpers, "rollback-invalid-previous-link");
    const previous = linked.target + ".previous";
    const realPrevious = previous + "-real";
    fs.renameSync(previous, realPrevious);
    try {
      fs.symlinkSync(realPrevious, previous, "junction");
      await assert.rejects(lifecycle.runRollback(rollbackOptions(linked)), error => error.code === "ROLLBACK_PREVIOUS_INVALID");
    } catch (error) {
      if (!error || error.code !== "EPERM") throw error;
    }
  });

  test("rollback-daemon-stop-sharing-doctor-receipt-and-marker-failures-restore-original-current", async () => {
    const failures = [
      ["DAEMON_STOP_FAILED", { stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_STOP_FAILED" }) }],
      ["ROLLBACK_SHARING_VIOLATION", { retryAttempts: 2, fsAdapter: { renameSync() { const error = new Error("shared"); error.code = "EPERM"; throw error; } } }],
      ["ROLLBACK_POST_CHECK_FAILED", { runDoctor: async () => ({ blockers: ["RELEASE_TREE_DRIFT", "UNEXPECTED_BLOCKER"], warnings: [] }) }],
      ["RECEIPT_WRITE_FAILED", { writeReceipt: async () => { const error = new Error("receipt"); error.code = "RECEIPT_WRITE_FAILED"; throw error; } }],
      ["RESTART_MARKER_WRITE_FAILED", { writeRestartMarker: () => { const error = new Error("marker"); error.code = "RESTART_MARKER_WRITE_FAILED"; throw error; } }],
    ];
    for (const [code, overrides] of failures) {
      const installed = await upgradedFixture(helpers, "rollback-failure-" + code.toLowerCase());
      const mutable = mutableHashes(installed.layout);
      const preview = await lifecycle.runRollback(rollbackOptions(installed));
      await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, { confirm: preview.confirmation.token, ...overrides })), error => error.code === code, code);
      assert.equal(hashReleaseTree(installed.target), installed.v2Hash, code);
      assert.equal(hashReleaseTree(installed.target + ".previous"), installed.v1Hash, code);
      assert.deepEqual(mutableHashes(installed.layout), mutable, code);
    }
  });

  test("rollback-parent-fsync-failure-restores-original-and-does-not-claim-commit", async () => {
    const installed = await upgradedFixture(helpers, "rollback-parent-fsync");
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    let armed = false;
    let injected = false;
    await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, {
      confirm: preview.confirmation.token,
      onPhase(phase) { if (phase === "candidate-move-planned") armed = true; },
      fsyncParent(directory) {
        if (!injected && armed && path.resolve(directory) === path.dirname(installed.target)) {
          injected = true;
          const error = new Error("fsync");
          error.code = "EIO";
          throw error;
        }
      },
    })), error => error.code === "PARENT_FSYNC_FAILED");
    assert.equal(injected, true);
    assert.equal(hashReleaseTree(installed.target), installed.v2Hash);
    assert.equal(hashReleaseTree(installed.target + ".previous"), installed.v1Hash);
    assert.notEqual(JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8")).status, "committed");
  });

  test("rollback-restoration-failure-preserves-complete-trees-and-recovery-journal", async () => {
    const installed = await upgradedFixture(helpers, "rollback-recovery-preserves");
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    const renameSync = fs.renameSync.bind(fs);
    let rollbackMoves = 0;
    await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, {
      confirm: preview.confirmation.token, retryAttempts: 2,
      runDoctor: async () => ({ blockers: ["UNEXPECTED_BLOCKER"], warnings: [] }),
      fsAdapter: { renameSync(from, to) {
        rollbackMoves++;
        if (rollbackMoves > 2) { const error = new Error("restore shared"); error.code = "EPERM"; throw error; }
        return renameSync(from, to);
      } },
    })), error => error.code === "ROLLBACK_RECOVERY_FAILED");
    const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
    assert.equal(journal.status, "recovery-required");
    assert.equal(hashReleaseTree(installed.target), installed.v1Hash);
    assert.equal(hashReleaseTree(journal.candidateDir), installed.v2Hash);
  });

  test("rollback-recovers-original-current-at-every-journal-crash-boundary", async () => {
    const boundaries = lifecycle.ROLLBACK_PHASES.filter(phase => phase !== "committed" && phase !== "recovered");
    for (const boundary of boundaries) {
      const installed = await upgradedFixture(helpers, "rollback-crash-" + boundary);
      const preview = await lifecycle.runRollback(rollbackOptions(installed));
      await assert.rejects(lifecycle.runRollback(rollbackOptions(installed, {
        confirm: preview.confirmation.token, onPhase(phase) { if (phase === boundary) { const error = new Error("crash"); error.code = "EINJECTED_CRASH"; error.simulatedCrash = true; throw error; } },
      })), error => error.code === "EINJECTED_CRASH", boundary);
      await lifecycle.runRollback(rollbackOptions(installed, { recoverOnly: true }));
      assert.equal(hashReleaseTree(installed.target), installed.v2Hash, boundary);
      assert.equal(hashReleaseTree(installed.target + ".previous"), installed.v1Hash, boundary);
    }
  });

  test("rollback-concurrent-lifecycle-operation-fails-closed", async () => {
    const installed = await upgradedFixture(helpers, "rollback-concurrent");
    const processInspector = { inspectSync: pid => pid === process.pid ? { exists: true, creationToken: "rollback-test-runner" } : { exists: pid === 7204, creationToken: "live-rollback-owner" } };
    fs.mkdirSync(installed.layout.lockPath);
    fs.writeFileSync(path.join(installed.layout.lockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1, lockKind: "lifecycle", lockPath: installed.layout.lockPath, ownerPid: 7204,
      processCreationToken: "live-rollback-owner", ownerToken: "live-rollback-owner-token",
      operationId: "live-rollback-operation", acquiredAt: new Date(1).toISOString(), heartbeatAt: new Date(1).toISOString(),
      journalPath: installed.layout.journalPath, operationPhase: "validated",
    }));
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    assert.equal(preview.code, "LIFECYCLE_LOCK_PRESENT");
    assert.deepEqual(preview.blockers, ["LIFECYCLE_LOCK_PRESENT"]);
    await assert.rejects(lifecycle.runUpgrade({ targetDir: installed.target, repo: REPO, tag: "v3.0.0", browserSource: "chrome", ...runtime(), processInspector }), error => error.code === "LIFECYCLE_LOCKED");
  });

  test("rollback-release-failure-is-fail-closed-with-committed-journal", async () => {
    const installed = await upgradedFixture(helpers, "rollback-release-failure");
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
    await assert.rejects(
      lifecycle.runRollback(rollbackOptions(installed, { confirm: preview.confirmation.token, lockFs })),
      error => error.code === "LIFECYCLE_LOCK_RELEASE_FAILED"
        && error.details.operationCommitted === true
        && error.details.lockReleaseFailure.stage === "claim-removal",
    );
    assert.equal(fs.existsSync(installed.layout.lockPath), true);
    assert.equal(JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8")).status, "committed");
  });

  test("rollback-primary-error-keeps-code-when-release-also-fails", async () => {
    const installed = await upgradedFixture(helpers, "rollback-primary-release-failure");
    const preview = await lifecycle.runRollback(rollbackOptions(installed));
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
    await assert.rejects(
      lifecycle.runRollback(rollbackOptions(installed, {
        confirm: preview.confirmation.token,
        lockFs,
        stopValidatedDaemon: async () => ({ stopped: false, code: "ROLLBACK_PRIMARY_FAILURE" }),
      })),
      error => error.code === "ROLLBACK_PRIMARY_FAILURE" && error.details.lockReleaseFailure.stage === "claim-removal",
    );
    assert.equal(fs.existsSync(installed.layout.lockPath), true);
  });
};
