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

function targetMigrationDefinition(sourceSchemaVersion, targetSchemaVersion, marker) {
  const sources = {
    configSchema: [{ min: sourceSchemaVersion, max: sourceSchemaVersion }],
    stateSchema: [{ min: sourceSchemaVersion, max: sourceSchemaVersion }],
  };
  if (sourceSchemaVersion === targetSchemaVersion) return { contractVersion: 2, sources, steps: [] };
  const markerOperation = marker === undefined ? [] : [{ op: "add", path: "/migratedBy", value: marker }];
  return {
    contractVersion: 2,
    sources,
    steps: [
      {
        domain: "configSchema", kinds: ["config"], from: sourceSchemaVersion, to: targetSchemaVersion,
        operations: [{ op: "replace", path: "/configSchemaVersion", value: targetSchemaVersion }, ...markerOperation],
      },
      {
        domain: "stateSchema", kinds: ["task-index", "task", "batch"], from: sourceSchemaVersion, to: targetSchemaVersion,
        operations: [{ op: "replace", path: "/stateSchemaVersion", value: targetSchemaVersion }, ...markerOperation],
      },
    ],
  };
}

function writeRelease(target, version, schemaVersion = "1.0.0", options = {}) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const manifest = {
    manifestSchemaVersion: 1, name: "rental-price-agent", releaseTag: "v" + version,
    skillVersion: version, daemonVersion: version, protocolVersion: version,
    configSchemaVersion: schemaVersion, stateSchemaVersion: schemaVersion,
    nodeRange: ">=18.0.0 <25.0.0", playwrightVersion: "1.60.0",
    browserPolicy: { supported: ["managed-chromium", "system-chrome"], default: "system-chrome", allowFallback: false },
    compatibility: {
      skill: { min: version, max: version }, daemon: { min: version, max: version }, protocol: { min: version, max: version },
      configSchema: { min: schemaVersion, max: schemaVersion }, stateSchema: { min: schemaVersion, max: schemaVersion },
    },
    migration: {
      contractVersion: 2,
      definition: "scripts/lib/target-migration.json",
      sources: {
        configSchema: [{ min: options.sourceSchemaVersion || schemaVersion, max: options.sourceSchemaVersion || schemaVersion }],
        stateSchema: [{ min: options.sourceSchemaVersion || schemaVersion, max: options.sourceSchemaVersion || schemaVersion }],
      },
    },
  };
  const packageJson = { name: "rental-price-agent", version, engines: { node: manifest.nodeRange }, dependencies: { playwright: "1.60.0" } };
  const lockfile = { name: "rental-price-agent", version, lockfileVersion: 3, requires: true, packages: {
    "": { ...packageJson, dependencies: { playwright: "1.60.0" } },
    "node_modules/playwright": { version: "1.60.0" },
  } };
  for (const [name, value] of Object.entries({
    "SKILL.md": "# Fixture " + version + "\n", "config.example.json": JSON.stringify(config(schemaVersion)) + "\n",
    "package.json": JSON.stringify(packageJson) + "\n", "package-lock.json": JSON.stringify(lockfile) + "\n",
    "release-manifest.json": JSON.stringify(manifest) + "\n",
  })) fs.writeFileSync(path.join(target, name), value);
  fs.mkdirSync(path.join(target, "scripts"));
  fs.writeFileSync(path.join(target, "scripts", "lifecycle.js"), "module.exports = {};\n");
  fs.mkdirSync(path.join(target, "scripts", "lib"));
  if (!options.omitMigrationDefinition) {
    const definition = options.migrationDefinition || targetMigrationDefinition(options.sourceSchemaVersion || schemaVersion, schemaVersion, options.marker);
    fs.writeFileSync(path.join(target, "scripts", "lib", "target-migration.json"), typeof definition === "string" ? definition : JSON.stringify(definition) + "\n");
  }
  fs.mkdirSync(path.join(target, "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(target, "node_modules", "playwright", "package.json"), JSON.stringify({ name: "playwright", version: "1.60.0" }));
}

async function installedFixture(helpers, name) {
  const fixture = await helpers.createLifecycleFixture({ name });
  const target = path.join(fixture.root, "agent");
  const layout = getInstallLayout(target);
  for (const candidate of [fixture.paths.active, fixture.paths.staging, fixture.paths.previous]) fs.rmSync(candidate, { recursive: true, force: true });
  writeRelease(target, "1.0.0");
  fs.mkdirSync(layout.dataRoot, { recursive: true });
  fs.writeFileSync(layout.configPath, JSON.stringify(config(), null, 2) + "\n");
  fs.mkdirSync(layout.tasksDir);
  fs.writeFileSync(path.join(layout.tasksDir, "_index.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", tasks: [] }));
  await writeInstallReceipt({
    targetDir: target,
    source: { owner: "lcc0628", repo: "rental-price-agent", tag: "v1.0.0", asset: "rental-price-agent-v1.0.0.tgz", sha256: "1".repeat(64) },
    browser: { policy: { source: "chrome", allowFallback: false }, selectedSource: "chrome", version: "149.0.0.0" },
  });
  return { fixture, target, layout };
}

