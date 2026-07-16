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
 *     { "productId": 761, "fields": { "rent1day": "22.00" } }
 *   ],
 *   "shared": { "tenancySet": "1,10,30" },
 *   "options": { "stopOnError": true }
 * }
 */

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./lib/config-loader");
const { getInstallLayout } = require("./lib/install-layout");
const { CURRENT_STATE_SCHEMA_VERSION, migrateJsonFile } = require("./lib/migrations");
const { checkRules } = require("./lib/rule-checker");
const { sendNegotiatedCommand } = require("./lib/daemon-protocol");
const {
  normalizeVASPlan,
  hasVASOps,
  validateVASPlan,
  buildTargetVASState,
  validateVASTargetState,
  compareVASState,
  buildVASDiff,
} = require("./lib/vas-model");

const SKILL_DIR = path.resolve(__dirname, "..");
const LAYOUT = getInstallLayout(SKILL_DIR);
const PORT_FILE = LAYOUT.daemonPortPath;
const TOKEN_FILE = LAYOUT.daemonTokenPath;
const BATCH_DIR = LAYOUT.batchesDir;
let atomicWriteSequence = 0;

function getDaemonPort() {
  if (!fs.existsSync(PORT_FILE)) return null;
  return Number(fs.readFileSync(PORT_FILE, "utf-8").trim());
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function log(msg) { process.stderr.write("[batch] " + msg + "\n"); }
function die(msg) { process.stderr.write("[batch] ERROR: " + msg + "\n"); process.exit(1); }
function output(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function readDaemonToken() { return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf-8").trim() : ""; }

function writeJsonAtomic(filePath, value) {
  const tempPath = filePath + ".tmp-" + process.pid + "-" + (++atomicWriteSequence);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
}

function loadBatchState(filePath) {
  return migrateJsonFile(filePath, { domain: "state", kind: "batch" }).value;
}

function getMaxBatchSizeFromRules(rules) {
  const limit = Number(rules && rules.maxBatchSize);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

function validateBatchSize(spec, rules = null) {
  const items = Array.isArray(spec && spec.items) ? spec.items : [];
  const effectiveRules = rules || ((loadConfig() || {}).rules || {});
  const maxBatchSize = getMaxBatchSizeFromRules(effectiveRules);
  if (!maxBatchSize) return { ok: true, count: items.length, maxBatchSize: 0 };
  if (items.length > maxBatchSize) {
    return {
      ok: false,
      count: items.length,
      maxBatchSize,
      message: "Batch item count " + items.length + " exceeds config.rules.maxBatchSize=" + maxBatchSize,
    };
  }
  return { ok: true, count: items.length, maxBatchSize };
}

function validateBatchItems(spec) {
  const items = Array.isArray(spec && spec.items) ? spec.items : [];
  const seen = new Set();
  for (const item of items) {
    const productId = String((item && item.productId) ?? "").trim();
    if (!/^[1-9]\d*$/.test(productId)) return { ok: false, message: "Invalid canonical productId: " + productId };
    if (seen.has(productId)) return { ok: false, message: "Duplicate productId: " + productId };
    seen.add(productId);
    const normalized = normalizeBatchItem(spec, item || {});
    const hasEffectiveOperation = expectedChangeCount(normalized.changes) > 0
      || hasFormSetup(normalized.setup)
      || hasImageOps(normalized.images)
      || hasVASOps(normalized.vas)
      || Boolean(normalized.vasSnapshot);
    if (!hasEffectiveOperation) return { ok: false, message: "No effective operation for productId: " + productId };
  }
  return { ok: true, count: items.length };
}

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

function resolveSubmitByReadback(submitResult, verificationEvidence) {
  const submitStatus = submitResult && submitResult.status ? submitResult.status : "unknown";
  if (submitStatus !== "unknown") return { status: submitStatus, resolvedBy: null, scopes: [] };
  const applicable = (Array.isArray(verificationEvidence) ? verificationEvidence : []).filter(item => item && item.applicable === true);
  const scopes = [...new Set(applicable.map(item => String(item.scope || "")).filter(Boolean))];
  const successful = applicable.filter(item => item.status === "ok");
  const failed = applicable.filter(item => item.status !== "ok");
  if (successful.length > 0 && failed.length === 0) return { status: "ok", resolvedBy: "readback", scopes };
  return { status: "verify_failed", resolvedBy: "readback", scopes };
}

function buildSubmitCommand(productId) {
  return { action: "submit", expectedProductId: productId };
}

const SENSITIVE_PREVIEW_KEYS = new Set([
  "password", "passwd", "pwd", "token", "accesstoken", "refreshtoken",
  "authorization", "cookie", "setcookie", "csrf", "secret", "apikey",
  "session", "sessionid", "clientsecret", "authtoken",
]);

function normalizeSensitivePreviewKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitivePreviewKey(key) {
  return SENSITIVE_PREVIEW_KEYS.has(normalizeSensitivePreviewKey(key));
}

function redactPreview(value) {
  let text;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    let nodes = 0;
    function redactJson(current, depth) {
      nodes++;
      if (nodes > 200 || depth > 8) return "[TRUNCATED]";
      if (Array.isArray(current)) return current.map(item => redactJson(item, depth + 1));
      if (!current || typeof current !== "object") return current;
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [
        key,
        isSensitivePreviewKey(key) ? "[REDACTED]" : redactJson(item, depth + 1),
      ]));
    }
    const serialized = JSON.stringify(redactJson(parsed, 0));
    text = serialized === undefined ? String(value) : serialized;
  } catch {
    text = String(value === undefined ? "" : value);
  }
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, match => {
    try {
      const url = new URL(match);
      for (const key of [...url.searchParams.keys()]) {
        if (isSensitivePreviewKey(key)) url.searchParams.set(key, "[REDACTED]");
      }
      return url.toString();
    } catch {
      return match;
    }
  });
  text = text
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
    .replace(/\b(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/\b([A-Za-z][A-Za-z0-9_-]*)\s*([=:])\s*([^\s&;,]+)/g, (match, key, separator) =>
      isSensitivePreviewKey(key) ? key + separator + "[REDACTED]" : match);
  return String(text).replace(/\s+/g, " ").trim().substring(0, 500);
}

function boundedRawPreview(raw) {
  return redactPreview(raw);
}

function normalizeSubmitCommandResult(raw) {
  const validObject = raw && typeof raw === "object" && !Array.isArray(raw);
  const status = validObject && typeof raw.status === "string" ? raw.status : "";
  if (!validObject || !["ok", "error", "unknown"].includes(status)) {
    return { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false, detail: "malformed_submit_response", rawPreview: boundedRawPreview(raw) };
  }
  if (status === "unknown") {
    return { ...raw, submitted: raw.submitted === undefined ? null : raw.submitted, sideEffectPossible: raw.sideEffectPossible !== false, retrySafe: false };
  }
  return { ...raw };
}

function buildSubmitTransportRecovery(result, error) {
  const detail = "submit_transport_error: " + String(error && error.message || error || "unknown");
  const submitResult = { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false, detail };
  return {
    ...result,
    status: "verify_failed",
    submitResult,
    recoveryRequired: true,
    recoveryPhase: "submitting",
    automaticResubmitBlocked: true,
    recoveryMessage: "Submit transport failed after dispatch became possible; manual verification required",
    steps: [...(result.steps || []), { step: "submit", ...submitResult }],
  };
}

function buildPostSubmitVerificationRecovery(result, error) {
  return {
    ...result,
    status: "verify_failed",
    recoveryRequired: true,
    recoveryPhase: "verification",
    automaticResubmitBlocked: true,
    recoveryMessage: "Post-submit verification transport failed; manual verification required",
    steps: [...(result.steps || []), { step: "verification-transport-error", status: "error", message: String(error && error.message || error || "unknown") }],
  };
}

function buildSubmitAuditSummary(entry) {
  const raw = entry && entry.submitResult ? entry.submitResult : {};
  const resolution = entry && entry.submitResolution ? entry.submitResolution : {};
  const summary = {
    rawStatus: raw.status || null,
    rawDetail: raw.detail || "",
    rawSubmitted: raw.submitted === undefined ? null : raw.submitted,
    resolutionStatus: resolution.status || null,
    resolvedBy: resolution.resolvedBy || null,
    scopes: Array.isArray(resolution.scopes) ? resolution.scopes : [],
  };
  const response = raw.response && typeof raw.response === "object" ? raw.response : {};
  if (response.url || response.httpStatus !== undefined || response.contentType || response.bodyPreview || raw.rawPreview) {
    summary.responseEvidence = {
      url: redactPreview(response.url || ""),
      httpStatus: response.httpStatus === undefined ? null : response.httpStatus,
      contentType: response.contentType || "",
      bodyPreview: redactPreview(response.bodyPreview || ""),
      rawPreview: redactPreview(raw.rawPreview || ""),
    };
  }
  return summary;
}

function buildSubmitAuditLines(entry, indent = "") {
  const summary = buildSubmitAuditSummary(entry);
  const lines = [];
  if (summary.rawStatus) {
    lines.push(indent + "Submit raw: status=" + summary.rawStatus + ", submitted=" + (summary.rawSubmitted === null ? "unknown" : summary.rawSubmitted) + ", detail=" + (summary.rawDetail || "N/A"));
  }
  if (summary.resolutionStatus) {
    lines.push(indent + "Submit resolution: status=" + summary.resolutionStatus + ", resolvedBy=" + (summary.resolvedBy || "N/A") + ", scopes=[" + summary.scopes.join(",") + "]");
  }
  if (summary.responseEvidence) {
    const evidence = summary.responseEvidence;
    lines.push(indent + "Submit response: url=" + (evidence.url || "N/A") + ", httpStatus=" + (evidence.httpStatus === null ? "N/A" : evidence.httpStatus) + ", contentType=" + (evidence.contentType || "N/A") + ", bodyPreview=" + (evidence.bodyPreview || "N/A") + ", rawPreview=" + (evidence.rawPreview || "N/A"));
  }
  return lines;
}

function buildVerificationAuditLines(entry, indent = "") {
  const lines = [];
  if (entry && entry.verifyResult) {
    const verify = entry.verifyResult;
    lines.push(indent + "Field verify: " + Number(verify.matched || 0) + "/" + Number(verify.total || 0) + " matched, mismatched=" + Number(verify.mismatched || 0));
    for (const mismatch of verify.mismatches || []) {
      lines.push(indent + "  " + (mismatch.specId || "(unknown)") + " " + (mismatch.field || "(unknown)") + ": expected " + mismatch.expected + ", got " + mismatch.actual);
    }
  }
  for (const [label, result] of [["Image", entry && entry.imageVerifyResult], ["VAS", entry && entry.vasVerifyResult]]) {
    if (!result) continue;
    if (result.verifyResult) {
      lines.push(indent + label + " verify: status=" + (result.status || "unknown") + ", " + Number(result.verifyResult.matched || 0) + "/" + Number(result.verifyResult.total || 0) + " matched, mismatched=" + Number(result.verifyResult.mismatched || 0));
    } else {
      lines.push(indent + label + " verify: status=" + (result.status || "unknown") + ", detail=" + (result.message || "verifyResult unavailable"));
    }
  }
  if (entry && entry.recoveryRequired === true) {
    lines.push(indent + "Recovery: phase=" + (entry.recoveryPhase || "unknown") + ", automaticResubmitBlocked=" + (entry.automaticResubmitBlocked === true) + ", message=" + (entry.recoveryMessage || "manual verification required"));
  }
  return lines;
}

function buildSubmittingCheckpoint(result) {
  const snapshot = JSON.parse(JSON.stringify(result));
  return { productId: result.productId, phase: "submitting", result: snapshot };
}

function buildSubmittedCheckpoint(result) {
  const snapshot = JSON.parse(JSON.stringify(result));
  return { productId: result.productId, phase: "submitted", result: snapshot };
}

function prepareResumeState(state) {
  const next = {
    ...state,
    completed: [...(state.completed || [])],
    previewOnly: [...(state.previewOnly || [])],
    verifyFailed: [...(state.verifyFailed || [])],
    failed: [...(state.failed || [])],
  };
  const recoveryCheckpoint = state.inFlight && ["submitting", "submitted"].includes(state.inFlight.phase) ? state.inFlight : null;
  if (recoveryCheckpoint) {
    const recovered = {
      ...(recoveryCheckpoint.result || {}),
      productId: recoveryCheckpoint.productId,
      status: "verify_failed",
      recoveryRequired: true,
      recoveryPhase: recoveryCheckpoint.phase,
      automaticResubmitBlocked: true,
      recoveryMessage: "Submit side effect was checkpointed before verification; automatic resubmit is blocked",
    };
    const alreadyRecorded = [...next.completed, ...next.previewOnly, ...next.verifyFailed, ...next.failed]
      .some(entry => String(entry.productId) === String(recoveryCheckpoint.productId));
    if (!alreadyRecorded) next.verifyFailed.push(recovered);
    next.inFlight = null;
    next.status = "recovery_required";
  }
  const doneIds = new Set([...next.completed, ...next.previewOnly, ...next.verifyFailed, ...next.failed].map(entry => String(entry.productId)));
  const remainingItems = ((next.spec && next.spec.items) || []).filter(item => !doneIds.has(String(item.productId)));
  return { state: next, remainingItems };
}

function expectedChangeCount(expectedChanges) {
  const expected = expectedChanges || {};
  if (isNestedChanges(expected)) return Object.values(expected).reduce((total, fields) => total + Object.keys(fields || {}).length, 0);
  return Object.keys(expected).length;
}

function evaluateImmediateFieldVerification(actualValues, expectedChanges) {
  const { matched, mismatched, checks } = compareValues(actualValues || {}, expectedChanges || {});
  const zeroChecks = expectedChangeCount(expectedChanges) > 0 && checks.length === 0;
  const failures = zeroChecks
    ? [{ specId: "(readback)", field: "(all)", expected: "changed fields", actual: "no checks produced", match: false }]
    : mismatched;
  return {
    status: failures.length > 0 ? "failed" : "ok",
    verifyResult: {
      total: checks.length + (zeroChecks ? 1 : 0),
      matched: matched.length,
      mismatched: failures.length,
      mismatches: failures,
    },
  };
}

function parseVerificationCounts(verifyResult) {
  if (!verifyResult || typeof verifyResult !== "object" || Array.isArray(verifyResult)) return null;
  const keys = ["matched", "mismatched", "total"];
  if (!keys.every(key => Object.prototype.hasOwnProperty.call(verifyResult, key))) return null;
  if (!keys.every(key => typeof verifyResult[key] === "number" && Number.isFinite(verifyResult[key]) && Number.isInteger(verifyResult[key]) && verifyResult[key] >= 0)) return null;
  if (verifyResult.total !== verifyResult.matched + verifyResult.mismatched) return null;
  return { matched: verifyResult.matched, mismatched: verifyResult.mismatched, total: verifyResult.total };
}

function evaluateImmediateScopedVerification(response) {
  const counts = parseVerificationCounts(response && response.verifyResult);
  if (!response || response.status !== "ok" || !counts || counts.total === 0 || counts.mismatched > 0) {
    return { status: "failed", verifyResult: counts || null, response: response || null };
  }
  return { status: "ok", verifyResult: counts, response };
}

function deriveDelayedStateStatus(results, unresolvedCount) {
  const allVerified = Array.isArray(results) && results.length > 0 && results.every(result => result && result.status === "verified");
  return allVerified && Number(unresolvedCount || 0) === 0 ? "delayed_verified" : "delayed_verify_partial";
}

function countDelayedUnresolved(state) {
  const unresolvedIds = new Set((state && state.verifyFailed || []).map(entry => String(entry.productId)));
  for (const entry of state && state.failed || []) {
    if (entry && (entry.recoveryRequired === true || entry.automaticResubmitBlocked === true)) unresolvedIds.add(String(entry.productId));
  }
  const inFlight = state && state.inFlight;
  if (inFlight && ["submitting", "submitted"].includes(inFlight.phase)) unresolvedIds.add(String(inFlight.productId ?? "(inFlight)"));
  return unresolvedIds.size;
}

function deriveBatchFinalStatus(state, stopped) {
  const recoveryEntries = [...(state.verifyFailed || []), ...(state.failed || [])]
    .some(entry => entry && (entry.recoveryRequired === true || entry.automaticResubmitBlocked === true));
  if (recoveryEntries) return "recovery_required";
  if (stopped) return "stopped";
  if ((state.failed || []).length > 0) return "partial";
  if ((state.verifyFailed || []).length > 0) return "completed_with_mismatch";
  return "completed";
}

function isResumableBatchState(state) {
  if (!state || state.resumedTo) return false;
  return !["completed", "completed_with_mismatch", "delayed_verified", "resumed"].includes(state.status);
}

function selectLatestResumableBatchState(candidates) {
  return [...(candidates || [])].sort((a, b) => Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0)).find(candidate => isResumableBatchState(candidate.state)) || null;
}

