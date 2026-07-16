const fs = require("fs");
const path = require("path");

const SKILL_DIR = path.resolve(__dirname, "..", "..", "..");
const { getInstallLayout } = require(path.join(SKILL_DIR, "scripts", "lib", "install-layout.js"));
const { readCurrentMetadata } = require(path.join(SKILL_DIR, "scripts", "lib", "version-contract.js"));

function completeConfig(overrides = {}) {
  return {
    configSchemaVersion: "1.0.0",
    saas: {
      baseUrl: "https://fixture.invalid",
      loginUrl: "https://fixture.invalid/login",
      productDetailUrl: "https://fixture.invalid/product/{productId}",
      productListUrl: "https://fixture.invalid/products",
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

async function makeStateFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, "rental-price-agent");
  await fs.promises.mkdir(target);
  const layout = getInstallLayout(target);
  await fs.promises.mkdir(layout.tasksDir, { recursive: true });
  await fs.promises.writeFile(layout.configPath, JSON.stringify(completeConfig(), null, 2) + "\n");
  await fs.promises.writeFile(layout.envPath, "SAAS_USERNAME=user\nSAAS_PASSWORD=super-secret\nMIRROR_API_KEY=mirror-secret\n");
  return { layout, releaseContract: readCurrentMetadata() };
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("live-readiness: healthy persisted state is deterministic and read-only", async () => {
    const { layout, releaseContract } = await makeStateFixture(helpers, "live-readiness-healthy");
    const { evaluateLiveStateReadiness } = require(path.join(SKILL_DIR, "scripts", "lib", "live-state-readiness.js"));
    const before = await helpers.hashTree(layout.dataRoot);
    const first = evaluateLiveStateReadiness(layout, releaseContract);
    const second = evaluateLiveStateReadiness(layout, releaseContract);
    const after = await helpers.hashTree(layout.dataRoot);

    assert.equal(first.readyForWrites, true);
    assert.deepEqual(first.blockers, []);
    assert.equal(first.stateDigest, second.stateDigest);
    assert.equal(first.actualSchemaVersions.config, "1.0.0");
    assert.deepEqual(first.actualSchemaVersions.state, []);
    assert.equal(before, after);
    assert.doesNotMatch(JSON.stringify(first), /super-secret|mirror-secret/);
  });

  test("live-readiness: legacy config and malformed task block without migration", async () => {
    const { layout, releaseContract } = await makeStateFixture(helpers, "live-readiness-corrupt");
    const { evaluateLiveStateReadiness } = require(path.join(SKILL_DIR, "scripts", "lib", "live-state-readiness.js"));
    const legacy = completeConfig();
    delete legacy.configSchemaVersion;
    await fs.promises.writeFile(layout.configPath, JSON.stringify(legacy, null, 2) + "\n");
    await fs.promises.writeFile(path.join(layout.tasksDir, "broken.json"), "{not-json");
    const before = await helpers.hashTree(layout.dataRoot);
    const result = evaluateLiveStateReadiness(layout, releaseContract);
    const after = await helpers.hashTree(layout.dataRoot);

    assert.equal(result.readyForWrites, false);
    assert.ok(result.blockers.includes("CONFIG_SCHEMA_MIGRATION_REQUIRED"));
    assert.ok(result.blockers.includes("STATE_DOCUMENT_MALFORMED"));
    assert.equal(result.actualSchemaVersions.config, "0.0.0");
    assert.equal(before, after);
    assert.equal(JSON.parse(await fs.promises.readFile(layout.configPath, "utf8")).configSchemaVersion, undefined);
  });

  test("live-readiness: unresolved journal, unknown files, and unsafe links fail closed", async () => {
    const { layout, releaseContract } = await makeStateFixture(helpers, "live-readiness-blockers");
    const { evaluateLiveStateReadiness } = require(path.join(SKILL_DIR, "scripts", "lib", "live-state-readiness.js"));
    await fs.promises.writeFile(layout.journalPath, JSON.stringify({ schemaVersion: 1, status: "activating" }));
    await fs.promises.writeFile(path.join(layout.tasksDir, "future.bin"), "unknown");
    let linked = false;
    try {
      await fs.promises.symlink(layout.configPath, path.join(layout.tasksDir, "unsafe.json"), "file");
      linked = true;
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    }
    const result = evaluateLiveStateReadiness(layout, releaseContract);

    assert.equal(result.readyForWrites, false);
    assert.ok(result.blockers.includes("LIFECYCLE_JOURNAL_INTERRUPTED"));
    assert.ok(result.blockers.includes("STATE_DOCUMENT_UNKNOWN"));
    if (linked) assert.ok(result.blockers.includes("STATE_DOCUMENT_UNSAFE"));
  });

  test("live-readiness: runtime config loading never migrates legacy config", async () => {
    const { layout } = await makeStateFixture(helpers, "runtime-config-read-only");
    const legacy = completeConfig();
    delete legacy.configSchemaVersion;
    await fs.promises.writeFile(layout.configPath, JSON.stringify(legacy, null, 2) + "\n");
    const before = await helpers.hashTree(layout.dataRoot);
    const { loadConfig } = require(path.join(SKILL_DIR, "scripts", "lib", "config-loader.js"));

    assert.throws(() => loadConfig({ layout }), error => error.code === "CONFIG_SCHEMA_MIGRATION_REQUIRED");
    assert.equal(before, await helpers.hashTree(layout.dataRoot));
  });
};
