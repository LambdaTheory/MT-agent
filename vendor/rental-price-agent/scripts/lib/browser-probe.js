const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const PROBE_URL = "data:text/html,<title>rental-price-agent-browser-probe</title>";
const SOURCES = Object.freeze(["chrome", "chromium"]);

function probeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeBrowserPolicy(value) {
  const policy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const source = policy.source === undefined ? "chrome" : policy.source;
  const allowFallback = policy.allowFallback === undefined ? false : policy.allowFallback;
  if (!SOURCES.includes(source) || typeof allowFallback !== "boolean") {
    throw probeError("INVALID_BROWSER_POLICY", "browser.source must be chrome or chromium and browser.allowFallback must be boolean");
  }
  return Object.freeze({ source, allowFallback });
}

function getFallbackSource(source) {
  return source === "chrome" ? "chromium" : "chrome";
}

function getBrowserLaunchCandidates(value) {
  const policy = normalizeBrowserPolicy(value);
  return policy.allowFallback ? [policy.source, getFallbackSource(policy.source)] : [policy.source];
}

function getLaunchOptions(source, headless = true) {
  if (!SOURCES.includes(source)) throw probeError("INVALID_BROWSER_SOURCE", "Unsupported browser source: " + source);
  return source === "chrome" ? { channel: "chrome", headless } : { headless };
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(probeError("BROWSER_PROCESS_EXIT_TIMEOUT", "browser process did not exit after termination"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };
    const onExit = () => { cleanup(); resolve(); };
    const onError = error => { cleanup(); reject(error); };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function terminateChild(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForChildExit(child);
  if (process.platform === "win32") {
    await new Promise(resolve => {
      const killer = childProcess.spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

function createTrackedLauncher(browserType, executablePath) {
  return {
    executablePath,
    launch: launchOptions => browserType.launch(launchOptions),
    launchProbe(launchOptions) {
      const children = [];
      const originalSpawn = childProcess.spawn;
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        childProcess.spawn = originalSpawn;
      };
      childProcess.spawn = function trackedSpawn(...args) {
        const child = originalSpawn.apply(this, args);
        children.push(child);
        return child;
      };
      const promise = Promise.resolve()
        .then(() => browserType.launch(launchOptions))
        .finally(restore);
      return {
        promise,
        children,
        async cancel() {
          restore();
          await Promise.all(children.map(terminateChild));
        },
      };
    },
  };
}

function createPlaywrightLaunchers(options = {}) {
  if (options.browserCacheDir) process.env.PLAYWRIGHT_BROWSERS_PATH = options.browserCacheDir;
  const playwright = options.playwright || require("playwright");
  return {
    chrome: createTrackedLauncher(playwright.chromium, resolveSystemChromeExecutable),
    chromium: createTrackedLauncher(playwright.chromium, () => playwright.chromium.executablePath()),
  };
}

function resolveSystemChromeExecutable() {
  const candidates = process.platform === "win32"
    ? [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  return candidates.filter(Boolean).find(candidate => fs.existsSync(candidate)) || "";
}

function sourceUnavailableCode(source) {
  return source === "chrome" ? "SYSTEM_CHROME_UNAVAILABLE" : "MANAGED_CHROMIUM_UNAVAILABLE";
}

function withTimeout(promise, timeoutMs, source, cancel) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(async () => {
      await cancel().catch(() => {});
      reject(probeError("BROWSER_LAUNCH_TIMEOUT", source + " browser probe timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function serializeError(error, source) {
  const code = error && error.code === "BROWSER_LAUNCH_TIMEOUT" ? error.code : sourceUnavailableCode(source);
  return { code, message: String(error && error.message ? error.message : error) };
}

async function cleanupProbe(state) {
  if (state.context) {
    const context = state.context;
    state.context = null;
    await context.close().catch(() => {});
  }
  if (state.browser) {
    const browser = state.browser;
    state.browser = null;
    await browser.close().catch(() => {});
  }
  if (state.attempt && typeof state.attempt.cancel === "function") await state.attempt.cancel();
  if (state.attempt && Array.isArray(state.attempt.children)) await Promise.all(state.attempt.children.map(terminateChild));
}

function beginLaunch(launcher, launchOptions) {
  if (typeof launcher.launchProbe === "function") {
    const attempt = launcher.launchProbe(launchOptions);
    if (!attempt || !attempt.promise || typeof attempt.promise.then !== "function") {
      throw probeError("INVALID_LAUNCH_CANCELLATION_CONTRACT", "launchProbe must return { promise, children?, cancel? }");
    }
    return attempt;
  }
  return { promise: launcher.launch(launchOptions), children: [] };
}

async function runProbe(source, launcher, state) {
  try {
    state.attempt = beginLaunch(launcher, getLaunchOptions(source, true));
    state.browser = await state.attempt.promise;
    state.context = await state.browser.newContext();
    const page = await state.context.newPage();
    await page.goto(PROBE_URL, { waitUntil: "load" });
    const version = typeof state.browser.version === "function" ? state.browser.version() : "";
    const browserProcess = typeof state.browser.process === "function" ? state.browser.process() : null;
    const executablePath = browserProcess && browserProcess.spawnfile
      ? browserProcess.spawnfile
      : (typeof launcher.executablePath === "function" ? launcher.executablePath() : "");
    if (typeof page.url !== "function" || !page.url().startsWith("data:text/html,") || typeof version !== "string" || !version.trim()
      || typeof executablePath !== "string" || !executablePath.trim()) {
      throw probeError("BROWSER_PROBE_INVALID_RESULT", source + " browser probe returned incomplete launch metadata");
    }
    return { ok: true, source, executablePath, version };
  } finally {
    await cleanupProbe(state);
  }
}

async function probeBrowserSource(source, options = {}) {
  if (!SOURCES.includes(source)) {
    return { ok: false, source, error: { code: "INVALID_BROWSER_SOURCE", message: "Unsupported browser source: " + source } };
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 10000;
  const launchers = options.launchers || createPlaywrightLaunchers(options);
  const launcher = launchers[source];
  if (!launcher || (typeof launcher.launch !== "function" && typeof launcher.launchProbe !== "function")) {
    return { ok: false, source, error: { code: sourceUnavailableCode(source), message: source + " browser launcher is unavailable" } };
  }
  try {
    const state = { attempt: null, browser: null, context: null };
    return await withTimeout(runProbe(source, launcher, state), timeoutMs, source, () => cleanupProbe(state));
  } catch (error) {
    const serialized = error && error.code === "BROWSER_PROBE_INVALID_RESULT"
      ? { code: error.code, message: error.message }
      : serializeError(error, source);
    return { ok: false, source, error: serialized };
  }
}

async function probeAllBrowserSources(options = {}) {
  const launchers = options.launchers || createPlaywrightLaunchers(options);
  const chrome = await probeBrowserSource("chrome", { ...options, launchers });
  const chromium = await probeBrowserSource("chromium", { ...options, launchers });
  return { chrome, chromium };
}

async function probeBrowserPolicy(value, options = {}) {
  let policy;
  try {
    policy = normalizeBrowserPolicy(value);
  } catch (error) {
    return { ok: false, selectedSource: null, fallbackUsed: false, probes: {}, error: { code: error.code, message: error.message } };
  }
  const probes = await probeAllBrowserSources(options);
  const primary = probes[policy.source];
  if (primary.ok) return { ...primary, selectedSource: policy.source, fallbackUsed: false, policy, probes };
  const fallbackSource = getFallbackSource(policy.source);
  if (policy.allowFallback && probes[fallbackSource].ok) {
    return { ...probes[fallbackSource], selectedSource: fallbackSource, fallbackUsed: true, policy, probes };
  }
  return { ok: false, selectedSource: null, fallbackUsed: false, policy, probes, error: primary.error };
}

async function resolveValidatedBrowserPolicy(value, options = {}) {
  const result = await probeBrowserPolicy(value, options);
  if (result.ok) return result;
  const error = probeError(result.error.code, result.error.message, { probes: result.probes, policy: result.policy });
  throw error;
}

module.exports = {
  PROBE_URL,
  SOURCES,
  createPlaywrightLaunchers,
  getBrowserLaunchCandidates,
  getLaunchOptions,
  normalizeBrowserPolicy,
  probeAllBrowserSources,
  probeBrowserPolicy,
  probeBrowserSource,
  resolveValidatedBrowserPolicy,
  resolveSystemChromeExecutable,
};
