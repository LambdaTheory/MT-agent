const path = require("path");

async function register({ test, assert }) {
  test("mutable layout baseline records legacy in-release path resolution", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const { getLegacyLayout } = require(path.join(skillDir, "scripts", "lib", "install-layout"));
    const legacy = getLegacyLayout(skillDir);

    assert.equal(legacy.configPath, path.join(skillDir, "config.json"));
    assert.equal(legacy.envPath, path.join(skillDir, ".env"));
    assert.equal(legacy.browserProfileDir, path.join(skillDir, ".browser-data"));
    assert.equal(legacy.tasksDir, path.join(skillDir, "tasks"));
    assert.equal(legacy.daemonPortPath, path.join(skillDir, ".daemon.port"));
  });
}

module.exports = { register };
