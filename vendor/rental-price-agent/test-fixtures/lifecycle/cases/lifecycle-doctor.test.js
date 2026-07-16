const fs = require("fs");
const path = require("path");

const { getInstallLayout } = require("../../../scripts/lib/install-layout");
const receipt = require("../../../scripts/lib/install-receipt");
const lifecycle = require("../../../scripts/lifecycle");
const init = require("../../../scripts/init");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");
const RELEASE_ENTRIES = [
  ".gitignore", "README.md", "SKILL.md", "config.example.json", "package-lock.json",
  "package.json", "references", "release-manifest.json", "scripts",
];

function completeConfig(overrides = {}) {
  return {
    configSchemaVersion: "1.0.0",
    saas: {
      baseUrl: "https://fixture.invalid",
      loginUrl: "https://fixture.invalid/login",
      productDetailUrl: "https://fixture.invalid/product/{productId}",
      credentials: { username: "${SAAS_USERNAME}", password: "${SAAS_PASSWORD}" },
    },
    selectors: {},
    vas: {},
    rules: {},
    taskStorage: { directory: "./tasks" },
    browser: { source: "chrome", allowFallback: false, headless: true },
    mirror: { baseUrl: "https://mirror.invalid", apiKey: "${MIRROR_API_KEY}" },
    ...overrides,
  };
}

async function makeRecognizedFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, "rental-price-agent");
  await fs.promises.mkdir(target);
  for (const entry of RELEASE_ENTRIES) {
    const source = path.join(SKILL_DIR, entry);
    if (fs.existsSync(source)) await fs.promises.cp(source, path.join(target, entry), { recursive: true });
  }
  const layout = getInstallLayout(target);
  await fs.promises.mkdir(layout.tasksDir, { recursive: true });
  await fs.promises.writeFile(layout.configPath, JSON.stringify(completeConfig(), null, 2) + "\n");
  await fs.promises.writeFile(layout.envPath, "SAAS_USERNAME=user\nSAAS_PASSWORD=password\nMIRROR_API_KEY=key\n");
  await fs.promises.mkdir(path.join(target, "node_modules", "playwright"), { recursive: true });
  await fs.promises.writeFile(path.join(target, "node_modules", "playwright", "package.json"), JSON.stringify({ name: "playwright", version: "1.60.0" }) + "\n");
  await receipt.writeInstallReceipt({
    targetDir: target,
    source: {
      owner: "lcc0628",
      repo: "rental-price-agent",
      tag: "v1.0.0",
      asset: "rental-price-agent-v1.0.0.tgz",
      sha256: "a".repeat(64),
    },
    browser: { policy: { source: "chrome", allowFallback: false }, selectedSource: "chrome", version: "149.0.0.0" },
    installedAt: "2026-07-14T00:00:00.000Z",
  });
  return { fixture, target, layout };
}

function goodProbe() {
  return Promise.resolve({ ok: true, selectedSource: "chrome", version: "149.0.0.0", executablePath: "C:\\fixture\\chrome.exe", probes: {} });
}

function codes(result) {
  return result.checks.map(check => check.code);
}

