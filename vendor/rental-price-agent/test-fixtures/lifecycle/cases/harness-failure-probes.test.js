async function register({ test, helpers }) {
  test("harness-misleading-success-probe", async () => {
    if (process.env.LIFECYCLE_PROBE_MISLEADING_SUCCESS === "1") {
      process.stderr.write("[PASS] deliberately misleading fixture output\n");
      throw new Error("intentional harness failure probe");
    }
  });

  test("harness-interruption-probe", async () => {
    if (process.env.LIFECYCLE_PROBE_INTERRUPTION !== "1") return;
    const fixture = await helpers.createLifecycleFixture({ name: "interruption", guardParentExit: true });
    process.stderr.write("[PROBE_ROOT] " + fixture.root + "\n");
    await new Promise(resolve => {
      const keepAlive = setInterval(() => {}, 1000);
      process.once("beforeExit", () => {
        clearInterval(keepAlive);
        resolve();
      });
    });
  });

  test("harness-global-mutation-probe", async () => {
    if (process.env.LIFECYCLE_PROBE_MUTATION !== "1") return;
    const daemon = helpers.createFakeDaemon();
    await daemon.invoke({ action: "image-upload" });
  });

  test("harness-guard-timeout-probe", async () => {
    if (process.env.LIFECYCLE_PROBE_GUARD_TIMEOUT !== "1") return;
    const fixture = await helpers.createLifecycleFixture({ name: "guard-timeout", guardParentExit: true });
    process.stderr.write("[PROBE_ROOT] " + fixture.root + "\n");
    await new Promise(() => setInterval(() => {}, 1000));
  });
}

module.exports = { register };
