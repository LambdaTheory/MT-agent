#!/usr/bin/env node

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PRELOAD_PATH = path.join(__dirname, "lib", "lifecycle-test-preload.js");
const DEFAULT_GUARD_TIMEOUT_MS = 180000;
const MIN_GUARD_TIMEOUT_MS = 1000;
const MAX_GUARD_TIMEOUT_MS = 300000;

function resolveGuardTimeoutMs() {
  const raw = process.env.LIFECYCLE_TEST_GUARD_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_GUARD_TIMEOUT_MS;
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_GUARD_TIMEOUT_MS || timeoutMs > MAX_GUARD_TIMEOUT_MS) {
    const error = new Error("LIFECYCLE_TEST_GUARD_TIMEOUT_MS must be an integer from 1000 through 300000");
    error.code = "INVALID_GUARD_TIMEOUT";
    throw error;
  }
  return timeoutMs;
}

function cleanupGuardArtifacts(evidenceBase, eventPath, removeEvidence) {
  fs.rmSync(eventPath, { force: true });
  if (removeEvidence) fs.rmSync(evidenceBase, { force: true });
  const directory = path.dirname(evidenceBase);
  const prefix = path.basename(evidenceBase) + ".tmp-";
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    if (entry.startsWith(prefix)) fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
}