async function renameChangingOnlyCase(filePath, nextName) {
  const intermediate = path.join(path.dirname(filePath), ".case-rename-" + process.pid);
  await fs.promises.rename(filePath, intermediate);
  await fs.promises.rename(intermediate, path.join(path.dirname(filePath), nextName));
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("lifecycle-doctor-current", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-current");
    const before = await helpers.hashTree(path.dirname(target));
    const status = lifecycle.collectStatus({ targetDir: target });
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    const after = await helpers.hashTree(path.dirname(target));
    const installed = JSON.parse(await fs.promises.readFile(layout.receiptPath, "utf8"));
    assert.equal(status.receipt.present, true);
    assert.equal(status.versions.skill, "1.0.0");
    assert.equal(result.readyForReads, true);
    assert.equal(result.readyForWrites, true);
    assert.deepEqual(result.blockers, []);
    assert.match(result.persistedState.stateDigest, /^[a-f0-9]{64}$/);
    assert.equal(result.persistedState.readyForWrites, true);
    assert.ok(codes(result).includes("DAEMON_IDENTITY_ABSENT"));
    assert.equal(before, after);
    assert.equal(installed.receiptSchemaVersion, 1);
    assert.equal(installed.targetDir, fs.realpathSync(target));
    assert.equal(installed.dataRoot, fs.realpathSync(layout.dataRoot));
    assert.deepEqual(Object.keys(installed.source).sort(), ["asset", "owner", "provider", "repo", "sha256", "tag"]);
    assert.deepEqual(Object.keys(installed.versions).sort(), ["configSchema", "daemon", "protocol", "skill", "stateSchema"]);
    assert.deepEqual(Object.keys(installed.browser).sort(), ["policy", "selectedSource", "version"]);
    assert.match(installed.dependencyLockSha256, /^[a-f0-9]{64}$/);
    assert.match(installed.releaseTreeSha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readdirSync(layout.dataRoot).some(name => name.includes("install-receipt.json.tmp")), false);
  });

  test("lifecycle-doctor-missing-receipt", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-missing-receipt");
    await fs.promises.unlink(layout.receiptPath);
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("INSTALL_RECEIPT_MISSING"));
  });

  test("lifecycle-doctor-tree-drift", async () => {
    const { target } = await makeRecognizedFixture(helpers, "doctor-tree-drift");
    await fs.promises.appendFile(path.join(target, "README.md"), "drift\n");
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("RELEASE_TREE_DRIFT"));
  });

  test("lifecycle-doctor-case-only-release-tree-drift", async () => {
    const { target } = await makeRecognizedFixture(helpers, "doctor-case-only-tree-drift");
    await renameChangingOnlyCase(path.join(target, "README.md"), "readme.md");
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("RELEASE_TREE_DRIFT"));
  });

  test("lifecycle-doctor-future-schema", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-future-schema");
    await fs.promises.writeFile(layout.configPath, JSON.stringify(completeConfig({ configSchemaVersion: "99.0.0" }), null, 2));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("CONFIG_SCHEMA_FUTURE"));
  });

  test("lifecycle-doctor-incomplete-config", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-incomplete-config");
    await fs.promises.writeFile(layout.configPath, JSON.stringify(completeConfig({ mirror: {} }), null, 2));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    const check = result.checks.find(item => item.code === "CONFIG_INCOMPLETE");
    assert.equal(result.readyForWrites, false);
    assert.deepEqual(check.details.fields, ["mirror.apiKey", "mirror.baseUrl"]);
    assert.equal(JSON.stringify(check).includes("secret-value"), false);
  });

  test("lifecycle-doctor-bad-browser", async () => {
    const { target } = await makeRecognizedFixture(helpers, "doctor-bad-browser");
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: async () => ({ ok: false, error: { code: "SYSTEM_CHROME_UNAVAILABLE", message: "not found" }, probes: {} }) });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("SYSTEM_CHROME_UNAVAILABLE"));
  });

  test("lifecycle-doctor-dependency-drift", async () => {
    const { target } = await makeRecognizedFixture(helpers, "doctor-dependency-drift");
    await fs.promises.writeFile(path.join(target, "node_modules", "playwright", "package.json"), JSON.stringify({ name: "playwright", version: "1.59.0" }));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("PLAYWRIGHT_INSTALL_DRIFT"));
  });

  test("lifecycle-doctor-interrupted-journal", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-interrupted-journal");
    await fs.promises.writeFile(layout.journalPath, JSON.stringify({ schemaVersion: 1, status: "activating" }));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("LIFECYCLE_JOURNAL_INTERRUPTED"));
  });

  test("lifecycle-doctor-malformed-receipt", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-malformed-receipt");
    await fs.promises.writeFile(layout.receiptPath, "{not-json");
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("INSTALL_RECEIPT_MALFORMED"));
  });

  test("lifecycle-doctor-rejects-symlinked-receipt-before-read", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-symlinked-receipt");
    let receiptRead = false;
    const receiptFileSystem = {
      ...fs,
      lstatSync(filePath) {
        if (path.resolve(filePath) === path.resolve(layout.receiptPath)) {
          return { isSymbolicLink: () => true, isFile: () => false };
        }
        return fs.lstatSync(filePath);
      },
      readFileSync(filePath, ...args) {
        if (path.resolve(filePath) === path.resolve(layout.receiptPath)) receiptRead = true;
        return fs.readFileSync(filePath, ...args);
      },
    };
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe, receiptFileSystem });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("INSTALL_RECEIPT_UNSAFE_PATH"));
    assert.equal(receiptRead, false);
  });

  test("lifecycle-doctor-rejects-receipt-path-substitution-before-read", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-substituted-receipt");
    let receiptRead = false;
    const outsideReceipt = path.join(path.dirname(layout.dataRoot), "outside-install-receipt.json");
    const receiptFileSystem = {
      ...fs,
      realpathSync(filePath) {
        if (path.resolve(filePath) === path.resolve(layout.receiptPath)) return outsideReceipt;
        return fs.realpathSync(filePath);
      },
      readFileSync(filePath, ...args) {
        if (path.resolve(filePath) === path.resolve(layout.receiptPath)) receiptRead = true;
        return fs.readFileSync(filePath, ...args);
      },
    };
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe, receiptFileSystem });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("INSTALL_RECEIPT_UNSAFE_PATH"));
    assert.equal(receiptRead, false);
  });

  test("lifecycle-doctor-blocks-malformed-persisted-state", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-malformed-state");
    await fs.promises.writeFile(path.join(layout.tasksDir, "_index.json"), "{not-json");
    const outcome = await lifecycle.runLifecycleCli(["doctor", "--target", target, "--json"], { probeBrowserPolicy: goodProbe, writeStdout() {}, writeStderr() {} });
    assert.notEqual(outcome.exitCode, 0);
    assert.equal(outcome.result.readyForWrites, false);
    assert.ok(codes(outcome.result).includes("STATE_DOCUMENT_MALFORMED"));
  });

  test("lifecycle-doctor-blocks-incomplete-task-and-batch-state", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-incomplete-state");
    await fs.promises.mkdir(layout.batchesDir, { recursive: true });
    await fs.promises.writeFile(path.join(layout.tasksDir, "task_incomplete.json"), JSON.stringify({ stateSchemaVersion: "1.0.0" }));
    await fs.promises.writeFile(path.join(layout.batchesDir, "batch_incomplete.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", batchId: "batch_incomplete" }));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.equal(result.checks.filter(item => item.code === "STATE_DOCUMENT_INVALID").length, 2);
  });

  test("lifecycle-doctor-blocks-state-with-missing-version", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-state-version-missing");
    await fs.promises.writeFile(path.join(layout.tasksDir, "task_missing_version.json"), JSON.stringify({ taskId: "task_missing_version" }));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("STATE_SCHEMA_MISSING"));
  });

  test("lifecycle-doctor-blocks-unreadable-persisted-state", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-unreadable-state");
    const statePath = path.join(layout.tasksDir, "task_unreadable.json");
    await fs.promises.writeFile(statePath, JSON.stringify({ stateSchemaVersion: "1.0.0", taskId: "task_unreadable" }));
    const stateFileSystem = {
      ...fs,
      readFileSync(filePath, ...args) {
        if (path.resolve(filePath) === path.resolve(statePath)) {
          const error = new Error("fixture access denied");
          error.code = "EACCES";
          throw error;
        }
        return fs.readFileSync(filePath, ...args);
      },
    };
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe, stateFileSystem });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("STATE_DOCUMENT_UNREADABLE"));
  });

  test("lifecycle-doctor-target-data-mismatch", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "doctor-target-data-mismatch");
    const value = JSON.parse(await fs.promises.readFile(layout.receiptPath, "utf8"));
    value.dataRoot = path.join(path.dirname(target), ".other-data");
    await fs.promises.writeFile(layout.receiptPath, JSON.stringify(value, null, 2));
    const result = await lifecycle.runDoctor({ targetDir: target, probeBrowserPolicy: goodProbe });
    assert.equal(result.readyForWrites, false);
    assert.ok(codes(result).includes("INSTALL_RECEIPT_PATH_MISMATCH"));
  });

  test("lifecycle-doctor-truthful-exit-codes", async () => {
    const { target } = await makeRecognizedFixture(helpers, "doctor-exit-codes");
    const healthy = await lifecycle.runLifecycleCli(["doctor", "--target", target, "--json"], { probeBrowserPolicy: goodProbe, writeStdout() {}, writeStderr() {} });
    assert.equal(healthy.exitCode, 0);
    await fs.promises.appendFile(path.join(target, "README.md"), "drift\n");
    const unhealthy = await lifecycle.runLifecycleCli(["doctor", "--target", target, "--json"], { probeBrowserPolicy: goodProbe, writeStdout() {}, writeStderr() {} });
    assert.notEqual(unhealthy.exitCode, 0);
    assert.equal(unhealthy.result.readyForWrites, false);
    assert.ok(unhealthy.result.blockers.length > 0);
  });

  test("lifecycle-init-does-not-create-config", async () => {
    const { target, layout } = await makeRecognizedFixture(helpers, "init-no-config-create");
    await fs.promises.unlink(layout.configPath);
    const result = await init.runInitialization({ targetDir: target, quiet: true, probeBrowserPolicy: goodProbe });
    assert.equal(result.exitCode, 1);
    assert.equal(fs.existsSync(layout.configPath), false);
    assert.ok(result.doctor.blockers.includes("CONFIG_MISSING"));
  });
};
