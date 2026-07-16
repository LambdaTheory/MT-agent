const fs = require("fs");
const os = require("os");
const path = require("path");

async function register({ test, assert }) {
  test("mutable-layout uses one deterministic sibling data root", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const { getInstallLayout } = require(path.join(skillDir, "scripts", "lib", "install-layout"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-layout-"));
    const target = path.join(parent, "Rental Agent");
    const layout = getInstallLayout(target);
    const dataRoot = path.join(parent, ".Rental Agent-data");

    assert.equal(layout.targetDir, path.resolve(target));
    assert.equal(layout.dataRoot, dataRoot);
    assert.equal(layout.configPath, path.join(dataRoot, "config.json"));
    assert.equal(layout.envPath, path.join(dataRoot, ".env"));
    assert.equal(layout.browserProfileDir, path.join(dataRoot, "browser-profile"));
    assert.equal(layout.browserCacheDir, path.join(dataRoot, "browser-cache"));
    assert.equal(layout.tasksDir, path.join(dataRoot, "tasks"));
    assert.equal(layout.daemonIdentityPath, path.join(dataRoot, "daemon", "identity.json"));
    assert.equal(layout.receiptPath, path.join(dataRoot, "install-receipt.json"));
    assert.equal(layout.lockPath, path.join(dataRoot, "lifecycle.lock"));
    assert.equal(layout.journalPath, path.join(dataRoot, "lifecycle-journal.json"));
    assert.equal(layout.migrationBackupsDir, path.join(dataRoot, "migration-backups"));

    assert.throws(() => getInstallLayout(""), /target/i);
    assert.throws(() => getInstallLayout(path.parse(target).root), /target/i);
    if (process.platform === "win32") {
      assert.throws(() => getInstallLayout(path.join(parent, "CON")), /target/i);
      assert.throws(() => getInstallLayout(path.join(parent, "trailing-dot.")), /target/i);
    }
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test("runtime modules share the install layout", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const layoutModule = require(path.join(skillDir, "scripts", "lib", "install-layout"));
    const configLoader = require(path.join(skillDir, "scripts", "lib", "config-loader"));
    const expected = layoutModule.getInstallLayout(skillDir);

    assert.equal(configLoader.SKILL_DIR, skillDir);
    assert.equal(configLoader.DATA_ROOT, expected.dataRoot);
    assert.equal(configLoader.CONFIG_PATH, expected.configPath);
    assert.equal(configLoader.ENV_PATH, expected.envPath);

    for (const relative of ["scripts/playwright-runner.js", "scripts/task-store.js", "scripts/batch-runner.js", "scripts/diff-generator.js"]) {
      const source = fs.readFileSync(path.join(skillDir, relative), "utf-8");
      assert.ok(source.includes("install-layout") || source.includes("LAYOUT"), relative + " must consume the shared layout");
      assert.doesNotMatch(source, /SKILL_DIR \+ "\/tasks/);
      assert.doesNotMatch(source, /SKILL_DIR \+ "\/\.daemon/);
      if (relative === "scripts/playwright-runner.js") {
        assert.match(source, /process\.env\.RENTAL_AGENT_USER_DATA_DIR/);
        assert.match(source, /LAYOUT\.browserProfileDir/);
        assert.match(source, /PLAYWRIGHT_BROWSERS_PATH/);
      }
    }
  });
}

module.exports = { register };
