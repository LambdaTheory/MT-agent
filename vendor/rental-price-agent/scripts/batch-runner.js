#!/usr/bin/env node

/**
 * Batch Runner — multi-product orchestration with per-product changes.
 *
 * Commands:
 *   node batch-runner.js preview  <spec.json>   — dry run, show batch diff
 *   node batch-runner.js execute  <spec.json>   — real execution
 *   node batch-runner.js resume                 — continue
 *   node batch-runner.js status                 — progress
 *
 * Spec format:
 * {
 *   "items": [
 *     { "productId": 761, "fields": { "rent1day": "22.00" } },
 *     { "productId": 762, "fields": { "rent1day": "25.00" } }
 *   ],
 *   "shared": { "tenancySet": "1,10,30" },
 *   "options": { "stopOnError": true }
 * }
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./lib/config-loader");
const { checkRules } = require("./lib/rule-checker");

const SKILL_DIR = path.resolve(__dirname, "..");
const PORT_FILE = SKILL_DIR + "/.daemon.port";
const TOKEN_FILE = SKILL_DIR + "/.daemon.token";
const BATCH_DIR = SKILL_DIR + "/tasks/batches";

function getDaemonPort() {
  if (!fs.existsSync(PORT_FILE)) return null;
  return Number(fs.readFileSync(PORT_FILE, "utf-8").trim());
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function log(msg) { process.stderr.write("[batch] " + msg + "\n"); }
function die(msg) { process.stderr.write("[batch] ERROR: " + msg + "\n"); process.exit(1); }
function output(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function readDaemonToken() { return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf-8").trim() : ""; }

function isNestedChanges(changes) {
  const firstVal = Object.values(changes || {})[0];
  return typeof firstVal === "object" && firstVal !== null && !Array.isArray(firstVal);
}

function compareValues(actualValues, expectedChanges) {
  const matched = [], mismatched = [], checks = [];
  const expected = expectedChanges || {};
  if (isNestedChanges(expected)) {
    for (const [specId, expectedFields] of Object.entries(expected)) {
      const sv = actualValues[specId];
      if (!sv) {
        const item = { specId, field: "(all)", expected: JSON.stringify(expectedFields), actual: "(spec not found)", match: false };
        mismatched.push(item); checks.push(item);
        continue;
      }
      for (const [field, expectedVal] of Object.entries(expectedFields)) {
        const actual = sv[field];
        const item = { specId, field, expected: String(expectedVal), actual: actual || "(missing)", match: actual !== undefined && actual === String(expectedVal) };
        if (item.match) matched.push(item); else mismatched.push(item);
        checks.push(item);
      }
    }
  } else {
    for (const [specId, sv] of Object.entries(actualValues || {})) {
      for (const [field, expectedVal] of Object.entries(expected)) {
        const actual = sv[field];
        const item = { specId, field, expected: String(expectedVal), actual: actual || "(missing)", match: actual !== undefined && actual === String(expectedVal) };
        if (item.match) matched.push(item); else mismatched.push(item);
        checks.push(item);
      }
    }
  }
  return { matched, mismatched, checks };
}

function addDiffEntry(diff, warnings, productId, specId, field, oldVal, newVal, rules) {
  if (oldVal === undefined) {
    const entry = {
      specId,
      field,
      old: "(missing)",
      new: String(newVal),
      change: "N/A",
      pct: "N/A",
      status: "error",
      issues: [{ level: "error", message: "Field not found on target spec" }],
    };
    diff.push(entry);
    warnings.push({ productId, ...entry });
    return;
  }
  const oldNum = Number(oldVal);
  const newNum = Number(newVal);
  const change = (newNum - oldNum).toFixed(2);
  const pct = oldNum !== 0 ? ((newNum - oldNum) / Math.abs(oldNum) * 100).toFixed(1) : "N/A";
  const entry = { specId, field, old: oldVal, new: String(newVal), change, pct: pct + "%" };
  const issues = checkRules(field, oldVal, newVal, rules);
  if (issues.length > 0) {
    entry.issues = issues;
    entry.status = issues.some(i => i.level === "error") ? "error" : "warn";
    warnings.push({ productId, ...entry });
  }
  diff.push(entry);
}

function addMissingSpecDiff(diff, warnings, productId, specId, fields) {
  const entry = {
    specId,
    field: "(all)",
    old: "(spec not found)",
    new: JSON.stringify(fields),
    change: "N/A",
    pct: "N/A",
    status: "error",
    issues: [{ level: "error", message: "Spec not found" }],
  };
  diff.push(entry);
  warnings.push({ productId, ...entry });
}

function addReadErrorDiff(diff, warnings, productId, readR) {
  const message = readR && readR.message ? readR.message : "read failed";
  const entry = {
    specId: "(read)",
    field: "(all)",
    old: "(unavailable)",
    new: "(unavailable)",
    change: "N/A",
    pct: "N/A",
    status: "error",
    issues: [{ level: "error", message }],
  };
  diff.push(entry);
  warnings.push({ productId, ...entry });
}

function failBeforeApply(result, step, response) {
  result.status = "failed";
  result.error = step + " failed before apply";
  result[step.replace(/-/g, "") + "Result"] = response;
  result.steps.push({ step: "abort", reason: step + "_not_ok", status: response && response.status });
  return result;
}

function buildReadbackFailure(verifyR) {
  const message = verifyR && verifyR.message ? verifyR.message : "readback returned no values";
  return {
    total: 1,
    matched: 0,
    mismatched: 1,
    mismatches: [{ specId: "(readback)", field: "(all)", expected: "values", actual: message, match: false }],
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function mergeSpecAddItems(base, override) {
  const merged = {};
  for (const [dimId, titles] of Object.entries(base || {})) {
    merged[dimId] = toList(titles);
  }
  for (const [dimId, titles] of Object.entries(override || {})) {
    merged[dimId] = [...new Set([...(merged[dimId] || []), ...toList(titles)])];
  }
  return merged;
}

function normalizeSetup(setup) {
  const normalized = {};
  if (!isPlainObject(setup)) return normalized;

  if (setup.tenancySet !== undefined) normalized.tenancySet = setup.tenancySet;
  if (setup.days !== undefined) normalized.tenancySet = setup.days;
  if (setup.specAddItems !== undefined) normalized.specAddItems = setup.specAddItems;
  if (setup.addItems !== undefined) normalized.specAddItems = setup.addItems;

  if (isPlainObject(setup.tenancy)) Object.assign(normalized, normalizeSetup(setup.tenancy));
  if (isPlainObject(setup.spec)) Object.assign(normalized, normalizeSetup(setup.spec));
  if (isPlainObject(setup.setup)) Object.assign(normalized, normalizeSetup(setup.setup));
  if (isPlainObject(setup.shared)) Object.assign(normalized, normalizeSetup(setup.shared));
  if (isPlainObject(setup.sharedSetup)) Object.assign(normalized, normalizeSetup(setup.sharedSetup));

  return normalized;
}

function mergeSetup(globalSetup, item) {
  const globalNormalized = normalizeSetup(globalSetup);
  const itemNormalized = normalizeSetup(item);
  const merged = { ...globalNormalized };
  if (Object.prototype.hasOwnProperty.call(itemNormalized, "tenancySet")) merged.tenancySet = itemNormalized.tenancySet;
  if (globalNormalized.specAddItems || itemNormalized.specAddItems) {
    merged.specAddItems = mergeSpecAddItems(globalNormalized.specAddItems, itemNormalized.specAddItems);
  }
  return merged;
}

function hasFormSetup(setup) {
  return Boolean(setup && (setup.tenancySet || (setup.specAddItems && Object.keys(setup.specAddItems).length > 0)));
}

function normalizeBatchItem(spec, item) {
  return {
    productId: item.productId,
    changes: item.fields || item.changes || {},
    setup: mergeSetup(spec.shared || spec.sharedSetup || {}, item),
  };
}

function batchHasFormSetup(spec) {
  return (spec.items || []).some(item => hasFormSetup(normalizeBatchItem(spec, item).setup));
}

function requireFormSetupExecutionConfirmation(spec) {
  if (!batchHasFormSetup(spec)) return;
  if (spec.options && spec.options.confirmFormSetupWithoutPreview === true) return;
  die("Batch contains form-level setup (tenancySet/specAddItems). Preview is blocked for this structure; set options.confirmFormSetupWithoutPreview=true only after explicit user confirmation.");
}

function addSetupPreviewBlockedDiff(diff, warnings, productId, setup) {
  const setupSummary = {
    tenancySet: setup.tenancySet || null,
    specAddItems: setup.specAddItems || null,
  };
  const message = "Batch preview with form-level setup is blocked because it would not reflect refreshed specs/tenancy; use execute only after implementing form-setup dry-run preview";
  const entry = {
    specId: "(setup)",
    field: "(form-level)",
    old: "(current server structure)",
    new: JSON.stringify(setupSummary),
    change: "N/A",
    pct: "N/A",
    status: "error",
    issues: [{ level: "error", message }],
  };
  diff.push(entry);
  warnings.push({ productId, setup: setupSummary, ...entry });
}

// ================================================================
// Daemon communication
// ================================================================

function send(cmd) {
  const port = getDaemonPort();
  if (!port) die("Daemon not running. Start: playwright-runner.js daemon start");
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(cmd);
    const token = readDaemonToken();
    const req = http.request({
      hostname: "127.0.0.1", port, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "X-Rental-Agent-Token": token },
    }, (res) => {
      let body = ""; res.on("data", c => body += c);
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

// ================================================================
// Single product pipeline
// ================================================================

async function processProduct(productId, changes, shared) {
  const result = { productId, steps: [], status: "ok" };
  let formValues = null; // values from current page state (after spec/tenancy changes)
  let onFormPage = false; // once true, do not navigate again before submit or unsaved setup changes are lost

  try {
    // Shared setup: tenancy (returns new structure values)
    if (shared.tenancySet) {
      const r = await send({ action: "tenancy-set", productId, days: shared.tenancySet });
      result.steps.push({ step: "tenancy-set", ...r });
      if (!r || r.status !== "ok") return failBeforeApply(result, "tenancy-set", r);
      if (r.values) formValues = r.values;
      onFormPage = true;
    }
    // Shared setup: spec items (atomic add-and-refresh, returns new structure values)
    if (shared.specAddItems) {
      for (const [dimId, titles] of Object.entries(shared.specAddItems)) {
        for (const title of titles) {
          const cmd = { action: "spec-add-and-refresh", specDimId: dimId, itemTitle: title, expectedProductId: productId };
          if (!onFormPage) cmd.productId = productId;
          else cmd.allowCurrentPage = true;
          const r = await send(cmd);
          result.steps.push({ step: "spec-add-and-refresh", ...(r || {}) });
          if (!r || r.status !== "ok") return failBeforeApply(result, "spec-add-and-refresh", r);
          if (r.values) formValues = r.values;
          onFormPage = true;
        }
      }
    }
    // Read: use form values from spec/tenancy if available, otherwise read from server
    if (formValues) {
      result.currentValues = formValues;
      result.steps.push({ step: "read", source: "form_state" });
    } else {
      const readR = await send({ action: "read", productId });
      result.steps.push({ step: "read", ...readR });
      if (!readR || readR.status !== "ok" || !readR.values) return failBeforeApply(result, "read", readR);
      result.currentValues = readR.values;
    }
    // Apply. If form-level structure changed, stay on current page to avoid losing unsaved changes.
    ensureDir(BATCH_DIR);
    const f = BATCH_DIR + "/changes_" + productId + ".json";
    fs.writeFileSync(f, JSON.stringify(changes), "utf-8");
    const applyAction = formValues ? "apply-current" : "apply";
    const applyR = formValues
      ? await send({ action: "apply-current", changesFile: f, allowCurrentPage: true, expectedProductId: productId })
      : await send({ action: "apply", productId, changesFile: f });
    result.steps.push({ step: applyAction, ...applyR });
    if (!applyR || applyR.status !== "ok") {
      result.status = "failed";
      result.error = "Apply failed before submit";
      result.applyResult = applyR;
      result.steps.push({ step: "abort", reason: "apply_not_ok", applyStatus: applyR && applyR.status });
      return result;
    }
    // Submit
    const submitR = await send({ action: "submit" });
    result.steps.push({ step: "submit", ...submitR });
    if (submitR.status === "error") {
      result.status = "failed";
      result.error = "Submit failed";
      result.submitResult = submitR;
      return result;
    }
    if (submitR.status === "unknown") {
      result.warnings = result.warnings || [];
      result.warnings.push("Submit result unknown; readback verification required");
    }
    // Verify: read and compare with expected values
    const verifyR = await send({ action: "read", productId });
    if (!verifyR || verifyR.status === "error" || !verifyR.values) {
      result.status = "verify_failed";
      result.verifyResult = buildReadbackFailure(verifyR);
      result.steps.push({ step: "verify", status: "error", ...result.verifyResult });
      return result;
    }
    const { matched, mismatched } = compareValues(verifyR.values, changes);
    result.finalValues = verifyR.values;
    result.verifyResult = { total: matched.length + mismatched.length, matched: matched.length, mismatched: mismatched.length, mismatches: mismatched };
    if (mismatched.length > 0) {
      result.status = "verify_failed";
      result.steps.push({ step: "verify", status: "mismatch", ...result.verifyResult });
    } else {
      result.steps.push({ step: "verify", status: "ok", matched: matched.length });
    }
  } catch (err) {
    result.status = "failed"; result.error = err.message;
    result.steps.push({ step: "error", message: err.message });
  }
  return result;
}

// ================================================================
// Preview
// ================================================================

async function batchPreview(spec) {
  await send({ action: "login" });

  const cfg = loadConfig();
  const rules = cfg.rules || {};
  const items = spec.items || [];
  const previews = [];
  const warnings = [];

  for (const item of items) {
    const normalized = normalizeBatchItem(spec, item);
    const pid = normalized.productId;
    log("Previewing " + pid + "...");
    const diff = [];
    if (hasFormSetup(normalized.setup)) {
      addSetupPreviewBlockedDiff(diff, warnings, pid, normalized.setup);
      previews.push({ productId: pid, setup: normalized.setup, specs: [], diff });
      continue;
    }
    const readR = await send({ action: "read", productId: pid });
    const itemFields = normalized.changes;
    if (!readR || readR.status === "error" || !readR.values) {
      addReadErrorDiff(diff, warnings, pid, readR);
      previews.push({ productId: pid, specs: readR && readR.specs ? readR.specs : [], diff });
      continue;
    }

    if (isNestedChanges(itemFields)) {
      for (const [targetSpecId, fields] of Object.entries(itemFields)) {
        const values = readR.values || {};
        if (!Object.prototype.hasOwnProperty.call(values, targetSpecId)) {
          addMissingSpecDiff(diff, warnings, pid, targetSpecId, fields);
          continue;
        }
        const sv = values[targetSpecId] || {};
        for (const [field, newVal] of Object.entries(fields)) {
          addDiffEntry(diff, warnings, pid, targetSpecId, field, sv[field], newVal, rules);
        }
      }
    } else {
      for (const [field, newVal] of Object.entries(itemFields)) {
        for (const [specId, sv] of Object.entries(readR.values || {})) {
          addDiffEntry(diff, warnings, pid, specId, field, sv[field], newVal, rules);
        }
      }
    }
    previews.push({ productId: pid, specs: readR.specs, diff });
  }

  return { previews, warnings, hasErrors: warnings.some(w => w.status === "error"), hasWarnings: warnings.some(w => w.status === "warn") };
}

// ================================================================
// Execute
// ================================================================

async function batchExecute(spec) {
  requireFormSetupExecutionConfirmation(spec);
  ensureDir(BATCH_DIR);
  await send({ action: "login" });
  const items = spec.items || [];
  const batchId = "batch_" + Date.now();
  const stateFile = BATCH_DIR + "/" + batchId + "_state.json";

  const state = { batchId, spec, total: items.length, completed: [], verifyFailed: [], failed: [], current: null, status: "running", startedAt: new Date().toISOString() };
  if (spec.resumeFrom) state.resumeFrom = spec.resumeFrom;
  if (spec.resumedAt) state.resumedAt = spec.resumedAt;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  log("Batch " + batchId + ": " + items.length + " items");

  let stopped = false;
  for (const item of items) {
    const pid = item.productId;
    state.current = pid; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    log("[" + (state.completed.length + 1) + "/" + state.total + "] " + pid);
    const normalized = normalizeBatchItem(spec, item);
    const result = await processProduct(pid, normalized.changes, normalized.setup);
    if (result.status === "ok") { state.completed.push(result); log("  OK"); }
    else if (result.status === "verify_failed") { state.verifyFailed.push(result); log("  WARN: verify mismatch"); }
    else {
      state.failed.push(result);
      log("  FAIL: " + result.error);
      if (spec.options && spec.options.stopOnError) { stopped = true; state.status = "stopped"; break; }
    }
  }
  state.current = null;
  if (stopped) state.status = "stopped";
  else if (state.failed.length > 0) state.status = "partial";
  else if (state.verifyFailed.length > 0) state.status = "completed_with_mismatch";
  else state.status = "completed";
  state.finishedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const report = { batchId, total: state.total, success: state.completed.length, verifyFailed: state.verifyFailed.length, failed: state.failed.length, status: state.status, items: state.completed.concat(state.verifyFailed || [], state.failed) };
  output(report);
  return { report, stateFile, state };
}

// ================================================================
// Resume
// ================================================================

async function batchResume() {
  ensureDir(BATCH_DIR);
  const files = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith("_state.json")).sort((a, b) => fs.statSync(BATCH_DIR + "/" + b).mtimeMs - fs.statSync(BATCH_DIR + "/" + a).mtimeMs);
  if (files.length === 0) die("No batch to resume");
  const statePath = BATCH_DIR + "/" + files[0];
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  if (state.status === "completed" || state.status === "completed_with_mismatch" || state.status === "delayed_verified") die("Last batch completed");
  const doneIds = new Set((state.completed || []).concat(state.verifyFailed || [], state.failed || []).map(x => x.productId));
  const remaining = state.spec.items.filter(item => !doneIds.has(item.productId));
  log("Resuming: " + remaining.length + " remaining of " + state.total);
  const resumedAt = new Date().toISOString();
  const resumed = await batchExecute({ items: remaining, shared: state.spec.shared || state.spec.sharedSetup, sharedSetup: state.spec.sharedSetup, options: state.spec.options, resumeFrom: state.batchId, resumedAt });
  state.resumedAt = resumedAt;
  state.resumedTo = resumed.state.batchId;
  state.resumeStateFile = path.basename(resumed.stateFile);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ================================================================
// Delayed Verify
// ================================================================

async function batchDelayedVerify(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  const completed = state.completed || [];
  if (completed.length === 0) die("No completed products to verify");

  await send({ action: "login" });
  log("Delayed verify: " + completed.length + " products");

  const results = [];
  const changesMap = {};
  if (state.spec && state.spec.items) {
    for (const item of state.spec.items) {
      changesMap[item.productId] = item.fields || item.changes || {};
    }
  }

  for (const entry of completed) {
    const pid = entry.productId;
    log("Verifying " + pid + "...");

    try {
      const readR = await send({ action: "read", productId: String(pid) });
      const current = readR.values || {};
      const expected = changesMap[pid] || {};
      const { checks } = compareValues(current, expected);

      const passed = checks.filter(c => c.match).length;
      const failed = checks.filter(c => !c.match).length;
      results.push({ productId: pid, status: failed === 0 ? "verified" : "mismatch", total: checks.length, passed, failed, checks });
      log("  " + (failed === 0 ? "✓" : "✗") + " " + passed + "/" + checks.length + " matched");
    } catch (err) {
      results.push({ productId: pid, status: "error", error: err.message });
      log("  ✗ ERROR: " + err.message);
    }
  }

  // Update state
  state.delayedVerify = { at: new Date().toISOString(), results };
  state.status = results.every(r => r.status === "verified") ? "delayed_verified" : "delayed_verify_partial";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const summary = { total: results.length, verified: results.filter(r => r.status === "verified").length, mismatch: results.filter(r => r.status === "mismatch").length, error: results.filter(r => r.status === "error").length, results };
  output(summary);
}

// ================================================================
// Audit Report
// ================================================================

async function batchReport(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  const completed = state.completed || [];
  const verifyFailed = state.verifyFailed || [];
  const failed = state.failed || [];

  log("=== Batch Audit Report ===");
  log("Batch: " + state.batchId);
  log("Started: " + state.startedAt);
  log("Finished: " + (state.finishedAt || "N/A"));
  log("Status: " + state.status);
  log("Products: " + state.total + " total, " + completed.length + " done, " + verifyFailed.length + " verify_failed, " + failed.length + " failed");
  log("");

  for (const entry of completed) {
    log("--- Product " + entry.productId + " ---");
    if (entry.currentValues) {
      for (const [specId, sv] of Object.entries(entry.currentValues)) {
        log("  " + specId + ": " + JSON.stringify(sv));
      }
    }
    if (entry.finalValues && entry.currentValues) {
      log("  Changes:");
      for (const [specId, sv] of Object.entries(entry.finalValues)) {
        const before = entry.currentValues[specId] || {};
        for (const [field, after] of Object.entries(sv)) {
          const beforeVal = before[field];
          if (beforeVal !== undefined && beforeVal !== after) {
            log("    " + field + ": " + beforeVal + " → " + after);
          }
        }
      }
    }
    if (entry.verifyResult) {
      log("  Verify: " + entry.verifyResult.matched + "/" + entry.verifyResult.total + " matched");
      if (entry.verifyResult.mismatched > 0) {
        log("  Mismatches:");
        for (const m of entry.verifyResult.mismatches) {
          log("    " + m.specId + " " + m.field + ": expected " + m.expected + ", got " + m.actual);
        }
      }
    }
    log("");
  }

  if (verifyFailed.length > 0) {
    log("=== Verify Failed ===");
    for (const f of verifyFailed) log("  " + f.productId + ": " + ((f.verifyResult && f.verifyResult.mismatched) || 0) + " mismatches");
  }

  if (failed.length > 0) {
    log("=== Failed ===");
    for (const f of failed) log("  " + f.productId + ": " + (f.error || "unknown"));
  }

  if (state.delayedVerify) {
    const dv = state.delayedVerify;
    log("=== Delayed Verify ===");
    log("At: " + dv.at);
    log("Results: " + dv.results.filter(r => r.status === "verified").length + "/" + dv.results.length + " verified");
  }
}

// ================================================================
// Rollback
// ================================================================

async function batchRollback(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  const completed = state.completed || [];
  if (completed.length === 0) die("No completed products to rollback");

  // Build reverse spec from currentValues (before state)
  const items = [];
  for (const entry of completed) {
    const reverse = {};
    const priceFields = ["stock", "rent1day", "rent10day", "rent30day", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"];
    if (entry.currentValues) {
      for (const [specId, sv] of Object.entries(entry.currentValues)) {
        reverse[specId] = {};
        for (const [field, val] of Object.entries(sv)) {
          if (priceFields.includes(field)) reverse[specId][field] = val;
        }
      }
    }
    if (Object.keys(reverse).length > 0) {
      items.push({ productId: entry.productId, fields: reverse });
    }
  }

  if (items.length === 0) die("No rollback data found in state");

  log("Rollback: " + items.length + " products to restore");
  const spec = { items, options: { stopOnError: false } };

  // Preview first
  const preview = await batchPreview(spec);
  log("");
  log("=== Rollback Preview ===");
  for (const p of preview.previews || preview) {
    log("Product " + p.productId + ":");
    for (const d of p.diff || []) {
      log("  " + d.field + ": " + d.old + " → " + d.new + " (" + d.change + ")");
    }
  }
  if (preview.hasErrors) { log("WARNING: Rule violations detected!"); log(JSON.stringify(preview.warnings)); }

  // Ask user for confirmation before rolling back
  log("");
  log("Review the preview above.");
  log("To confirm rollback: batch-runner.js rollback --confirm " + statePath);

  return { preview, items, statePath };
}

async function batchRollbackConfirm(statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  const completed = state.completed || [];

  const items = [];
  for (const entry of completed) {
    const reverse = {};
    const priceFields = ["stock", "rent1day", "rent10day", "rent30day", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"];
    if (entry.currentValues) {
      for (const [specId, sv] of Object.entries(entry.currentValues)) {
        reverse[specId] = {};
        for (const [field, val] of Object.entries(sv)) {
          if (priceFields.includes(field)) reverse[specId][field] = val;
        }
      }
    }
    if (Object.keys(reverse).length > 0) items.push({ productId: entry.productId, fields: reverse });
  }

  log("Executing rollback for " + items.length + " products...");
  await batchExecute({ items, options: { stopOnError: false } });
  // Verify rollback: re-read and compare with expected (currentValues from state)
  log("Verifying rollback...");
  await send({ action: "login" });
  const results = [];
  for (const entry of completed) {
    const pid = entry.productId;
    const readR = await send({ action: "read", productId: String(pid) });
    if (!readR || readR.status === "error" || !readR.values) {
      const message = readR && readR.message ? readR.message : "readback returned no values";
      results.push({ productId: pid, status: "error", matched: 0, total: 1, error: message });
      log("  " + pid + ": ERROR " + message);
      continue;
    }
    const current = readR.values || {};
    const expected = entry.currentValues || {};
    let matched = 0, total = 0;
    const mismatches = [];
    for (const [specId, exp] of Object.entries(expected)) {
      const sv = current[specId] || {};
      for (const [field, expVal] of Object.entries(exp)) {
        total++;
        if (sv[field] === expVal) matched++;
        else mismatches.push({ specId, field, expected: expVal, actual: sv[field] || "(missing)" });
      }
    }
    const status = matched === total ? "verified" : "mismatch";
    results.push({ productId: pid, status, matched, total, mismatches });
    log("  " + pid + ": " + matched + "/" + total + " fields restored");
  }
  const summary = { status: results.every(r => r.status === "verified") ? "ok" : "mismatch", results };
  output(summary);
  if (summary.status !== "ok") process.exitCode = 1;
}

// ================================================================
// Main
// ================================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) die("Usage: batch-runner.js <preview|execute|resume|status|delayed-verify|report|rollback> [spec.json|state.json]");
  switch (args[0]) {
    case "preview": {
      const s = JSON.parse(fs.readFileSync(args[1], "utf-8"));
      const result = await batchPreview(s);
      output(result);
      if (result.hasErrors) process.exitCode = 1;
      break;
    }
    case "execute": { const s = JSON.parse(fs.readFileSync(args[1], "utf-8")); await batchExecute(s); break; }
    case "delayed-verify": await batchDelayedVerify(args[1]); break;
    case "report": await batchReport(args[1]); break;
    case "rollback": {
      if (args[1] === "--confirm" && args[2]) await batchRollbackConfirm(args[2]);
      else await batchRollback(args[1]);
      break;
    }
    case "resume": await batchResume(); break;
    case "status": {
      ensureDir(BATCH_DIR);
      const files = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith("_state.json")).sort((a, b) => fs.statSync(BATCH_DIR + "/" + b).mtimeMs - fs.statSync(BATCH_DIR + "/" + a).mtimeMs);
      if (files.length === 0) { output({ status: "none" }); break; }
      const st = JSON.parse(fs.readFileSync(BATCH_DIR + "/" + files[0], "utf-8"));
      output({ batchId: st.batchId, total: st.total, done: (st.completed || []).length, verifyFailed: (st.verifyFailed || []).length, failed: (st.failed || []).length, current: st.current, status: st.status });
      break;
    }
    default: die("Unknown: " + args[0]);
  }
}

main().catch(err => die(err.message));
