const fs = require("fs");
const path = require("path");

const lifecycle = require("../../../scripts/lifecycle");
const { getInstallLayout, hashPath } = require("../../../scripts/lib/install-layout");
const { hashReleaseTree, writeInstallReceipt } = require("../../../scripts/lib/install-receipt");

const REPO = "lcc0628/rental-price-agent";

function completeConfig() {
  return {
    configSchemaVersion: "1.0.0",
    saas: { baseUrl: "https://fixture.invalid", loginUrl: "https://fixture.invalid/login", productDetailUrl: "https://fixture.invalid/product/{productId}", productListUrl: "https://fixture.invalid/products", credentials: { username: "${SAAS_USERNAME}", password: "${SAAS_PASSWORD}" } },
    selectors: {}, vas: {}, rules: {}, taskStorage: { directory: "./tasks" },
    browser: { source: "chrome", allowFallback: false, headless: true },
    mirror: { baseUrl: "https://mirror.invalid", apiKey: "${MIRROR_API_KEY}" },
  };
}

function writeRelease(target, helpers, version, options = {}) {
  const release = helpers.createReleaseFixture({ version });
  fs.mkdirSync(target, { recursive: true });
  const files = {
    "SKILL.md": "# Fixture " + version + "\n",
    "config.example.json": JSON.stringify(completeConfig()) + "\n",
    "package.json": JSON.stringify({ name: "rental-price-agent", version, engines: { node: ">=18.0.0 <25.0.0" }, dependencies: { playwright: "1.60.0" } }) + "\n",
    "package-lock.json": JSON.stringify({ name: "rental-price-agent", version, lockfileVersion: 3, requires: true, packages: { "": { name: "rental-price-agent", version, dependencies: { playwright: "1.60.0" }, engines: { node: ">=18.0.0 <25.0.0" } }, "node_modules/playwright": { version: "1.60.0" } } }) + "\n",
    "release-manifest.json": JSON.stringify({ manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v" + version, skillVersion: version, daemonVersion: version, protocolVersion: version, configSchemaVersion: "1.0.0", stateSchemaVersion: "1.0.0", nodeRange: ">=18.0.0 <25.0.0", playwrightVersion: "1.60.0", browserPolicy: { supported: ["managed-chromium", "system-chrome"], default: "system-chrome", allowFallback: false }, compatibility: { skill: { min: version, max: version }, daemon: { min: version, max: version }, protocol: { min: version, max: version }, configSchema: { min: "1.0.0", max: "1.0.0" }, stateSchema: { min: "1.0.0", max: "1.0.0" } }, migration: { contractVersion: 2, definition: "scripts/lib/target-migration.json", sources: { configSchema: [{ min: "1.0.0", max: "1.0.0" }], stateSchema: [{ min: "1.0.0", max: "1.0.0" }] } } }) + "\n",
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(target, name), content);
  fs.mkdirSync(path.join(target, "scripts"));
  fs.writeFileSync(path.join(target, "scripts", "lifecycle.js"), "module.exports = {};\n");
  fs.mkdirSync(path.join(target, "scripts", "lib"));
  const sources = { configSchema: [{ min: "1.0.0", max: "1.0.0" }], stateSchema: [{ min: "1.0.0", max: "1.0.0" }] };
  const definition = options.migrationDefinition || { contractVersion: 2, sources, steps: [] };
  fs.writeFileSync(path.join(target, "scripts", "lib", "target-migration.json"), typeof definition === "string" ? definition : JSON.stringify(definition) + "\n");
  fs.mkdirSync(path.join(target, "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(target, "node_modules", "playwright", "package.json"), JSON.stringify({ name: "playwright", version: "1.60.0" }));
  return release;
}

async function createInstalledFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, "agent");
  const layout = getInstallLayout(target);
  fs.rmSync(fixture.paths.active, { recursive: true, force: true });
  fs.rmSync(fixture.paths.staging, { recursive: true, force: true });
  fs.rmSync(fixture.paths.previous, { recursive: true, force: true });
  writeRelease(target, helpers, "1.0.0");
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  fs.writeFileSync(layout.configPath, JSON.stringify(completeConfig(), null, 2) + "\n");
  fs.writeFileSync(layout.envPath, "FIXTURE_SECRET=unchanged\n");
  fs.mkdirSync(layout.browserProfileDir);
  fs.writeFileSync(path.join(layout.browserProfileDir, "Cookies"), "fixture-cookie-bytes");
  fs.mkdirSync(layout.tasksDir);
  fs.writeFileSync(path.join(layout.tasksDir, "_index.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", tasks: [] }));
  const receipt = await writeInstallReceipt({
    targetDir: target,
    source: { owner: "lcc0628", repo: "rental-price-agent", tag: "v1.0.0", asset: "rental-price-agent-v1.0.0.tgz", sha256: "1".repeat(64) },
    browser: { policy: { source: "chrome", allowFallback: false }, selectedSource: "chrome", version: "149.0.0.0" },
  });
  return { fixture, target, layout, receipt };
}

function runtime(helpers, overrides = {}) {
  return {
    platform: "win32",
    run() { return { status: 0, stdout: "", stderr: "" }; },
    probeBrowserPolicy: async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "C:\\fixture\\browser.exe", probes: {} }),
    requestDaemonDrain: async () => ({ drained: true, code: "DAEMON_ALREADY_STOPPED" }),
    stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_ALREADY_STOPPED" }),
    verifyProfileReleased: async () => ({ released: true }),
    runDoctor: async () => ({ blockers: [], warnings: [] }),
    sleep: async () => {},
    stageGiteeRelease: async options => {
       writeRelease(options.stagingDir, helpers, "2.0.0", { migrationDefinition: overrides.migrationDefinition });
      return { archiveName: "rental-price-agent-v2.0.0.tgz", sha256: "2".repeat(64), stagingDir: options.stagingDir };
    },
    ...overrides,
  };
}