function options(installed, overrides = {}) {
  return {
    targetDir: installed.target, repo: REPO, tag: "v2.0.0", browserSource: "chrome", platform: "win32",
    operationId: "todo12-operation", run() { return { status: 0, stdout: "", stderr: "" }; },
    probeBrowserPolicy: async policy => ({ ok: true, selectedSource: policy.source, version: "149.0.0.0", executablePath: "C:\\fixture\\browser.exe", probes: {} }),
    requestDaemonDrain: async () => ({ drained: true, code: "DAEMON_ALREADY_STOPPED" }),
    stopValidatedDaemon: async () => ({ stopped: false, code: "DAEMON_ALREADY_STOPPED" }),
    verifyProfileReleased: async () => ({ released: true }), sleep: async () => {},
    runDoctor: async () => ({ blockers: [], warnings: [] }),
    stageGiteeRelease: async stage => {
      writeRelease(stage.stagingDir, overrides.targetVersion || "2.0.0", overrides.targetSchemaVersion || "1.0.0", {
        sourceSchemaVersion: overrides.sourceSchemaVersion,
        migrationDefinition: overrides.migrationDefinition,
        omitMigrationDefinition: overrides.omitMigrationDefinition,
        marker: overrides.migrationMarker,
      });
      return { archiveName: "rental-price-agent-v2.0.0.tgz", sha256: "2".repeat(64), stagingDir: stage.stagingDir };
    },
    ...overrides,
  };
}

async function crashAt(installed, phase, overrides = {}) {
  await require("assert").rejects(lifecycle.runUpgrade(options(installed, {
    ...overrides,
    onPhase(current) {
      if (current === phase) {
        const error = new Error("crash");
        error.code = "EINJECTED_CRASH";
        error.simulatedCrash = true;
        throw error;
      }
    },
  })), error => error.code === "EINJECTED_CRASH");
  return JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
}

