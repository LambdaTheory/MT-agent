const childProcess = require("child_process");
const path = require("path");
const { normalizeBrowserPolicy, probeBrowserPolicy } = require("./browser-probe");

function installError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function defaultRun(command, args, options) {
  return childProcess.spawnSync(command, args, { ...options, encoding: "utf8", windowsHide: true });
}

function assertSucceeded(result, code, command) {
  if (!result || result.error || result.status !== 0) {
    throw installError(code, command + " failed", {
      status: result && result.status,
      stderr: result && result.stderr ? String(result.stderr).trim() : "",
      cause: result && result.error ? result.error.message : undefined,
    });
  }
}

function installStagingDependencies(options = {}) {
  const stagingDir = path.resolve(String(options.stagingDir || ""));
  const dataRoot = path.resolve(String(options.dataRoot || ""));
  const browserSource = options.browserSource;
  if (!options.stagingDir || !options.dataRoot || !["chrome", "chromium"].includes(browserSource)) {
    throw installError("INVALID_DEPENDENCY_INSTALL_OPTIONS", "stagingDir, dataRoot, and browserSource chrome|chromium are required");
  }
  const run = options.run || defaultRun;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const env = { ...process.env };
  const dependencyResult = run(npmCommand, ["ci", "--ignore-scripts"], { cwd: stagingDir, env });
  assertSucceeded(dependencyResult, "DEPENDENCY_INSTALL_FAILED", "npm ci --ignore-scripts");

  const commands = [{ command: npmCommand, args: ["ci", "--ignore-scripts"] }];
  let browserCacheDir = null;
  if (browserSource === "chromium") {
    browserCacheDir = path.join(dataRoot, "browser-cache");
    const browserEnv = { ...env, PLAYWRIGHT_BROWSERS_PATH: browserCacheDir };
    const browserResult = run(npxCommand, ["playwright", "install", "chromium"], { cwd: stagingDir, env: browserEnv });
    assertSucceeded(browserResult, "MANAGED_CHROMIUM_INSTALL_FAILED", "npx playwright install chromium");
    commands.push({ command: npxCommand, args: ["playwright", "install", "chromium"] });
  }
  return { ok: true, stagingDir, dataRoot, browserSource, browserCacheDir, commands };
}

async function prepareStagingReadiness(options = {}) {
  const policy = normalizeBrowserPolicy(options.browserPolicy);
  const installation = installStagingDependencies({
    stagingDir: options.stagingDir,
    dataRoot: options.dataRoot,
    browserSource: policy.source,
    run: options.run,
  });
  const readiness = await (options.probeBrowserPolicy || probeBrowserPolicy)(policy, {
    browserCacheDir: installation.browserCacheDir || path.join(installation.dataRoot, "browser-cache"),
    ...(options.probeOptions || {}),
  });
  if (!readiness.ok) {
    throw installError(readiness.error.code, readiness.error.message, { installation, readiness });
  }
  return { ok: true, installation, readiness };
}

module.exports = { installStagingDependencies, prepareStagingReadiness };