function evaluateDelayedVerification({ readResult, expectedChanges = {}, imageApplicable = false, imageResult = null, vasApplicable = false, vasResult = null, requireAnyCheck = false }) {
  if (!readResult || readResult.status === "error" || !readResult.values) {
    return { status: "error", total: 1, passed: 0, failed: 1, checks: [], imageVerify: imageResult, vasVerify: vasResult, error: readResult?.message || "readback returned no values" };
  }
  const { checks } = compareValues(readResult.values, expectedChanges);
  const expectedCount = expectedChangeCount(expectedChanges);
  const zeroFieldChecks = expectedCount > 0 && checks.length === 0;
  const fieldPassed = checks.filter(check => check.match).length;
  let fieldFailed = checks.filter(check => !check.match).length + (zeroFieldChecks ? 1 : 0);
  let infrastructureError = zeroFieldChecks;

  let imagePassed = 0, imageFailed = 0, imageTotal = 0;
  if (imageApplicable) {
    const imageCounts = parseVerificationCounts(imageResult && imageResult.verifyResult);
    if (!imageResult || imageResult.status === "error" || !imageCounts || imageCounts.total === 0) {
      imageFailed = 1; imageTotal = 1; infrastructureError = true;
    } else {
      imagePassed = imageCounts.matched;
      imageFailed = imageCounts.mismatched;
      imageTotal = imageCounts.total;
      if (imageResult.status !== "ok" && imageFailed === 0) { imageFailed = 1; imageTotal = Math.max(1, imageTotal); }
    }
  }

  let vasPassed = 0, vasFailed = 0, vasTotal = 0;
  if (vasApplicable) {
    const vasCounts = parseVerificationCounts(vasResult && vasResult.verifyResult);
    if (!vasResult || vasResult.status === "error" || !vasCounts || vasCounts.total === 0) {
      vasFailed = 1; vasTotal = 1; infrastructureError = true;
    } else {
      vasPassed = vasCounts.matched;
      vasFailed = vasCounts.mismatched;
      vasTotal = vasCounts.total;
      if (vasResult.status !== "ok" && vasFailed === 0) { vasFailed = 1; vasTotal = Math.max(1, vasTotal); }
    }
  }

  let total = checks.length + (zeroFieldChecks ? 1 : 0) + imageTotal + vasTotal;
  if (requireAnyCheck && total === 0) {
    fieldFailed++;
    total = 1;
    infrastructureError = true;
  }
  const failed = fieldFailed + imageFailed + vasFailed;
  return {
    status: infrastructureError ? "error" : (failed > 0 ? "mismatch" : "verified"),
    total,
    passed: fieldPassed + imagePassed + vasPassed,
    failed,
    checks,
    imageVerify: imageResult,
    vasVerify: vasResult,
    fieldPassed,
    fieldFailed,
    imagePassed,
    imageFailed,
    imageTotal,
    vasPassed,
    vasFailed,
    vasTotal,
  };
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

function normalizeImagePlan(plan) {
  if (!isPlainObject(plan)) return {};
  const normalized = {};

  if (isPlainObject(plan.pick)) {
    const categoryName = String(plan.pick.categoryName || plan.pick.category || plan.categoryName || "").trim();
    const fileNames = toList(plan.pick.fileNames !== undefined ? plan.pick.fileNames : plan.pick.files)
      .map(x => String(x).trim())
      .filter(Boolean);
    const skipIfAlreadyPresent = plan.pick.skipIfAlreadyPresent === true || plan.skipIfAlreadyPresent === true;
    if (fileNames.length > 0) normalized.pick = { categoryName, fileNames, skipIfAlreadyPresent };
  }

  if (isPlainObject(plan.upload)) {
    const sectionType = String(plan.upload.sectionType || plan.sectionType || "thumbs").trim() || "thumbs";
    const categoryName = String(plan.upload.categoryName || plan.upload.category || plan.categoryName || "").trim();
    const uploadFile = String(plan.upload.uploadFile || plan.upload.file || plan.upload.path || "").trim();
    const confirmSelection = plan.upload.confirmSelection !== false;
    const allowDuplicateFileName = plan.upload.allowDuplicateFileName === true;
    if (uploadFile) normalized.upload = { sectionType, categoryName, uploadFile, confirmSelection, allowDuplicateFileName };
  }

  if (isPlainObject(plan.whiteImage)) {
    const categoryName = String(plan.whiteImage.categoryName || plan.whiteImage.category || "").trim();
    const fileName = String(plan.whiteImage.fileName || plan.whiteImage.name || "").trim();
    const skipIfWhiteImageMatched = plan.whiteImage.skipIfWhiteImageMatched === true || plan.skipIfWhiteImageMatched === true;
    if (fileName) normalized.whiteImage = { categoryName, fileName, skipIfWhiteImageMatched };
  }

  const orderedUrls = toList(plan.orderedUrls || (isPlainObject(plan.order) ? plan.order.orderedUrls : undefined))
    .map(x => String(x).trim())
    .filter(Boolean);
  if (orderedUrls.length > 0) normalized.orderedUrls = orderedUrls;

  const thumbnailFileName = String(plan.thumbnailFileName || (isPlainObject(plan.thumbnail) ? plan.thumbnail.fileName : "") || plan.setFirstFileName || "").trim();
  if (thumbnailFileName) normalized.thumbnailFileName = thumbnailFileName;

  if (normalized.orderedUrls && normalized.thumbnailFileName) {
    normalized.invalid = "orderedUrls and thumbnailFileName cannot be used together";
  }

  return normalized;
}

function hasImageOps(plan) {
  return Boolean(plan && (plan.invalid || plan.pick || plan.upload || (plan.orderedUrls && plan.orderedUrls.length > 0) || plan.thumbnailFileName || plan.whiteImage));
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
    images: normalizeImagePlan(item.images || item.image || item.imageOps || {}),
    vas: normalizeVASPlan(item.vas || item.valueAddedServices || {}),
    vasSnapshot: item.vasSnapshot || null,
  };
}