module.exports.register = async function register({ test, assert, helpers }) {
  test("upgrade-journal-path-substitution-fails-closed-and-preserves-all-trees", async () => {
    const fields = ["targetDir", "dataRoot", "stagingDir", "previousDir", "retainedPreviousDir", "temporaryDataRoot", "dataBackupRoot", "receiptPath", "restartMarkerPath", "journalPath"];
    for (const field of fields) {
      const installed = await installedFixture(helpers, "upgrade-path-substitution-" + field.toLowerCase());
      const journal = await crashAt(installed, "staged");
      const victim = path.join(installed.fixture.root, "user-documents");
      fs.mkdirSync(victim);
      fs.writeFileSync(path.join(victim, "sentinel.txt"), "keep");
      const activeHash = hashReleaseTree(installed.target);
      const stagingDir = journal.stagingDir;
      const stagingHash = hashReleaseTree(stagingDir);
      const configHash = hashPath(installed.layout.configPath);
      journal[field] = victim;
      fs.writeFileSync(installed.layout.journalPath, JSON.stringify(journal, null, 2) + "\n");
      await assert.rejects(lifecycle.runUpgrade(options(installed, { recoverOnly: true })), error => error.code === "LIFECYCLE_JOURNAL_PATH_MISMATCH", field);
      assert.equal(fs.readFileSync(path.join(victim, "sentinel.txt"), "utf8"), "keep", field);
      assert.equal(hashReleaseTree(installed.target), activeHash, field);
      assert.equal(hashReleaseTree(stagingDir), stagingHash, field);
      assert.equal(hashPath(installed.layout.configPath), configHash, field);
    }
  });

  test("upgrade-journal-tree-metadata-substitution-and-ambiguity-preserve-candidates", async () => {
    const substituted = await installedFixture(helpers, "upgrade-tree-substitution");
    const journal = await crashAt(substituted, "staged");
    writeRelease(journal.stagingDir, "9.9.9");
    journal.targetVersion = "9.9.9";
    journal.targetTreeSha256 = hashReleaseTree(journal.stagingDir);
    fs.writeFileSync(substituted.layout.journalPath, JSON.stringify(journal, null, 2) + "\n");
    await assert.rejects(lifecycle.runUpgrade(options(substituted, { recoverOnly: true })), error => error.code === "LIFECYCLE_JOURNAL_MALFORMED");
    assert.equal(fs.existsSync(journal.stagingDir), true);

    const receiptSubstitution = await installedFixture(helpers, "upgrade-receipt-substitution");
    const receiptJournal = await crashAt(receiptSubstitution, "staged");
    receiptJournal.sourceReceipt.source.asset = "attacker-selected.tgz";
    receiptJournal.targetSource.sha256 = "9".repeat(64);
    fs.writeFileSync(receiptSubstitution.layout.journalPath, JSON.stringify(receiptJournal, null, 2) + "\n");
    await assert.rejects(lifecycle.runUpgrade(options(receiptSubstitution, { recoverOnly: true })), error => error.code === "LIFECYCLE_JOURNAL_MALFORMED");
    assert.equal(fs.existsSync(receiptSubstitution.target), true);
    assert.equal(fs.existsSync(receiptJournal.stagingDir), true);

    const ambiguous = await installedFixture(helpers, "upgrade-tree-ambiguous");
    const ambiguousJournal = await crashAt(ambiguous, "staged");
    fs.cpSync(ambiguous.target, ambiguousJournal.previousDir, { recursive: true });
    await assert.rejects(lifecycle.runUpgrade(options(ambiguous, { recoverOnly: true })), error => error.code === "UPGRADE_RECOVERY_AMBIGUOUS");
    assert.equal(fs.existsSync(ambiguous.target), true);
    assert.equal(fs.existsSync(ambiguousJournal.stagingDir), true);
    assert.equal(fs.existsSync(ambiguousJournal.previousDir), true);
  });

  test("upgrade-rejects-live-and-migrated-schema-versions-outside-target-ranges-before-activation", async () => {
    const live = await installedFixture(helpers, "upgrade-schema-live");
    const liveHash = hashReleaseTree(live.target);
    await assert.rejects(lifecycle.runUpgrade(options(live, { targetSchemaVersion: "2.0.0" })), error => error.code === "TARGET_SCHEMA_INCOMPATIBLE");
    assert.equal(hashReleaseTree(live.target), liveHash);
    assert.equal(JSON.parse(fs.readFileSync(live.layout.configPath, "utf8")).configSchemaVersion, "1.0.0");

    const migrated = await installedFixture(helpers, "upgrade-schema-migrated");
    await assert.rejects(lifecycle.runUpgrade(options(migrated, {
      migrationDefinition: targetMigrationDefinition("1.0.0", "9.0.0", "invalid-target"),
    })), error => error.code === "TARGET_MIGRATION_DEFINITION_INVALID");
    assert.equal(fs.existsSync(migrated.target), true);
  });

  test("upgrade-runs-only-the-verified-target-migration-and-persists-all-managed-json", async () => {
    const installed = await installedFixture(helpers, "upgrade-target-migration-persisted");
    const documents = [["task.json", { stateSchemaVersion: "1.0.0", taskId: "task", status: "completed", history: [], evidence: [], results: {} }]];
    for (const [name, value] of documents) fs.writeFileSync(path.join(installed.layout.tasksDir, name), JSON.stringify(value) + "\n");
    fs.mkdirSync(installed.layout.batchesDir);
    fs.writeFileSync(path.join(installed.layout.batchesDir, "batch.json"), JSON.stringify({ stateSchemaVersion: "1.0.0", batchId: "batch", status: "completed", spec: {}, total: 0, completed: [], previewOnly: [], verifyFailed: [], failed: [] }) + "\n");
    const recoveryFiles = [
      [path.join(installed.layout.tasksDir, "changes_task.json"), Buffer.from('{\n  "__broadcast": true,\n  "stock": "5"\n}\n')],
      [path.join(installed.layout.batchesDir, "changes_batch.json"), Buffer.from('{"sku-basic":{"dailyPrice":"12.50"}}\n')],
    ];
    for (const [filePath, bytes] of recoveryFiles) fs.writeFileSync(filePath, bytes);

    const result = await lifecycle.runUpgrade(options(installed, {
      targetSchemaVersion: "2.0.0",
      sourceSchemaVersion: "1.0.0",
      migrationMarker: "target-v2",
    }));
    assert.equal(result.code, "UPGRADE_OK");
    const managed = [installed.layout.configPath, path.join(installed.layout.tasksDir, "_index.json"), ...documents.map(([name]) => path.join(installed.layout.tasksDir, name)), path.join(installed.layout.batchesDir, "batch.json")];
    for (const filePath of managed) {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      assert.equal(value.configSchemaVersion || value.stateSchemaVersion, "2.0.0", filePath);
      assert.equal(value.migratedBy, "target-v2", filePath);
    }
    for (const [filePath, bytes] of recoveryFiles) {
      assert.deepEqual(fs.readFileSync(filePath), bytes, filePath);
      assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).stateSchemaVersion, undefined, filePath);
    }
    const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
    assert.deepEqual(journal.dataFiles.map(file => file.relativePath), [
      "config.json",
      "tasks/_index.json",
      "tasks/batches/batch.json",
      "tasks/batches/changes_batch.json",
      "tasks/changes_task.json",
      "tasks/task.json",
    ]);
    const recoveryInventory = journal.dataFiles.filter(file => file.kind === "recovery");
    const recoveryMigrations = journal.migrations.filter(file => file.kind === "recovery");
    assert.equal(recoveryInventory.length, 2);
    assert.equal(recoveryMigrations.length, 2);
    assert.ok(recoveryInventory.every(file => file.schemaVersion === null && file.sha256 === file.targetSha256));
    assert.ok(recoveryMigrations.every(file => file.sourceVersion === null && file.targetVersion === null));
  });

  test("upgrade-rejects-malformed-schema-less-recovery-before-activation", async () => {
    const installed = await installedFixture(helpers, "upgrade-malformed-schema-less-recovery");
    const recoveryPath = path.join(installed.layout.tasksDir, "changes_bad.json");
    const malformed = Buffer.from("{}\n");
    fs.writeFileSync(recoveryPath, malformed);
    const activeHash = hashReleaseTree(installed.target);

    await assert.rejects(lifecycle.runUpgrade(options(installed)), error => error.code === "TARGET_MIGRATION_INPUT_INVALID" && error.message === "Managed recovery data is malformed");

    assert.equal(hashReleaseTree(installed.target), activeHash);
    assert.deepEqual(fs.readFileSync(recoveryPath), malformed);
  });

  test("upgrade-rejects-missing-malformed-unsafe-cyclic-and-unknown-target-migration-definitions", async () => {
    const missing = await installedFixture(helpers, "upgrade-migration-definition-missing");
    await assert.rejects(lifecycle.runUpgrade(options(missing, { omitMigrationDefinition: true })), error => error.code === "TARGET_MIGRATION_DEFINITION_INVALID");
    assert.equal(JSON.parse(fs.readFileSync(missing.layout.configPath, "utf8")).configSchemaVersion, "1.0.0");

    const invalidDefinitions = [
      ["malformed", "{not-json"],
      ["unknown", { ...targetMigrationDefinition("1.0.0", "2.0.0"), executable: "module.exports = process" }],
      ["unsafe-pointer", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: [{ domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "2.0.0", operations: [{ op: "add", path: "/__proto__/polluted", value: true }] }] }],
      ["cyclic", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: [{ domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "2.0.0", operations: [] }, { domain: "configSchema", kinds: ["config"], from: "2.0.0", to: "1.0.0", operations: [] }] }],
      ["ambiguous", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: [{ domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "2.0.0", operations: [] }, { domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "3.0.0", operations: [] }] }],
      ["recovery-kind", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: [{ domain: "stateSchema", kinds: ["recovery"], from: "1.0.0", to: "2.0.0", operations: [{ op: "replace", path: "/stateSchemaVersion", value: "2.0.0" }] }] }],
      ["unknown-operation", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: [{ domain: "configSchema", kinds: ["config"], from: "1.0.0", to: "2.0.0", operations: [{ op: "execute", path: "/configSchemaVersion" }] }] }],
      ["too-many-steps", { ...targetMigrationDefinition("1.0.0", "2.0.0"), steps: Array.from({ length: 65 }, (_, index) => ({ domain: "configSchema", kinds: ["config"], from: "1.0." + index, to: "1.0." + (index + 1), operations: [] })) }],
      ["oversized", " ".repeat(256 * 1024 + 1)],
    ];
    for (const [name, migrationDefinition] of invalidDefinitions) {
      const installed = await installedFixture(helpers, "upgrade-migration-definition-" + name);
      await assert.rejects(lifecycle.runUpgrade(options(installed, { targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationDefinition })), error => error.code === "TARGET_MIGRATION_DEFINITION_INVALID", name);
      assert.equal(JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8")).configSchemaVersion, "1.0.0", name);
    }
  });

  test("upgrade-keeps-code-shaped-migration-values-inert", async () => {
    const installed = await installedFixture(helpers, "upgrade-migration-code-shaped-data");
    const payload = "require.constructor('return process')().__targetMigrationEscape = 'escaped'";
    delete process.__targetMigrationEscape;
    const result = await lifecycle.runUpgrade(options(installed, {
      targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationMarker: payload,
    }));
    assert.equal(result.code, "UPGRADE_OK");
    assert.equal(JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8")).migratedBy, payload);
    assert.equal(process.__targetMigrationEscape, undefined);
  });

  test("upgrade-applies-the-supported-declarative-operation-subset", async () => {
    const installed = await installedFixture(helpers, "upgrade-migration-operation-subset");
    const original = JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8"));
    original.legacyMarker = "remove-me";
    fs.writeFileSync(installed.layout.configPath, JSON.stringify(original, null, 2) + "\n");
    const definition = targetMigrationDefinition("1.0.0", "2.0.0", "subset-v2");
    definition.steps[0].operations.unshift(
      { op: "test", path: "/legacyMarker", value: "remove-me" },
      { op: "remove", path: "/legacyMarker" },
    );
    definition.steps[0].operations.splice(2, 0, { op: "add", path: "/nested", value: { enabled: false } });
    definition.steps[0].operations.push({ op: "replace", path: "/nested/enabled", value: true });
    const result = await lifecycle.runUpgrade(options(installed, {
      targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationDefinition: definition,
    }));
    assert.equal(result.code, "UPGRADE_OK");
    const migrated = JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8"));
    assert.equal(migrated.configSchemaVersion, "2.0.0");
    assert.equal(migrated.legacyMarker, undefined);
    assert.deepEqual(migrated.nested, { enabled: true });
    assert.equal(migrated.migratedBy, "subset-v2");
  });

  test("upgrade-data-commit-crashes-and-post-check-failure-restore-original-bytes", async () => {
    for (const phase of ["data-backup-planned", "data-backed-up", "data-install-planned", "data-installed"]) {
      const installed = await installedFixture(helpers, "upgrade-data-crash-" + phase);
      const original = fs.readFileSync(installed.layout.configPath);
      fs.mkdirSync(installed.layout.batchesDir);
      const recoveryFiles = [
        [path.join(installed.layout.tasksDir, "changes_task.json"), Buffer.from('{"__broadcast":true,"stock":"5"}\n')],
        [path.join(installed.layout.batchesDir, "changes_batch.json"), Buffer.from('{\n  "sku-basic": { "dailyPrice": "12.50" }\n}\n')],
      ];
      for (const [filePath, bytes] of recoveryFiles) fs.writeFileSync(filePath, bytes);
      await crashAt(installed, phase, { targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationMarker: "target-v2" });
      await lifecycle.runUpgrade({ ...options(installed), recoverOnly: true });
      assert.deepEqual(fs.readFileSync(installed.layout.configPath), original, phase);
      for (const [filePath, bytes] of recoveryFiles) assert.deepEqual(fs.readFileSync(filePath), bytes, phase + ":" + filePath);
    }
    const failedDoctor = await installedFixture(helpers, "upgrade-data-doctor-rollback");
    const original = fs.readFileSync(failedDoctor.layout.configPath);
    await assert.rejects(lifecycle.runUpgrade(options(failedDoctor, {
      targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationMarker: "target-v2",
      postActivationDoctor: async () => ({ blockers: ["BROKEN_TARGET"], warnings: [] }),
    })), error => error.code === "POST_ACTIVATION_CHECK_FAILED");
    assert.deepEqual(fs.readFileSync(failedDoctor.layout.configPath), original);
  });

  test("upgrade-consecutive-v1-v2-v3-cleans-committed-journal-and-retains-v2-only", async () => {
    const installed = await installedFixture(helpers, "upgrade-sequential-v1-v2-v3");
    await lifecycle.runUpgrade(options(installed, { targetSchemaVersion: "2.0.0", sourceSchemaVersion: "1.0.0", migrationMarker: "target-v2" }));
    assert.equal(JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8")).migratedBy, "target-v2");
    const second = await lifecycle.runUpgrade(options(installed, {
      tag: "v3.0.0", targetVersion: "3.0.0", operationId: "todo12-operation-v3",
      targetSchemaVersion: "3.0.0", sourceSchemaVersion: "2.0.0", migrationMarker: "target-v3",
      stageGiteeRelease: async stage => {
        writeRelease(stage.stagingDir, "3.0.0", "3.0.0", { sourceSchemaVersion: "2.0.0", marker: "target-v3" });
        return { archiveName: "rental-price-agent-v3.0.0.tgz", sha256: "3".repeat(64), stagingDir: stage.stagingDir };
      },
    }));
    assert.equal(second.version, "3.0.0");
    assert.equal(JSON.parse(fs.readFileSync(installed.layout.configPath, "utf8")).migratedBy, "target-v3");
    assert.equal(JSON.parse(fs.readFileSync(path.join(installed.target + ".previous", "package.json"), "utf8")).version, "2.0.0");
  });

  test("upgrade-rejects-unknown-or-impossible-journal-enums-and-transition-history", async () => {
    const mutations = [
      journal => { journal.phase = "future-phase"; },
      journal => { journal.status = "future-status"; },
      journal => { journal.status = "committed"; },
      journal => { journal.transitionHistory = ["locked", "staged"]; },
      journal => { journal.schemaVersion = lifecycle.JOURNAL_SCHEMA_VERSION + 1; },
    ];
    for (let index = 0; index < mutations.length; index++) {
      const installed = await installedFixture(helpers, "upgrade-journal-enum-" + index);
      const journal = await crashAt(installed, "staged");
      mutations[index](journal);
      fs.writeFileSync(installed.layout.journalPath, JSON.stringify(journal, null, 2) + "\n");
      await assert.rejects(lifecycle.runUpgrade(options(installed, { recoverOnly: true })), error => error.code === "LIFECYCLE_JOURNAL_MALFORMED");
      assert.equal(fs.existsSync(installed.target), true);
      assert.equal(fs.existsSync(journal.stagingDir), true);
    }
  });

  test("upgrade-parent-fsync-failure-recovers-without-claiming-commit", async () => {
    for (const boundary of ["journal", "release-rename", "receipt", "marker"]) {
      const installed = await installedFixture(helpers, "upgrade-parent-fsync-" + boundary);
      const originalHash = hashReleaseTree(installed.target);
      let injected = false;
      let armed = boundary === "journal" || boundary === "release-rename";
      await assert.rejects(lifecycle.runUpgrade(options(installed, {
        onPhase(phase) {
          if (boundary === "receipt" && phase === "receipt-write-planned") armed = true;
          if (boundary === "marker" && phase === "restart-write-planned") armed = true;
        },
        fsyncParent(directory) {
          const releaseParent = path.resolve(directory) === path.dirname(installed.target);
          const dataParent = path.resolve(directory) === installed.layout.dataRoot;
          const matches = boundary === "release-rename" ? releaseParent : dataParent;
          if (!injected && armed && matches) {
            injected = true;
            const error = new Error("fsync failed");
            error.code = "EIO";
            throw error;
          }
        },
      })), error => error.code === "PARENT_FSYNC_FAILED", boundary);
      assert.equal(injected, true, boundary);
      assert.equal(hashReleaseTree(installed.target), originalHash, boundary);
      const journal = JSON.parse(fs.readFileSync(installed.layout.journalPath, "utf8"));
      assert.notEqual(journal.status, "committed", boundary);
    }
  });
};
