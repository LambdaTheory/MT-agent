#!/usr/bin/env node

const path = require("path");
const { probeBrowserPolicy } = require("./lib/browser-probe");
const { runDoctor } = require("./lifecycle");

const SKILL_DIR = path.resolve(__dirname, "..");

function log(message) {
  process.stderr.write("[init] " + message + "\n");
}

function usage() {
  return [
    "Usage: node scripts/init.js [--target <absolute-path>] [--json] [--quiet]",
    "  --target <absolute-path>  Run the read-only initialization check for one install target",
    "  --json                    Write the init result JSON to stdout",
    "  --quiet                   Suppress stderr summary lines",
    "  --help                    Show this help",
    "  Without --target, init checks the current skill directory only. It does not infer an install target.",
  ].join("\n");
}

function parseCliArgs(argv) {
  const options = { targetDir: SKILL_DIR, json: false, quiet: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--target") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        const error = new Error("--target requires an absolute path");
        error.code = "INVALID_INSTALL_TARGET";
        throw error;
      }
      options.targetDir = value;
    } else if (argument.startsWith("--target=")) options.targetDir = argument.slice("--target=".length);
    else {
      const error = new Error("Unknown argument: " + argument);
      error.code = "INVALID_ARGUMENT";
      throw error;
    }
  }
  return options;
}

async function checkBrowserReadiness(config, options = {}) {
  const probe = options.probeBrowserPolicy || probeBrowserPolicy;
  const result = await probe(config && config.browser, options.probeOptions || {});
  return result.ok;
}

async function runInitialization(options = {}) {
  const targetDir = options.targetDir || SKILL_DIR;
  const doctor = options.runDoctor || runDoctor;
  const result = await doctor({
    targetDir,
    probeBrowserPolicy: options.probeBrowserPolicy,
    probeOptions: options.probeOptions,
    nodeVersion: options.nodeVersion,
  });
  if (!options.quiet) {
    log("Rental Price Agent — read-only initialization check");
    for (const item of result.checks) {
      const marker = item.status === "pass" ? "PASS" : item.status === "warn" ? "WARN" : "FAIL";
      log(marker + " [" + item.code + "] " + item.message);
    }
    log("readyForReads=" + result.readyForReads + " readyForWrites=" + result.readyForWrites);
    if (!result.readyForWrites) log("No files were created or changed. Fix blockers, then rerun doctor.");
  }
  return {
    exitCode: result.blockers.length === 0 ? 0 : 1,
    results: {
      doctor: result.blockers.length === 0,
      readyForReads: result.readyForReads,
      readyForWrites: result.readyForWrites,
    },
    doctor: result,
  };
}

async function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    return {
      exitCode: 2,
      result: { status: "error", code: error.code || "INIT_DOCTOR_FAILED", message: error.message },
      help: null,
    };
  }
  if (options.help) return { exitCode: 0, result: null, help: usage() };
  const result = await runInitialization({ targetDir: options.targetDir, quiet: options.quiet });
  return { exitCode: result.exitCode, result, help: null, json: options.json };
}

if (require.main === module) {
  runCli()
    .then(({ exitCode, result, help, json }) => {
      if (help) process.stdout.write(help + "\n");
      else if (json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = exitCode;
    })
    .catch(error => {
      process.stderr.write(JSON.stringify({ status: "error", code: error.code || "INIT_DOCTOR_FAILED", message: error.message }) + "\n");
      process.exitCode = 1;
    });
}

module.exports = { checkBrowserReadiness, parseCliArgs, runCli, runInitialization, usage };
