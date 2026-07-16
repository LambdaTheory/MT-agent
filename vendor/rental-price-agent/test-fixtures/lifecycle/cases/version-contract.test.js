const path = require("path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function register({ test, assert }) {
  test("version-contract: rejects every canonical metadata drift class", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));
    const current = contract.loadContractFiles({ skillDir });
    assert.equal(contract.validateVersionContract({ ...current, nodeVersion: process.versions.node }).skillVersion, "1.0.0");
    assert.equal(current.manifest.migration.contractVersion, 2);
    assert.equal(current.manifest.migration.definition, "scripts/lib/target-migration.json");

    const probes = [
      ["MALFORMED_SEMVER", value => { value.manifest.protocolVersion = "1"; }],
      ["RELEASE_TAG_VERSION_MISMATCH", value => { value.manifest.releaseTag = "v1.0.1"; }],
      ["UNSUPPORTED_NODE", null, "17.9.0"],
      ["PLAYWRIGHT_DEPENDENCY_DRIFT", value => { value.packageJson.dependencies.playwright = "^1.60.0"; }],
      ["UNKNOWN_COMPATIBILITY_FIELD", value => { value.manifest.compatibility.futureDomain = { min: "1.0.0", max: "1.0.0" }; }],
      ["UNKNOWN_MANIFEST_FIELD", value => { value.manifest.migration.module = "scripts/lib/target-migration.js"; }],
      ["UNKNOWN_MANIFEST_FIELD", value => { value.manifest.migration.contractVersion = 1; }],
    ];
    for (const [code, mutate, nodeVersion = process.versions.node] of probes) {
      const candidate = clone(current);
      if (mutate) mutate(candidate);
      assert.throws(
        () => contract.validateVersionContract({ ...candidate, nodeVersion }),
        error => error && error.code === code,
        "expected " + code,
      );
    }
  });
}

module.exports = { register };
