const fs = require("fs");
const os = require("os");
const path = require("path");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function register({ test, assert }) {
  const skillDir = path.resolve(__dirname, "..", "..", "..");
  const installLayout = require(path.join(skillDir, "scripts", "lib", "install-layout"));

  test("install-layout rejects invalid Windows segments anywhere in target", async () => {
    if (process.platform !== "win32") return;
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-segments-"));
    try {
      for (const target of [
        path.join(parent, "CON", "agent"),
        path.join(parent, "bad-parent.", "agent"),
        path.join(parent, "bad:name", "agent"),
        path.join(parent, "AUX.txt", "agent"),
        "\\\\?\\C:\\temp\\agent",
        "\\\\.\\C:\\temp\\agent",
      ]) {
        assert.throws(() => installLayout.getInstallLayout(target), error => error.code === "INVALID_INSTALL_TARGET", target);
      }
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test("install-layout rejects dataRoot and destination-ancestor junction escapes", async () => {
    if (process.platform !== "win32") return;
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-junction-"));
    try {
      const target = path.join(parent, "Agent");
      const outside = path.join(parent, "outside");
      fs.mkdirSync(target);
      fs.mkdirSync(outside);
      write(path.join(target, "config.json"), "safe-source\n");
      const layout = installLayout.getInstallLayout(target);
      fs.symlinkSync(outside, layout.dataRoot, "junction");
      await assert.rejects(
        installLayout.importLegacyData({ targetDir: target }),
        error => error.code === "UNSAFE_DATA_ROOT"
      );
      assert.equal(fs.existsSync(path.join(outside, "config.json")), false);
      fs.unlinkSync(layout.dataRoot);

      fs.mkdirSync(layout.dataRoot);
      fs.symlinkSync(outside, layout.daemonDir, "junction");
      write(path.join(target, ".daemon.token"), "safe-token\n");
      await assert.rejects(
        installLayout.importLegacyData({ targetDir: target }),
        error => error.code === "UNSAFE_DESTINATION_ANCESTOR"
      );
      assert.equal(fs.existsSync(path.join(outside, "daemon.token")), false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test("install-layout constrains every caller-supplied destination to dataRoot", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-forged-layout-"));
    try {
      const target = path.join(parent, "Agent");
      fs.mkdirSync(target);
      write(path.join(target, "config.json"), "safe-source\n");
      const expected = installLayout.getInstallLayout(target);
      const destinationFields = [
        "configPath", "envPath", "browserProfileDir", "browserCacheDir", "tasksDir", "batchesDir",
        "daemonDir", "daemonIdentityPath", "daemonPidPath", "daemonPortPath", "daemonTokenPath",
        "receiptPath", "lockPath", "journalPath", "migrationBackupsDir",
      ];
      for (const field of destinationFields) {
        const outsidePath = path.join(parent, "outside", field);
        const forged = { ...expected, [field]: outsidePath };
        await assert.rejects(
          installLayout.importLegacyData({ targetDir: target, layout: forged }),
          error => error.code === "INSTALL_LAYOUT_ESCAPE",
          field
        );
        assert.equal(fs.existsSync(outsidePath), false, field);
      }
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  test("install-layout preserves legitimate nested importer-prefix user files", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-prefix-user-"));
    try {
      const target = path.join(parent, "Agent");
      fs.mkdirSync(target);
      const userFile = path.join(target, "tasks", ".legacy-import-user-note");
      write(userFile, "user-owned\n");
      const sourceHash = installLayout.hashPath(userFile);
      const first = await installLayout.importLegacyData({ targetDir: target });
      const layout = installLayout.getInstallLayout(target);
      const importedUserFile = path.join(layout.tasksDir, ".legacy-import-user-note");
      assert.deepEqual(first.imported, ["tasks"]);
      assert.equal(installLayout.hashPath(importedUserFile), sourceHash);

      const second = await installLayout.importLegacyData({ targetDir: target });
      assert.deepEqual(second.unchanged, ["tasks"]);
      assert.equal(installLayout.hashPath(importedUserFile), sourceHash);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
}

module.exports = { register };
