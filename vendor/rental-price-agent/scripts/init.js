#!/usr/bin/env node

/**
 * Skill initialization — checks environment, validates config, tests connectivity.
 *
 * Usage: node scripts/init.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadConfig, SKILL_DIR, CONFIG_PATH } = require("./lib/config-loader");

const EXAMPLE_PATH = SKILL_DIR + "/config.example.json";

function log(msg) { process.stderr.write("[init] " + msg + "\n"); }
function ok(msg) { process.stderr.write("  ✅ " + msg + "\n"); }
function warn(msg) { process.stderr.write("  ⚠️  " + msg + "\n"); }
function fail(msg) { process.stderr.write("  ❌ " + msg + "\n"); }

// ================================================================
// 1. Node version
// ================================================================
function checkNode() {
  const v = process.version;
  const major = parseInt(v.replace("v", "").split(".")[0]);
  if (major >= 18) { ok("Node " + v); return true; }
  fail("Node " + v + " — need 18+"); return false;
}

// ================================================================
// 2. Playwright
// ================================================================
function checkPlaywright() {
  try {
    require.resolve("playwright");
    ok("Playwright installed");
    return true;
  } catch {
    warn("Playwright not found. Installing...");
    try {
      execSync("npm install playwright", { cwd: SKILL_DIR, stdio: "pipe" });
      execSync("npx playwright install chromium", { cwd: SKILL_DIR, stdio: "pipe" });
      ok("Playwright installed");
      return true;
    } catch (e) {
      fail("Playwright install failed: " + e.message);
      return false;
    }
  }
}

// ================================================================
// 3. Config
// ================================================================
function checkConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
      warn("config.json created from example. Fill in credentials.");
    } else {
      fail("No config.json or config.example.json found");
      return null;
    }
  }
  try {
    const cfg = loadConfig();
    const issues = [];

    if (!cfg.saas?.baseUrl || cfg.saas.baseUrl.includes("<")) issues.push("saas.baseUrl");
    if (!cfg.saas?.loginUrl || cfg.saas.loginUrl.includes("<")) issues.push("saas.loginUrl");
    if (!cfg.saas?.productDetailUrl || cfg.saas.productDetailUrl.includes("<")) issues.push("saas.productDetailUrl");
    if (!cfg.saas?.credentials?.username || cfg.saas.credentials.username.includes("<")) issues.push("saas.credentials.username");
    if (!cfg.saas?.credentials?.password || cfg.saas.credentials.password.includes("<")) issues.push("saas.credentials.password");
    if (!cfg.mirror?.baseUrl || cfg.mirror.baseUrl.includes("<")) issues.push("mirror.baseUrl");
    if (!cfg.mirror?.apiKey || cfg.mirror.apiKey.includes("<")) issues.push("mirror.apiKey");

    if (issues.length > 0) {
      warn("Config incomplete: " + issues.join(", "));
      return cfg;
    }
    ok("config.json valid");
    return cfg;
  } catch (e) {
    fail("config.json parse error: " + e.message);
    return null;
  }
}

// ================================================================
// 4. SaaS connectivity
// ================================================================
async function checkSaaS(cfg) {
  if (!cfg?.saas?.baseUrl) { warn("SaaS check skipped (no baseUrl)"); return false; }
  try {
    const resp = await fetch(cfg.saas.baseUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (resp.ok || resp.status < 500) { ok("SaaS reachable: " + cfg.saas.baseUrl); return true; }
    warn("SaaS returned " + resp.status);
    return false;
  } catch (e) {
    warn("SaaS unreachable: " + e.message);
    return false;
  }
}

// ================================================================
// 5. Mirror API connectivity
// ================================================================
async function checkMirror(cfg) {
  if (!cfg?.mirror?.baseUrl || !cfg?.mirror?.apiKey) { warn("Mirror check skipped (no config)"); return false; }
  try {
    const resp = await fetch(cfg.mirror.baseUrl + "/skill/products/search?limit=1", {
      headers: { "X-API-Key": cfg.mirror.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) { ok("Mirror API reachable"); return true; }
    if (resp.status === 401) { warn("Mirror API: invalid key"); return false; }
    warn("Mirror API returned " + resp.status);
    return false;
  } catch (e) {
    warn("Mirror API unreachable: " + e.message);
    return false;
  }
}

// ================================================================
// Main
// ================================================================
async function main() {
  log("Rental Price Agent — Initialization");
  log("");

  const results = {};

  results.node = checkNode();
  results.playwright = checkPlaywright();
  const cfg = checkConfig();
  results.config = cfg !== null;

  if (cfg) {
    results.saas = await checkSaaS(cfg);
    results.mirror = await checkMirror(cfg);
  }

  log("");
  log("=== Summary ===");
  for (const [k, v] of Object.entries(results)) {
    process.stderr.write("  " + (v ? "✅" : "❌") + " " + k + "\n");
  }

  const allOk = Object.values(results).every(Boolean);
  if (allOk) {
    log("");
    log("All checks passed. Ready to use.");
    log("Start: node scripts/playwright-runner.js daemon start");
  } else {
    log("");
    log("Some checks failed. Fix the ❌ items above before using the skill.");
  }
}

main().catch(e => { fail(e.message); process.exit(1); });