function buildRollbackItem(entry) {
  const reverse = {};
  const priceFields = new Set(["stock", "marketPrice", "deposit", "purchasePrice", "costPrice", "finalPayment"]);
  const isRollbackField = field => priceFields.has(field) || /^rent\d+day$/.test(field);
  const finalValues = entry && entry.finalValues && typeof entry.finalValues === "object" ? entry.finalValues : null;
  if (entry.currentValues) {
    for (const [specId, beforeValues] of Object.entries(entry.currentValues)) {
      const afterValues = finalValues && finalValues[specId] && typeof finalValues[specId] === "object" ? finalValues[specId] : null;
      const fields = {};
      for (const [field, beforeVal] of Object.entries(beforeValues)) {
        if (!isRollbackField(field)) continue;
        if (!afterValues) continue;
        const afterVal = afterValues[field];
        if (afterVal === undefined) continue;
        if (String(afterVal) !== String(beforeVal)) fields[field] = beforeVal;
      }
      if (Object.keys(fields).length > 0) reverse[specId] = fields;
    }
  }
  const rollbackItem = { productId: entry.productId };
  if (Object.keys(reverse).length > 0) rollbackItem.fields = reverse;
  if (entry.vasBefore) rollbackItem.vasSnapshot = entry.vasBefore;
  return rollbackItem.fields || rollbackItem.vasSnapshot ? rollbackItem : null;
}

