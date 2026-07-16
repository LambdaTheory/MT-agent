const path = require("path");

async function register({ test, assert }) {
  test("version-contract-current: canonical metadata is internally consistent", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));
    const metadata = contract.readCurrentMetadata({ skillDir });

    assert.equal(metadata.name, "rental-price-agent");
    assert.equal(metadata.skillVersion, "1.0.0");
    assert.equal(metadata.daemonVersion, "1.0.0");
    assert.equal(metadata.protocolVersion, "1.0.0");
    assert.equal(metadata.configSchemaVersion, "1.0.0");
    assert.equal(metadata.stateSchemaVersion, "1.0.0");
    assert.equal(metadata.playwrightVersion, "1.60.0");
    assert.equal(metadata.releaseTag, "v1.0.0");
    assert.deepEqual(metadata.browserPolicy.supported, ["managed-chromium", "system-chrome"]);
    assert.equal(metadata.browserPolicy.allowFallback, false);
  });
}

module.exports = { register };