function upgradeOptions(installed, helpers, overrides = {}) {
  return {
    targetDir: installed.target,
    repo: REPO,
    tag: "v2.0.0",
    browserSource: "chrome",
    ...runtime(helpers),
    ...overrides,
  };
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("upgrade-current-to-next", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-current-next");
    const mutableHashes = {
      config: hashPath(installed.layout.configPath),
      env: hashPath(installed.layout.envPath),
      profile: hashPath(installed.layout.browserProfileDir),
      tasks: hashPath(installed.layout.tasksDir),
    };
    const oldHash = hashReleaseTree(installed.target);
    const result = await lifecycle.runUpgrade(upgradeOptions(installed, helpers));
    assert.equal(result.code, "UPGRADE_OK");
    assert.equal(result.version, "2.0.0");
    assert.equal(hashReleaseTree(installed.target), result.receipt.releaseTreeSha256);
    assert.equal(hashReleaseTree(installed.target + ".previous"), oldHash);
    assert.deepEqual({
      config: hashPath(installed.layout.configPath),
      env: hashPath(installed.layout.envPath),
      profile: hashPath(installed.layout.browserProfileDir),
      tasks: hashPath(installed.layout.tasksDir),
    }, mutableHashes);
  });

  test("upgrade-rejects-same-older-unresolved-and-cross-volume", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-rejections");
    for (const tag of ["v1.0.0", "v0.9.0"]) {
      await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, { tag })), error => error.code === (tag === "v1.0.0" ? "UPGRADE_SAME_VERSION" : "UPGRADE_DOWNGRADE_FORBIDDEN"));
    }
    fs.writeFileSync(path.join(installed.layout.tasksDir, "pending.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", taskId: "pending", status: "running", history: [], evidence: [], results: {} }));
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers)), error => error.code === "UNRESOLVED_OPERATIONS");
    fs.unlinkSync(path.join(installed.layout.tasksDir, "pending.json"));
    fs.mkdirSync(installed.layout.batchesDir);
    fs.writeFileSync(path.join(installed.layout.batchesDir, "batch.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", batchId: "batch", status: "recovering", spec: {}, total: 0, completed: [], previewOnly: [], verifyFailed: [], failed: [] }));
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers)), error => error.code === "UNRESOLVED_OPERATIONS");
    fs.rmSync(installed.layout.batchesDir, { recursive: true, force: true });
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, { volumeResolver: value => value.includes("upgrade-stage") ? "D:" : "C:" })), error => error.code === "CROSS_VOLUME_STAGING");
  });

  test("upgrade-daemon-profile-and-staging-failures-are-nondestructive", async () => {
    const failures = [
      ["DAEMON_DRAIN_TIMEOUT", { requestDaemonDrain: async () => ({ drained: false, code: "DAEMON_DRAIN_TIMEOUT" }) }],
      ["DAEMON_HELLO_MISMATCH", { requestDaemonDrain: async () => ({ drained: false, code: "DAEMON_HELLO_MISMATCH" }) }],
      ["BROWSER_PROFILE_LOCKED", { verifyProfileReleased: async () => ({ released: false, code: "BROWSER_PROFILE_LOCKED" }) }],
      ["STAGING_DOCTOR_FAILED", { runDoctor: async () => ({ blockers: ["RELEASE_TREE_DRIFT"], warnings: [] }) }],
      ["TARGET_MIGRATION_DEFINITION_INVALID", { stageGiteeRelease: async stage => {
        writeRelease(stage.stagingDir, helpers, "2.0.0", { migrationDefinition: { contractVersion: 2, sources: { configSchema: [{ min: "1.0.0", max: "1.0.0" }], stateSchema: [{ min: "1.0.0", max: "1.0.0" }] }, steps: [{ domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "1.0.1", operations: [{ op: "execute", path: "/configSchemaVersion" }] }] } });
        return { archiveName: "rental-price-agent-v2.0.0.tgz", sha256: "2".repeat(64), stagingDir: stage.stagingDir };
      } }],
    ];
    for (const [code, overrides] of failures) {
      const installed = await createInstalledFixture(helpers, "upgrade-fail-" + code.toLowerCase());
      const activeHash = hashReleaseTree(installed.target);
      const configHash = hashPath(installed.layout.configPath);
      await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, overrides)), error => error.code === code, code);
      assert.equal(hashReleaseTree(installed.target), activeHash, code);
      assert.equal(hashPath(installed.layout.configPath), configHash, code);
    }
  });

  test("activation-crash-recovery-restores-exact-active-at-every-journal-boundary", async () => {
    const boundaries = lifecycle.UPGRADE_PHASES.filter(phase => phase !== "committed");
    assert.ok(boundaries.length > 10);
    for (const boundary of boundaries) {
      const installed = await createInstalledFixture(helpers, "upgrade-crash-" + boundary);
      const oldHash = hashReleaseTree(installed.target);
      const originalReceipt = fs.readFileSync(installed.layout.receiptPath, "utf8");
      let processCreationToken = "upgrade-owner-before-crash";
      const processInspector = { inspectSync: pid => ({ exists: pid === process.pid, creationToken: processCreationToken }) };
      const options = upgradeOptions(installed, helpers, { processInspector, onPhase(phase) { if (phase === boundary) { const error = new Error("crash"); error.code = "EINJECTED_CRASH"; error.simulatedCrash = true; throw error; } } });
      await assert.rejects(lifecycle.runUpgrade(options), error => error.code === "EINJECTED_CRASH", boundary);
      processCreationToken = "upgrade-owner-after-crash";
      await lifecycle.runUpgrade({ ...upgradeOptions(installed, helpers), processInspector, recoverOnly: true });
      assert.equal(hashReleaseTree(installed.target), oldHash, boundary);
      assert.equal(fs.readFileSync(installed.layout.receiptPath, "utf8"), originalReceipt, boundary);
    }
  });

  test("activation-sharing-violation-retries-transient-and-preserves-permanent", async () => {
    const transient = await createInstalledFixture(helpers, "upgrade-sharing-transient");
    let attempts = 0;
    const renameSync = fs.renameSync.bind(fs);
    const transientResult = await lifecycle.runUpgrade(upgradeOptions(transient, helpers, { fsAdapter: { renameSync(from, to) { attempts++; if (attempts <= 2) { const error = new Error("antivirus"); error.code = attempts === 1 ? "EPERM" : "EACCES"; throw error; } return renameSync(from, to); } } }));
    assert.equal(transientResult.code, "UPGRADE_OK");
    assert.ok(attempts > 2);

    const permanent = await createInstalledFixture(helpers, "upgrade-sharing-permanent");
    const oldHash = hashReleaseTree(permanent.target);
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(permanent, helpers, { retryAttempts: 2, fsAdapter: { renameSync() { const error = new Error("locked"); error.code = "EPERM"; throw error; } } })), error => error.code === "ACTIVATION_SHARING_VIOLATION");
    assert.equal(hashReleaseTree(permanent.target), oldHash);
  });

  test("upgrade-rejects-concurrency-malformed-or-symlinked-journal-and-retains-one-previous", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-lock-journal");
    const processInspector = { inspectSync: pid => pid === process.pid ? { exists: true, creationToken: "upgrade-test-runner" } : { exists: pid === 7203, creationToken: "live-upgrade-owner" } };
    fs.mkdirSync(installed.layout.lockPath);
    fs.writeFileSync(path.join(installed.layout.lockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1, lockKind: "lifecycle", lockPath: installed.layout.lockPath, ownerPid: 7203,
      processCreationToken: "live-upgrade-owner", ownerToken: "live-upgrade-owner-token",
      operationId: "live-upgrade-operation", acquiredAt: new Date(1).toISOString(), heartbeatAt: new Date(1).toISOString(),
      journalPath: installed.layout.journalPath, operationPhase: "staged",
    }));
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, { processInspector })), error => error.code === "LIFECYCLE_LOCKED");
    fs.rmSync(installed.layout.lockPath, { recursive: true, force: true });
    fs.writeFileSync(installed.layout.journalPath, "not-json");
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers)), error => error.code === "LIFECYCLE_JOURNAL_MALFORMED");
    fs.unlinkSync(installed.layout.journalPath);
    const outside = path.join(installed.fixture.root, "outside-journal");
    fs.writeFileSync(outside, "{}");
    try {
      fs.symlinkSync(outside, installed.layout.journalPath, "file");
      await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers)), error => error.code === "LIFECYCLE_JOURNAL_UNSAFE_PATH");
    } catch (error) {
      if (!error || error.code !== "EPERM") throw error;
    } finally { fs.rmSync(installed.layout.journalPath, { force: true }); }

    writeRelease(installed.target + ".previous", helpers, "0.9.0");
    const result = await lifecycle.runUpgrade(upgradeOptions(installed, helpers));
    assert.equal(result.code, "UPGRADE_OK");
    assert.equal(hashReleaseTree(installed.target + ".previous"), result.previous.releaseTreeSha256);
    assert.equal(fs.existsSync(installed.target + ".previous.retained"), false);
  });

  test("upgrade-restores-receipt-marker-on-write-and-post-check-failure", async () => {
    const cases = [
      ["RECEIPT_WRITE_FAILED", { writeReceipt: async () => { const error = new Error("receipt"); error.code = "RECEIPT_WRITE_FAILED"; throw error; } }],
      ["RESTART_MARKER_WRITE_FAILED", { writeRestartMarker: () => { const error = new Error("marker"); error.code = "RESTART_MARKER_WRITE_FAILED"; throw error; } }],
      ["POST_ACTIVATION_CHECK_FAILED", { postActivationDoctor: async () => ({ blockers: ["RELEASE_TREE_DRIFT"] }) }],
    ];
    for (const [code, overrides] of cases) {
      const installed = await createInstalledFixture(helpers, "upgrade-restore-" + code.toLowerCase());
      fs.writeFileSync(installed.layout.restartMarkerPath, JSON.stringify({ schemaVersion: 1, required: true, activatingReleaseTreeSha256: installed.receipt.releaseTreeSha256, activationId: "old", sessionId: "old", createdAt: new Date(0).toISOString(), reason: "install" }) + "\n");
      const oldHash = hashReleaseTree(installed.target);
      const receipt = fs.readFileSync(installed.layout.receiptPath);
      const marker = fs.readFileSync(installed.layout.restartMarkerPath);
      await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, overrides)), error => error.code === code, code);
      assert.equal(hashReleaseTree(installed.target), oldHash);
      assert.deepEqual(fs.readFileSync(installed.layout.receiptPath), receipt);
      assert.deepEqual(fs.readFileSync(installed.layout.restartMarkerPath), marker);
    }
  });

  test("upgrade-leaves-two-complete-trees-and-journal-when-immediate-restoration-is-blocked", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-recovery-blocked");
    const oldHash = hashReleaseTree(installed.target);
    const renameSync = fs.renameSync.bind(fs);
    let activationFailed = false;
    await assert.rejects(lifecycle.runUpgrade(upgradeOptions(installed, helpers, { retryAttempts: 2, fsAdapter: { renameSync(from, to) {
      if (from.includes("upgrade-stage") && to === installed.target) {
        activationFailed = true;
        const error = new Error("activation blocked");
        error.code = "EIO";
        throw error;
      }
      if (activationFailed && from === installed.target + ".previous" && to === installed.target) {
        const error = new Error("restore locked");
        error.code = "EPERM";
        throw error;
      }
      return renameSync(from, to);
    } } })), error => error.code === "UPGRADE_RECOVERY_FAILED");
    assert.equal(hashReleaseTree(installed.target + ".previous"), oldHash);
    const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
    assert.equal(journal.status, "recovery-required");
    assert.equal(hashReleaseTree(journal.stagingDir), journal.targetTreeSha256);
    assert.equal(fs.existsSync(installed.target), false);
  });

  test("upgrade-release-failure-is-fail-closed-and-defers-owned-success-cleanup", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-release-failure");
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
    await assert.rejects(
      lifecycle.runUpgrade(upgradeOptions(installed, helpers, { lockFs })),
      error => error.code === "LIFECYCLE_LOCK_RELEASE_FAILED"
        && error.details.operationCommitted === true
        && error.details.lockReleaseFailure.stage === "claim-removal",
    );
    const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
    assert.equal(journal.status, "committed");
    assert.equal(fs.existsSync(installed.layout.lockPath), true);
    assert.equal(fs.existsSync(journal.temporaryDataRoot), true);
  });

  test("upgrade-primary-error-keeps-code-when-release-also-fails", async () => {
    const installed = await createInstalledFixture(helpers, "upgrade-primary-release-failure");
    const lockFs = Object.create(fs);
    lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
    await assert.rejects(
      lifecycle.runUpgrade(upgradeOptions(installed, helpers, {
        lockFs,
        stageGiteeRelease: async () => { throw Object.assign(new Error("primary upgrade failure"), { code: "UPGRADE_PRIMARY_FAILURE" }); },
      })),
      error => error.code === "UPGRADE_PRIMARY_FAILURE" && error.details.lockReleaseFailure.stage === "claim-removal",
    );
    assert.equal(fs.existsSync(installed.layout.lockPath), true);
  });
};
