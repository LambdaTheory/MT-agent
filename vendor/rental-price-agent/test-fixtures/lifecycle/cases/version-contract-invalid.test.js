const path = require("path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(assert, fn, code) {
  assert.throws(fn, error => error && error.code === code, "expected error code " + code);
}

async function register({ test, assert }) {
  test("version-contract-invalid: rejects numeric prerelease identifiers with leading zeroes", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));

    expectCode(assert, () => contract.parseSemver("1.0.0-01", "probe"), "MALFORMED_SEMVER");
  });

  test("version-contract-invalid: compares prerelease identifiers by SemVer precedence", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));

    assert.equal(contract.compareSemver("1.0.0-beta.10", "1.0.0-beta.2"), 1);
    assert.equal(contract.compareSemver("1.0.0-beta.99999999999999999999", "1.0.0-beta.10"), 1);
    assert.equal(contract.compareSemver("1.0.0-beta.2", "1.0.0-beta.alpha"), -1);
    assert.equal(contract.compareSemver("1.0.0-beta", "1.0.0-beta.1"), -1);
  });

  test("version-contract-invalid: rejects lockfile root Node range drift", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));
    const current = contract.loadContractFiles({ skillDir });
    const staleLockfile = clone(current);
    staleLockfile.lockfile.packages[""].engines.node = ">=20.0.0 <25.0.0";

    expectCode(assert, () => contract.validateVersionContract({ ...staleLockfile, nodeVersion: process.versions.node }), "NODE_RANGE_MISMATCH");
  });

  test("version-contract-invalid: malformed and incompatible metadata fail closed", async () => {
    const skillDir = path.resolve(__dirname, "..", "..", "..");
    const contract = require(path.join(skillDir, "scripts", "lib", "version-contract.js"));
    const current = contract.loadContractFiles({ skillDir });

    const malformed = clone(current);
    malformed.manifest.skillVersion = "1";
    expectCode(assert, () => contract.validateVersionContract({ ...malformed, nodeVersion: process.versions.node }), "MALFORMED_SEMVER");

    expectCode(assert, () => contract.validateVersionContract({ ...clone(current), nodeVersion: "17.9.0" }), "UNSUPPORTED_NODE");

    const dependencyDrift = clone(current);
    dependencyDrift.packageJson.dependencies.playwright = "^1.60.0";
    expectCode(assert, () => contract.validateVersionContract({ ...dependencyDrift, nodeVersion: process.versions.node }), "PLAYWRIGHT_DEPENDENCY_DRIFT");

    const unknownField = clone(current);
    unknownField.manifest.compatibility.unexpected = { min: "1.0.0", max: "1.0.0" };
    expectCode(assert, () => contract.validateVersionContract({ ...unknownField, nodeVersion: process.versions.node }), "UNKNOWN_COMPATIBILITY_FIELD");

    const stalePackage = clone(current);
    stalePackage.packageJson.version = "1.0.1";
    expectCode(assert, () => contract.validateVersionContract({ ...stalePackage, nodeVersion: process.versions.node }), "PACKAGE_VERSION_MISMATCH");
  });
}

module.exports = { register };
