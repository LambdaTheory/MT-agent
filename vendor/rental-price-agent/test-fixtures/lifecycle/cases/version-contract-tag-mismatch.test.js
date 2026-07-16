const path = require("path");

async function register({ test, assert }) {
  test("version-contract-tag-mismatch: release tag must equal the Skill version", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));
    const current = contract.loadContractFiles({ skillDir });
    const manifest = JSON.parse(JSON.stringify(current.manifest));
    manifest.releaseTag = "v1.0.1";

    assert.throws(
      () => contract.validateVersionContract({ ...current, manifest, nodeVersion: process.versions.node }),
      error => error && error.code === "RELEASE_TAG_VERSION_MISMATCH",
    );
  });
}

module.exports = { register };
