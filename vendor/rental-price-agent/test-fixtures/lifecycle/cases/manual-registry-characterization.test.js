const path = require("path");

async function register({ test, assert }) {
  test("manual-registry-characterization", async () => {
    const runner = require(path.resolve(__dirname, "../../../scripts/run-lifecycle-tests.js"));
    const registered = [];
    const manualTest = (name, fn) => registered.push({ name, fn });
    manualTest("first", async () => {});
    manualTest("second", async () => { throw new Error("expected failure"); });

    assert.deepEqual(registered.map(item => item.name), ["first", "second"]);
    assert.equal(runner.formatPass("first"), "[PASS] first");
    assert.equal(runner.formatFail("second"), "[FAIL] second");
    assert.equal(runner.formatSummary(1, registered.length), "1/2 tests passed");
  });
}

module.exports = { register };