function bootstrapGuardedProcess() {
  if (require.main !== module || process.env.LIFECYCLE_TEST_GUARD === "1") return;
  const argv = process.argv.slice(2);
  if (!argv.includes("--offline") && !argv.includes("--forbid-saas")) return;
  let guardTimeoutMs;
  try {
    guardTimeoutMs = resolveGuardTimeoutMs();
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: "failed", code: error.code || "INVALID_GUARD_TIMEOUT", message: error.message }) + "\n");
    process.exit(2);
  }
  const evidenceIndex = argv.indexOf("--evidence");
  const evidenceBase = evidenceIndex >= 0 && argv[evidenceIndex + 1]
    ? path.resolve(argv[evidenceIndex + 1])
    : path.join(os.tmpdir(), "rental-price-agent-lifecycle-events-" + process.pid + ".json");
  const eventPath = evidenceBase + ".events.jsonl";
  cleanupGuardArtifacts(evidenceBase, eventPath, true);
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  const preloadOptionPath = PRELOAD_PATH.replace(/\\/g, "/");
  const nodeOptions = existingNodeOptions.includes("lifecycle-test-preload.js")
    ? existingNodeOptions
    : [existingNodeOptions, '--require="' + preloadOptionPath.replace(/"/g, '\\"') + '"'].filter(Boolean).join(" ");
  const child = childProcess.spawnSync(process.execPath, [__filename, ...argv], {
    cwd: process.cwd(),
    env: { ...process.env, LIFECYCLE_TEST_GUARD: "1", LIFECYCLE_TEST_EVIDENCE_PATH: eventPath, NODE_OPTIONS: nodeOptions },
    stdio: "inherit",
    timeout: guardTimeoutMs,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  const timedOut = child.error && child.error.code === "ETIMEDOUT";
  cleanupGuardArtifacts(evidenceBase, eventPath, timedOut || child.status === null);
  if (timedOut) {
    process.stdout.write(JSON.stringify({
      status: "failed",
      command: [process.execPath, path.join("scripts", "run-lifecycle-tests.js")].concat(argv),
      exitCode: 1,
      doneClaim: false,
      guardTimeoutMs,
      error: { code: "LIFECYCLE_GUARD_TIMEOUT", message: "Guarded lifecycle child exceeded " + guardTimeoutMs + "ms" },
    }, null, 2) + "\n");
  }
  process.exit(child.status === null ? 1 : child.status);
}

bootstrapGuardedProcess();

const support = require("./lib/lifecycle-test-support.js");

const SKILL_DIR = path.resolve(__dirname, "..");
const DEFAULT_CASES_DIR = path.join(SKILL_DIR, "test-fixtures", "lifecycle", "cases");
const FIXTURES_ROOT = path.join(SKILL_DIR, "test-fixtures", "lifecycle");

function formatPass(name) { return "[PASS] " + name; }
function formatFail(name) { return "[FAIL] " + name; }
function formatSummary(passed, total) { return passed + "/" + total + " tests passed"; }

function usage() {
  return [
    "Usage: node scripts/run-lifecycle-tests.js [options]",
    "  --case <name>       Run one registered case or all cases in a matching case module",
    "  --offline           Reject all non-loopback HTTP requests before socket creation",
    "  --forbid-saas       Reject SaaS-shaped URLs before socket creation",
    "  --evidence <path>   Write the JSON evidence document to a file",
    "  --help              Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { caseName: null, offline: false, forbidSaas: false, evidencePath: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--offline") options.offline = true;
    else if (argument === "--forbid-saas") options.forbidSaas = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--case" || argument === "--evidence") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw support.makeError("INVALID_CLI_ARGUMENT", "Missing value for " + argument);
      if (argument === "--case") options.caseName = value;
      else options.evidencePath = path.resolve(value);
    } else {
      throw support.makeError("INVALID_CLI_ARGUMENT", "Unknown argument: " + argument);
    }
  }
  return options;
}

function discoverCaseFiles(casesDir = DEFAULT_CASES_DIR) {
  if (!fs.existsSync(casesDir)) return [];
  return fs.readdirSync(casesDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".test.js"))
    .map(entry => path.join(casesDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function registerCases(caseFiles) {
  const tests = [];
  for (const caseFile of caseFiles) {
    delete require.cache[require.resolve(caseFile)];
    const caseModule = require(caseFile);
    if (!caseModule || typeof caseModule.register !== "function" || caseModule.register.constructor.name !== "AsyncFunction") {
      throw support.makeError("INVALID_CASE_MODULE", path.basename(caseFile) + " must export async function register({ test, assert, helpers })");
    }
    const source = path.basename(caseFile, ".test.js");
    const registerTest = (name, fn) => {
      if (typeof name !== "string" || !name.trim() || typeof fn !== "function") {
        throw support.makeError("INVALID_TEST_REGISTRATION", source + " registered an invalid test");
      }
      tests.push({ name: name.trim(), fn, source });
    };
    await caseModule.register({ test: registerTest, assert, helpers: null });
  }
  const duplicate = tests.find((item, index) => tests.findIndex(candidate => candidate.name === item.name) !== index);
  if (duplicate) throw support.makeError("DUPLICATE_CASE_NAME", "Duplicate lifecycle case: " + duplicate.name);
  return tests;
}

function selectTests(tests, caseName) {
  if (!caseName) return tests;
  const exact = tests.filter(test => test.name === caseName);
  if (exact.length) return exact;
  const moduleMatches = tests.filter(test => test.source === caseName);
  if (moduleMatches.length) return moduleMatches;
  throw support.makeError("CASE_NOT_FOUND", "Lifecycle case not found: " + caseName);
}

function makeHelpers(options, counters, proofs) {
  const http = support.createNetworkGuard({ offline: options.offline, forbidSaas: options.forbidSaas, counters });
  return {
    fixturesRoot: FIXTURES_ROOT,
    support,
    http,
    counters,
    formatPass,
    formatFail,
    formatSummary,
    recordProof(name, value = true) { proofs[name] = value; },
    createLifecycleFixture: support.createLifecycleFixture,
    createFaultInjectingFs: support.createFaultInjectingFs,
    createFakeProcessAdapter: support.createFakeProcessAdapter,
    createFakeDaemon(overrides = {}) { return support.createFakeDaemon(Object.assign({ counters }, overrides)); },
    createFakeBrowser(overrides = {}) {
      return support.createFakeBrowser(Object.assign({ counters, offline: options.offline, forbidSaas: options.forbidSaas }, overrides));
    },
    createSchemaFixture: support.createSchemaFixture,
    createReleaseFixture: support.createReleaseFixture,
    sha256: support.sha256,
    sha256File: support.sha256File,
    sha256Json: support.sha256Json,
    hashTree: support.hashTree,
    startFakeGiteeServer: support.startFakeGiteeServer,
  };
}

async function writeEvidence(filePath, evidence) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + ".tmp-" + process.pid;
  await fs.promises.writeFile(temporary, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  await fs.promises.rename(temporary, filePath);
}

function readGuardEvents() {
  const filePath = process.env.LIFECYCLE_TEST_EVIDENCE_PATH;
  if (process.env.LIFECYCLE_TEST_GUARD !== "1" || !filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function run(argv = process.argv.slice(2), runtime = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return {
      exitCode: 2,
      evidence: {
        status: "failed",
        command: [process.execPath, path.join("scripts", "run-lifecycle-tests.js")].concat(argv),
        exitCode: 2,
        error: { code: error.code || "INVALID_CLI_ARGUMENT", message: error.message },
      },
    };
  }
  if (options.help) return { exitCode: 0, help: usage(), evidence: null };

  support.resetHarnessState();
  const counters = support.createCounters();
  const proofs = {};
  const helpers = makeHelpers(options, counters, proofs);
  const results = [];
  const casesDir = runtime.casesDir || process.env.LIFECYCLE_CASES_DIR || DEFAULT_CASES_DIR;
  let selected = [];
  let fatalError = null;

  try {
    const files = discoverCaseFiles(casesDir);
    const registered = [];
    for (const caseFile of files) {
      delete require.cache[require.resolve(caseFile)];
      const caseModule = require(caseFile);
      if (!caseModule || typeof caseModule.register !== "function" || caseModule.register.constructor.name !== "AsyncFunction") {
        throw support.makeError("INVALID_CASE_MODULE", path.basename(caseFile) + " must export async function register({ test, assert, helpers })");
      }
      const source = path.basename(caseFile, ".test.js");
      await caseModule.register({
        test(name, fn) {
          if (typeof name !== "string" || !name.trim() || typeof fn !== "function") throw support.makeError("INVALID_TEST_REGISTRATION", source + " registered an invalid test");
          registered.push({ name: name.trim(), fn, source });
        },
        assert,
        helpers,
      });
    }
    const duplicate = registered.find((item, index) => registered.findIndex(candidate => candidate.name === item.name) !== index);
    if (duplicate) throw support.makeError("DUPLICATE_CASE_NAME", "Duplicate lifecycle case: " + duplicate.name);
    selected = selectTests(registered, options.caseName);
    if (!selected.length) throw support.makeError("NO_CASES_DISCOVERED", "No lifecycle cases were discovered in " + casesDir);

    for (const item of selected) {
      try {
        await item.fn();
        results.push({ name: item.name, source: item.source, status: "passed" });
        if (!runtime.quiet) process.stderr.write(formatPass(item.name) + "\n");
      } catch (error) {
        results.push({ name: item.name, source: item.source, status: "failed", error: String(error && error.stack ? error.stack : error) });
        if (!runtime.quiet) process.stderr.write(formatFail(item.name) + "\n" + String(error && error.stack ? error.stack : error) + "\n");
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    await support.cleanupAllFixtures(fatalError ? "runner-fatal" : "runner-finally");
  }

  const passed = results.filter(result => result.status === "passed").length;
  const telemetry = support.getHarnessTelemetry();
  const guardEvents = readGuardEvents();
  const interceptedNativeAttempts = guardEvents.filter(event => event.type === "network-intercepted").length;
  const actualLoopbackRequests = guardEvents.filter(event => event.type === "loopback-request").length;
  const mutationAttempts = guardEvents.filter(event => event.type === "action-attempt" && event.classification === "mutation").length;
  const handlerInvocations = guardEvents.filter(event => event.type === "handler-invocation").length;
  const successfulHandlerInvocations = guardEvents.filter(event => event.type === "handler-success").length;
  const mutationInvocations = guardEvents.filter(event => event.type === "handler-invocation" && event.classification === "mutation").length;
  const successfulMutationHandlerInvocations = guardEvents.filter(event => event.type === "handler-success" && event.classification === "mutation").length;
  const saasRequests = guardEvents.filter(event => event.type === "network-intercepted" && event.saas === true).length;
  const cleanupOk = telemetry.cleanupReceipts.every(receipt => receipt.removed && !receipt.existsAfterCleanup);
  const globalAssertions = {
    guardActive: (!options.offline && !options.forbidSaas) || process.env.LIFECYCLE_TEST_GUARD === "1",
    noInterceptedNativeAttempts: interceptedNativeAttempts === 0,
    noSaasRequests: saasRequests === 0,
    noMutationInvocations: mutationInvocations === 0,
  };
  const assertionsOk = Object.values(globalAssertions).every(Boolean);
  const exitCode = fatalError || passed !== selected.length || !cleanupOk || !assertionsOk ? 1 : 0;
  const evidence = {
    status: exitCode === 0 ? "passed" : "failed",
    command: [process.execPath, path.join("scripts", "run-lifecycle-tests.js")].concat(argv),
    exitCode,
    selectedCase: options.caseName,
    flags: { offline: options.offline, forbidSaas: options.forbidSaas },
    guardTimeoutMs: process.env.LIFECYCLE_TEST_GUARD === "1" ? resolveGuardTimeoutMs() : null,
    discoveredCases: discoverCaseFiles(casesDir).map(file => path.basename(file)),
    results,
    summary: { passed, total: selected.length, text: formatSummary(passed, selected.length) },
    fixturePath: telemetry.tempParent,
    fixturePaths: telemetry.cleanupReceipts.map(receipt => receipt.root),
    doneClaim: exitCode === 0,
    doneClaimScope: options.caseName ? "selected-case" : "full-lifecycle",
    saasRequests,
    mutationAttempts,
    mutationInvocations,
    handlerInvocations,
    successfulHandlerInvocations,
    successfulMutationHandlerInvocations,
    interceptedNativeAttempts,
    actualLoopbackRequests,
    requestCount: counters.requests,
    networkAttempts: counters.networkAttempts,
    globalAssertions,
    beforeHashes: telemetry.cleanupReceipts.map(receipt => ({ root: receipt.root, sha256: receipt.beforeHash })),
    afterHashes: telemetry.cleanupReceipts.map(receipt => ({ root: receipt.root, sha256: receipt.afterHash })),
    cleanup: { ok: cleanupOk, receipts: telemetry.cleanupReceipts },
    proofs,
  };
  if (fatalError) evidence.error = { code: fatalError.code || "HARNESS_ERROR", message: fatalError.message, stack: String(fatalError.stack || fatalError) };
  if (!runtime.quiet) process.stderr.write("\n" + evidence.summary.text + "\n");
  const evidencePath = options.evidencePath || (options.caseName === "harness-self-test"
    ? path.join(SKILL_DIR, ".omo", "evidence", "task-3-rental-price-agent-lifecycle.json")
    : null);
  if (evidencePath) {
    evidence.evidencePath = evidencePath;
    await writeEvidence(evidencePath, evidence);
  }
  if (process.env.LIFECYCLE_TEST_GUARD === "1" && process.env.LIFECYCLE_TEST_EVIDENCE_PATH) {
    fs.rmSync(process.env.LIFECYCLE_TEST_EVIDENCE_PATH, { force: true });
  }
  return { exitCode, evidence };
}

async function main() {
  let interrupting = false;
  const interrupt = signal => {
    if (interrupting) return;
    interrupting = true;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    support.cleanupAllFixtures("interrupt-" + signal.toLowerCase()).finally(() => process.exit(exitCode));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  const onMessage = message => {
    if (message === "lifecycle-test-interrupt") interrupt("IPC");
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.on("message", onMessage);
  try {
    const result = await run();
    if (result.help) process.stdout.write(result.help + "\n");
    else process.stdout.write(JSON.stringify(result.evidence, null, 2) + "\n");
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "failed", exitCode: 1, error: { code: error.code || "HARNESS_ERROR", message: error.message } }, null, 2) + "\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("message", onMessage);
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_GUARD_TIMEOUT_MS,
  DEFAULT_CASES_DIR,
  discoverCaseFiles,
  formatFail,
  formatPass,
  formatSummary,
  parseArgs,
  resolveGuardTimeoutMs,
  registerCases,
  run,
  selectTests,
  usage,
};
