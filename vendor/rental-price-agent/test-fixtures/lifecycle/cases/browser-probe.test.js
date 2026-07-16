const childProcess = require("child_process");
const path = require("path");

function fakeLauncher(options = {}) {
  const calls = [];
  const state = { browserClosed: false, contextClosed: false };
  return {
    calls,
    state,
    executablePath() { return options.executablePath || "C:/fake/chrome.exe"; },
    async launch(launchOptions) {
      calls.push(launchOptions);
      if (options.hang) return new Promise(() => {});
      if (options.error) throw Object.assign(new Error(options.error.message), { code: options.error.code });
      let closed = false;
      const page = {
        async goto(url) {
          if (options.badPage) return;
          this.urlValue = url;
          if (options.hangGoto) return new Promise(() => {});
        },
        url() { return this.urlValue || "about:blank"; },
      };
      const context = {
        async newPage() { return page; },
        async close() { closed = true; state.contextClosed = true; },
      };
      return {
        version() { return options.version || "123.4.5.6"; },
        process() { return options.processPath === null ? null : { spawnfile: options.processPath || options.executablePath || "C:/fake/chrome.exe" }; },
        async newContext() { return context; },
        async close() { closed = true; state.browserClosed = true; },
        isClosed() { return closed; },
      };
    },
  };
}

