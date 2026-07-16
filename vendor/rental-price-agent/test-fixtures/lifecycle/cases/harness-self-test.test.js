const fs = require("fs");
const path = require("path");

const support = require(path.join(__dirname, "../../../scripts/lib/lifecycle-test-support.js"));

async function register({ test, assert, helpers }) {
  test("harness-self-test", async () => {
    const runner = require(path.join(__dirname, "../../../scripts/run-lifecycle-tests.js"));
    const releaseBuilder = require(path.join(__dirname, "../../../scripts/build-release.js"));
    assert.equal(helpers.formatPass("baseline"), "[PASS] baseline");
    assert.equal(helpers.formatFail("baseline"), "[FAIL] baseline");
    assert.equal(helpers.formatSummary(1, 2), "1/2 tests passed");
    const discoveredNames = runner.discoverCaseFiles().map(file => path.basename(file));
    assert.deepEqual(discoveredNames, discoveredNames.slice().sort((left, right) => left.localeCompare(right)));
    assert.equal(discoveredNames.includes("harness-self-test.test.js"), true);
    assert.throws(() => runner.parseArgs(["--case"]), error => error && error.code === "INVALID_CLI_ARGUMENT");
    const originalGuardTimeout = process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS;
    try {
      delete process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS;
      assert.equal(runner.resolveGuardTimeoutMs(), 180000);
      assert.equal(runner.DEFAULT_GUARD_TIMEOUT_MS, releaseBuilder.LIFECYCLE_GATE_TIMEOUT_MS);
      assert.equal(releaseBuilder.LIFECYCLE_GATE_TIMEOUT_MS, 180000);
      for (const timeout of ["1000", "300000"]) {
        process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS = timeout;
        assert.equal(runner.resolveGuardTimeoutMs(), Number(timeout));
      }
      for (const timeout of ["", "999", "300001", "1.5", "not-a-number"]) {
        process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS = timeout;
        assert.throws(() => runner.resolveGuardTimeoutMs(), error => error && error.code === "INVALID_GUARD_TIMEOUT");
      }
    } finally {
      if (originalGuardTimeout === undefined) delete process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS;
      else process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS = originalGuardTimeout;
    }
    helpers.recordProof("manualRegistryOutput", ["[PASS] baseline", "[FAIL] baseline", "1/2 tests passed"]);
    helpers.recordProof("dynamicCaseDiscovery", discoveredNames);

    const staleRoot = path.join(support.PROCESS_TEMP_PARENT, "harness-a-001");
    await fs.promises.mkdir(staleRoot, { recursive: true });
    await fs.promises.writeFile(path.join(staleRoot, "stale-partial-state"), "must be removed", "utf8");
    const [first, second] = await Promise.all([
      support.createLifecycleFixture({ name: "harness-a" }),
      support.createLifecycleFixture({ name: "harness-b" }),
    ]);
    try {
      assert.notEqual(first.root, second.root);
      assert.equal(path.dirname(path.dirname(first.root)), support.TEMP_PARENT);
      assert.equal(path.dirname(first.root), support.PROCESS_TEMP_PARENT);
      assert.equal(first.paths.active.endsWith(path.join("harness-a-001", "active")), true);
      assert.equal(second.paths.active.endsWith(path.join("harness-b-002", "active")), true);
      assert.equal(fs.existsSync(path.join(first.root, "stale-partial-state")), false);
      helpers.recordProof("deterministicConcurrentRoots", [path.basename(first.root), path.basename(second.root)]);
      helpers.recordProof("staleTempStateRemoved", true);

      const fsWithFault = support.createFaultInjectingFs({
        failures: [{ operation: "rename", at: 1, code: "EINJECTED" }],
      });
      await assert.rejects(
        fsWithFault.rename(first.paths.active, first.paths.previous),
        error => error && error.code === "EINJECTED",
      );
      assert.equal(fsWithFault.operations.rename, 1);
      helpers.recordProof("injectedFilesystemFailure", { operation: "rename", code: "EINJECTED" });

      const fakeServer = await support.startFakeGiteeServer({
        routes: { "/api/v5/repos/example/releases/tags/v1.0.0": { status: 200, body: { tag_name: "v1.0.0" } } },
      });
      try {
        const response = await helpers.http.request(fakeServer.url + "/api/v5/repos/example/releases/tags/v1.0.0");
        assert.equal(response.statusCode, 200);
        assert.equal(JSON.parse(response.body).tag_name, "v1.0.0");
      } finally {
        await fakeServer.stop();
      }

      const hangingServer = await support.startFakeGiteeServer({ routes: { "/hang": { hang: true } } });
      const hangingRequest = helpers.http.request(hangingServer.url + "/hang");
      const hangingRejection = assert.rejects(hangingRequest);
      await new Promise(resolve => setImmediate(resolve));
      const hangingCleanup = await hangingServer.stop();
      await hangingRejection;
      assert.equal(hangingCleanup.openSockets, 0);
      helpers.recordProof("hungServerCleanup", hangingCleanup);

      const offlineProbe = support.createNetworkGuard({ offline: true, forbidSaas: true });
      await assert.rejects(
        offlineProbe.request("http://192.0.2.1/never-contact"),
        error => error && error.code === "OFFLINE_NON_LOOPBACK_BLOCKED",
      );
      assert.equal(offlineProbe.counters.networkAttempts, 0);
      helpers.recordProof("offlineGuard", { code: "OFFLINE_NON_LOOPBACK_BLOCKED", externalSocketsOpened: 0 });

      const saasProbe = support.createNetworkGuard({ offline: true, forbidSaas: true });
      await assert.rejects(
        saasProbe.request("https://merchant.example.test/web/index.php?r=goods.edit&id=761"),
        error => error && error.code === "SAAS_REQUEST_FORBIDDEN",
      );
      assert.equal(saasProbe.counters.networkAttempts, 0);
      assert.equal(saasProbe.counters.saasRequests, 1);
      helpers.recordProof("saasGuard", { code: "SAAS_REQUEST_FORBIDDEN", externalSocketsOpened: 0 });

      const daemon = support.createFakeDaemon();
      const browser = support.createFakeBrowser();
      await daemon.invoke({ action: "ping" });
      await browser.launch({ url: "data:text/plain,lifecycle" });
      assert.equal(daemon.counters.mutationInvocations, 0);
      assert.equal(browser.counters.saasRequests, 0);

      const processes = support.createFakeProcessAdapter();
      const child = processes.spawn("fake-daemon");
      assert.equal(processes.isRunning(child.pid), true);
      assert.equal(processes.stop(child.pid), true);
      assert.equal(processes.isRunning(child.pid), false);

      const legacy = support.createSchemaFixture("legacy");
      const current = support.createSchemaFixture("current");
      const future = support.createSchemaFixture("future");
      assert.equal(legacy.config.configSchemaVersion, undefined);
      assert.equal(current.config.configSchemaVersion < future.config.configSchemaVersion, true);
      assert.equal(support.sha256Json(current), support.sha256Json(support.createSchemaFixture("current")));
      const release = support.createReleaseFixture({ version: "1.2.3" });
      assert.equal(release.manifest.tag, "v1.2.3");
      assert.equal(release.manifest.asset.sha256, support.sha256(release.archive));
      helpers.recordProof("fixtureFactories", ["legacy", "current", "future", "release-manifest", "release-archive"]);
    } finally {
      const receipts = await Promise.all([first.cleanup(), second.cleanup()]);
      for (const receipt of receipts) {
        assert.equal(receipt.removed, true);
        assert.equal(receipt.existsAfterCleanup, false);
      }
    }
  });
}

module.exports = { register };