function getCommittedEntries(state) {
  return (state && Array.isArray(state.completed) ? state.completed : []).filter(entry => entry && entry.status !== "preview_only");
}

function getRollbackCandidates(state) {
  return [...getCommittedEntries(state), ...(state && Array.isArray(state.verifyFailed) ? state.verifyFailed : [])];
}

function buildRollbackExecutionPlan(state) {
  const operations = [];
  for (const entry of getRollbackCandidates(state)) {
    const item = buildRollbackItem(entry);
    if (item) operations.push({ entry, item });
  }
  return { operations, items: operations.map(operation => operation.item) };
}

function evaluateRollbackVerification({ currentValues = {}, expectedFields = {}, vasApplicable = false, vasResult = null }) {
  const fieldApplicable = expectedChangeCount(expectedFields) > 0;
  const { matched, mismatched, checks } = fieldApplicable ? compareValues(currentValues, expectedFields) : { matched: [], mismatched: [], checks: [] };
  let infrastructureError = fieldApplicable && checks.length === 0;
  let total = checks.length;
  let matchedCount = matched.length;
  const mismatches = [...mismatched];
  if (fieldApplicable && checks.length === 0) {
    total = 1;
    mismatches.push({ scope: "fields", field: "(all)", expected: "rollback fields", actual: "no checks produced" });
  }
  if (vasApplicable) {
    const counts = parseVerificationCounts(vasResult && vasResult.verifyResult);
    if (!vasResult || vasResult.status !== "ok" || !counts || counts.total === 0) {
      infrastructureError = true;
      total++;
      mismatches.push({ scope: "vas", field: "readback", expected: "strict nonzero VAS verification", actual: vasResult?.message || "invalid verifyResult" });
    } else {
      total += counts.total;
      matchedCount += counts.matched;
      const vasMismatches = (vasResult.verifyResult.mismatches || []).map(item => ({ scope: "vas", ...item }));
      if (counts.mismatched > 0 && vasMismatches.length === 0) vasMismatches.push({ scope: "vas", field: "(summary)", expected: "0 mismatches", actual: String(counts.mismatched) });
      mismatches.push(...vasMismatches);
    }
  }
  if (!fieldApplicable && !vasApplicable) {
    return { status: "error", matched: 0, total: 1, mismatches: [{ field: "(all)", expected: "rollback evidence", actual: "no applicable checks" }] };
  }
  return { status: infrastructureError ? "error" : (mismatches.length > 0 ? "mismatch" : "verified"), matched: matchedCount, total, mismatches, vasVerify: vasResult };
}

function batchHasFormSetup(spec) {
  return (spec.items || []).some(item => hasFormSetup(normalizeBatchItem(spec, item).setup));
}

function batchHasImageOps(spec) {
  return (spec.items || []).some(item => hasImageOps(normalizeBatchItem(spec, item).images));
}

function requireFormSetupExecutionConfirmation(spec) {
  if (!batchHasFormSetup(spec)) return;
  if (spec.options && spec.options.confirmFormSetupWithoutPreview === true) return;
  die("Batch contains form-level setup (tenancySet/specAddItems). Preview is blocked for this structure; set options.confirmFormSetupWithoutPreview=true only after explicit user confirmation.");
}

