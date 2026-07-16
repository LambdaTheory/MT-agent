const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function register({ test, assert }) {
  test("legacy-data-copy-interrupted", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const { getInstallLayout, hashPath, importLegacyData } = require(path.join(skillDir, "scripts", "lib", "install-layout"));
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-interrupt-"));
    const target = path.join(parent, "Agent.With Dots (QA)");
    fs.mkdirSync(target);
    write(path.join(target, "config.json"), "{\"safe\":true}\n");
    write(path.join(target, "dirty-release-note.txt"), "uncommitted release edit\n");
    const sourceHash = hashPath(path.join(target, "config.json"));
    const dirtyHash = hashPath(path.join(target, "dirty-release-note.txt"));
    const layout = getInstallLayout(target);
    fs.mkdirSync(layout.dataRoot, { recursive: true });
    const legitimatePrefixedFile = path.join(layout.dataRoot, ".legacy-import-stale");
    write(legitimatePrefixedFile, "user-owned\n");
    const legitimatePrefixedHash = hashPath(legitimatePrefixedFile);

    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(
        importLegacyData({
          targetDir: target,
          onProgress(event) {
            if (event.phase === "copied-to-temp") throw new Error("injected interruption " + attempt);
          },
        }),
        /injected interruption/
      );
      assert.equal(fs.existsSync(layout.configPath), false);
      assert.deepEqual(fs.readdirSync(layout.dataRoot), [".legacy-import-stale"]);
      assert.equal(hashPath(legitimatePrefixedFile), legitimatePrefixedHash);
    }

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(importLegacyData({ targetDir: target, signal: controller.signal }), error => error.code === "LEGACY_IMPORT_CANCELLED");
    assert.equal(fs.existsSync(layout.configPath), false);

    const modulePath = path.join(skillDir, "scripts", "lib", "install-layout.js");
    const crashScript = [
      "const layout = require(" + JSON.stringify(modulePath) + ");",
      "layout.importLegacyData({ targetDir: " + JSON.stringify(target) + ", onProgress(event) {",
      "  if (event.phase === 'copied-to-temp') process.exit(77);",
      "}});",
    ].join("\n");
    const crashed = childProcess.spawnSync(process.execPath, ["-e", crashScript], { encoding: "utf-8" });
    assert.equal(crashed.status, 77);
    assert.ok(fs.existsSync(path.join(layout.dataRoot, ".legacy-import-artifacts.json")));
    assert.ok(fs.readdirSync(layout.dataRoot).some(name => name.startsWith(".legacy-import-operation-")));

    const recovered = await importLegacyData({ targetDir: target });
    assert.equal(recovered.imported.length, 1);
    assert.ok(recovered.unknown.includes("dirty-release-note.txt"));
    assert.equal(hashPath(layout.configPath), sourceHash);
    assert.equal(hashPath(path.join(target, "dirty-release-note.txt")), dirtyHash);
    assert.equal(hashPath(legitimatePrefixedFile), legitimatePrefixedHash);
    assert.equal(fs.existsSync(path.join(layout.dataRoot, ".legacy-import-artifacts.json")), false);
    assert.equal(fs.readdirSync(layout.dataRoot).some(name => name.startsWith(".legacy-import-operation-")), false);

    fs.writeFileSync(layout.configPath, "{\"different\":true}\n");
    const conflictingDestinationHash = hashPath(layout.configPath);
    await assert.rejects(importLegacyData({ targetDir: target }), error => error.code === "LEGACY_IMPORT_CONFLICT");
    assert.equal(hashPath(path.join(target, "config.json")), sourceHash);
    assert.equal(hashPath(layout.configPath), conflictingDestinationHash);
    fs.rmSync(parent, { recursive: true, force: true });
  });
}

module.exports = { register };
