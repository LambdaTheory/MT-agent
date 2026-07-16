const fs = require("fs");
const os = require("os");
const path = require("path");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function register({ test, assert }) {
  test("legacy-data-import copies verified known data, reports unknown files, and reruns idempotently", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const { getInstallLayout, hashPath, importLegacyData } = require(path.join(skillDir, "scripts", "lib", "install-layout"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-import-"));
    const target = path.join(parent, "agent");
    fs.mkdirSync(target);
    write(path.join(target, "config.json"), "{\"value\":1}\n");
    write(path.join(target, ".env"), "TOKEN=secret\n");
    write(path.join(target, ".browser-data", "Default", "Cookies"), "cookie-bytes");
    write(path.join(target, "tasks", "task.json"), "{\"status\":\"planned\"}\n");
    write(path.join(target, ".daemon.pid"), "123\n");
    write(path.join(target, ".daemon.port"), "9223\n");
    write(path.join(target, ".daemon.token"), "token\n");
    write(path.join(target, "notes.local"), "leave me in place\n");

    const sourceHashes = {
      config: hashPath(path.join(target, "config.json")),
      env: hashPath(path.join(target, ".env")),
      cookies: hashPath(path.join(target, ".browser-data", "Default", "Cookies")),
      tasks: hashPath(path.join(target, "tasks")),
      unknown: hashPath(path.join(target, "notes.local")),
    };

    const first = await importLegacyData({ targetDir: target });
    const layout = getInstallLayout(target);
    assert.equal(hashPath(layout.configPath), sourceHashes.config);
    assert.equal(hashPath(layout.envPath), sourceHashes.env);
    assert.equal(hashPath(path.join(layout.browserProfileDir, "Default", "Cookies")), sourceHashes.cookies);
    assert.equal(hashPath(layout.tasksDir), sourceHashes.tasks);
    assert.equal(hashPath(path.join(target, "notes.local")), sourceHashes.unknown);
    assert.ok(first.imported.length >= 7);
    assert.ok(first.unknown.includes("notes.local"));
    assert.equal(first.sourceDeleted, false);

    const second = await importLegacyData({ targetDir: target });
    assert.equal(second.imported.length, 0);
    assert.ok(second.unchanged.length >= 7);
    assert.equal(second.sourceDeleted, false);
    assert.equal(hashPath(path.join(target, "config.json")), sourceHashes.config);
    fs.rmSync(parent, { recursive: true, force: true });
  });

}

module.exports = { register };