async function register({ test, assert, helpers }) {
  const skillDir = path.resolve(__dirname, "..", "..", "..");
  const probe = require(path.join(skillDir, "scripts", "lib", "browser-probe.js"));
  const dependencyInstall = require(path.join(skillDir, "scripts", "lib", "dependency-install.js"));
  const init = require(path.join(skillDir, "scripts", "init.js"));
  const runner = require(path.join(skillDir, "scripts", "playwright-runner.js"));

  test("browser-system-chrome-probe: available source reports executable and version", async () => {
    const chrome = fakeLauncher({ executablePath: "C:/Program Files/Google/Chrome/chrome.exe", version: "126.0.1.2" });
    const result = await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.source, "chrome");
    assert.equal(result.executablePath, "C:/Program Files/Google/Chrome/chrome.exe");
    assert.equal(result.version, "126.0.1.2");
    assert.deepEqual(chrome.calls, [{ channel: "chrome", headless: true }]);
  });

  test("browser-managed-chromium-probe: available source uses managed executable", async () => {
    const chromium = fakeLauncher({ executablePath: "D:/data/browser-cache/chromium/chrome.exe", version: "127.0.0.0" });
    const result = await probe.probeBrowserSource("chromium", { launchers: { chromium }, timeoutMs: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.source, "chromium");
    assert.match(result.executablePath, /browser-cache/);
    assert.equal(result.version, "127.0.0.0");
    assert.deepEqual(chromium.calls, [{ headless: true }]);
  });

  test("browser-source-unavailable: deterministic errors distinguish chrome and chromium", async () => {
    const chrome = fakeLauncher({ error: { code: "ENOENT", message: "missing chrome" } });
    const chromium = fakeLauncher({ error: { code: "ENOENT", message: "missing managed binary" } });
    const results = await probe.probeAllBrowserSources({ launchers: { chrome, chromium }, timeoutMs: 100 });
    assert.equal(results.chrome.error.code, "SYSTEM_CHROME_UNAVAILABLE");
    assert.equal(results.chromium.error.code, "MANAGED_CHROMIUM_UNAVAILABLE");
  });

  test("browser-both-unavailable: selected source fails without silent fallback", async () => {
    const launchers = {
      chrome: fakeLauncher({ error: { message: "missing chrome" } }),
      chromium: fakeLauncher({ error: { message: "missing chromium" } }),
    };
    const result = await probe.probeBrowserPolicy({ source: "chrome" }, { launchers, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.equal(result.selectedSource, null);
    assert.equal(result.error.code, "SYSTEM_CHROME_UNAVAILABLE");
    assert.equal(launchers.chromium.calls.length, 1);
  });

  test("browser-fallback-disabled: available secondary is not selected", async () => {
    const launchers = {
      chrome: fakeLauncher({ error: { message: "missing chrome" } }),
      chromium: fakeLauncher({ version: "127.1.2.3" }),
    };
    const result = await probe.probeBrowserPolicy({ source: "chrome", allowFallback: false }, { launchers, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.equal(result.selectedSource, null);
    assert.equal(result.probes.chromium.ok, true);
  });

  test("browser-fallback-enabled: explicit policy selects available secondary", async () => {
    const launchers = {
      chrome: fakeLauncher({ error: { message: "missing chrome" } }),
      chromium: fakeLauncher({ version: "127.1.2.3" }),
    };
    const result = await probe.probeBrowserPolicy({ source: "chrome", allowFallback: true }, { launchers, timeoutMs: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.selectedSource, "chromium");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.version, "127.1.2.3");
  });

  test("browser-policy-malformed: rejects unknown source and non-boolean fallback", async () => {
    assert.throws(() => probe.normalizeBrowserPolicy({ source: "edge" }), error => error.code === "INVALID_BROWSER_POLICY");
    assert.throws(() => probe.normalizeBrowserPolicy({ source: "chrome", allowFallback: "yes" }), error => error.code === "INVALID_BROWSER_POLICY");
  });

  test("browser-probe-timeout: hung launch returns a stable timeout code", async () => {
    const result = await probe.probeBrowserSource("chrome", { launchers: { chrome: fakeLauncher({ hang: true }) }, timeoutMs: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "BROWSER_LAUNCH_TIMEOUT");
  });

  test("browser-probe-timeout-cleanup: timeout closes browser and context before returning", async () => {
    const chrome = fakeLauncher({ hangGoto: true });
    const result = await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 20 });
    assert.equal(result.error.code, "BROWSER_LAUNCH_TIMEOUT");
    assert.equal(chrome.state.contextClosed, true);
    assert.equal(chrome.state.browserClosed, true);
  });

  test("browser-probe-timeout-child: timeout terminates and awaits a launched child", async () => {
    let child;
    const chrome = {
      launchProbe() {
        child = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
        return { promise: new Promise(() => {}), children: [child] };
      },
    };
    const result = await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 30 });
    assert.equal(result.error.code, "BROWSER_LAUNCH_TIMEOUT");
    assert.ok(child.pid);
    assert.throws(() => process.kill(child.pid, 0));
  });

  test("browser-probe-flaky-repeat: probes do not cache a prior success", async () => {
    let attempts = 0;
    const chrome = fakeLauncher();
    const originalLaunch = chrome.launch;
    chrome.launch = async options => {
      attempts++;
      if (attempts === 2) throw new Error("second launch failed");
      return originalLaunch.call(chrome, options);
    };
    assert.equal((await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 100 })).ok, true);
    assert.equal((await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 100 })).error.code, "SYSTEM_CHROME_UNAVAILABLE");
  });

  test("browser-probe-profile-lock-isolation: probe never receives a persistent profile", async () => {
    const chrome = fakeLauncher();
    const result = await probe.probeBrowserSource("chrome", { launchers: { chrome }, timeoutMs: 100, userDataDir: "D:/live-profile" });
    assert.equal(result.ok, true);
    assert.equal(chrome.calls[0].userDataDir, undefined);
    assert.equal(chrome.calls[0].args, undefined);
  });

  test("browser-probe-stale-cache: missing managed executable is not reported as success", async () => {
    const chromium = fakeLauncher({ error: { code: "ENOENT", message: "Executable doesn't exist at stale cache path" } });
    const result = await probe.probeBrowserSource("chromium", { launchers: { chromium }, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "MANAGED_CHROMIUM_UNAVAILABLE");
  });

  test("browser-probe-misleading-success: incomplete launch metadata fails closed", async () => {
    const chromium = fakeLauncher({ version: "", executablePath: "", processPath: null });
    chromium.executablePath = () => "";
    const result = await probe.probeBrowserSource("chromium", { launchers: { chromium }, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "BROWSER_PROBE_INVALID_RESULT");
  });

  test("browser-probe-network-proof: all fake probes remain on data URLs", async () => {
    const browser = helpers.createFakeBrowser();
    const handle = await browser.launch({ url: probe.PROBE_URL });
    await handle.close();
    assert.equal(helpers.counters.saasRequests, 0);
    assert.equal(helpers.counters.networkAttempts, 0);
    helpers.recordProof("browserProbeUsesDataUrl", probe.PROBE_URL.startsWith("data:text/html,"));
  });

  test("dependency-install-chrome: staging uses npm ci ignore-scripts without browser download", async () => {
    const calls = [];
    const result = dependencyInstall.installStagingDependencies({
      stagingDir: "D:/stage/release",
      dataRoot: "D:/stage/data",
      browserSource: "chrome",
      run(command, args, options) { calls.push({ command, args, options }); return { status: 0 }; },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["ci", "--ignore-scripts"]);
  });

  test("dependency-install-chromium: managed install is explicit and cache-scoped", async () => {
    const calls = [];
    const result = dependencyInstall.installStagingDependencies({
      stagingDir: "D:/stage/release",
      dataRoot: "D:/stage/data",
      browserSource: "chromium",
      run(command, args, options) { calls.push({ command, args, options }); return { status: 0 }; },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ["ci", "--ignore-scripts"]);
    assert.deepEqual(calls[1].args, ["playwright", "install", "chromium"]);
    assert.equal(calls[1].options.env.PLAYWRIGHT_BROWSERS_PATH, path.join("D:/stage/data", "browser-cache"));
  });

  test("staging-readiness: install completes before the selected browser policy is probed", async () => {
    const events = [];
    const chrome = fakeLauncher();
    const result = await dependencyInstall.prepareStagingReadiness({
      stagingDir: "D:/stage/release",
      dataRoot: "D:/stage/data",
      browserPolicy: { source: "chrome", allowFallback: false },
      run() { events.push("install"); return { status: 0 }; },
      probeOptions: {
        launchers: {
          chrome: { ...chrome, async launch(options) { events.push("probe"); return chrome.launch(options); } },
          chromium: fakeLauncher({ error: { message: "not installed" } }),
        },
        timeoutMs: 100,
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events, ["install", "probe"]);
    assert.equal(result.readiness.selectedSource, "chrome");
  });

  test("init-browser-readiness: init delegates to read-only doctor and returns nonzero on blockers", async () => {
    let receivedTarget;
    const result = await init.runInitialization({
      targetDir: "D:/fixture/target",
      quiet: true,
      runDoctor: async options => {
        receivedTarget = options.targetDir;
        return {
          checks: [{ code: "MANAGED_CHROMIUM_UNAVAILABLE", status: "fail", message: "missing", blocks: ["writes"] }],
          blockers: ["MANAGED_CHROMIUM_UNAVAILABLE"],
          readyForReads: true,
          readyForWrites: false,
        };
      },
    });
    assert.equal(receivedTarget, "D:/fixture/target");
    assert.equal(result.exitCode, 1);
    assert.equal(result.results.doctor, false);
    assert.equal(result.results.readyForWrites, false);
  });

  test("runtime-browser-policy: runner consumes the common validated source without retry fallback", async () => {
    const chrome = fakeLauncher({ error: { message: "missing" } });
    const chromium = fakeLauncher();
    const resolved = await runner.resolveRuntimeBrowserPolicy({ source: "chrome", allowFallback: true, headless: false }, {
      launchers: { chrome, chromium },
      timeoutMs: 100,
    });
    assert.equal(resolved.selectedSource, "chromium");
    assert.deepEqual(resolved.launchOptions, { headless: false });
    assert.equal(resolved.fallbackUsed, true);
  });
}

module.exports = { register };