function requireImageExecutionConfirmation(spec) {
  if (!batchHasImageOps(spec)) return;
  if (spec.options && spec.options.confirmImageWithoutPreview === true) return;
  die("Batch contains image operations. Preview is blocked for image selection/order; set options.confirmImageWithoutPreview=true only after explicit user confirmation.");
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

function getVASPlanServiceIds(plan) {
  if (!plan || !plan.services) return [];
  const services = plan.services.set || plan.services.upsert || [];
  return [...new Set(services.map(service => String(service.id)).filter(Boolean))];
}

function addVASValidationDiff(diff, warnings, productId, validation) {
  for (const message of validation.errors || []) {
    const entry = {
      specId: "(vas)", field: "validation", old: "(current VAS state)", new: "(invalid plan)",
      change: "VAS", pct: "N/A", status: "error", scope: "vas",
      issues: [{ level: "error", message }],
    };
    diff.push(entry);
    warnings.push({ productId, ...entry });
  }
  for (const message of validation.warnings || []) {
    const entry = {
      specId: "(vas)", field: "validation", old: "(current VAS state)", new: "(warning)",
      change: "VAS", pct: "N/A", status: "warn", scope: "vas",
      issues: [{ level: "warn", message }],
    };
    diff.push(entry);
    warnings.push({ productId, ...entry });
  }
}

async function previewVAS(productId, plan, diff, warnings, allowCurrentPage = false) {
  if (!hasVASOps(plan)) return null;
  const readCmd = allowCurrentPage
    ? { action: "vas-read", allowCurrentPage: true, expectedProductId: productId }
    : { action: "vas-read", productId };
  const beforeR = await send(readCmd);
  if (!beforeR || beforeR.status !== "ok") {
    const entry = { specId: "(vas)", field: "read", old: "(unavailable)", new: "(unavailable)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: beforeR?.message || "vas-read failed" }] };
    diff.push(entry); warnings.push({ productId, ...entry });
    return { beforeResult: beforeR };
  }
  const before = { enabled: beforeR.enabled, platforms: beforeR.platforms, services: beforeR.services };
  const catalogR = await send({ action: "vas-catalog-read", allowCurrentPage: true, expectedProductId: productId, ids: getVASPlanServiceIds(plan) });
  if (!catalogR || catalogR.status !== "ok") {
    const entry = { specId: "(vas)", field: "catalog", old: "(unavailable)", new: "(unavailable)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: catalogR?.message || "vas-catalog-read failed" }] };
    diff.push(entry); warnings.push({ productId, ...entry });
    return { before, catalogResult: catalogR };
  }
  const validation = validateVASPlan(plan, before, catalogR.catalog || []);
  const target = buildTargetVASState(before, plan, catalogR.catalog || []);
  diff.push(...buildVASDiff(before, target));
  addVASValidationDiff(diff, warnings, productId, validation);
  return { before, expected: target, catalog: catalogR.catalog || [], validation };
}

function addImagePreviewBlockedDiff(diff, warnings, productId, images) {
  const imageSummary = {
    pick: images.pick || null,
    upload: images.upload || null,
    orderedUrls: images.orderedUrls || null,
    thumbnailFileName: images.thumbnailFileName || null,
    whiteImage: images.whiteImage || null,
    delayedVerifyImages: images.delayedVerify || null,
  };
  const message = "Batch preview with image operations is blocked because material selection and URL writeback can only be verified on the live form page; use execute only after explicit confirmation";
  const entry = {
    specId: "(images)",
    field: "(image-ops)",
    old: "(current page image state)",
    new: JSON.stringify(imageSummary),
    change: "N/A",
    pct: "N/A",
    status: "error",
    issues: [{ level: "error", message }],
  };
  diff.push(entry);
  warnings.push({ productId, images: imageSummary, ...entry });
}

// ================================================================
// Daemon communication
// ================================================================

function send(cmd) {
  const port = getDaemonPort();
  if (!port) die("Daemon not running. Start: playwright-runner.js daemon start");
  const token = readDaemonToken();
  return sendNegotiatedCommand({ port, token, command: cmd });
}

// ================================================================
// Single product pipeline
// ================================================================

async function processProduct(productId, changes, shared, images = {}, vas = {}, options = {}, vasSnapshot = null, hooks = {}) {
  const result = { productId, steps: [], status: "ok", expectedChanges: changes };
  let formValues = null; // values from current page state (after spec/tenancy changes)
  let onFormPage = false; // once true, do not navigate again before submit or unsaved setup changes are lost
  let submitDispatched = false;

  try {
    if (images && images.invalid) {
      result.status = "failed";
      result.error = images.invalid;
      result.steps.push({ step: "image-plan-validate", status: "error", message: images.invalid });
      return result;
    }
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

    if (hasImageOps(images)) {
      const imageReadCmd = onFormPage
        ? { action: "image-read", allowCurrentPage: true, expectedProductId: productId }
        : { action: "image-read", productId };
      const imageReadR = await send(imageReadCmd);
      result.steps.push({ step: "image-read", ...(imageReadR || {}) });
      if (!imageReadR || imageReadR.status !== "ok") return failBeforeApply(result, "image-read", imageReadR);
      result.imageBefore = { thumbs: imageReadR.thumbs, white: imageReadR.white, thumbnail: imageReadR.thumbnail };
      onFormPage = true;

      if (images.upload) {
        const uploadR = await send({
          action: "image-upload",
          sectionType: images.upload.sectionType || "thumbs",
          categoryName: images.upload.categoryName,
          uploadFile: images.upload.uploadFile,
          confirmSelection: images.upload.confirmSelection !== false,
          allowDuplicateFileName: images.upload.allowDuplicateFileName === true,
          allowCurrentPage: true,
          expectedProductId: productId,
        });
        result.steps.push({ step: "image-upload", ...(uploadR || {}) });
        if (!uploadR || uploadR.status !== "ok") return failBeforeApply(result, "image-upload", uploadR);
        result.imageUploadResult = uploadR;
      }

      if (images.pick) {
        const pickR = await send({
          action: "image-pick",
          categoryName: images.pick.categoryName,
          fileNames: images.pick.fileNames,
          skipIfAlreadyPresent: images.pick.skipIfAlreadyPresent === true,
          allowCurrentPage: true,
          expectedProductId: productId,
        });
        result.steps.push({ step: "image-pick", ...(pickR || {}) });
        if (!pickR || pickR.status !== "ok") return failBeforeApply(result, "image-pick", pickR);
        result.imagePickResult = pickR;
      }

      if (images.thumbnailFileName) {
        const stateR = await send({ action: "image-read", allowCurrentPage: true, expectedProductId: productId });
        result.steps.push({ step: "image-read-after-pick", ...(stateR || {}) });
        if (!stateR || stateR.status !== "ok") return failBeforeApply(result, "image-read-after-pick", stateR);
        const pickedSet = [];
        if (result.imagePickResult && Array.isArray(result.imagePickResult.selected)) pickedSet.push(...result.imagePickResult.selected);
        if (result.imageUploadResult && result.imageUploadResult.uploaded) pickedSet.push(result.imageUploadResult.uploaded);
        const pickedTarget = pickedSet.find(item => item && item.name === images.thumbnailFileName);
        if (!pickedTarget) {
          result.status = "failed";
          result.error = "Thumbnail target file not found in current upload/pick set: " + images.thumbnailFileName;
          result.steps.push({ step: "image-order-prepare", status: "error", message: result.error });
          return result;
        }
        const targetUrl = String(pickedTarget.imgUrl || "").startsWith("http")
          ? String(pickedTarget.imgUrl)
          : "https://zloss.xinyongzu.cn/" + String(pickedTarget.imgUrl || "").replace(/^\//, "");
        images.orderedUrls = [targetUrl].concat((stateR.thumbs.values || []).filter(url => url !== targetUrl));
      }

      if (images.orderedUrls && images.orderedUrls.length > 0) {
        const orderR = await send({
          action: "image-order",
          orderedUrls: images.orderedUrls,
          allowCurrentPage: true,
          expectedProductId: productId,
        });
        result.steps.push({ step: "image-order", ...(orderR || {}) });
        if (!orderR || orderR.status !== "ok") return failBeforeApply(result, "image-order", orderR);
        result.imageOrderResult = orderR;
      }

      if (images.whiteImage) {
        const whiteR = await send({
          action: "white-image-set",
          categoryName: images.whiteImage.categoryName,
          fileName: images.whiteImage.fileName,
          skipIfWhiteImageMatched: images.whiteImage.skipIfWhiteImageMatched === true,
          allowCurrentPage: true,
          expectedProductId: productId,
        });
        result.steps.push({ step: "white-image-set", ...(whiteR || {}) });
        if (!whiteR || whiteR.status !== "ok") return failBeforeApply(result, "white-image-set", whiteR);
        result.whiteImageResult = whiteR;
      }

      const imageAfterR = await send({ action: "image-read", allowCurrentPage: true, expectedProductId: productId });
      result.steps.push({ step: "image-read-final", ...(imageAfterR || {}) });
      if (!imageAfterR || imageAfterR.status !== "ok") return failBeforeApply(result, "image-read-final", imageAfterR);
      result.imageAfter = { thumbs: imageAfterR.thumbs, white: imageAfterR.white, thumbnail: imageAfterR.thumbnail };
    }

    if (hasVASOps(vas) || vasSnapshot) {
      const vasReadR = await send(onFormPage
        ? { action: "vas-read", allowCurrentPage: true, expectedProductId: productId }
        : { action: "vas-read", productId });
      result.steps.push({ step: "vas-read", ...(vasReadR || {}) });
      if (!vasReadR || vasReadR.status !== "ok") return failBeforeApply(result, "vas-read", vasReadR);
      result.vasBefore = { enabled: vasReadR.enabled, platforms: vasReadR.platforms, services: vasReadR.services };
      onFormPage = true;

      if (vasSnapshot) {
        const validation = validateVASTargetState(vasSnapshot);
        result.vasValidation = validation;
        result.vasExpected = validation.target;
        if (!validation.ok) {
          result.status = "failed";
          result.error = "VAS snapshot validation failed: " + validation.errors.join("; ");
          result.steps.push({ step: "vas-snapshot-validate", status: "error", errors: validation.errors, warnings: validation.warnings });
          return result;
        }
        result.steps.push({ step: "vas-snapshot-validate", status: "ok", warnings: validation.warnings });
      } else {
        const vasCatalogR = await send({ action: "vas-catalog-read", allowCurrentPage: true, expectedProductId: productId, ids: getVASPlanServiceIds(vas) });
        result.steps.push({ step: "vas-catalog-read", ...(vasCatalogR || {}) });
        if (!vasCatalogR || vasCatalogR.status !== "ok") return failBeforeApply(result, "vas-catalog-read", vasCatalogR);
        const validation = validateVASPlan(vas, result.vasBefore, vasCatalogR.catalog || []);
        result.vasExpected = buildTargetVASState(result.vasBefore, vas, vasCatalogR.catalog || []);
        result.vasValidation = validation;
        if (!validation.ok) {
          result.status = "failed";
          result.error = "VAS validation failed: " + validation.errors.join("; ");
          result.steps.push({ step: "vas-validate", status: "error", errors: validation.errors, warnings: validation.warnings });
          return result;
        }
        result.steps.push({ step: "vas-validate", status: "ok", warnings: validation.warnings });
      }
      const vasApplyR = await send({ action: "vas-apply", allowCurrentPage: true, expectedProductId: productId, expectedVAS: result.vasExpected });
      result.steps.push({ step: "vas-apply", ...(vasApplyR || {}) });
      result.vasApplyResult = vasApplyR;
      if (!vasApplyR || vasApplyR.status !== "ok") return failBeforeApply(result, "vas-apply", vasApplyR);
      onFormPage = true;
    }

    const hasFieldChanges = Boolean(changes && Object.keys(changes).length > 0);
    if (hasFieldChanges) {
      // Apply. If form-level structure changed, stay on current page to avoid losing unsaved changes.
      ensureDir(BATCH_DIR);
      const f = BATCH_DIR + "/changes_" + productId + ".json";
      fs.writeFileSync(f, JSON.stringify(changes), "utf-8");
      const applyAction = onFormPage ? "apply-current" : "apply";
      const applyR = onFormPage
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
    } else {
      result.steps.push({ step: "apply-skip", reason: "no_field_changes" });
    }

    if (options.skipSubmit === true) {
      result.status = "preview_only";
      result.steps.push({ step: "submit-skip", reason: "skipSubmit=true" });
      const changedCurrentForm = onFormPage || hasFieldChanges;
      if (changedCurrentForm) {
        result.previewState = {
          currentValues: result.currentValues || null,
          imageBefore: result.imageBefore || null,
          imageAfter: result.imageAfter || null,
          vasBefore: result.vasBefore || null,
          vasExpected: result.vasExpected || null,
        };
        const discardR = await send({ action: "discard-current-form", expectedProductId: productId });
        result.discardResult = discardR;
        result.steps.push({ step: "discard-current-form", ...(discardR || {}) });
        if (!discardR || discardR.status !== "ok") {
          result.status = "failed";
          result.error = "Failed to discard current form after skipSubmit";
        }
      }
      return result;
    }

    // Submit
    if (typeof hooks.onSubmitting === "function") hooks.onSubmitting(buildSubmittingCheckpoint(result));
    let submitR;
    try {
      const rawSubmitResult = await send(buildSubmitCommand(productId));
      submitDispatched = true;
      submitR = normalizeSubmitCommandResult(rawSubmitResult);
    } catch (err) {
      return buildSubmitTransportRecovery(result, err);
    }
    result.steps.push({ step: "submit", ...submitR });
    result.submitResult = submitR;
    if (typeof hooks.onSubmitted === "function") hooks.onSubmitted(buildSubmittedCheckpoint(result));
    if (submitR.status === "error") {
      result.status = "failed";
      result.error = "Submit failed";
      return result;
    }
    const verificationEvidence = [];

    if (!hasFieldChanges) {
      result.steps.push({ step: "verify-skip", reason: "no_field_changes" });
    } else {
      // Verify: read and compare with expected values
      const verifyR = await send({ action: "read", productId });
      if (!verifyR || verifyR.status === "error" || !verifyR.values) {
        result.status = "verify_failed";
        result.verifyResult = buildReadbackFailure(verifyR);
        verificationEvidence.push({ scope: "fields", applicable: true, status: "failed" });
        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
        result.steps.push({ step: "verify", status: "error", ...result.verifyResult });
        return result;
      }
      const fieldEvaluation = evaluateImmediateFieldVerification(verifyR.values, changes);
      result.finalValues = verifyR.values;
      result.verifyResult = fieldEvaluation.verifyResult;
      if (fieldEvaluation.status === "failed") {
        result.status = "verify_failed";
        verificationEvidence.push({ scope: "fields", applicable: true, status: "failed" });
        result.steps.push({ step: "verify", status: "mismatch", ...result.verifyResult });
      } else {
        verificationEvidence.push({ scope: "fields", applicable: true, status: "ok" });
        result.steps.push({ step: "verify", status: "ok", matched: result.verifyResult.matched });
      }
    }

    if ((hasVASOps(vas) || vasSnapshot) && result.vasExpected) {
      const vasVerifyR = await send({ action: "vas-verify", productId, expectedVAS: result.vasExpected });
      result.steps.push({ step: "vas-verify", ...(vasVerifyR || {}) });
      result.vasVerifyResult = vasVerifyR;
      const vasEvaluation = evaluateImmediateScopedVerification(vasVerifyR);
      if (vasEvaluation.status === "failed") {
        result.status = "verify_failed";
        verificationEvidence.push({ scope: "vas", applicable: true, status: "failed" });
        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
        return result;
      }
      verificationEvidence.push({ scope: "vas", applicable: true, status: "ok" });
    }

    if (hasImageOps(images)) {
      const expectedImages = {};
      const finalImageState = result.imageAfter || null;
      if (finalImageState && finalImageState.thumbs && Array.isArray(finalImageState.thumbs.values) && finalImageState.thumbs.values.length > 0) {
        expectedImages.thumbs = finalImageState.thumbs.values;
        expectedImages.thumbnail = finalImageState.thumbnail || finalImageState.thumbs.values[0] || "";
      }
      if (finalImageState && finalImageState.white && finalImageState.white.value) {
        expectedImages.white = finalImageState.white.value;
      }
      const imageVerifyR = await send({ action: "image-verify", productId, expectedImages });
      result.steps.push({ step: "image-verify", ...(imageVerifyR || {}) });
      result.imageVerifyResult = imageVerifyR;
      const imageEvaluation = evaluateImmediateScopedVerification(imageVerifyR);
      if (imageEvaluation.status === "failed") {
        result.status = "verify_failed";
        verificationEvidence.push({ scope: "images", applicable: true, status: "failed" });
        if (submitR.status === "unknown") result.submitResolution = resolveSubmitByReadback(submitR, verificationEvidence);
        return result;
      }
      verificationEvidence.push({ scope: "images", applicable: true, status: "ok" });
    }

    if (submitR.status === "unknown") {
      const resolution = resolveSubmitByReadback(submitR, verificationEvidence);
      result.submitResolution = resolution;
      if (resolution.status === "ok") {
        result.steps.push({ step: "submit-resolution", ...resolution });
      } else {
        result.status = "verify_failed";
      }
    }
  } catch (err) {
    if (submitDispatched) return buildPostSubmitVerificationRecovery(result, err);
    result.status = "failed"; result.error = err.message;
    result.steps.push({ step: "error", message: err.message });
  }
  return result;
}

// ================================================================
// Preview
// ================================================================

async function batchPreview(spec) {
  const cfg = loadConfig();
  const rules = cfg.rules || {};
  const itemCheck = validateBatchItems(spec);
  if (!itemCheck.ok) die(itemCheck.message);
  const batchSizeCheck = validateBatchSize(spec, rules);
  if (!batchSizeCheck.ok) die(batchSizeCheck.message);

  await send({ action: "login" });
  const items = spec.items || [];
  const previews = [];
  const warnings = [];

  for (const item of items) {
    const normalized = normalizeBatchItem(spec, item);
    const pid = normalized.productId;
    log("Previewing " + pid + "...");
    const diff = [];
    const setupBlocked = hasFormSetup(normalized.setup);
    const imageBlocked = hasImageOps(normalized.images);
    if (setupBlocked) addSetupPreviewBlockedDiff(diff, warnings, pid, normalized.setup);
    if (imageBlocked) addImagePreviewBlockedDiff(diff, warnings, pid, normalized.images);

    let vasPreview = null;
    if (normalized.vasSnapshot) {
      const beforeR = await send({ action: "vas-read", productId: pid });
      if (!beforeR || beforeR.status !== "ok") {
        const entry = { specId: "(vas)", field: "read", old: "(unavailable)", new: "(snapshot)", change: "VAS", pct: "N/A", status: "error", scope: "vas", issues: [{ level: "error", message: beforeR?.message || "vas-read failed" }] };
        diff.push(entry); warnings.push({ productId: pid, ...entry });
        vasPreview = { beforeResult: beforeR };
      } else {
        const before = { enabled: beforeR.enabled, platforms: beforeR.platforms, services: beforeR.services };
        const validation = validateVASTargetState(normalized.vasSnapshot);
        diff.push(...buildVASDiff(before, validation.target));
        addVASValidationDiff(diff, warnings, pid, validation);
        vasPreview = { before, expected: validation.target, validation, snapshot: true };
      }
    } else if (hasVASOps(normalized.vas)) {
      vasPreview = await previewVAS(pid, normalized.vas, diff, warnings, false);
    }

    if (setupBlocked || imageBlocked) {
      previews.push({ productId: pid, setup: normalized.setup, images: normalized.images, vas: normalized.vas, vasPreview, specs: [], diff });
      continue;
    }
    const readR = await send({ action: "read", productId: pid });
    const itemFields = normalized.changes;
    if (!readR || readR.status === "error" || !readR.values) {
      addReadErrorDiff(diff, warnings, pid, readR);
      previews.push({ productId: pid, vas: normalized.vas, vasPreview, specs: readR && readR.specs ? readR.specs : [], diff });
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
    previews.push({ productId: pid, vas: normalized.vas, vasPreview, specs: readR.specs, diff });
  }

  return { previews, warnings, hasErrors: warnings.some(w => w.status === "error"), hasWarnings: warnings.some(w => w.status === "warn") };
}

// ================================================================
// Execute
// ================================================================

async function batchExecute(spec) {
  const cfg = loadConfig();
  const itemCheck = validateBatchItems(spec);
  if (!itemCheck.ok) die(itemCheck.message);
  const batchSizeCheck = validateBatchSize(spec, cfg.rules || {});
  if (!batchSizeCheck.ok) die(batchSizeCheck.message);
  requireFormSetupExecutionConfirmation(spec);
  requireImageExecutionConfirmation(spec);
  ensureDir(BATCH_DIR);
  await send({ action: "login" });
  const items = spec.items || [];
  const batchId = "batch_" + Date.now();
  const stateFile = BATCH_DIR + "/" + batchId + "_state.json";

  const state = { stateSchemaVersion: CURRENT_STATE_SCHEMA_VERSION, batchId, spec, total: items.length, completed: [], previewOnly: [], verifyFailed: [], failed: [], current: null, inFlight: null, status: "running", startedAt: new Date().toISOString() };
  if (spec.resumeFrom) state.resumeFrom = spec.resumeFrom;
  if (spec.resumedAt) state.resumedAt = spec.resumedAt;
  writeJsonAtomic(stateFile, state);
  log("Batch " + batchId + ": " + items.length + " items");

  let stopped = false;
  for (const item of items) {
    const pid = item.productId;
    state.current = pid; writeJsonAtomic(stateFile, state);
    log("[" + (state.completed.length + 1) + "/" + state.total + "] " + pid);
    const normalized = normalizeBatchItem(spec, item);
    const result = await processProduct(pid, normalized.changes, normalized.setup, normalized.images, normalized.vas, spec.options || {}, normalized.vasSnapshot, {
      onSubmitting(checkpoint) {
        state.inFlight = checkpoint;
        writeJsonAtomic(stateFile, state);
      },
      onSubmitted(checkpoint) {
        state.inFlight = checkpoint;
        writeJsonAtomic(stateFile, state);
      },
    });
    let stopAfterPersist = false;
    if (result.status === "ok") {
      state.completed.push(result);
      log("  OK");
    }
    else if (result.status === "preview_only") {
      state.previewOnly.push(result);
      log("  OK (skip submit; not committed)");
    }
    else if (result.status === "verify_failed") { state.verifyFailed.push(result); log("  WARN: verify mismatch"); }
    else {
      state.failed.push(result);
      log("  FAIL: " + (result.error || result.status));
      if (spec.options && spec.options.stopOnError) { stopped = true; state.status = "stopped"; stopAfterPersist = true; }
    }
    state.inFlight = null;
    state.current = null;
    writeJsonAtomic(stateFile, state);
    if (stopAfterPersist) break;
  }
  state.current = null;
  state.status = deriveBatchFinalStatus(state, stopped);
  state.finishedAt = new Date().toISOString();
  writeJsonAtomic(stateFile, state);

  const report = { batchId, total: state.total, success: state.completed.length, previewOnly: state.previewOnly.length, verifyFailed: state.verifyFailed.length, failed: state.failed.length, status: state.status, items: state.completed.concat(state.previewOnly || [], state.verifyFailed || [], state.failed) };
  output(report);
  return { report, stateFile, state };
}

// ================================================================
// Resume
// ================================================================

async function batchResume() {
  ensureDir(BATCH_DIR);
  const candidates = fs.readdirSync(BATCH_DIR).filter(file => file.endsWith("_state.json")).map(file => {
    const statePath = BATCH_DIR + "/" + file;
    try { return { path: statePath, mtimeMs: fs.statSync(statePath).mtimeMs, state: loadBatchState(statePath) }; }
    catch { return { path: statePath, mtimeMs: 0, state: null }; }
  });
  const selected = selectLatestResumableBatchState(candidates);
  if (!selected) die("No resumable batch found");
  const statePath = selected.path;
  const loadedState = selected.state;
  const prepared = prepareResumeState(loadedState);
  const state = prepared.state;
  const remaining = prepared.remainingItems;
  writeJsonAtomic(statePath, state);
  log("Resuming: " + remaining.length + " remaining of " + state.total);
  const resumedAt = new Date().toISOString();
  if (remaining.length === 0) {
    state.resumedAt = resumedAt;
    state.status = state.verifyFailed.some(entry => entry.automaticResubmitBlocked === true) ? "recovery_required" : state.status;
    writeJsonAtomic(statePath, state);
    return { statePath, state };
  }
  const resumed = await batchExecute({ items: remaining, shared: state.spec.shared || state.spec.sharedSetup, sharedSetup: state.spec.sharedSetup, options: state.spec.options, resumeFrom: state.batchId, resumedAt });
  state.resumedAt = resumedAt;
  state.resumedTo = resumed.state.batchId;
  state.resumeStateFile = path.basename(resumed.stateFile);
  state.status = "resumed";
  writeJsonAtomic(statePath, state);
}

// ================================================================
// Delayed Verify
// ================================================================

async function batchDelayedVerify(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = loadBatchState(statePath);
  const completed = getCommittedEntries(state);
  if (completed.length === 0) die("No committed products to verify");

  await send({ action: "login" });
  log("Delayed verify: " + completed.length + " products");

  const results = [];
  const changesMap = {};
  if (state.spec && state.spec.items) {
    for (const item of state.spec.items) {
      const normalized = normalizeBatchItem(state.spec, item);
      changesMap[item.productId] = { changes: normalized.changes, setup: normalized.setup, images: normalized.images, vas: normalized.vas };
    }
  }

  for (const entry of completed) {
    const pid = entry.productId;
    log("Verifying " + pid + "...");

    try {
      const expectedPack = changesMap[pid] || { changes: {}, setup: {}, images: {}, vas: {} };
      const expected = expectedPack.changes || {};
      const reference = entry.imageVerifyResult?.readback || entry.imageAfter || null;
      const imageApplicable = hasImageOps(expectedPack.images || {}) || Boolean(reference);
      const vasApplicable = Boolean(entry.vasExpected);
      const setupApplicable = hasFormSetup(expectedPack.setup || {});
      const readR = await send({ action: "read", productId: String(pid) });

      let imageResult = null;
      if (readR && readR.status !== "error" && readR.values && imageApplicable) {
        const expectedImages = {};
        if (reference && reference.thumbs && Array.isArray(reference.thumbs.values) && reference.thumbs.values.length > 0) {
          expectedImages.thumbs = reference.thumbs.values;
          expectedImages.thumbnail = reference.thumbnail || reference.thumbs.values[0] || "";
        }
        if (reference && reference.white && reference.white.value) {
          expectedImages.white = reference.white.value;
        }
        imageResult = await send({ action: "image-verify", productId: String(pid), expectedImages });
      }

      let vasResult = null;
      if (readR && readR.status !== "error" && readR.values && vasApplicable) {
        vasResult = await send({ action: "vas-verify", productId: String(pid), expectedVAS: entry.vasExpected });
      }

      const evaluation = evaluateDelayedVerification({
        readResult: readR,
        expectedChanges: expected,
        imageApplicable,
        imageResult,
        vasApplicable,
        vasResult,
        requireAnyCheck: setupApplicable,
      });
      results.push({
        productId: pid,
        ...evaluation,
      });
      log("  " + (evaluation.status === "verified" ? "✓" : "✗") + " fields=" + evaluation.fieldPassed + "/" + evaluation.checks.length + (imageApplicable ? (", images=" + evaluation.imagePassed + "/" + evaluation.imageTotal) : "") + (vasApplicable ? (", vas=" + evaluation.vasPassed + "/" + evaluation.vasTotal) : ""));
    } catch (err) {
      results.push({ productId: pid, status: "error", error: err.message });
      log("  ✗ ERROR: " + err.message);
    }
  }

  // Update state
  const unresolvedCount = countDelayedUnresolved(state);
  state.delayedVerify = { at: new Date().toISOString(), results, unresolvedCount };
  state.status = deriveDelayedStateStatus(results, unresolvedCount);
  writeJsonAtomic(statePath, state);

  const summary = { total: results.length, verified: results.filter(r => r.status === "verified").length, mismatch: results.filter(r => r.status === "mismatch").length, error: results.filter(r => r.status === "error").length, unresolved: unresolvedCount, results };
  output(summary);
}

// ================================================================
// Audit Report
// ================================================================

async function batchReport(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = loadBatchState(statePath);
  const completed = getCommittedEntries(state);
  const previewOnly = state.previewOnly || (state.completed || []).filter(entry => entry && entry.status === "preview_only");
  const verifyFailed = state.verifyFailed || [];
  const failed = state.failed || [];

  log("=== Batch Audit Report ===");
  log("Batch: " + state.batchId);
  log("Started: " + state.startedAt);
  log("Finished: " + (state.finishedAt || "N/A"));
  log("Status: " + state.status);
  log("Products: " + state.total + " total, " + completed.length + " committed, " + previewOnly.length + " preview_only, " + verifyFailed.length + " verify_failed, " + failed.length + " failed");
  log("");

  for (const entry of completed) {
    log("--- Product " + entry.productId + " ---");
    for (const line of buildSubmitAuditLines(entry, "  ")) log(line);
    for (const line of buildVerificationAuditLines(entry, "  ")) log(line);
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
    if (entry.vasBefore || entry.vasExpected || entry.vasVerifyResult) {
      const summarizeVAS = state => state ? ("enabled=" + state.enabled + ", platforms=[" + (state.platforms || []).join(",") + "], services=[" + (state.services || []).map(service => service.id).join(",") + "]") : "N/A";
      log("  VAS before: " + summarizeVAS(entry.vasBefore));
      log("  VAS expected: " + summarizeVAS(entry.vasExpected));
    }
    log("");
  }

  if (previewOnly.length > 0) {
    log("=== Preview Only (not committed) ===");
    for (const entry of previewOnly) log("  " + entry.productId + ": skipSubmit=true, form changes discarded");
  }

  if (verifyFailed.length > 0) {
    log("=== Verify Failed ===");
    for (const f of verifyFailed) {
      log("  " + f.productId + ": " + ((f.verifyResult && f.verifyResult.mismatched) || 0) + " mismatches");
      for (const line of buildSubmitAuditLines(f, "    ")) log(line);
      for (const line of buildVerificationAuditLines(f, "    ")) log(line);
    }
  }

  if (failed.length > 0) {
    log("=== Failed ===");
    for (const f of failed) {
      log("  " + f.productId + ": " + (f.error || "unknown"));
      for (const line of buildSubmitAuditLines(f, "    ")) log(line);
    }
  }

  if (state.delayedVerify) {
    const dv = state.delayedVerify;
    log("=== Delayed Verify ===");
    log("At: " + dv.at);
    log("Results: " + dv.results.filter(r => r.status === "verified").length + "/" + dv.results.length + " verified");
    log("Unresolved entries: " + Number(dv.unresolvedCount || 0));
    for (const result of dv.results || []) {
      log("  " + result.productId + ": status=" + result.status + ", fieldFailed=" + Number(result.fieldFailed || 0) + ", imageFailed=" + Number(result.imageFailed || 0) + ", vasFailed=" + Number(result.vasFailed || 0));
    }
  }
}

// ================================================================
// Rollback
// ================================================================

async function batchRollback(statePath) {
  if (!fs.existsSync(statePath)) die("State file not found: " + statePath);
  const state = loadBatchState(statePath);
  const plan = buildRollbackExecutionPlan(state);
  const items = plan.items;
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
  const state = loadBatchState(statePath);
  const plan = buildRollbackExecutionPlan(state);
  const items = plan.items;
  if (items.length === 0) die("No rollback data found in state");

  log("Executing rollback for " + items.length + " products...");
  await batchExecute({ items, options: { stopOnError: false } });
  // Verify rollback: re-read and compare with expected (currentValues from state)
  log("Verifying rollback...");
  await send({ action: "login" });
  const results = [];
  for (const operation of plan.operations) {
    const entry = operation.entry;
    const pid = entry.productId;
    const readR = await send({ action: "read", productId: String(pid) });
    if (!readR || readR.status === "error" || !readR.values) {
      const message = readR && readR.message ? readR.message : "readback returned no values";
      results.push({ productId: pid, status: "error", matched: 0, total: 1, error: message });
      log("  " + pid + ": ERROR " + message);
      continue;
    }
    const current = readR.values || {};
    const expected = operation.item.fields || {};
    let vasVerify = null;
    if (entry.vasBefore) {
      vasVerify = await send({ action: "vas-verify", productId: String(pid), expectedVAS: entry.vasBefore });
    }
    const evaluation = evaluateRollbackVerification({ currentValues: current, expectedFields: expected, vasApplicable: Boolean(entry.vasBefore), vasResult: vasVerify });
    results.push({ productId: pid, ...evaluation });
    log("  " + pid + ": " + evaluation.matched + "/" + evaluation.total + " fields/VAS checks restored (" + evaluation.status + ")");
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
      const st = loadBatchState(BATCH_DIR + "/" + files[0]);
      output({ batchId: st.batchId, total: st.total, done: getCommittedEntries(st).length, previewOnly: (st.previewOnly || (st.completed || []).filter(entry => entry && entry.status === "preview_only")).length, verifyFailed: (st.verifyFailed || []).length, failed: (st.failed || []).length, current: st.current, status: st.status });
      break;
    }
    default: die("Unknown: " + args[0]);
  }
}

if (require.main === module) {
  main().catch(err => die(err.message));
} else {
  module.exports = {
    normalizeImagePlan,
    hasImageOps,
    normalizeVASPlan,
    hasVASOps,
    validateVASPlan,
    buildTargetVASState,
    validateVASTargetState,
    compareVASState,
    buildVASDiff,
    normalizeSetup,
    mergeSetup,
    hasFormSetup,
    normalizeBatchItem,
    buildRollbackItem,
    buildRollbackExecutionPlan,
    evaluateRollbackVerification,
    getCommittedEntries,
    getRollbackCandidates,
    batchHasFormSetup,
    batchHasImageOps,
    validateBatchSize,
    validateBatchItems,
    compareValues,
    resolveSubmitByReadback,
    buildSubmitCommand,
    normalizeSubmitCommandResult,
    redactPreview,
    buildSubmitTransportRecovery,
    buildPostSubmitVerificationRecovery,
    buildSubmitAuditSummary,
    buildSubmitAuditLines,
    buildVerificationAuditLines,
    buildSubmittingCheckpoint,
    buildSubmittedCheckpoint,
    prepareResumeState,
    evaluateImmediateFieldVerification,
    evaluateImmediateScopedVerification,
    evaluateDelayedVerification,
    deriveDelayedStateStatus,
    countDelayedUnresolved,
    deriveBatchFinalStatus,
    writeJsonAtomic,
    loadBatchState,
    isResumableBatchState,
    selectLatestResumableBatchState,
  };
}
