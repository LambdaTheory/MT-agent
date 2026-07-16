const fs = require("fs");
const os = require("os");
const path = require("path");

async function register({ test, assert, helpers }) {
  const migrations = require(path.join(__dirname, "..", "..", "..", "scripts", "lib", "migrations.js"));
  const base = name => JSON.parse(fs.readFileSync(path.join(helpers.fixturesRoot, "base", name), "utf8"));
  const legacyConfig = (overrides = {}) => ({
    saas: { baseUrl: "http://127.0.0.1/fixture" }, selectors: {}, vas: {}, rules: {},
    taskStorage: { directory: "./tasks" }, browser: { source: "chrome", allowFallback: false, headless: true }, mirror: {},
    ...overrides,
  });

  test("config-migration-preserves-unknown-keys", () => {
    const legacy = base("sanitized-config.json");
    delete legacy.configSchemaVersion;
    legacy.extension = { nested: { keep: true }, list: [1, 2, 3] };
    const original = JSON.parse(JSON.stringify(legacy));
    const result = migrations.migrateConfig(legacy);
    assert.equal(result.sourceVersion, migrations.LEGACY_SCHEMA_VERSION);
    assert.equal(result.targetVersion, migrations.CURRENT_CONFIG_SCHEMA_VERSION);
    assert.equal(result.value.configSchemaVersion, migrations.CURRENT_CONFIG_SCHEMA_VERSION);
    assert.deepEqual(result.value.extension, original.extension);
    assert.deepEqual(legacy, original);
    assert.deepEqual(migrations.migrateConfig(result.value).value, result.value);
    helpers.recordProof("configUnknownKeysPreserved", true);
  });

  test("state-migration-task-and-batch-fixtures", () => {
    for (const [name, kind] of [["legacy-task-state.json", "task"], ["legacy-batch-state.json", "batch"]]) {
      const legacy = base(name);
      const result = migrations.migrateState(legacy, { kind });
      assert.equal(result.value.stateSchemaVersion, migrations.CURRENT_STATE_SCHEMA_VERSION);
      assert.deepEqual(result.value.extension, legacy.extension);
      assert.deepEqual(migrations.migrateState(result.value, { kind }).value, result.value);
    }
    const index = migrations.migrateState([{ taskId: "task_fixture", instruction: "fixture", status: "planned", createdAt: "2026-01-01T00:00:00.000Z", extension: "keep" }], { kind: "task-index" });
    assert.equal(index.value.stateSchemaVersion, migrations.CURRENT_STATE_SCHEMA_VERSION);
    assert.equal(index.value.tasks[0].extension, "keep");
    const currentIndex = { stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA_VERSION, tasks: [], extension: { keep: true } };
    assert.deepEqual(migrations.migrateState(currentIndex, { kind: "task-index" }).value.extension, { keep: true });
    helpers.recordProof("taskBatchFixturesMigrated", true);
  });

  test("migration-future-and-unsupported-gap-rejection", () => {
    assert.throws(() => migrations.migrateConfig({ ...legacyConfig(), configSchemaVersion: "2.0.0" }), error => error.code === "FUTURE_SCHEMA_VERSION");
    assert.throws(() => migrations.migrateState({ stateSchemaVersion: "0.5.0", taskId: "task_gap", instruction: "fixture", changes: {}, createdAt: "2026-01-01T00:00:00.000Z", status: "planned", history: [], evidence: [], results: {} }, { kind: "task" }), error => error.code === "UNSUPPORTED_SCHEMA_GAP");
    assert.equal(migrations.checkSchemaCompatibility("config", "1.0.0").status, "current");
    assert.equal(migrations.checkSchemaCompatibility("state", undefined).status, "migration-required");
  });

  test("migration-malformed-object-rejection", () => {
    for (const malformed of [null, [], "bad", 1]) {
      assert.throws(() => migrations.migrateConfig(malformed), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    }
    assert.throws(() => migrations.migrateConfig({ browser: [] }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    assert.throws(() => migrations.migrateState({}, { kind: "unknown" }), error => error.code === "UNSUPPORTED_STATE_KIND");
  });

  test("current-config-validator-requires-sections-and-operation-critical-field-types", () => {
    const valid = {
      configSchemaVersion: migrations.CURRENT_CONFIG_SCHEMA_VERSION,
      saas: { baseUrl: "https://fixture.invalid", loginUrl: "https://fixture.invalid/login", productDetailUrl: "https://fixture.invalid/product/{productId}", credentials: { username: "${USER}", password: "${PASS}" } },
      selectors: {}, vas: {}, rules: { maxBatchSize: 20 }, taskStorage: { directory: "./tasks" },
      browser: { source: "chrome", allowFallback: false, headless: true }, mirror: { baseUrl: "https://mirror.invalid", apiKey: "${KEY}" },
      extension: { keep: true },
    };
    assert.equal(migrations.validateConfig(valid), valid);
    for (const field of ["saas", "selectors", "vas", "rules", "taskStorage", "browser", "mirror"]) {
      const missing = { ...valid };
      delete missing[field];
      assert.throws(() => migrations.validateConfig(missing), error => error.code === "MALFORMED_MIGRATION_OBJECT", field + " missing");
      assert.throws(() => migrations.validateConfig({ ...valid, [field]: [] }), error => error.code === "MALFORMED_MIGRATION_OBJECT", field + " wrong type");
    }
    const wrongFields = [
      value => { value.saas.baseUrl = 1; }, value => { value.saas.credentials = []; },
      value => { value.rules.maxBatchSize = "20"; }, value => { value.taskStorage.directory = 1; },
      value => { value.browser.source = false; }, value => { value.browser.allowFallback = "false"; },
      value => { value.browser.headless = "true"; }, value => { value.mirror.apiKey = 1; },
    ];
    for (const mutate of wrongFields) {
      const value = JSON.parse(JSON.stringify(valid));
      mutate(value);
      assert.throws(() => migrations.validateConfig(value), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    }
    assert.throws(() => migrations.validateConfig({ ...valid, configSchemaVersion: "0.9.0" }), error => error.code === "MALFORMED_SCHEMA_VERSION");
  });

  test("current-task-and-index-validators-enforce-complete-persisted-contracts", () => {
    const task = {
      stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA_VERSION, taskId: "task_fixture", instruction: "fixture", changes: {},
      createdAt: "2026-01-01T00:00:00.000Z", status: "planned",
      history: [{ timestamp: "2026-01-01T00:00:00.000Z", action: "created", status: "planned" }],
      evidence: [{ type: "verify_result", path: "evidence.json", timestamp: "2026-01-01T00:00:01.000Z" }], results: {}, extension: true,
    };
    assert.equal(migrations.validateTask(task), task);
    for (const field of ["taskId", "instruction", "changes", "createdAt", "status", "history", "evidence", "results"]) {
      const missing = { ...task };
      delete missing[field];
      assert.throws(() => migrations.validateTask(missing), error => error.code === "MALFORMED_MIGRATION_OBJECT", field + " missing");
    }
    const wrongTaskFields = {
      instruction: 1, changes: [], createdAt: 1, status: "invented", history: {}, evidence: {}, results: [],
    };
    for (const [field, wrong] of Object.entries(wrongTaskFields)) {
      assert.throws(() => migrations.validateTask({ ...task, [field]: wrong }), error => error.code === "MALFORMED_MIGRATION_OBJECT", field);
    }
    assert.throws(() => migrations.validateTask({ ...task, history: [{}] }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    assert.throws(() => migrations.validateTask({ ...task, evidence: [{}] }), error => error.code === "MALFORMED_MIGRATION_OBJECT");

    const entry = { taskId: task.taskId, instruction: task.instruction, status: task.status, createdAt: task.createdAt, extension: true };
    const index = { stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA_VERSION, tasks: [entry], extension: true };
    assert.equal(migrations.validateTaskIndex(index), index);
    for (const field of ["taskId", "instruction", "status", "createdAt"]) {
      const malformedEntry = { ...entry };
      delete malformedEntry[field];
      assert.throws(() => migrations.validateTaskIndex({ ...index, tasks: [malformedEntry] }), error => error.code === "MALFORMED_MIGRATION_OBJECT", field);
    }
    assert.throws(() => migrations.validateTaskIndex({ ...index, tasks: [{ ...entry, status: "invented" }] }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
  });

  test("current-batch-and-recovery-validators-reject-incomplete-or-arbitrary-objects", () => {
    const batch = {
      stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA_VERSION, batchId: "batch_fixture", status: "running", spec: { items: [] }, total: 0,
      completed: [], previewOnly: [], verifyFailed: [], failed: [], current: null, inFlight: null,
      startedAt: "2026-01-01T00:00:00.000Z", extension: true,
    };
    assert.equal(migrations.validateBatch(batch), batch);
    for (const field of ["batchId", "status", "spec", "total", "completed", "previewOnly", "verifyFailed", "failed", "current", "inFlight", "startedAt"]) {
      const missing = { ...batch };
      delete missing[field];
      assert.throws(() => migrations.validateBatch(missing), error => error.code === "MALFORMED_MIGRATION_OBJECT", field + " missing");
    }
    assert.throws(() => migrations.validateBatch({ ...batch, status: "invented" }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    assert.throws(() => migrations.validateBatch({ ...batch, current: {} }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    assert.throws(() => migrations.validateBatch({ ...batch, inFlight: {} }), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    assert.throws(() => migrations.validateBatch({ ...batch, completed: [{}] }), error => error.code === "MALFORMED_MIGRATION_OBJECT");

    const recovery = { __broadcast: true, stock: "5", extensionField: "keep" };
    assert.equal(migrations.validateRecovery(recovery), recovery);
    for (const malformed of [null, [], {}, { arbitrary: true }, { __broadcast: false, stock: "5" }, { __broadcast: true }]) {
      assert.throws(() => migrations.validateRecovery(malformed), error => error.code === "MALFORMED_MIGRATION_OBJECT");
    }
  });

  test("migration-partial-step-throw-is-copy-only", () => {
    const input = legacyConfig({ extension: { keep: true } });
    const before = JSON.stringify(input);
    const throwingMaps = {
      config: new Map([[migrations.LEGACY_SCHEMA_VERSION, {
        to: migrations.CURRENT_CONFIG_SCHEMA_VERSION,
        migrate(value) {
          value.extension.keep = false;
          throw new Error("injected partial step");
        },
      }]]),
    };
    assert.throws(() => migrations.migrateConfig(input, { migrationMaps: throwingMaps }), /injected partial step/);
    assert.equal(JSON.stringify(input), before);
  });

  test("migration-interruption", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-interrupt-"));
    const filePath = path.join(root, "config.json");
    const legacy = legacyConfig({ extension: { keep: true } });
    const originalBytes = JSON.stringify(legacy, null, 4) + "\n";
    fs.writeFileSync(filePath, originalBytes);
    const adapter = Object.create(fs);
    adapter.renameSync = () => { const error = new Error("injected rename interruption"); error.code = "EINTR"; throw error; };
    try {
      assert.throws(() => migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter }), error => error.code === "EINTR");
      assert.equal(fs.readFileSync(filePath, "utf8"), originalBytes);
      assert.deepEqual(fs.readdirSync(root), ["config.json"]);
      assert.throws(() => migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter }), error => error.code === "EINTR");
      assert.equal(fs.readFileSync(filePath, "utf8"), originalBytes);
      helpers.recordProof("migrationFailureOriginalByteIdentical", helpers.sha256(originalBytes));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration-file-idempotency-and-determinism", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-idempotent-"));
    const filePath = path.join(root, "state.json");
    fs.writeFileSync(filePath, JSON.stringify(base("legacy-batch-state.json"), null, 2) + "\n");
    try {
      const first = migrations.migrateJsonFile(filePath, { domain: "state", kind: "batch" });
      const firstBytes = fs.readFileSync(filePath);
      const firstHash = helpers.sha256(firstBytes);
      const second = migrations.migrateJsonFile(filePath, { domain: "state", kind: "batch" });
      assert.equal(first.changed, true);
      assert.equal(second.changed, false);
      assert.equal(helpers.sha256(fs.readFileSync(filePath)), firstHash);
      assert.equal(first.sourceVersion, migrations.LEGACY_SCHEMA_VERSION);
      assert.equal(first.targetVersion, migrations.CURRENT_STATE_SCHEMA_VERSION);
      helpers.recordProof("migrationDeterministicHash", firstHash);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration-lock-rejects-competing-migrator-and-cleans-owner-lock", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-lock-"));
    const filePath = path.join(root, "config.json");
    const lockPath = filePath + ".migration.lock";
    const legacy = legacyConfig();
    fs.writeFileSync(filePath, JSON.stringify(legacy) + "\n");
    const adapter = Object.create(fs);
    let competed = false;
    adapter.fsyncSync = descriptor => {
      if (!competed && fs.fstatSync(descriptor).isFile()) {
        competed = true;
        assert.throws(
          () => migrations.migrateJsonFile(filePath, { domain: "config" }),
          error => error.code === "MIGRATION_LOCKED" && error.details.owner.ownerPid === process.pid,
        );
      }
      return fs.fsyncSync(descriptor);
    };
    try {
      migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter });
      assert.equal(fs.existsSync(lockPath), false);
      assert.deepEqual(fs.readdirSync(root), ["config.json"]);
      helpers.recordProof("migrationCompetingMigratorRejected", true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration-release-failure-is-domain-typed-and-primary-errors-remain-primary", () => {
    for (const malformed of [false, true]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-release-failure-"));
      const filePath = path.join(root, "config.json");
      const lockPath = filePath + ".migration.lock";
      fs.writeFileSync(filePath, malformed ? "{malformed" : JSON.stringify(legacyConfig()) + "\n");
      const lockFs = Object.create(fs);
      lockFs.rmSync = () => { throw Object.assign(new Error("injected release removal"), { code: "EIO" }); };
      try {
        assert.throws(
          () => migrations.migrateJsonFile(filePath, { domain: "config", lockFs }),
          error => {
            assert.equal(error.code, malformed ? "MALFORMED_MIGRATION_JSON" : "MIGRATION_LOCK_RELEASE_FAILED");
            assert.equal(error.details.lockReleaseFailure.stage, "claim-removal");
            if (!malformed) {
              assert.equal(error.details.operationCommitted, true);
              assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).configSchemaVersion, migrations.CURRENT_CONFIG_SCHEMA_VERSION);
            }
            return true;
          },
        );
        assert.equal(fs.existsSync(lockPath), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("migration-lock-recovers-one-bounded-stale-owner", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-stale-lock-"));
    const filePath = path.join(root, "config.json");
    const lockPath = filePath + ".migration.lock";
    fs.writeFileSync(filePath, JSON.stringify(legacyConfig()) + "\n");
    const processInspector = {
      inspectSync(pid) {
        if (pid === process.pid) return { exists: true, creationToken: "migration-test-runner" };
        return { exists: false };
      },
    };
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1, lockKind: "migration", lockPath, ownerPid: 999999,
      processCreationToken: "dead-migration-process", ownerToken: "stale-owner-token-0001",
      operationId: "stale-migration-operation", acquiredAt: new Date(1).toISOString(),
      heartbeatAt: new Date(1).toISOString(), resourcePath: path.resolve(filePath),
    }));
    try {
      const result = migrations.migrateJsonFile(filePath, { domain: "config", processInspector });
      assert.equal(result.changed, true);
      assert.equal(fs.existsSync(lockPath), false);
      assert.deepEqual(fs.readdirSync(root), ["config.json"]);
      helpers.recordProof("migrationStaleLockRecovered", true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    for (const ownerContent of [null, "{malformed"]) {
      const ownerlessRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-ownerless-lock-"));
      const ownerlessFilePath = path.join(ownerlessRoot, "config.json");
      const ownerlessLockPath = ownerlessFilePath + ".migration.lock";
      fs.writeFileSync(ownerlessFilePath, JSON.stringify(legacyConfig()) + "\n");
      fs.mkdirSync(ownerlessLockPath);
      if (ownerContent !== null) fs.writeFileSync(path.join(ownerlessLockPath, "owner.json"), ownerContent);
      fs.utimesSync(ownerlessLockPath, new Date(1), new Date(1));
      try {
        assert.throws(
          () => migrations.migrateJsonFile(ownerlessFilePath, { domain: "config", processInspector }),
          error => error.code === "LOCK_RECOVERY_REQUIRED",
        );
        assert.equal(fs.existsSync(ownerlessLockPath), true);
      } finally {
        fs.rmSync(ownerlessRoot, { recursive: true, force: true });
      }
    }
    helpers.recordProof("migrationOwnerlessLockFailsClosed", true);

    const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-owned-cleanup-"));
    const cleanupFilePath = path.join(cleanupRoot, "config.json");
    const cleanupLockPath = cleanupFilePath + ".migration.lock";
    const staleToken = "stale-operation-token";
    const ownedTemporary = path.join(cleanupRoot, ".config.json.migration-" + staleToken + ".tmp");
    const ownedBackup = path.join(cleanupRoot, ".config.json.backup-" + staleToken + ".tmp");
    const userTemporary = ownedTemporary + ".user";
    const otherOperation = path.join(cleanupRoot, ".config.json.migration-other-operation.tmp");
    const cleanupOriginalBytes = JSON.stringify(legacyConfig()) + "\n";
    fs.writeFileSync(cleanupFilePath, cleanupOriginalBytes);
    fs.mkdirSync(cleanupLockPath);
    fs.writeFileSync(path.join(cleanupLockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1, lockKind: "migration", lockPath: cleanupLockPath, ownerPid: 999999,
      processCreationToken: "dead-cleanup-process", ownerToken: staleToken,
      operationId: "stale-cleanup-operation", acquiredAt: new Date(1).toISOString(),
      heartbeatAt: new Date(1).toISOString(), resourcePath: path.resolve(cleanupFilePath),
    }));
    fs.writeFileSync(ownedTemporary, "owned temporary");
    fs.renameSync(cleanupFilePath, ownedBackup);
    fs.writeFileSync(userTemporary, "user file");
    fs.writeFileSync(otherOperation, "other operation");
    try {
      const result = migrations.migrateJsonFile(cleanupFilePath, { domain: "config", processInspector });
      assert.equal(result.changed, true);
      assert.equal(fs.existsSync(ownedTemporary), false);
      assert.equal(fs.existsSync(ownedBackup), false);
      assert.equal(fs.readFileSync(userTemporary, "utf8"), "user file");
      assert.equal(fs.readFileSync(otherOperation, "utf8"), "other operation");
      assert.equal(fs.existsSync(cleanupLockPath), false);
      helpers.recordProof("migrationExactOwnedArtifactCleanup", true);
    } finally {
      fs.rmSync(cleanupRoot, { recursive: true, force: true });
    }
  });

  test("migration-lock-never-steals-live-lock-older-than-five-minutes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-live-old-lock-"));
    const filePath = path.join(root, "config.json");
    const lockPath = filePath + ".migration.lock";
    const creationToken = "live-migration-owner";
    fs.writeFileSync(filePath, JSON.stringify(legacyConfig()) + "\n");
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      schemaVersion: 1,
      lockKind: "migration",
      lockPath,
      ownerPid: 7302,
      processCreationToken: creationToken,
      ownerToken: "live-migration-token",
      pid: 7302,
      token: "live-migration-token",
      createdAt: 1,
      operationId: "live-migration-operation",
      acquiredAt: new Date(1).toISOString(),
      heartbeatAt: new Date(1).toISOString(),
    }));
    try {
      assert.throws(
        () => migrations.migrateJsonFile(filePath, {
          domain: "config",
          now: () => 10 * 60 * 1000,
          processInspector: { inspectSync: pid => pid === process.pid ? { exists: true, creationToken: "test-runner-process" } : { exists: pid === 7302, creationToken } },
        }),
        error => error.code === "MIGRATION_LOCKED",
      );
      assert.equal(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).ownerToken, "live-migration-token");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration-compare-and-swap-rejects-competing-writer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-cas-"));
    const filePath = path.join(root, "config.json");
    const writerBytes = JSON.stringify(legacyConfig({ saas: { baseUrl: "http://127.0.0.1/writer" }, writer: true }), null, 2) + "\n";
    fs.writeFileSync(filePath, JSON.stringify(legacyConfig()) + "\n");
    const adapter = Object.create(fs);
    let wrote = false;
    adapter.fsyncSync = descriptor => {
      const result = fs.fsyncSync(descriptor);
      if (!wrote && fs.fstatSync(descriptor).isFile()) {
        wrote = true;
        fs.writeFileSync(filePath, writerBytes);
      }
      return result;
    };
    try {
      assert.throws(
        () => migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter }),
        error => error.code === "MIGRATION_SOURCE_CHANGED",
      );
      assert.equal(fs.readFileSync(filePath, "utf8"), writerBytes);
      assert.deepEqual(fs.readdirSync(root), ["config.json"]);
      helpers.recordProof("migrationCompetingWriterRejected", helpers.sha256(writerBytes));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    {
      const finalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-final-cas-"));
      const finalFilePath = path.join(finalRoot, "config.json");
      const finalWriterBytes = JSON.stringify(legacyConfig({ saas: { baseUrl: "http://127.0.0.1/final-writer" }, writer: true }), null, 2) + "\n";
      fs.writeFileSync(finalFilePath, JSON.stringify(legacyConfig()) + "\n");
      const finalAdapter = Object.create(fs);
      let finalWrote = false;
      finalAdapter.renameSync = (source, destination) => {
        if (!finalWrote && source === finalFilePath && destination.includes(".backup-")) {
          const result = fs.renameSync(source, destination);
          fs.writeFileSync(finalFilePath, finalWriterBytes);
          finalWrote = true;
          return result;
        }
        if (!finalWrote && source.includes(".migration-") && destination === finalFilePath) {
          fs.writeFileSync(finalFilePath, finalWriterBytes);
          finalWrote = true;
        }
        return fs.renameSync(source, destination);
      };
      try {
        assert.throws(
          () => migrations.migrateJsonFile(finalFilePath, { domain: "config", fs: finalAdapter }),
          error => error.code === "MIGRATION_SOURCE_CHANGED",
        );
        assert.equal(finalWrote, true);
        assert.equal(fs.readFileSync(finalFilePath, "utf8"), finalWriterBytes);
        assert.deepEqual(fs.readdirSync(finalRoot), ["config.json"]);
        helpers.recordProof("migrationFinalInstallWriterPreserved", helpers.sha256(finalWriterBytes));
      } finally {
        fs.rmSync(finalRoot, { recursive: true, force: true });
      }
    }
  });

  test("migration-post-rename-directory-fsync-failure-restores-original-bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-fsync-rollback-"));
    const filePath = path.join(root, "config.json");
    const originalBytes = JSON.stringify(legacyConfig({ spacing: "keep" }), null, 4) + "\n";
    fs.writeFileSync(filePath, originalBytes);
    const adapter = Object.create(fs);
    let directoryFsyncs = 0;
    adapter.fsyncSync = descriptor => {
      if (fs.fstatSync(descriptor).isDirectory() && directoryFsyncs++ === 0) {
        const error = new Error("injected post-rename directory fsync failure");
        error.code = "EIO";
        throw error;
      }
      return fs.fsyncSync(descriptor);
    };
    try {
      assert.throws(() => migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter }), error => error.code === "EIO");
      assert.equal(fs.readFileSync(filePath, "utf8"), originalBytes);
      assert.deepEqual(fs.readdirSync(root), ["config.json"]);
      helpers.recordProof("migrationPostRenameRollbackHash", helpers.sha256(originalBytes));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("migration-restoration-failure-has-distinct-fatal-code-and-cleans-artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-migration-restore-fatal-"));
    const filePath = path.join(root, "config.json");
    const originalBytes = JSON.stringify(legacyConfig(), null, 2) + "\n";
    fs.writeFileSync(filePath, originalBytes);
    const adapter = Object.create(fs);
    let directoryFailed = false;
    adapter.fsyncSync = descriptor => {
      if (fs.fstatSync(descriptor).isDirectory() && !directoryFailed) {
        directoryFailed = true;
        const error = new Error("injected post-rename directory fsync failure");
        error.code = "EIO";
        throw error;
      }
      return fs.fsyncSync(descriptor);
    };
    adapter.linkSync = (source, destination) => {
      if (directoryFailed && source.includes(".backup-") && destination === filePath) {
        const error = new Error("injected restoration rename failure");
        error.code = "EACCES";
        throw error;
      }
      return fs.linkSync(source, destination);
    };
    try {
      assert.throws(
        () => migrations.migrateJsonFile(filePath, { domain: "config", fs: adapter }),
        error => error.code === "MIGRATION_RESTORE_FAILED" && error.details.originalCode === "EIO" && error.details.restoreCode === "EACCES",
      );
      assert.equal(fs.existsSync(filePath + ".migration.lock"), false);
      assert.equal(fs.readdirSync(root).some(name => name.includes(".migration-") || name.includes(".backup-")), false);
      helpers.recordProof("migrationRestoreFailureCode", "MIGRATION_RESTORE_FAILED");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

module.exports = { register };
