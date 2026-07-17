#!/usr/bin/env node

/**
 * Playwright Runner — Daemon mode v2.
 *
 * Start the daemon:
 *   node playwright-runner.js daemon start [--port=9223]
 *
 * Send commands:
 *   node playwright-runner.js daemon send '<json>'
 *   # Or pipe: echo '{"action":"login"}' | node playwright-runner.js daemon send
 *
 * Stop:
 *   node playwright-runner.js daemon stop
 *
 * Legacy single-invocation mode still works:
 *   node playwright-runner.js read 761
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");

const { loadConfig, LAYOUT } = require("./lib/config-loader");
const { getLaunchOptions, resolveValidatedBrowserPolicy } = require("./lib/browser-probe");
const { validateVASTargetState, compareVASState } = require("./lib/vas-model");
const { buildHandshakeMetadata } = require("./lib/version-contract");
const { classifyAction } = require("./lib/action-registry");
const lifecycleTestInstrumentation = require("./lib/lifecycle-test-instrumentation");
const { createNonceStore, LOADED_RELEASE_IDENTITY, sendNegotiatedCommand, validateDaemonCommand, validatePersistedStateBinding } = require("./lib/daemon-protocol");
const { cleanupDaemonState, createDaemonIdentity, readDaemonIdentity, removeDaemonFiles, stopValidatedDaemon, validateDaemonIdentity } = require("./lib/daemon-identity");
const { enforceRestartForCommand } = require("./lib/restart-session");
const { hashReleaseTree } = require("./lib/install-receipt");
const { evaluateLiveStateReadiness } = require("./lib/live-state-readiness");
const { readCurrentMetadata } = require("./lib/version-contract");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = LAYOUT.browserCacheDir;
const { chromium } = require("playwright");
const USER_DATA_DIR = process.env.RENTAL_AGENT_USER_DATA_DIR
  ? path.resolve(process.env.RENTAL_AGENT_USER_DATA_DIR)
  : LAYOUT.browserProfileDir;
const OUTPUT_DIR = LAYOUT.tasksDir;
const PID_FILE = LAYOUT.daemonPidPath;
const PORT_FILE = LAYOUT.daemonPortPath;
const TOKEN_FILE = LAYOUT.daemonTokenPath;
const DAEMON_INSTANCE_ID = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
const RELEASE_TREE_SHA256 = hashReleaseTree(LAYOUT.targetDir);
const HANDSHAKE_METADATA = buildHandshakeMetadata({ instanceId: DAEMON_INSTANCE_ID, releaseTreeSha256: RELEASE_TREE_SHA256 });
const NEGOTIATION_NONCES = createNonceStore();
const RELEASE_CONTRACT = readCurrentMetadata();
let readinessEvaluator = evaluateLiveStateReadiness;

async function invokeRegisteredAction(action, handler) {
  lifecycleTestInstrumentation.recordActionAttempt(action);
  return lifecycleTestInstrumentation.invokeAction(action, handler);
}

function currentHandshakeMetadata() {
  const readiness = readinessEvaluator(LAYOUT, RELEASE_CONTRACT);
  const stateVersions = readiness.actualSchemaVersions.state;
  return {
    ...HANDSHAKE_METADATA,
    configSchemaVersion: readiness.actualSchemaVersions.config || "0.0.0",
    stateSchemaVersion: stateVersions.length === 1 ? stateVersions[0] : stateVersions.length === 0 ? RELEASE_CONTRACT.stateSchemaVersion : "0.0.0",
    upgradeLock: fs.existsSync(LAYOUT.lockPath),
    restartRequired: fs.existsSync(LAYOUT.restartMarkerPath),
    persistedStateReady: readiness.readyForWrites,
    persistedStateDigest: readiness.stateDigest,
    persistedStateBlockers: readiness.blockers,
    actualSchemaVersions: readiness.actualSchemaVersions,
  };
}

// ================================================================
// Helpers
// ================================================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  process.stderr.write("[pw] " + msg + "\n");
}

function die(msg) {
  process.stderr.write("[pw] ERROR: " + msg + "\n");
  process.exit(1);
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function getOrCreateDaemonToken() {
  if (fs.existsSync(TOKEN_FILE)) return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token);
  return token;
}

function readDaemonToken() {
  return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf-8").trim() : "";
}

function resolveSelector(selectorTemplate, specId) {
  if (!selectorTemplate) return null;
  return selectorTemplate.replace(/\{specId\}/g, specId);
}

function getProductFields() {
  const sel = config.selectors.product;
  const skipKeys = ["_note", "saveButton", "saveSuccessToast", "specTable", "goodsName", "_dynamicFields"];
  return Object.keys(sel).filter(k => typeof sel[k] === "string" && sel[k] !== null && !skipKeys.includes(k));
}

// --- Dynamic rent field discovery ---
function getDynamicRentConfig() {
  const df = config.selectors.product._dynamicFields;
  if (!df || !df.rentDays) return null;
  return df.rentDays;
}

function isDynamicRentField(field) {
  return /^rent\d+day$/.test(field);
}

function resolveDynamicRentSelector(field, specId) {
  const dynConfig = getDynamicRentConfig();
  if (!dynConfig) return null;
  const match = field.match(/^rent(\d+)day$/);
  if (!match) return null;
  const days = match[1];
  return dynConfig.selectorTemplate
    .replace(/\{days\}/g, days)
    .replace(/\{specId\}/g, specId);
}

function resolveFieldSelector(field, specId) {
  const staticTemplate = config.selectors.product[field];
  if (staticTemplate) return resolveSelector(staticTemplate, specId);
  if (isDynamicRentField(field)) return resolveDynamicRentSelector(field, specId);
  return null;
}

// Scan a spec row for all rent inputs, return { rentNday: daysInt }
async function discoverRentFieldsForSpec(scope, specId) {
  const dynConfig = getDynamicRentConfig();
  if (!dynConfig) return {};
  return await scope.evaluate((params) => {
    const reg = new RegExp(params.extractRegexStr);
    const rows = document.querySelectorAll("#options table tbody tr");
    let targetRow = null;
    for (const row of rows) {
      const idEl = row.querySelector("input.option_ids");
      if (idEl && idEl.value.trim() === String(params.specId)) {
        targetRow = row;
        break;
      }
    }
    if (!targetRow) return {};
    const inputs = targetRow.querySelectorAll(params.scanSel);
    const result = {};
    for (const input of inputs) {
      const className = input.className || "";
      const match = className.match(reg);
      if (!match) continue;
      const days = match[1];
      const fieldName = params.fieldTemplate.replace(/\{days\}/g, days);
      result[fieldName] = parseInt(days, 10);
    }
    return result;
  }, {
    specId,
    scanSel: dynConfig.scanSelector,
    extractRegexStr: dynConfig.extractDaysRegex,
    fieldTemplate: dynConfig.fieldTemplate
  });
}

function getCurrentProductIdFromUrl() {
  const match = page.url().match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

function checkExpectedProductUrl(url, expectedProductId, productDetailUrlTemplate) {
  const expected = String(expectedProductId ?? "").trim();
  const currentUrlText = String(url || "");
  if (!/^[1-9]\d*$/.test(expected)) {
    return { ok: false, currentProductId: null, expectedProductId: expected, url: currentUrlText, reason: "invalid_expected_product_id" };
  }
  try {
    const currentUrl = new URL(currentUrlText);
    const expectedUrl = new URL(String(productDetailUrlTemplate || "").replace("{productId}", expected));
    const currentProductId = currentUrl.searchParams.get("id");
    const ok = currentUrl.origin === expectedUrl.origin
      && currentUrl.pathname === expectedUrl.pathname
      && currentUrl.searchParams.get("r") === "goods.edit"
      && expectedUrl.searchParams.get("r") === "goods.edit"
      && currentProductId === expected;
    return { ok, currentProductId, expectedProductId: expected, url: currentUrlText };
  } catch {
    return { ok: false, currentProductId: null, expectedProductId: expected, url: currentUrlText, reason: "invalid_product_url" };
  }
}

function assertCurrentProduct(expectedProductId) {
  if (!expectedProductId) return { ok: true, currentProductId: getCurrentProductIdFromUrl(), url: page.url() };
  return checkExpectedProductUrl(page.url(), expectedProductId, config && config.saas && config.saas.productDetailUrl);
}

function validateProductPageAfterNavigation(url, expectedProductId, productDetailUrlTemplate, currentPage) {
  const currentCheck = checkExpectedProductUrl(url, expectedProductId, productDetailUrlTemplate);
  if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
  return { status: "ok", productId: currentCheck.currentProductId, currentPage: Boolean(currentPage) };
}

function checkSaasOrigin(url, trustedUrl) {
  try {
    const current = new URL(String(url || ""));
    const trusted = new URL(String(trustedUrl || ""));
    return { ok: current.origin === trusted.origin, origin: current.origin, expectedOrigin: trusted.origin, url: current.toString() };
  } catch {
    return { ok: false, origin: "", expectedOrigin: "", url: String(url || ""), reason: "invalid_url" };
  }
}

function checkConfiguredPage(url, expectedUrl) {
  try {
    const current = new URL(String(url || ""));
    const expected = new URL(String(expectedUrl || ""));
    const expectedRoute = expected.searchParams.get("r");
    const ok = current.origin === expected.origin
      && current.pathname === expected.pathname
      && (!expectedRoute || current.searchParams.get("r") === expectedRoute);
    return { ok, url: current.toString(), origin: current.origin, expectedOrigin: expected.origin, pathname: current.pathname, expectedPathname: expected.pathname };
  } catch {
    return { ok: false, url: String(url || ""), reason: "invalid_configured_page_url" };
  }
}

function validateCopyDestination(url, expectedProductId, productDetailUrlTemplate) {
  const expected = String(expectedProductId ?? "").trim();
  if (!/^[1-9]\d*$/.test(expected)) return { ok: false, expectedProductId: expected, reason: "invalid_expected_product_id" };
  try {
    const current = new URL(String(url || ""));
    const trusted = new URL(String(productDetailUrlTemplate || "").replace("{productId}", expected));
    const route = current.searchParams.get("r");
    const currentProductId = current.searchParams.get("id");
    const ok = current.origin === trusted.origin
      && current.pathname === trusted.pathname
      && (route === "goods.edit" || route === "goods.copy")
      && currentProductId === expected;
    return { ok, route, currentProductId, expectedProductId: expected, url: current.toString() };
  } catch {
    return { ok: false, expectedProductId: expected, url: String(url || ""), reason: "invalid_copy_url" };
  }
}

function replaceRouteValue(urlText, routeValue) {
  try {
    const url = new URL(String(urlText || ""));
    url.searchParams.set("r", routeValue);
    return url.toString();
  } catch {
    return String(urlText || "");
  }
}

function getProductSearchChannels() {
  const activeUrl = String(config.saas.productListUrl || "").trim();
  const soldOutUrl = String(config.saas.productOutListUrl || replaceRouteValue(activeUrl, "goods.out")).trim();
  const stockUrl = String(config.saas.productStockListUrl || replaceRouteValue(activeUrl, "goods.stock")).trim();
  return [
    { key: "active", label: "在租", url: activeUrl },
    { key: "sold-out", label: "售罄", url: soldOutUrl },
    { key: "stock", label: "仓库", url: stockUrl },
  ].filter(channel => channel.url);
}

function validateSubmitCommand(cmd) {
  if (!cmd || cmd.action !== "submit") return null;
  const expectedProductId = String(cmd.expectedProductId ?? "").trim();
  if (!/^[1-9]\d*$/.test(expectedProductId)) return { status: "error", message: "submit requires a canonical positive expectedProductId" };
  return { status: "ok", expectedProductId };
}

function buildLegacyApplySubmitDecision(applyResult, submitRequested) {
  if (!submitRequested) return { shouldSubmit: false, submitResult: null };
  const applyStatus = applyResult && applyResult.status ? applyResult.status : "unknown";
  if (applyStatus === "ok") return { shouldSubmit: true, submitResult: null };
  return { shouldSubmit: false, submitResult: { status: "skipped", reason: "apply_status_not_ok", applyStatus } };
}

function mergeLegacyApplySubmitOutcome(applyResult, submitResult) {
  const merged = { ...(applyResult || {}), submit: submitResult };
  if (!submitResult || submitResult.status === "ok") {
    merged.status = "ok";
    return merged;
  }
  if (submitResult.status === "unknown") {
    merged.status = "unknown";
    merged.sideEffectPossible = submitResult.sideEffectPossible === true;
    merged.retrySafe = submitResult.retrySafe === true;
    return merged;
  }
  if (submitResult.status === "error") {
    merged.status = "error";
    if (submitResult.sideEffectPossible !== undefined) merged.sideEffectPossible = submitResult.sideEffectPossible;
    if (submitResult.retrySafe !== undefined) merged.retrySafe = submitResult.retrySafe;
    return merged;
  }
  return merged;
}

function compareLegacyVerification(readResult, expectedChanges) {
  if (!readResult || readResult.status === "error" || !readResult.values) {
    return { status: "error", matches: {}, mismatches: [], message: readResult && readResult.message ? readResult.message : "readback returned no values" };
  }
  const expected = expectedChanges || {};
  const firstExpected = Object.values(expected)[0];
  const nested = firstExpected && typeof firstExpected === "object" && !Array.isArray(firstExpected);
  const matches = {};
  const mismatches = [];
  const compareField = (specId, field, expectedValue, actualValues, missingSpec) => {
    if (!matches[specId]) matches[specId] = {};
    const actual = actualValues ? actualValues[field] : undefined;
    const match = !missingSpec && actual !== undefined && actual === String(expectedValue);
    matches[specId][field] = match;
    if (!match) mismatches.push({ specId, field, expected: String(expectedValue), actual: missingSpec ? "(spec not found)" : (actual === undefined ? "(missing)" : actual) });
  };
  if (nested) {
    for (const [specId, fields] of Object.entries(expected)) {
      const actualValues = readResult.values[specId];
      for (const [field, expectedValue] of Object.entries(fields || {})) compareField(specId, field, expectedValue, actualValues, !actualValues);
    }
  } else {
    const specs = Object.entries(readResult.values);
    if (specs.length === 0 && Object.keys(expected).length > 0) {
      for (const [field, expectedValue] of Object.entries(expected)) compareField("(all)", field, expectedValue, null, true);
    } else {
      for (const [specId, actualValues] of specs) {
        for (const [field, expectedValue] of Object.entries(expected)) compareField(specId, field, expectedValue, actualValues, false);
      }
    }
  }
  return { status: mismatches.length > 0 ? "mismatch" : "ok", matches, mismatches };
}

function getImageSelectors() {
  return (config.selectors && config.selectors.image) || {};
}

async function getImageSection(sectionType) {
  const imageSel = getImageSelectors();
  const btnSelector = sectionType === "white" ? imageSel.whiteButton : imageSel.thumbsButton;
  if (!btnSelector) throw new Error("Image button selector not configured for section: " + sectionType);
  const btn = await page.$(btnSelector);
  if (!btn) throw new Error("Image button not found for section: " + sectionType);
  const section = await btn.evaluateHandle(el => el.closest(".form-group") || el.parentElement);
  return { btn, section, btnSelector };
}

async function readImageSectionState(sectionType) {
  const imageSel = getImageSelectors();
  const { section } = await getImageSection(sectionType);
  const state = await section.evaluate((el, inputSelector, emptyKeyword) => {
    const items = Array.from(el.querySelectorAll(".multi-item")).map((item, index) => ({
      index,
      imgSrc: item.querySelector("img")?.getAttribute("src") || "",
      inputName: item.querySelector("input")?.getAttribute("name") || "",
      inputValue: item.querySelector("input")?.value || "",
      hasDelete: !!item.querySelector(".BOX_IMG_UPLOAD_DELL"),
      deleteClass: item.querySelector(".BOX_IMG_UPLOAD_DELL")?.className || ""
    }));
    const inputs = Array.from(el.querySelectorAll(inputSelector)).map(node => node.value || "");
    const imgs = Array.from(el.querySelectorAll("img")).map(node => node.getAttribute("src") || "");
    const isEmptyPlaceholder = !!emptyKeyword && imgs.length === 1 && String(imgs[0] || "").includes(emptyKeyword) && inputs.length === 0;
    return {
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
      html: (el.outerHTML || "").slice(0, 20000),
      items,
      values: inputs,
      imgs,
      isEmptyPlaceholder
    };
  }, sectionType === "white" ? imageSel.whiteInput : imageSel.thumbsInput, imageSel.emptyPlaceholderSrcKeyword || "default-pic.jpg");
  if (sectionType === "white") {
    return {
      sectionType,
      value: state.values[0] || "",
      values: state.values,
      imgs: state.imgs,
      items: state.items,
      isEmptyPlaceholder: state.isEmptyPlaceholder,
      text: state.text,
      html: state.html,
    };
  }
  return {
    sectionType,
    values: state.values,
    imgs: state.imgs,
    items: state.items,
    text: state.text,
    html: state.html,
  };
}

async function openImageModal(sectionType) {
  const { btn } = await getImageSection(sectionType);
  await btn.click();
  await page.waitForTimeout(1200);
  const imageSel = getImageSelectors();
  const confirmBtn = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
  await page.waitForSelector(confirmBtn, { timeout: 8000, state: "visible" });
  return { status: "ok", sectionType };
}

async function clickImageCategory(categoryName) {
  const imageSel = getImageSelectors();
  const categorySelector = imageSel.materialCategory || ".box_main_left_title_main";
  const clicked = await page.evaluate(({ categorySelector, categoryName }) => {
    const nodes = Array.from(document.querySelectorAll(categorySelector));
    const target = nodes.find(el => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return text === categoryName;
    });
    if (!target) return false;
    target.click();
    return true;
  }, { categorySelector, categoryName });
  if (!clicked) throw new Error("Image category not found: " + categoryName);
  await page.waitForTimeout(1000);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok", categoryName };
}

async function listVisibleMaterialCards() {
  const imageSel = getImageSelectors();
  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
  const nameSelector = imageSel.materialCardName || ".box_name";
  return await page.evaluate(({ cardSelector, nameSelector }) => {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    return Array.from(document.querySelectorAll(cardSelector)).filter(visible).map((el, index) => ({
      index,
      id: el.id || "",
      imgUrl: el.getAttribute("img_url") || "",
      name: ((el.querySelector(nameSelector)?.textContent) || el.textContent || "").replace(/\s+/g, " ").trim(),
      className: el.className || "",
      style: el.getAttribute("style") || "",
      selected: /(^|\s)on(\s|$)|selected|active|checked|cur/.test(el.className || "")
    }));
  }, { cardSelector, nameSelector });
}

async function markMaterialSearchControls() {
  const imageSel = getImageSelectors();
  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
  const confirmSelector = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
  const configuredInputSelector = imageSel.modalSearchInput || null;
  const configuredButtonSelector = imageSel.modalSearchButton || null;
  return await page.evaluate(({ cardSelector, confirmSelector, configuredInputSelector, configuredButtonSelector }) => {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    document.querySelectorAll('[data-rpa-material-search-input],[data-rpa-material-search-button]').forEach(el => {
      el.removeAttribute('data-rpa-material-search-input');
      el.removeAttribute('data-rpa-material-search-button');
    });

    const configuredInput = configuredInputSelector ? Array.from(document.querySelectorAll(configuredInputSelector)).find(visible) : null;
    const configuredButton = configuredButtonSelector ? Array.from(document.querySelectorAll(configuredButtonSelector)).find(visible) : null;
    let root = null;
    const visibleCard = Array.from(document.querySelectorAll(cardSelector)).find(visible) || null;
    const visibleConfirm = Array.from(document.querySelectorAll(confirmSelector)).find(visible) || null;
    if (visibleCard) {
      const ancestors = [];
      let node = visibleCard;
      while (node && node !== document.body) {
        ancestors.push(node);
        node = node.parentElement;
      }
      root = ancestors.find(el => visibleConfirm && el.contains(visibleConfirm)) || ancestors[0] || null;
    }
    if (!root && visibleConfirm) root = visibleConfirm.closest('div,section,form') || visibleConfirm.parentElement;
    const scope = root || document;
    const textInputs = Array.from(scope.querySelectorAll("input[type='text'],input[type='search']")).filter(visible);
    const keywordRe = /(search|搜索|query|keyword|名称|文件名|素材)/i;
    const buttons = Array.from(scope.querySelectorAll('button,span,a')).filter(visible);
    const resolvedInput = configuredInput || textInputs.find(el => keywordRe.test((el.id || '') + ' ' + (el.name || '') + ' ' + (el.className || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')))
      || textInputs.find(el => keywordRe.test((el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim()))
      || (textInputs.length === 1 ? textInputs[0] : null);
    const resolvedButton = configuredButton || buttons.find(el => keywordRe.test(((el.textContent || '') + ' ' + (el.id || '') + ' ' + (el.className || '')).replace(/\s+/g, ' ').trim())) || null;
    if (!resolvedInput) {
      return { status: "ok", used: false, reason: "search_controls_not_found" };
    }
    resolvedInput.setAttribute('data-rpa-material-search-input', '1');
    if (resolvedButton) resolvedButton.setAttribute('data-rpa-material-search-button', '1');
    return {
      status: "ok",
      used: true,
      inputSelector: '[data-rpa-material-search-input="1"]',
      buttonSelector: resolvedButton ? '[data-rpa-material-search-button="1"]' : null,
      inputMeta: {
        id: resolvedInput.id || '',
        name: resolvedInput.name || '',
        className: resolvedInput.className || '',
        placeholder: resolvedInput.placeholder || ''
      },
      buttonMeta: resolvedButton ? {
        text: (resolvedButton.textContent || '').replace(/\s+/g, ' ').trim(),
        className: resolvedButton.className || ''
      } : null
    };
  }, { cardSelector, confirmSelector, configuredInputSelector, configuredButtonSelector });
}

async function searchMaterialLibrary(keyword) {
  const normalizedKeyword = String(keyword || "").trim();
  if (!normalizedKeyword) return { status: "ok", used: false, reason: "empty_keyword" };
  const marked = await markMaterialSearchControls();
  if (!marked || marked.used !== true) return marked || { status: "ok", used: false, reason: "search_controls_not_found" };
  await page.fill(marked.inputSelector, normalizedKeyword);
  if (marked.buttonSelector) await page.click(marked.buttonSelector);
  else await page.press(marked.inputSelector, "Enter").catch(() => {});
  await page.waitForTimeout(1200);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok", used: true, keyword: normalizedKeyword, inputMeta: marked.inputMeta, buttonMeta: marked.buttonMeta };
}

async function clearMaterialSearch() {
  const marked = await markMaterialSearchControls();
  if (!marked || marked.used !== true) return { status: "ok", used: false, reason: "search_controls_not_found" };
  await page.fill(marked.inputSelector, "");
  if (marked.buttonSelector) await page.click(marked.buttonSelector);
  else await page.press(marked.inputSelector, "Enter").catch(() => {});
  await page.waitForTimeout(800);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok", used: true };
}

async function selectMaterialCardsByNames(fileNames, options = {}) {
  const targets = Array.isArray(fileNames) ? fileNames.map(x => String(x).trim()).filter(Boolean) : [];
  if (targets.length === 0) throw new Error("fileNames is required");
  const imageSel = getImageSelectors();
  const cardSelector = imageSel.materialCard || "li.box_main_right_img";
  const nameSelector = imageSel.materialCardName || ".box_name";
  const maxPages = Number(imageSel.materialMaxPages || 80);
  const existingUrls = new Set((options.existingUrls || []).map(normalizeMaterialUrl).filter(Boolean));
  const skipExistingUrls = options.skipExistingUrls === true;
  const shouldClick = options.select !== false;
  const suppressMissingError = options.suppressMissingError === true;
  const searchKeyword = String(options.searchText || (targets.length === 1 ? targets[0] : "")).trim();
  let searchUsed = false;
  let searchFallback = false;

  async function scanPages() {
    const picked = [];
    const duplicates = [];
    const alreadyPresent = [];
    const seenByName = new Set();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const scan = await page.evaluate(({ cardSelector, nameSelector }) => {
        function visible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
        }
        const cards = Array.from(document.querySelectorAll(cardSelector)).filter(visible);
        const info = cards.map((el, index) => ({
          index,
          id: el.id || "",
          imgUrl: el.getAttribute("img_url") || "",
          name: ((el.querySelector(nameSelector)?.textContent) || el.textContent || "").replace(/\s+/g, " ").trim(),
          className: el.className || ""
        }));
        return { info, pageText: (document.querySelector('.box_pages')?.textContent || '').replace(/\s+/g, ' ').trim() };
      }, { cardSelector, nameSelector });

      for (const target of targets) {
        if (seenByName.has(target)) continue;
        const matches = scan.info.filter(card => card.name === target);
        if (matches.length > 1) {
          duplicates.push({ target, pageNum, matches });
          continue;
        }
        if (matches.length === 1) {
          const matched = matches[0];
          const normalizedUrl = normalizeMaterialUrl(matched.imgUrl);
          if (skipExistingUrls && existingUrls.has(normalizedUrl)) {
            alreadyPresent.push({ ...matched, pageNum, normalizedUrl });
            seenByName.add(target);
            continue;
          }
          if (shouldClick) {
            const targetIndex = matched.index;
            await page.evaluate(({ cardSelector, targetIndex }) => {
              function visible(el) {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
              }
              const cards = Array.from(document.querySelectorAll(cardSelector)).filter(visible);
              if (!cards[targetIndex]) throw new Error('Target card index not found on current page');
              cards[targetIndex].click();
            }, { cardSelector, targetIndex });
          }
          picked.push({ ...matched, pageNum, normalizedUrl });
          seenByName.add(target);
        }
      }

      const remaining = targets.filter(name => !seenByName.has(name));
      if (remaining.length === 0) break;
      const nextPage = pageNum + 1;
      const pageChanged = await page.evaluate((nextCode) => {
        const btn = Array.from(document.querySelectorAll('.box_pages .box_btn')).find(el => (el.getAttribute('code') || '') === String(nextCode));
        if (!btn) return false;
        btn.click();
        return true;
      }, nextPage);
      if (!pageChanged) break;
      await page.waitForTimeout(1200);
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const missing = targets.filter(name => !seenByName.has(name));
    if (duplicates.length > 0) {
      return { status: "error", message: "Duplicate material names found", picked, missing, duplicates, alreadyPresent };
    }
    if (missing.length > 0 && !suppressMissingError) {
      return { status: "error", message: "Material names not found", picked, missing, duplicates, alreadyPresent };
    }
    return { status: "ok", picked, missing, duplicates, alreadyPresent };
  }

  if (searchKeyword && options.searchFirst !== false) {
    const searchResult = await searchMaterialLibrary(searchKeyword).catch(err => ({ status: "error", used: false, message: err.message }));
    if (searchResult && searchResult.used) searchUsed = true;
  }

  let result = await scanPages();
  if (searchUsed && result.status !== "ok" && (result.missing || []).length > 0) {
    await clearMaterialSearch().catch(() => {});
    searchFallback = true;
    result = await scanPages();
  }

  return { ...result, searchUsed, searchFallback, searchKeyword: searchKeyword || null };
}

async function confirmImageModal() {
  const imageSel = getImageSelectors();
  const confirmSelector = imageSel.modalConfirmButton || "span.btn.btn-primary.save";
  const btn = await page.$(confirmSelector);
  if (!btn) throw new Error("Image modal confirm button not found");
  await btn.click();
  await page.waitForTimeout(1500);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok" };
}

async function cancelImageModal() {
  const imageSel = getImageSelectors();
  const cancelSelector = imageSel.modalCancelButton || "span.btn.btn-default.cancel";
  const btn = await page.$(cancelSelector);
  if (!btn) throw new Error("Image modal cancel button not found");
  await btn.click();
  await page.waitForTimeout(1000);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok" };
}

function normalizeStatusText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isSubmitSuccessText(text) {
  const normalized = normalizeStatusText(text);
  if (!normalized) return false;
  if (/失败|错误|异常|fail|error/i.test(normalized)) return false;
  return /保存成功|操作成功|提交成功|修改成功|更新成功|编辑成功|success/i.test(normalized);
}

function isSubmitFailureText(text) {
  return /失败|错误|异常|fail(?:ed|ure)?|error/i.test(normalizeStatusText(text));
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
  return normalizeStatusText(text).substring(0, 500);
}

function submitBodyPreview(bodyText) {
  return redactPreview(bodyText);
}

function inspectSubmitJson(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  let success = false;
  let truncated = false;
  while (stack.length > 0 && nodes < 200) {
    const { value, depth } = stack.pop();
    nodes++;
    if (!value || typeof value !== "object") continue;
    if (depth > 8) {
      truncated = true;
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    const markerText = [value.message, value.msg, value.errmsg]
      .filter(item => typeof item === "string").join(" ");
    const statusMarker = value.status === undefined ? "" : String(value.status).toLowerCase();
    const codeMarker = value.code === undefined ? "" : String(value.code).toLowerCase();
    const explicitError = Object.prototype.hasOwnProperty.call(value, "error") && Boolean(value.error);
    const failureCode = value.code !== undefined && !["1", "ok", "success", "succeeded"].includes(codeMarker)
      && isSubmitFailureText(markerText);
    if (value.success === false || value.ok === false || explicitError
      || /^(error|fail|failed|failure)$/.test(statusMarker) || statusMarker === "0"
      || failureCode || isSubmitFailureText(markerText)) return { failure: true, success: false };
    if (value.success === true || value.ok === true || /^(ok|success|succeeded)$/.test(statusMarker)
      || statusMarker === "1" || codeMarker === "1" || isSubmitSuccessText(markerText)) success = true;
    for (const item of Object.values(value)) {
      if (item && typeof item === "object") stack.push({ value: item, depth: depth + 1 });
    }
  }
  if (stack.length > 0) truncated = true;
  return { failure: false, success, truncated };
}

function matchesSubmitResponseEvidence(evidence, options = {}) {
  if (String(evidence && evidence.method || "").toUpperCase() !== "POST") return false;
  try {
    const responseUrl = new URL(String(evidence && evidence.url || ""));
    const pageUrl = new URL(String(options.pageUrl || ""));
    if (responseUrl.origin !== pageUrl.origin || responseUrl.pathname !== pageUrl.pathname) return false;
    if (responseUrl.searchParams.get("r") !== "goods.edit") return false;
    if (options.expectedProductId !== undefined && options.expectedProductId !== null) {
      return responseUrl.searchParams.get("id") === String(options.expectedProductId);
    }
    return true;
  } catch {
    return false;
  }
}

function classifySubmitResponseEvidence(evidence, options = {}) {
  const bodyPreview = submitBodyPreview(evidence && evidence.bodyText);
  const base = {
    url: redactPreview(String(evidence && evidence.url || "")),
    method: String(evidence && evidence.method || "").toUpperCase(),
    httpStatus: Number(evidence && evidence.httpStatus || 0),
    contentType: String(evidence && evidence.contentType || "").toLowerCase(),
    bodyPreview,
  };
  if (!matchesSubmitResponseEvidence(evidence, options)) return { status: "ignored", ...base };
  if (base.httpStatus >= 400 && base.httpStatus <= 599) return { status: "error", detail: "http_status_" + base.httpStatus, ...base };
  if (base.httpStatus >= 300 && base.httpStatus <= 399) return { status: "unknown", detail: "http_redirect_" + base.httpStatus, ...base };
  if (base.httpStatus < 200 || base.httpStatus >= 600) return { status: "unknown", detail: "unfamiliar_http_status_" + base.httpStatus, ...base };
  if (base.httpStatus === 204 || !bodyPreview) return { status: "unknown", detail: "empty_response", ...base };

  if (/^(application|text)\/[\w.+-]*json\b/.test(base.contentType)) {
    let parsed;
    try {
      parsed = JSON.parse(String(evidence.bodyText));
    } catch {
      return { status: "unknown", detail: "malformed_json", ...base };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "unknown", detail: "unfamiliar_json", ...base };
    const inspection = inspectSubmitJson(parsed);
    if (inspection.failure) return { status: "error", detail: "explicit_json_failure", ...base };
    if (inspection.truncated) return { status: "unknown", detail: "inspection_truncated", ...base };
    return inspection.success
      ? { status: "ok", detail: "explicit_json_success", ...base }
      : { status: "unknown", detail: "unfamiliar_json", ...base };
  }

  if (/^text\/plain\b/.test(base.contentType)) {
    if (isSubmitFailureText(bodyPreview)) return { status: "error", detail: "explicit_text_failure", ...base };
    if (isSubmitSuccessText(bodyPreview)) return { status: "ok", detail: "explicit_text_success", ...base };
  }
  return { status: "unknown", detail: "unfamiliar_response", ...base };
}

function createSubmitResponseObserver(targetPage, options = {}) {
  const timers = options.timers || { setTimeout, clearTimeout };
  const successGraceMs = Math.max(1, Number(options.successGraceMs || 350));
  const bodyReadGraceMs = Math.max(1, Number(options.bodyReadGraceMs || 500));
  let disposed = false;
  let settled = false;
  let armed = options.startArmed !== false;
  let armGeneration = armed ? 1 : 0;
  let deadlineReached = false;
  const inFlightBodyReads = new Set();
  let deadlineHandle = null;
  let successHandle = null;
  let bodyReadGraceHandle = null;
  let bestResult = null;
  let capturedRequest = null;
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });

  function arm() {
    if (disposed || settled) return false;
    if (!armed) {
      armed = true;
      armGeneration++;
    }
    return true;
  }

  function disarm() {
    if (disposed) return;
    if (armed) armGeneration++;
    armed = false;
    bestResult = null;
    capturedRequest = null;
    inFlightBodyReads.clear();
    if (successHandle) timers.clearTimeout(successHandle);
    if (bodyReadGraceHandle) timers.clearTimeout(bodyReadGraceHandle);
    successHandle = null;
    bodyReadGraceHandle = null;
  }

  function dispose() {
    if (disposed) return;
    disarm();
    disposed = true;
    if (deadlineHandle) timers.clearTimeout(deadlineHandle);
    if (successHandle) timers.clearTimeout(successHandle);
    if (bodyReadGraceHandle) timers.clearTimeout(bodyReadGraceHandle);
    targetPage.off("response", onResponse);
  }

  function settle(value) {
    if (settled) return;
    settled = true;
    dispose();
    resolveResult(value);
  }

  function settleAfterBodyReadGrace() {
    if (bodyReadGraceHandle || settled) return;
    bodyReadGraceHandle = timers.setTimeout(() => {
      bodyReadGraceHandle = null;
      if (inFlightBodyReads.size > 0) {
        settle({ status: "unknown", detail: "body_read_timeout", bodyPreview: "" });
        return;
      }
      settle(bestResult || { status: "unknown", detail: "body_read_timeout", bodyPreview: "" });
    }, bodyReadGraceMs);
  }

  function scheduleSuccessSettlement() {
    if (successHandle || settled) return;
    successHandle = timers.setTimeout(() => {
      successHandle = null;
      if (inFlightBodyReads.size > 0) {
        settleAfterBodyReadGrace();
        return;
      }
      settle(bestResult);
    }, successGraceMs);
  }

  function recordClassified(classified) {
    if (classified.status === "error") {
      settle(classified);
      return;
    }
    if (classified.status === "ok" || !bestResult) bestResult = classified;
    if (deadlineReached && inFlightBodyReads.size === 0) {
      settle(bestResult || classified);
      return;
    }
    if (classified.status === "ok") scheduleSuccessSettlement();
  }

  async function onResponse(response) {
    if (!armed || disposed || settled) return;
    const request = response.request();
    const evidence = {
      url: response.url(),
      method: request.method(),
      httpStatus: response.status(),
      contentType: String(response.headers()["content-type"] || ""),
      bodyText: "",
    };
    if (!matchesSubmitResponseEvidence(evidence, options)) return;
    if (!capturedRequest) capturedRequest = request;
    else if (request !== capturedRequest) return;
    const responseArmGeneration = armGeneration;
    if (evidence.httpStatus < 200 || evidence.httpStatus >= 300 || evidence.httpStatus === 204) {
      if (armed && armGeneration === responseArmGeneration) recordClassified(classifySubmitResponseEvidence(evidence, options));
      return;
    }
    const bodyReadToken = {};
    inFlightBodyReads.add(bodyReadToken);
    let bodyReadSucceeded = false;
    try {
      evidence.bodyText = await response.text();
      bodyReadSucceeded = true;
    } catch (err) {
      if (armed && armGeneration === responseArmGeneration) {
        recordClassified({
          status: "unknown",
          detail: "body_read_failed: " + String(err && err.message || err || "unknown"),
          ...evidence,
          bodyPreview: "",
        });
      }
    } finally {
      inFlightBodyReads.delete(bodyReadToken);
    }
    if (bodyReadSucceeded && armed && armGeneration === responseArmGeneration) recordClassified(classifySubmitResponseEvidence(evidence, options));
    if (deadlineReached && inFlightBodyReads.size === 0 && !settled) settle(bestResult || { status: "unknown", detail: "response_timeout", bodyPreview: "" });
  }

  targetPage.on("response", onResponse);
  deadlineHandle = timers.setTimeout(() => {
    deadlineReached = true;
    if (inFlightBodyReads.size > 0) settleAfterBodyReadGrace();
    else settle(bestResult || { status: "unknown", detail: "response_timeout", bodyPreview: "" });
  }, Math.max(1, Number(options.timeoutMs || 15000)));
  return { result, arm, disarm, dispose };
}

function classifySubmitClickError(error) {
  const message = String(error && error.message || error || "submit click failed");
  if (/click.*Timeout .*exceeded|Timeout .*click|waiting for click.*exceeded/i.test(message)) {
    return { disposition: "unknown", status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false };
  }
  if (/intercepts pointer events|element is not enabled/i.test(message)) return { disposition: "retry" };
  return { disposition: "error", status: "error", message };
}

function resolveImmediateSubmitOutcome({ responseResult, redirectDetail = "", toastDetail = "" } = {}) {
  const response = responseResult || { status: "unknown", detail: "no_matching_ajax_response" };
  if (response.status === "error") {
    return { status: "error", submitted: false, detail: response.detail || "explicit_ajax_error", response };
  }
  if (response.status === "ok") {
    return { status: "ok", submitted: true, detail: response.detail || "explicit_ajax_success", response };
  }
  const detail = [response.detail, redirectDetail, toastDetail].filter(Boolean).join("; ") || "no_decisive_submit_signal";
  return {
    status: "unknown",
    submitted: null,
    detail,
    verified: "check_with_readback",
    sideEffectPossible: true,
    retrySafe: false,
    response,
  };
}

async function dispatchSubmitClick(element, observer) {
  try {
    await element.click({ trial: true });
  } catch (err) {
    if (err && typeof err === "object") err.submitClickPhase = "trial";
    throw err;
  }
  observer.arm();
  try {
    await element.click({ force: true });
  } catch (err) {
    if (err && typeof err === "object") err.submitClickPhase = "dispatch";
    throw err;
  }
}

function getSubmitToastSelectors(configuredSelector) {
  return [...new Set([
    configuredSelector,
    ".layui-layer-dialog",
    ".layui-layer-msg",
    ".alert-success",
    ".alert-info",
    ".toast",
    ".success",
    ".success_tip",
    ".message",
    ".notification",
    "#msg",
    ".layui-m-layer",
  ].filter(sel => typeof sel === "string" && sel.trim()))];
}

function excludeBaselineToastCandidates(candidates, baseline) {
  const baselineKeys = new Set((baseline || []).map(item => item.selector + "\u0000" + item.text));
  return (candidates || []).filter(item => !baselineKeys.has(item.selector + "\u0000" + item.text));
}

async function readVisibleSubmitToastCandidates(selectors) {
  return page.evaluate((sels) => {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    const rows = [];
    for (const sel of sels) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(visible);
      for (const node of nodes) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) rows.push({ selector: sel, text: text.substring(0, 200) });
      }
    }
    return rows;
  }, selectors).catch(() => []);
}

async function dismissBlockingDialogs() {
  const dismissed = await page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    }
    const dialogSelector = ".jconfirm, .layui-layer-dialog, .layui-layer-confirm, .modal.show, .modal.in";
    const actionText = /^(确定|确认|知道了|关闭|好|是|OK)$/i;
    const successText = /保存成功|操作成功|提交成功|success/i;
    const failureText = /失败|错误|异常/;
    const dialogs = Array.from(document.querySelectorAll(dialogSelector)).filter(visible);
    const actions = [];
    for (const dialog of dialogs) {
      const text = (dialog.textContent || "").replace(/\s+/g, " ").trim().substring(0, 120);
      if (text && successText.test(text) && !failureText.test(text)) {
        continue;
      }
      const closeBtn = Array.from(dialog.querySelectorAll(".jconfirm-closeIcon, .layui-layer-close, .close, [data-dismiss='modal'], [aria-label='Close']")).find(visible) || null;
      if (closeBtn) {
        closeBtn.click();
        actions.push({ type: "close", text });
        continue;
      }
      const confirmBtn = Array.from(dialog.querySelectorAll("button, a, span.btn, input[type='button'], input[type='submit']")).find(node => {
        if (!visible(node)) return false;
        const label = ((node.textContent || node.value || "")).replace(/\s+/g, " ").trim();
        return actionText.test(label);
      }) || null;
      if (confirmBtn) {
        confirmBtn.click();
        actions.push({ type: "confirm", text });
      }
    }
    return { count: actions.length, actions };
  });
  if (dismissed.count > 0) {
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  return dismissed;
}

async function detectSubmitSuccessToast(configuredSelector, baseline = [], overallDeadline = Infinity) {
  const selectors = getSubmitToastSelectors(configuredSelector);
  const deadline = Math.min(Date.now() + 4000, overallDeadline);
  let lastNonSuccess = null;
  while (Date.now() < deadline) {
    const hits = excludeBaselineToastCandidates(await readVisibleSubmitToastCandidates(selectors), baseline);
    for (const hit of hits) {
      if (isSubmitSuccessText(hit.text)) {
        return {
          success: true,
          detail: "toast(" + hit.selector + "): " + hit.text.substring(0, 40),
          selector: hit.selector,
          text: hit.text,
        };
      }
      if (!lastNonSuccess) lastNonSuccess = hit;
    }
    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
  }
  return {
    success: false,
    detail: lastNonSuccess ? "non_success_signal(" + lastNonSuccess.selector + "): " + lastNonSuccess.text.substring(0, 40) : "",
    selector: lastNonSuccess ? lastNonSuccess.selector : "",
    text: lastNonSuccess ? lastNonSuccess.text : "",
  };
}

function normalizeMaterialUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, config.saas.baseUrl).toString();
  return new URL(raw, "https://zloss.xinyongzu.cn/").toString();
}

async function ensureImagePage(productId, allowCurrentPage, expectedProductId) {
  const targetProductId = expectedProductId || productId;
  if (allowCurrentPage) {
    return validateProductPageAfterNavigation(page.url(), targetProductId, config.saas.productDetailUrl, true);
  }
  const initialNavigation = await actionNavigate(productId);
  if (initialNavigation.status !== "ok") return initialNavigation;
  await ensureLogin();
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    const loginNavigation = await actionNavigate(productId);
    if (loginNavigation.status !== "ok") return loginNavigation;
  }
  await page.waitForTimeout(1000);
  return validateProductPageAfterNavigation(page.url(), targetProductId, config.saas.productDetailUrl, false);
}

function getVASSelectors() {
  return (config.selectors && config.selectors.vas) || {};
}

async function ensureVASPage(productId, allowCurrentPage, expectedProductId) {
  return ensureImagePage(productId, allowCurrentPage, expectedProductId);
}

async function readVASStateFromPage() {
  const selectors = getVASSelectors();
  return await page.evaluate((sel) => {
    const boolValue = value => String(value ?? "") === "1" || value === true;
    const readNamed = (root, names) => {
      for (const name of names) {
        const input = root.querySelector(`input[name$="[${name}]"]`);
        if (input) return input.value || "";
      }
      return "";
    };
    const enabledRadios = Array.from(document.querySelectorAll(sel.enabledRadio));
    const platformCheckboxes = Array.from(document.querySelectorAll(sel.platformCheckbox));
    const serviceList = document.querySelector(sel.list);
    const missing = [];
    if (enabledRadios.length === 0) missing.push("enabledRadio");
    if (platformCheckboxes.length === 0) missing.push("platformCheckbox");
    if (!serviceList) missing.push("list");
    if (missing.length > 0) return { ok: false, missing };
    const enabledNode = enabledRadios.find(node => node.checked);
    if (!enabledNode) return { ok: false, missing: ["enabledRadio.checked"] };
    const platforms = platformCheckboxes.filter(node => node.checked).map(node => node.value);
    const services = Array.from(document.querySelectorAll(sel.item)).map(item => ({
      id: readNamed(item, ["id"]),
      serviceName: readNamed(item, ["service_name"]),
      serviceMoney: readNamed(item, ["service_money"]),
      defaultSelected: boolValue(readNamed(item, ["defaultSelected"])),
      isForce: boolValue(readNamed(item, ["is_force"])),
      isPopup: boolValue(readNamed(item, ["is_popup"])),
      metadata: {
        describe: readNamed(item, ["describe"]),
        disclaimer: readNamed(item, ["disclaimer"]),
        protectionScope: readNamed(item, ["protection_scope"]),
        claimProcess: readNamed(item, ["claim_process"]),
        specialInstruction: readNamed(item, ["special_intruction", "special_instruction"]),
        picDesc: readNamed(item, ["pic_desc"]),
      },
    }));
    return { ok: true, enabled: String(enabledNode.value) === "1", platforms, services };
  }, selectors);
}

async function actionVASRead(productId, allowCurrentPage, expectedProductId) {
  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const state = await readVASStateFromPage();
  if (!state || state.ok !== true) {
    return { status: "error", productId: prep.productId, currentPage: prep.currentPage, message: "VAS selectors missing or no enabled radio is checked", missing: state?.missing || [] };
  }
  return { status: "ok", productId: prep.productId, currentPage: prep.currentPage, enabled: state.enabled, platforms: state.platforms, services: state.services };
}

function normalizeVASCatalogItem(item) {
  return {
    id: String(item.id ?? ""),
    serviceName: String(item.serviceName ?? item.service_name ?? item.name ?? ""),
    serviceMoney: String(item.serviceMoney ?? item.service_money ?? item.money ?? ""),
    metadata: {
      describe: String(item.describe ?? ""),
      disclaimer: String(item.disclaimer ?? ""),
      protectionScope: String(item.protectionScope ?? item.protection_scope ?? ""),
      claimProcess: String(item.claimProcess ?? item.claim_process ?? ""),
      specialInstruction: String(item.specialInstruction ?? item.special_intruction ?? ""),
      picDesc: String(item.picDesc ?? item.pic_desc ?? ""),
    },
  };
}

async function actionVASCatalogRead(productId, keyword, ids, allowCurrentPage, expectedProductId) {
  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const endpoint = config.vas && config.vas.catalogEndpoint;
  if (!endpoint) return { status: "error", message: "config.vas.catalogEndpoint is not configured" };
  const response = await page.evaluate(async ({ endpoint, keyword, goodsId }) => {
    const body = new URLSearchParams();
    body.set("keyword", keyword || "");
    body.set("goodsId", goodsId || "");
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 1000) };
    try { return { ok: true, json: JSON.parse(text) }; }
    catch { return { ok: false, status: res.status, text: text.slice(0, 1000) }; }
  }, { endpoint, keyword: String(keyword || ""), goodsId: String(prep.productId || productId || "") });
  if (!response.ok) return { status: "error", message: "VAS catalog request failed", response };
  const rawList = response.json?.data?.list || response.json?.list || response.json?.data || [];
  const requestedIds = new Set((Array.isArray(ids) ? ids : []).map(value => String(value)));
  const catalog = (Array.isArray(rawList) ? rawList : []).map(normalizeVASCatalogItem).filter(item => item.id && (requestedIds.size === 0 || requestedIds.has(item.id)));
  return { status: "ok", productId: prep.productId, currentPage: prep.currentPage, keyword: String(keyword || ""), ids: [...requestedIds], catalog };
}

async function actionVASApply(productId, expectedVAS, allowCurrentPage, expectedProductId) {
  const prep = await ensureVASPage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  if (!expectedVAS || typeof expectedVAS !== "object") return { status: "error", message: "expectedVAS full target state is required" };
  const targetValidation = validateVASTargetState(expectedVAS);
  if (!targetValidation.ok) {
    return { status: "error", productId: prep.productId, message: "Invalid expectedVAS target: " + targetValidation.errors.join("; "), validation: targetValidation };
  }
  const selectors = getVASSelectors();
  const target = targetValidation.target;
  const applyResult = await page.evaluate(({ sel, target }) => {
    const radios = Array.from(document.querySelectorAll(sel.enabledRadio));
    const targetRadio = radios.find(node => String(node.value) === (target.enabled ? "1" : "0"));
    if (!targetRadio) return { ok: false, message: "VAS enabled radio not found" };
    if (!targetRadio.checked) targetRadio.click();

    const platformSet = new Set(target.platforms);
    for (const checkbox of document.querySelectorAll(sel.platformCheckbox)) {
      const shouldCheck = platformSet.has(String(checkbox.value));
      if (checkbox.checked !== shouldCheck) checkbox.click();
    }

    if (typeof window.addGoodsIncrement !== "function") return { ok: false, message: "window.addGoodsIncrement is not available" };
    const services = target.services.map(service => ({
      id: String(service.id),
      name: String(service.serviceName || ""),
      money: String(service.serviceMoney || ""),
      describe: String(service.metadata?.describe || ""),
      disclaimer: String(service.metadata?.disclaimer || ""),
      protection_scope: String(service.metadata?.protectionScope || ""),
      claim_process: String(service.metadata?.claimProcess || ""),
      special_intruction: String(service.metadata?.specialInstruction || ""),
      pic_desc: String(service.metadata?.picDesc || ""),
    }));
    window.addGoodsIncrement(services);

    const boxes = Array.from(document.querySelectorAll(sel.item));
    const readId = box => box.querySelector('input[name$="[id]"]')?.value || "";
    const setOption = (box, selector, desired) => {
      if (!selector) return "selector_missing";
      const checkbox = box.querySelector(selector);
      if (!checkbox) return "missing";
      if (checkbox.checked !== desired) checkbox.click();
      return checkbox.checked === desired ? "ok" : "mismatch";
    };
    const optionResults = [];
    for (const service of target.services) {
      const box = boxes.find(item => readId(item) === String(service.id));
      if (!box) { optionResults.push({ id: service.id, option: "item", status: "missing" }); continue; }
      optionResults.push({ id: service.id, option: "defaultSelected", status: setOption(box, sel.defaultCheckbox, service.defaultSelected === true) });
    }
    for (const service of target.services) {
      const box = boxes.find(item => readId(item) === String(service.id));
      if (box) optionResults.push({ id: service.id, option: "isPopup", status: setOption(box, sel.popupCheckbox, service.isPopup === true) });
    }
    for (const service of target.services) {
      const box = boxes.find(item => readId(item) === String(service.id));
      if (box) optionResults.push({ id: service.id, option: "isForce", status: setOption(box, sel.forceCheckbox, service.isForce === true) });
    }
    const optionFailures = optionResults.filter(item => item.status !== "ok");
    return {
      ok: optionFailures.length === 0,
      message: optionFailures.length > 0 ? "VAS option control missing or did not reach target state" : "",
      optionResults,
      optionFailures,
    };
  }, { sel: selectors, target });
  if (!applyResult.ok) return { status: "error", productId: prep.productId, message: applyResult.message, applyResult };
  await page.waitForTimeout(300);
  const readback = await readVASStateFromPage();
  if (!readback || readback.ok !== true) {
    return {
      status: "error",
      productId: prep.productId,
      currentPage: prep.currentPage,
      message: "VAS selectors missing or no enabled radio is checked after apply",
      missing: readback?.missing || [],
      readback,
      optionResults: applyResult.optionResults,
    };
  }
  const compare = compareVASState(readback, target);
  return {
    status: compare.mismatched === 0 ? "ok" : "partial",
    productId: prep.productId,
    currentPage: prep.currentPage,
    expectedVAS: target,
    readback,
    compare,
    optionResults: applyResult.optionResults,
  };
}

async function actionVASVerify(productId, expectedVAS, allowCurrentPage, expectedProductId) {
  const validation = validateVASTargetState(expectedVAS);
  if (!validation.ok) {
    return {
      status: "error",
      message: "Invalid expectedVAS target: " + validation.errors.join("; "),
      validation,
    };
  }
  const current = await actionVASRead(productId, allowCurrentPage, expectedProductId);
  if (!current || current.status !== "ok") return { status: "error", message: current?.message || "vas-read failed", readback: current || null };
  const compare = compareVASState(current, validation.target);
  return {
    status: compare.mismatched === 0 ? "ok" : "mismatch",
    productId: current.productId,
    currentPage: current.currentPage,
    expectedVAS: validation.target,
    readback: { enabled: current.enabled, platforms: current.platforms, services: current.services },
    verifyResult: compare,
  };
}

async function actionDiscardCurrentForm(expectedProductId) {
  if (!expectedProductId) return { status: "error", message: "discard-current-form requires expectedProductId" };
  const currentCheck = assertCurrentProduct(expectedProductId);
  if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
  const initialNavigation = await actionNavigate(expectedProductId);
  if (initialNavigation.status !== "ok") return initialNavigation;
  await ensureLogin();
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    const loginNavigation = await actionNavigate(expectedProductId);
    if (loginNavigation.status !== "ok") return loginNavigation;
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  const restoredProductId = getCurrentProductIdFromUrl();
  if (String(restoredProductId || "") !== String(expectedProductId)) {
    return { status: "error", message: "Discard navigation restored wrong product", expectedProductId: String(expectedProductId), productId: restoredProductId, url: page.url() };
  }
  return { status: "ok", productId: restoredProductId, url: page.url(), discarded: true };
}

async function actionImageRead(productId, allowCurrentPage, expectedProductId) {
  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const thumbs = await readImageSectionState("thumbs");
  const white = await readImageSectionState("white");
  return {
    status: "ok",
    productId: prep.productId,
    currentPage: prep.currentPage,
    thumbs,
    white,
    thumbnail: thumbs.values[0] || "",
  };
}

function compareImageState(actual, expected = {}) {
  const checks = [];
  const expectedThumbs = Array.isArray(expected.thumbs) ? expected.thumbs.map(normalizeMaterialUrl).filter(Boolean) : [];
  const actualThumbs = actual && actual.thumbs && Array.isArray(actual.thumbs.values) ? actual.thumbs.values.map(normalizeMaterialUrl) : [];
  if (expectedThumbs.length > 0) {
    const thumbsMatch = JSON.stringify(actualThumbs) === JSON.stringify(expectedThumbs);
    checks.push({ field: "thumbs", expected: expectedThumbs, actual: actualThumbs, match: thumbsMatch });
  }
  if (expected.thumbnail !== undefined && expected.thumbnail !== null && String(expected.thumbnail).trim()) {
    const expectedThumbnail = normalizeMaterialUrl(expected.thumbnail);
    const actualThumbnail = normalizeMaterialUrl(actual && actual.thumbnail);
    checks.push({ field: "thumbnail", expected: expectedThumbnail, actual: actualThumbnail, match: actualThumbnail === expectedThumbnail });
  }
  if (expected.white !== undefined && expected.white !== null && String(expected.white).trim()) {
    const expectedWhite = normalizeMaterialUrl(expected.white);
    const actualWhite = normalizeMaterialUrl(actual && actual.white && actual.white.value);
    checks.push({ field: "white", expected: expectedWhite, actual: actualWhite, match: actualWhite === expectedWhite });
  }
  const mismatches = checks.filter(item => !item.match);
  return {
    total: checks.length,
    matched: checks.length - mismatches.length,
    mismatched: mismatches.length,
    checks,
    mismatches,
  };
}

async function actionImageVerify(productId, expected, allowCurrentPage, expectedProductId) {
  const current = await actionImageRead(productId, allowCurrentPage, expectedProductId);
  if (!current || current.status !== "ok") {
    return {
      status: "error",
      message: current && current.message ? current.message : "image-read failed",
      readback: current || null,
    };
  }
  const compare = compareImageState(current, expected || {});
  return {
    status: compare.mismatched === 0 ? "ok" : "mismatch",
    productId: current.productId,
    currentPage: current.currentPage,
    expected,
    readback: current,
    verifyResult: compare,
  };
}

async function actionImagePick(productId, categoryName, fileNames, allowCurrentPage, expectedProductId, options = {}) {
  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const before = await readImageSectionState("thumbs");
  const requested = Array.isArray(fileNames) ? fileNames.map(x => String(x).trim()).filter(Boolean) : [String(fileNames || "").trim()].filter(Boolean);
  await openImageModal("thumbs");
  if (categoryName) await clickImageCategory(categoryName);
  const selection = await selectMaterialCardsByNames(requested, {
    existingUrls: before.values,
    skipExistingUrls: options.skipIfAlreadyPresent === true,
    searchText: requested.length === 1 ? requested[0] : "",
  });
  if (selection.status !== "ok") return selection;
  const alreadyPresent = selection.alreadyPresent || [];
  const selected = selection.picked || [];
  if (selected.length === 0) {
    await cancelImageModal();
    const afterSkip = await readImageSectionState("thumbs");
    return {
      status: "ok",
      productId: prep.productId,
      currentPage: prep.currentPage,
      categoryName,
      requested,
      selected: [],
      alreadyPresent,
      expectedUrls: alreadyPresent.map(item => item.normalizedUrl || normalizeMaterialUrl(item.imgUrl)),
      appended: [],
      before,
      after: afterSkip,
      missingUrls: [],
      skipped: true,
      reason: "all_requested_images_already_present",
      searchUsed: selection.searchUsed,
      searchFallback: selection.searchFallback,
      searchKeyword: selection.searchKeyword,
    };
  }
  await confirmImageModal();
  const after = await readImageSectionState("thumbs");
  const expectedUrls = selected.map(item => normalizeMaterialUrl(item.imgUrl));
  const appended = after.values.filter(url => !before.values.includes(url));
  const missingUrls = expectedUrls.filter(url => !after.values.includes(url));
  return {
    status: missingUrls.length === 0 ? "ok" : "partial",
    productId: prep.productId,
    currentPage: prep.currentPage,
    categoryName,
    requested,
    selected,
    alreadyPresent,
    expectedUrls,
    appended,
    before,
    after,
    missingUrls,
    searchUsed: selection.searchUsed,
    searchFallback: selection.searchFallback,
    searchKeyword: selection.searchKeyword,
  };
}

async function actionImageOrder(productId, orderedUrls, allowCurrentPage, expectedProductId) {
  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const before = await readImageSectionState("thumbs");
  const targetOrder = Array.isArray(orderedUrls) ? orderedUrls.map(normalizeMaterialUrl).filter(Boolean) : [];
  if (targetOrder.length === 0) return { status: "error", message: "orderedUrls is required" };
  const beforeSet = [...before.values].sort().join("||");
  const targetSet = [...targetOrder].sort().join("||");
  if (beforeSet !== targetSet) {
    return { status: "error", message: "orderedUrls must exactly match current thumbs[] set", current: before.values, orderedUrls: targetOrder };
  }
  const imageSel = getImageSelectors();
  const moveResult = await page.evaluate(({ orderedUrls, multiItemSelector, inputSelector }) => {
    const list = document.querySelector('.gimgs .multi-img-details');
    if (!list) return { ok: false, message: 'Image list not found' };
    const items = Array.from(list.querySelectorAll(multiItemSelector || '.multi-item'));
    const map = new Map(items.map(item => {
      const input = item.querySelector(inputSelector || 'input[name="thumbs[]"]');
      return [input ? input.value : '', item];
    }));
    for (const url of orderedUrls) {
      const item = map.get(url);
      if (!item) return { ok: false, message: 'Item not found for url: ' + url };
      list.appendChild(item);
    }
    return { ok: true };
  }, { orderedUrls: targetOrder, multiItemSelector: imageSel.multiItem || '.multi-item', inputSelector: imageSel.thumbsInput || 'input[name="thumbs[]"]' });
  if (!moveResult.ok) return { status: "error", message: moveResult.message };
  await page.waitForTimeout(500);
  const after = await readImageSectionState("thumbs");
  return {
    status: JSON.stringify(after.values) === JSON.stringify(targetOrder) ? "ok" : "partial",
    productId: prep.productId,
    currentPage: prep.currentPage,
    before,
    after,
    targetOrder,
    thumbnail: after.values[0] || "",
  };
}

async function actionWhiteImageSet(productId, categoryName, fileName, allowCurrentPage, expectedProductId, options = {}) {
  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const before = await readImageSectionState("white");
  const requested = String(fileName || "").trim();
  await openImageModal("white");
  if (categoryName) await clickImageCategory(categoryName);
  const selection = await selectMaterialCardsByNames([requested], {
    existingUrls: before.value ? [before.value] : [],
    skipExistingUrls: options.skipIfWhiteImageMatched === true,
    searchText: requested,
  });
  if (selection.status !== "ok") return selection;
  if ((selection.picked || []).length === 0) {
    await cancelImageModal();
    const afterSkip = await readImageSectionState("white");
    return {
      status: "ok",
      productId: prep.productId,
      currentPage: prep.currentPage,
      categoryName,
      requested,
      selected: null,
      alreadyPresent: selection.alreadyPresent || [],
      expectedUrl: before.value || "",
      before,
      after: afterSkip,
      skipped: true,
      reason: "white_image_already_matched",
      searchUsed: selection.searchUsed,
      searchFallback: selection.searchFallback,
      searchKeyword: selection.searchKeyword,
    };
  }
  await confirmImageModal();
  const after = await readImageSectionState("white");
  const expectedUrl = normalizeMaterialUrl(selection.picked[0].imgUrl);
  return {
    status: after.value === expectedUrl ? "ok" : "partial",
    productId: prep.productId,
    currentPage: prep.currentPage,
    categoryName,
    requested,
    selected: selection.picked[0],
    alreadyPresent: selection.alreadyPresent || [],
    expectedUrl,
    before,
    after,
    searchUsed: selection.searchUsed,
    searchFallback: selection.searchFallback,
    searchKeyword: selection.searchKeyword,
  };
}

async function actionImageUpload(productId, sectionType, categoryName, uploadFile, allowCurrentPage, expectedProductId, options = {}) {
  const prep = await ensureImagePage(productId, allowCurrentPage, expectedProductId);
  if (prep.status !== "ok") return prep;
  const normalizedSection = sectionType === "white" ? "white" : "thumbs";
  const absoluteUploadFile = path.isAbsolute(String(uploadFile || ""))
    ? String(uploadFile || "")
    : path.resolve(String(uploadFile || ""));
  if (!absoluteUploadFile) return { status: "error", message: "uploadFile is required" };
  if (!fs.existsSync(absoluteUploadFile)) return { status: "error", message: "Upload file not found: " + absoluteUploadFile };

  const imageSel = getImageSelectors();
  const before = await readImageSectionState(normalizedSection);
  const uploadedFileName = path.basename(absoluteUploadFile);
  await openImageModal(normalizedSection);
  if (categoryName) await clickImageCategory(categoryName);

  const duplicateCheck = await selectMaterialCardsByNames([uploadedFileName], {
    select: false,
    suppressMissingError: true,
    searchText: uploadedFileName,
  });
  const duplicateMatches = (duplicateCheck && duplicateCheck.picked) || [];
  if (duplicateMatches.length > 0 && options.allowDuplicateFileName !== true) {
    await cancelImageModal();
    return {
      status: "error",
      message: "Duplicate material names found before upload",
      uploadFile: absoluteUploadFile,
      uploadedFileName,
      sectionType: normalizedSection,
      duplicates: duplicateMatches,
      searchUsed: duplicateCheck.searchUsed,
      searchFallback: duplicateCheck.searchFallback,
      searchKeyword: duplicateCheck.searchKeyword,
    };
  }
  if (duplicateCheck && duplicateCheck.searchUsed) {
    await clearMaterialSearch().catch(() => {});
  }

  const fileInputSelector = imageSel.modalFileInput || "input.box_uploading_img_file";
  const fileInput = await page.$(fileInputSelector);
  if (!fileInput) throw new Error("Image modal file input not found");
  await fileInput.setInputFiles(absoluteUploadFile);
  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle").catch(() => {});

  const selection = await selectMaterialCardsByNames([uploadedFileName], {
    searchText: uploadedFileName,
  });
  if (selection.status !== "ok") return { ...selection, uploadFile: absoluteUploadFile, uploadedFileName, sectionType: normalizedSection };

  const uploaded = selection.picked[0] || null;
  const expectedUrl = uploaded ? normalizeMaterialUrl(uploaded.imgUrl) : "";
  const shouldConfirm = options && options.confirmSelection !== false;

  if (shouldConfirm) {
    if (normalizedSection === "white") {
      await confirmImageModal();
      const after = await readImageSectionState("white");
      return {
        status: after.value === expectedUrl ? "ok" : "partial",
        productId: prep.productId,
        currentPage: prep.currentPage,
        sectionType: normalizedSection,
        categoryName,
        uploadFile: absoluteUploadFile,
        uploadedFileName,
        uploaded,
        expectedUrl,
        before,
        after,
        confirmed: true,
        searchUsed: selection.searchUsed,
        searchFallback: selection.searchFallback,
        searchKeyword: selection.searchKeyword,
      };
    }

    await confirmImageModal();
    const after = await readImageSectionState("thumbs");
    const appended = after.values.filter(url => !before.values.includes(url));
    return {
      status: after.values.includes(expectedUrl) ? "ok" : "partial",
      productId: prep.productId,
      currentPage: prep.currentPage,
      sectionType: normalizedSection,
      categoryName,
      uploadFile: absoluteUploadFile,
      uploadedFileName,
      uploaded,
      expectedUrl,
      appended,
      before,
      after,
      confirmed: true,
      searchUsed: selection.searchUsed,
      searchFallback: selection.searchFallback,
      searchKeyword: selection.searchKeyword,
    };
  }

  await cancelImageModal();
  const afterCancel = await readImageSectionState(normalizedSection);
  return {
    status: uploaded ? "ok" : "partial",
    productId: prep.productId,
    currentPage: prep.currentPage,
    sectionType: normalizedSection,
    categoryName,
    uploadFile: absoluteUploadFile,
    uploadedFileName,
    uploaded,
    expectedUrl,
    before,
    after: afterCancel,
    confirmed: false,
    materialVisible: Boolean(uploaded),
    searchUsed: selection.searchUsed,
    searchFallback: selection.searchFallback,
    searchKeyword: selection.searchKeyword,
  };
}

// ================================================================
// Action imports (shared between daemon and legacy mode)
// ================================================================

let config;
let context, page;

async function resolveRuntimeBrowserPolicy(browserConfig = {}, options = {}) {
  const readiness = await resolveValidatedBrowserPolicy(browserConfig, {
    browserCacheDir: LAYOUT.browserCacheDir,
    ...options,
  });
  return {
    ...readiness,
    launchOptions: getLaunchOptions(readiness.selectedSource, browserConfig.headless !== false),
  };
}

async function initBrowser() {
  ensureDir(USER_DATA_DIR);
  // Remove stale locks
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonLock"); } catch {}
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonSocket"); } catch {}
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonCookie"); } catch {}

  config = loadConfig();
  const browserConfig = config.browser || {};
  const runtimePolicy = await resolveRuntimeBrowserPolicy(browserConfig);
  const sharedLaunchOptions = {
    viewport: browserConfig.viewport || { width: 1440, height: 900 },
    slowMo: browserConfig.slowMo || 100,
  };
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, { ...runtimePolicy.launchOptions, ...sharedLaunchOptions });
  } catch (cause) {
    const error = new Error("Validated browser source could not launch persistently: " + runtimePolicy.selectedSource + ": " + cause.message);
    error.code = runtimePolicy.selectedSource === "chrome" ? "SYSTEM_CHROME_UNAVAILABLE" : "MANAGED_CHROMIUM_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }
  if (runtimePolicy.fallbackUsed) log("Explicit browser fallback selected: " + runtimePolicy.policy.source + " -> " + runtimePolicy.selectedSource);
  page = context.pages()[0] || (await context.newPage());
  log("Browser initialized");
}

async function closeBrowser() {
  if (context) await context.close();
  log("Browser closed");
}

// --- Login ---
async function actionLogin() {
  const sel = config.selectors.login;
  await page.goto(config.saas.loginUrl, { waitUntil: "networkidle" });
  const url = page.url();
  const loginOrigin = checkSaasOrigin(url, config.saas.loginUrl);
  if (!loginOrigin.ok) return { status: "error", message: "Login redirected to an untrusted origin", ...loginOrigin };
  if (!url.includes("login") && !url.includes("c=user")) {
    return { status: "ok", alreadyLoggedIn: true, url };
  }
  const hasForm = await page.$(sel.username).catch(() => null);
  if (!hasForm) return { status: "ok", alreadyLoggedIn: true, url };
  await page.fill(sel.username, config.saas.credentials.username);
  await page.fill(sel.password, config.saas.credentials.password);
  await page.click(sel.submitButton);
  try {
    await page.waitForURL(u => !u.includes("login") && !u.includes("c=user"), { timeout: 15000 });
  } catch {
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  // Verify login succeeded: check URL or dashboard element
  const finalUrl = page.url();
  const finalOrigin = checkSaasOrigin(finalUrl, config.saas.loginUrl);
  if (!finalOrigin.ok) return { status: "error", message: "Login completed on an untrusted origin", ...finalOrigin };
  const loggedIn = !finalUrl.includes("login") && !finalUrl.includes("c=user");
  if (!loggedIn) {
    const dashEl = await page.$(config.selectors.login.successIndicator || ".user-avatar,.dashboard-header").catch(() => null);
    if (!dashEl) return { status: "error", message: "Login failed — still on login page or no dashboard element found", url: finalUrl };
  }
  return { status: "ok", loggedIn: true, url: finalUrl };
}

// --- Ensure logged in ---
async function ensureLogin() {
  const url = page.url();
  if (!url || url === "about:blank" || url.includes("login") || url.includes("c=user")) {
    return await actionLogin();
  }
  const originCheck = checkSaasOrigin(url, config.saas.loginUrl || config.saas.baseUrl);
  if (!originCheck.ok) return { status: "error", message: "Current page is on an untrusted origin", ...originCheck };
  return { status: "ok", alreadyLoggedIn: true };
}

// --- Navigate ---
async function actionNavigate(productId) {
  const validation = await navigateProductTab(page, productId);
  return validation.status === "ok" ? { ...validation, url: page.url() } : validation;
}

async function navigateProductTab(tab, productId) {
  const url = config.saas.productDetailUrl.replace("{productId}", productId);
  await tab.goto(url, { waitUntil: "networkidle" });
  return validateProductPageAfterNavigation(tab.url(), productId, config.saas.productDetailUrl, false);
}

// --- Discover specs ---
async function discoverSpecs() {
  const rows = await page.$$("#options table tbody tr");
  const specs = [];
  for (const row of rows) {
    const idEl = await row.$("input.option_ids");
    const titleEl = await row.$("input.option_title");
    if (idEl) {
      specs.push({ specId: await idEl.inputValue(), title: titleEl ? (await titleEl.inputValue()) : "unknown" });
    }
  }
  return specs;
}

// --- Read ---
async function actionRead(productId, fields) {
  const initialNavigation = await actionNavigate(productId);
  if (initialNavigation.status !== "ok") return initialNavigation;
  await ensureLogin();
  // Re-navigate: login may have redirected away from product page
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    const loginNavigation = await actionNavigate(productId);
    if (loginNavigation.status !== "ok") return loginNavigation;
  }
  await page.waitForTimeout(1500);

  const sel = config.selectors.product;
  const specs = await discoverSpecs();
  if (specs.length === 0) {
    return { status: "error", productId, message: "no specs found; product may not exist or page structure changed", url: page.url() };
  }
  const explicitFields = Array.isArray(fields) && fields.length > 0;
  const staticFields = explicitFields ? fields : getProductFields();

  const result = { status: "ok", productId, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: {}, warnings: [], missingFields: [], dynamicRentFields: {} };
  let requestedCount = 0;
  let readCount = 0;
  for (const spec of specs) {
    const specValues = {};
    // Determine fields to read: static + dynamically discovered rent fields
    let fieldsToRead = staticFields;
    if (!explicitFields) {
      const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
      result.dynamicRentFields[spec.specId] = rentFields;
      fieldsToRead = [...staticFields, ...Object.keys(rentFields)];
    }
    for (const field of fieldsToRead) {
      requestedCount++;
      const selector = resolveFieldSelector(field, spec.specId);
      if (!selector) {
        const warning = { level: "error", specId: spec.specId, field, message: "Selector not configured" };
        result.warnings.push(warning);
        result.missingFields.push({ specId: spec.specId, field, message: warning.message });
        continue;
      }
      try {
        const el = await page.$(selector);
        if (!el) {
          const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field, message: "Element not found" };
          result.warnings.push(warning);
          if (explicitFields) result.missingFields.push({ specId: spec.specId, field, message: warning.message });
          continue;
        }
        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        let val;
        if (tag === "input" || tag === "textarea") val = await el.inputValue();
        else if (tag === "select") val = await el.evaluate(e => e.options[e.selectedIndex]?.textContent || e.value);
        else val = await el.textContent();
        specValues[field] = (val || "").trim();
        readCount++;
      } catch (err) {
        const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field, message: err.message };
        result.warnings.push(warning);
        if (explicitFields) result.missingFields.push({ specId: spec.specId, field, message: warning.message });
      }
    }
    result.values[spec.specId] = specValues;
  }
  result.requestedCount = requestedCount;
  result.readCount = readCount;
  if (explicitFields && result.missingFields.length > 0) result.status = readCount > 0 ? "partial" : "error";
  return result;
}

// --- Apply ---
async function applyFieldsOnPage(raw, specs) {
  const sel = config.selectors.product;
  const result = { status: "ok", applied: {}, failures: [], requestedCount: 0, appliedCount: 0 };
  const firstVal = Object.values(raw)[0];
  const isNested = typeof firstVal === "object" && firstVal !== null;

  if (isNested) {
    for (const [specId, fields] of Object.entries(raw)) {
      const spec = specs.find(s => s.specId === specId);
      if (!spec) {
        result.requestedCount += Object.keys(fields || {}).length;
        result.failures.push({ specId, error: "Spec not found" });
        continue;
      }
      result.applied[specId] = {};
      for (const [field, newValue] of Object.entries(fields)) {
        result.requestedCount++;
        const selector = resolveFieldSelector(field, specId);
        if (!selector) {
          result.failures.push({ specId, field, error: "Selector not configured" });
          continue;
        }
        try {
          await page.fill(selector, String(newValue));
          result.applied[specId][field] = String(newValue);
          result.appliedCount++;
        } catch (err) {
          result.failures.push({ specId, field, error: err.message });
        }
      }
    }
  } else {
    delete raw.__broadcast;
    if (specs.length > 1) {
      result.requestedCount = Object.keys(raw).length * specs.length;
      result.failures.push({ error: "Flat changes are not allowed on multi-spec pages; use nested per-spec changes" });
      result.status = "error";
      return result;
    }
    for (const spec of specs) {
      result.applied[spec.specId] = {};
      for (const [field, newValue] of Object.entries(raw)) {
        result.requestedCount++;
        const selector = resolveFieldSelector(field, spec.specId);
        if (!selector) {
          result.failures.push({ specId: spec.specId, field, error: "Selector not configured" });
          continue;
        }
        try {
          await page.fill(selector, String(newValue));
          result.applied[spec.specId][field] = String(newValue);
          result.appliedCount++;
        } catch (err) {
          result.failures.push({ specId: spec.specId, field, error: err.message });
        }
      }
    }
  }
  if (result.requestedCount === 0 || result.appliedCount === 0) result.status = "error";
  else if (result.failures.length > 0 || result.appliedCount !== result.requestedCount) result.status = "partial";
  return result;
}

async function actionApply(productId, changesFile) {
  const initialNavigation = await actionNavigate(productId);
  if (initialNavigation.status !== "ok") return initialNavigation;
  await ensureLogin();
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    const loginNavigation = await actionNavigate(productId);
    if (loginNavigation.status !== "ok") return loginNavigation;
  }
  await page.waitForTimeout(1500);
  if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
  const raw = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
  const specs = await discoverSpecs();
  return applyFieldsOnPage(raw, specs);
}

async function actionApplyOnPage(changesFile, expectedProductId) {
  const currentCheck = assertCurrentProduct(expectedProductId);
  if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
  if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
  const raw = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
  const specs = await discoverSpecs();
  return applyFieldsOnPage(raw, specs);
}

// --- Submit ---
async function actionSubmit(expectedProductId) {
  if (expectedProductId === undefined || expectedProductId === null || String(expectedProductId).trim() === "") {
    return { status: "error", step: "submit-precheck", message: "expectedProductId is required", sideEffectPossible: false };
  }
  const currentCheck = assertCurrentProduct(expectedProductId);
  if (!currentCheck.ok) {
    return { status: "error", step: "submit-precheck", message: "Current page product mismatch", sideEffectPossible: false, ...currentCheck };
  }
  const sel = config.selectors.product;
  const initialDismiss = await dismissBlockingDialogs();
  const configuredToastSelector = typeof sel.saveSuccessToast === "string" ? sel.saveSuccessToast : null;
  const toastSelectors = getSubmitToastSelectors(configuredToastSelector);
  const toastBaseline = await readVisibleSubmitToastCandidates(toastSelectors);
  const pageUrlBeforeSubmit = page.url();
  const deadline = Date.now() + 15000;
  const responseObserver = createSubmitResponseObserver(page, {
    pageUrl: pageUrlBeforeSubmit,
    expectedProductId,
    timeoutMs: Math.max(1, deadline - Date.now()),
    startArmed: false,
  });

  async function clickSaveButton() {
    const saveBtn = await page.$(sel.saveButton);
    if (!saveBtn) {
      const alt = await page.$("input[type=submit],button:has-text('保存')");
      if (!alt) return { clicked: false, reason: "Save button not found" };
      await alt.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      await dispatchSubmitClick(alt, responseObserver);
      return { clicked: true, selector: "fallback" };
    }
    await saveBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await dispatchSubmitClick(saveBtn, responseObserver);
    return { clicked: true, selector: sel.saveButton };
  }

  try {
    try {
      const clickResult = await clickSaveButton();
      if (!clickResult.clicked) {
        return { status: "error", message: clickResult.reason, dismissedDialogs: initialDismiss };
      }
    } catch (err) {
      const clickError = err && err.submitClickPhase === "trial" ? { disposition: "retry" } : classifySubmitClickError(err);
      if (clickError.disposition === "unknown") {
        return { ...clickError, detail: String(err && err.message || err), dismissedDialogs: initialDismiss };
      }
      if (clickError.disposition === "error") {
        return { status: "error", message: clickError.message, dismissedDialogs: initialDismiss };
      }
      responseObserver.disarm();
      const retryDismiss = await dismissBlockingDialogs();
      try {
        const retryClick = await clickSaveButton();
        if (!retryClick.clicked) {
          return { status: "error", message: retryClick.reason, dismissedDialogs: { before: initialDismiss, retry: retryDismiss } };
        }
      } catch (retryErr) {
        const retryClickError = retryErr && retryErr.submitClickPhase === "trial"
          ? { disposition: "error", status: "error", message: String(retryErr.message || retryErr) }
          : classifySubmitClickError(retryErr);
        if (retryClickError.disposition === "unknown") {
          return { ...retryClickError, detail: String(retryErr && retryErr.message || retryErr), dismissedDialogs: { before: initialDismiss, retry: retryDismiss } };
        }
        return {
          status: "error",
          message: retryClickError.message || String(retryErr && retryErr.message || retryErr || err),
          dismissedDialogs: { before: initialDismiss, retry: retryDismiss },
        };
      }
    }

    const pendingForever = new Promise(() => {});
    const responseSignal = responseObserver.result.then(result => ({ source: "response", result }));
    const redirectSignal = page.waitForURL(u => !u.toString().includes("goods.edit"), { timeout: Math.max(1, deadline - Date.now()) })
      .then(() => ({ source: "redirect", result: { success: true, detail: "redirected" } }))
      .catch(() => pendingForever);
    const toastSignal = detectSubmitSuccessToast(configuredToastSelector, toastBaseline, deadline)
      .then(result => result.success ? { source: "toast", result } : pendingForever);
    const firstSignal = await Promise.race([responseSignal, redirectSignal, toastSignal]);

    if (firstSignal.source !== "response") {
      const graceMs = Math.min(350, Math.max(1, deadline - Date.now()));
      const ajaxDuringGrace = await Promise.race([
        responseObserver.result.then(result => ({ received: true, result })),
        new Promise(resolve => setTimeout(() => resolve({ received: false }), graceMs)),
      ]);
      const externalDetails = firstSignal.source === "redirect"
        ? { redirectDetail: firstSignal.result.detail }
        : { toastDetail: firstSignal.result.detail };
      const outcome = resolveImmediateSubmitOutcome({
        responseResult: ajaxDuringGrace.received ? ajaxDuringGrace.result : { status: "unknown", detail: "no_matching_ajax_response" },
        ...externalDetails,
      });
      return { ...outcome, dismissedDialogs: initialDismiss };
    }

    const responseResult = firstSignal.result;
    const currentUrl = page.url();
    const redirectDetail = currentUrl.includes("goods.edit") ? "" : "url_changed: " + currentUrl.substring(0, 60);
    return { ...resolveImmediateSubmitOutcome({ responseResult, redirectDetail }), dismissedDialogs: initialDismiss };
  } finally {
    responseObserver.dispose();
  }
}

// --- Spec management ---
async function actionSpecDiscover() {
  const dims = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[id^="spec_"]').forEach(el => {
      if (el.id === "spec_table" || el.id.startsWith("spec_item_") || !el.querySelector(".spec_title")) return;
      const specId = el.id.replace("spec_", "");
      const items = [];
      const c = document.getElementById("spec_item_" + specId);
      if (c) c.querySelectorAll(".spec_item_title").forEach(itemEl => {
        const row = itemEl.closest('[id^="spec_item_"]');
        const idEl = row ? row.querySelector(".spec_item_id") : null;
        items.push({ id: idEl ? idEl.value : "?", title: itemEl.value || "" });
      });
      result.push({ specId, title: el.querySelector(".spec_title").value || "", items });
    });
    return result;
  });
  return { status: "ok", dimensions: dims };
}

function normalizeSpecTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findSpecDim(dimensions, specDimId) {
  return (dimensions || []).find(d => String(d.specId) === String(specDimId));
}

function specDimHasItem(dim, itemTitle) {
  const target = normalizeSpecTitle(itemTitle);
  return Boolean(dim && (dim.items || []).some(i => normalizeSpecTitle(i.title) === target));
}

async function actionSpecAddItem(specDimId, itemTitle) {
  const normalizedTitle = normalizeSpecTitle(itemTitle);
  if (!normalizedTitle) return { status: "error", message: "itemTitle is required" };
  const specSel = config.selectors.spec || {};
  const btnSel = specSel.addSpecItemBtn ? specSel.addSpecItemBtn.replace("{dimId}", specDimId) : "#add-specitem-" + specDimId;
  const btn = await page.$(btnSel);
  if (!btn) return { status: "error", message: "Button not found: " + btnSel };
  await btn.click();
  await page.waitForTimeout(800);
  const containerSel = specSel.specItemContainer ? specSel.specItemContainer.replace("{dimId}", specDimId) : "#spec_item_" + specDimId;
  const container = await page.$(containerSel);
  if (!container) return { status: "error", message: "Spec item container not found: " + containerSel };
  const titleSel = specSel.specItemTitle || ".spec_item_title";
  const itemInputs = await container.$$(titleSel);
  const last = itemInputs[itemInputs.length - 1];
  if (!last) return { status: "error", message: "Spec item input not found: " + titleSel };
  if (last) {
    await last.click();
    await last.fill(normalizedTitle);
    // Trigger events to register the new item with the platform
    await last.evaluate(el => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
    const filled = normalizeSpecTitle(await last.inputValue().catch(() => ""));
    if (filled !== normalizedTitle) return { status: "error", message: "Spec item input was not filled", expected: normalizedTitle, actual: filled };
  }
  return { status: "ok", action: "add-item", specDimId, itemTitle: normalizedTitle };
}

async function actionSpecRemoveItem(specDimId) {
  const containerSel = (config.selectors.spec || {}).specItemContainer ? (config.selectors.spec || {}).specItemContainer.replace("{dimId}", specDimId) : "#spec_item_" + specDimId;
  const rows = await page.$$(containerSel + " .spec_item_title");
  if (rows.length <= 1) return { status: "error", message: "Cannot remove last item" };

  const lastRow = rows[rows.length - 1];
  const parent = await lastRow.evaluateHandle(el => el.closest("div,tr,li"));

  // Try multiple strategies to find the delete button
  let delBtn = await parent.$("a[onclick*='remove'],a[onclick*='delete'],a.btn-danger,a[class*='del'],a[class*='remove']");
  if (!delBtn) {
    const allLinks = await parent.$$("a[onclick]");
    if (allLinks.length > 0) delBtn = allLinks[allLinks.length - 1];
  }

  if (delBtn) {
    await delBtn.click();
    await page.waitForTimeout(500);
    return { status: "ok", action: "remove-item", specDimId };
  }

  // Fallback: evaluate in browser
  try {
    await page.evaluate((dimId) => {
      const c = document.getElementById("spec_item_" + dimId);
      if (!c) return;
      const items = c.querySelectorAll(".spec_item_title");
      if (items.length <= 1) return;
      const row = items[items.length - 1].closest("div,tr");
      if (!row) return;
      const links = row.querySelectorAll("a[onclick]");
      if (links.length > 0) links[links.length - 1].click();
    }, specDimId);
    return { status: "ok", action: "remove-item", specDimId };
  } catch (e) {
    log("spec-remove-item fallback failed: " + e.message);
  }

  return { status: "error", message: "Delete button not found for dim " + specDimId };
}

async function actionSpecAddDim(title) {
  const btn = await page.$("#add-spec");
  if (!btn) return { status: "error", message: "add-spec button not found" };
  await btn.click();
  await page.waitForTimeout(800);
  const inputs = await page.$$(".spec_title");
  const last = inputs[inputs.length - 1];
  if (last) { await last.click(); await last.fill(title); }
  return { status: "ok", action: "add-dim", title };
}

async function actionSpecRemoveDim(dimId) {
  const container = await page.$("#spec_" + dimId);
  if (!container) return { status: "error", message: "Dimension not found: " + dimId };
  const delBtn = await container.$("a[onclick*='removeSpec']") || await container.$("a.btn-danger");
  if (!delBtn) return { status: "error", message: "Delete button not found" };
  await delBtn.click();
  return { status: "ok", action: "remove-dim", dimId };
}

async function actionSpecRefresh() {
  const specSel = config.selectors.spec || {};
  const btnSel = specSel.refreshBtn || "a:has-text('刷新规格项目表')";
  const btn = await page.$(btnSel);
  if (!btn) return { status: "error", message: "Refresh button not found: " + btnSel };
  await btn.click();
  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: "ok", tableRows: (await page.$$("#options table tbody tr")).length };
}

// --- Tenancy management ---
async function actionTenancySet(daysStr) {
  const days = daysStr.split(",").map(d => d.trim()).filter(Boolean);
  if (days.length === 0) return { status: "error", message: "No tenancy days provided" };
  const showPopup = await page.evaluate(() => {
    const p = document.querySelector(".BOX_PUBLIC_POP_WEB");
    if (!p) return { ok: false, message: "Tenancy popup not found" };
    p.style.display = "block";
    p.style.visibility = "visible";
    p.style.position = "fixed";
    p.style.top = "60px";
    p.style.left = "50%";
    p.style.transform = "translateX(-50%)";
    p.style.zIndex = "9999";
    p.style.background = "#fff";
    p.style.border = "1px solid #ccc";
    p.style.padding = "20px";
    p.style.width = "500px";
    return { ok: true };
  });
  if (!showPopup.ok) return { status: "error", message: showPopup.message };
  await page.waitForTimeout(300);
  const prep = await page.evaluate((d) => {
    const tbody = document.querySelector(".rent_days_tbody");
    if (!tbody) return { ok: false, message: "rent_days_tbody not found" };
    if (typeof addDays !== "function") return { ok: false, message: "addDays not found on page" };
    tbody.innerHTML = "";
    d.forEach(() => addDays());
    return { ok: true, rows: tbody.querySelectorAll("tr").length };
  }, days);
  if (!prep.ok) return { status: "error", message: prep.message };
  await page.waitForTimeout(300);
  const inputs = await page.$$("input.rent_days");
  if (inputs.length < days.length) return { status: "error", message: "Not enough rent day inputs", expected: days.length, actual: inputs.length };
  for (let i = 0; i < days.length; i++) { await inputs[i].fill(days[i]); }
  const filled = await page.$$eval("input.rent_days", els => els.map(el => (el.value || "").trim()));
  const missingDays = days.filter(d => !filled.includes(d));
  if (missingDays.length > 0) return { status: "error", message: "Tenancy inputs were not filled", missingDays, filled };
  const saved = await page.evaluate(() => {
    if (typeof saveDays !== "function") return { ok: false, message: "saveDays not found on page" };
    saveDays();
    return { ok: true };
  });
  if (!saved.ok) return { status: "error", message: saved.message };
  await page.waitForTimeout(1000);
  // Close popup BEFORE refresh (popup blocks refresh button)
  await page.evaluate(() => {
    const p = document.querySelector(".BOX_PUBLIC_POP_WEB");
    if (p) p.style.display = "none";
  });
  await page.waitForTimeout(300);
  const refresh = await actionSpecRefresh();
  if (!refresh || refresh.status !== "ok") return { status: "error", message: "Refresh failed after tenancy-set", refresh };
  // Read new values from current page (don't navigate away)
  const specs = await discoverSpecs();
  if (specs.length === 0) return { status: "error", message: "no specs found after tenancy-set refresh", days };
  const staticFlds = getProductFields();
  const vals = {};
  for (const spec of specs) {
    vals[spec.specId] = {};
    const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
    const allFlds = [...staticFlds, ...Object.keys(rentFields)];
    for (const f of allFlds) {
      const selector = resolveFieldSelector(f, spec.specId);
      if (!selector) continue;
      try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
    }
  }
  return { status: "ok", days, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals };
}

// --- Shared: find product on list page via search + large page size ---
async function findProductOnList(productId) {
  const channels = getProductSearchChannels();
  for (const channel of channels) {
    await page.goto(buildListUrl(channel.url, { pagesize: 100 }), { waitUntil: "networkidle" });
    const login = await ensureLogin();
    if (login && login.status === "error") return login;
    const initialPage = checkConfiguredPage(page.url(), channel.url);
    if (!initialPage.ok) return { status: "error", message: "Product list navigation failed canonical validation", channelKey: channel.key, channelLabel: channel.label, ...initialPage };
    await page.waitForTimeout(1500);

    const kwInput = await page.$("input[name='keyword']");
    if (kwInput) {
      await kwInput.fill(String(productId));
      await kwInput.press("Enter");
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle").catch(() => {});
      const searchPage = checkConfiguredPage(page.url(), channel.url);
      if (!searchPage.ok) return { status: "error", message: "Product list search navigation failed canonical validation", channelKey: channel.key, channelLabel: channel.label, ...searchPage };
    }

    const editLink = await page.$(`a[href*="goods.edit&id=${productId}"]`);
    if (editLink) {
      const row = await editLink.evaluateHandle(el => el.closest("tr"));
      const copyBtn = await page.$(`a[data-toggle="ajaxModal"][href*="copyGoods"][href*="id=${productId}"]`);
      return { found: true, row, copyBtn, channelKey: channel.key, channelLabel: channel.label, channelUrl: channel.url };
    }

    for (let pg = 2; pg <= 5; pg++) {
      await page.goto(buildListUrl(channel.url, { pagesize: 100, page: pg }), { waitUntil: "networkidle" });
      const pageCheck = checkConfiguredPage(page.url(), channel.url);
      if (!pageCheck.ok) return { status: "error", message: "Product list pagination failed canonical validation", channelKey: channel.key, channelLabel: channel.label, ...pageCheck };
      await page.waitForTimeout(1000);
      const link = await page.$(`a[href*="goods.edit&id=${productId}"]`);
      if (link) {
        const row = await link.evaluateHandle(el => el.closest("tr"));
        const copyBtn = await page.$(`a[data-toggle="ajaxModal"][href*="copyGoods"][href*="id=${productId}"]`);
        return { found: true, row, copyBtn, channelKey: channel.key, channelLabel: channel.label, channelUrl: channel.url };
      }
    }
  }

  return { found: false, searchedChannels: channels.map(channel => ({ key: channel.key, label: channel.label, url: channel.url })) };
}

async function clickVisibleConfirmIn(scopeHandle) {
  if (!scopeHandle) return { clicked: false };
  const text = await scopeHandle.evaluate(el => el.textContent?.trim().substring(0, 200) || "").catch(() => "");
  const clicked = await scopeHandle.evaluate(el => {
    const candidates = Array.from(el.querySelectorAll("button, a, input[type='button'], input[type='submit']"));
    const btn = candidates.find(node => {
      const txt = (node.textContent || node.value || "").trim();
      return (txt === "确认" || txt === "确定" || txt === "是" || txt === "OK") && node.offsetParent !== null;
    });
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => false);
  return { clicked, text };
}

async function maybeConfirmDialog() {
  const modal = await page.waitForSelector(".modal.show, .modal.in, .layui-layer-dialog, .layui-m-layer, .modal, .layui-layer", { timeout: 3000, state: "visible" }).catch(() => null);
  if (!modal) return { confirmed: false, text: "" };
  const result = await clickVisibleConfirmIn(modal);
  if (result.clicked) {
    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  return { confirmed: result.clicked, text: result.text };
}

function copyResultStatus(newProductId) {
  return newProductId ? "ok" : "unknown";
}

async function waitForNewProductIdAfterSave(originalProductId, targetPage) {
  const original = String(originalProductId);
  const deadline = Date.now() + 10000;
  let lastUrl = targetPage.url();
  while (Date.now() < deadline) {
    await targetPage.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    await targetPage.waitForTimeout(500);
    lastUrl = targetPage.url();
    const idMatch = lastUrl.match(/[?&]id=(\d+)/);
    if (idMatch && idMatch[1] !== original) return { newProductId: idMatch[1], url: lastUrl };
    const successText = await targetPage.locator("text=/保存成功|操作成功|复制成功|success/i").first().isVisible({ timeout: 200 }).catch(() => false);
    if (successText && idMatch && idMatch[1] !== original) return { newProductId: idMatch[1], url: lastUrl };
  }
  return { newProductId: null, url: lastUrl };
}

function unknownCopyResult(productId, confirmText, extra = {}) {
  return {
    status: "unknown",
    action: "copy",
    originalProductId: productId,
    newProductId: null,
    confirmText,
    sideEffectPossible: true,
    retrySafe: false,
    message: "Copy may have succeeded but newProductId could not be detected; do not retry automatically",
    ...extra,
  };
}

// --- Delist product ---
async function actionDelist(productId) {
  const lookup = await findProductOnList(productId);
  if (lookup.status === "error") return lookup;
  const { found, row, channelKey, channelLabel } = lookup;
  if (!found) return { status: "error", message: "Product not found: " + productId };
  const cb = await row.$("input[type='checkbox']");
  if (!cb) return { status: "error", message: "Checkbox not found in row" };
  await cb.check();
  await page.waitForTimeout(300);

  // Click 下架 button
  const btn = await page.$("button[data-toggle='batch']:has(i.icow-xiajia3)");
  if (!btn) return { status: "error", message: "下架 button not found" };
  await btn.click();
  const confirm = await maybeConfirmDialog();
  if (!confirm.confirmed) {
    return { status: "error", action: "delist", productId, channelKey, channelLabel, confirmed: false, confirmText: confirm.text, message: "Delist confirmation dialog was not confirmed" };
  }
  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle").catch(() => {});

  // Verify: re-search to confirm product no longer in active list
  const kwInput = await page.$("input[name='keyword']");
  if (kwInput) {
    await kwInput.fill(String(productId));
    await kwInput.press("Enter");
    await page.waitForTimeout(1500);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  const stillVisible = await page.$(`a[href*="goods.edit&id=${productId}"]`);
  if (stillVisible) return { status: "error", action: "delist", productId, channelKey, channelLabel, confirmed: confirm.confirmed, confirmText: confirm.text, message: "Product still visible after delist" };

  return { status: "ok", action: "delist", productId, channelKey, channelLabel, confirmed: confirm.confirmed, confirmText: confirm.text };
}

// --- Copy product ---
async function actionCopyProduct(productId) {
  const lookup = await findProductOnList(productId);
  if (lookup.status === "error") return lookup;
  const { found, copyBtn, channelKey, channelLabel } = lookup;
  if (!found || !copyBtn) return { status: "error", message: "Product not found: " + productId };
  await copyBtn.click();
  await page.waitForTimeout(1500);

  // Wait for modal container to appear first
  const modalContainer = await page.waitForSelector(".modal.show, .modal.in, .layui-layer-dialog, .layui-m-layer, .modal", { timeout: 8000 }).catch(() => null);
  if (!modalContainer) {
    // Debug: log what's visible
    const visibleModals = await page.$$(".modal, .layui-layer, [class*='dialog']");
    const modalInfo = [];
    for (const m of visibleModals.slice(0, 3)) {
      const cls = await m.evaluate(el => el.className).catch(() => "");
      const txt = await m.evaluate(el => el.textContent?.substring(0, 50)).catch(() => "");
      modalInfo.push({ class: cls, text: txt });
    }
    return { status: "error", message: "Modal not found after copy click", modalInfo };
  }
  await page.waitForTimeout(500);

  // Click confirm button only inside the current modal
  await page.waitForTimeout(500);
  const confirm = await clickVisibleConfirmIn(modalContainer);
  if (!confirm.clicked) return { status: "error", message: "No visible confirm button found in copy modal", modalText: confirm.text };
  await page.waitForTimeout(2000);

  // Check if current page navigated (same-tab redirect) or new page opened
  const currentUrl = page.url();
  if (currentUrl.includes("goods.edit") || currentUrl.includes("goods.copy")) {
    const destination = validateCopyDestination(currentUrl, productId, config.saas.productDetailUrl);
    if (!destination.ok) return unknownCopyResult(productId, confirm.text, { channelKey, channelLabel, currentUrl, message: "Copy destination failed canonical validation; save was not clicked" });
    // Same-tab navigation: we're on the copy/edit page with original product data
    const saveBtn = await page.$(config.selectors.product.saveButton).catch(() => null)
      || await page.$("input[type=submit],button:has-text('保存')").catch(() => null);
    if (!saveBtn) return { status: "error", message: "Save button not found on copy page" };
    await saveBtn.click();
    const saved = await waitForNewProductIdAfterSave(productId, page);
    // Restore page state: navigate back to list page so daemon is in a known state
    await page.goto(config.saas.productListUrl, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    if (!saved.newProductId) return unknownCopyResult(productId, confirm.text, { channelKey, channelLabel, currentUrl: saved.url });
    return { status: copyResultStatus(saved.newProductId), action: "copy", originalProductId: productId, newProductId: saved.newProductId, channelKey, channelLabel, confirmText: confirm.text, currentUrl: saved.url, sideEffectPossible: false };
  }

  // Check for new page/tab
  const pages = context.pages();
  const newPage = pages.find(p => p !== page && validateCopyDestination(p.url(), productId, config.saas.productDetailUrl).ok);
  if (newPage) {
    await newPage.waitForLoadState("networkidle").catch(() => {});
    await newPage.waitForTimeout(1000);
    const saveBtn = await newPage.$(config.selectors.product.saveButton).catch(() => null)
      || await newPage.$("input[type=submit],button:has-text('保存')").catch(() => null);
    if (saveBtn) { await saveBtn.click(); }
    const saved = await waitForNewProductIdAfterSave(productId, newPage);
    await newPage.close().catch(() => {});
    if (!saved.newProductId) return unknownCopyResult(productId, confirm.text, { channelKey, channelLabel, newUrl: saved.url });
    return { status: copyResultStatus(saved.newProductId), action: "copy", originalProductId: productId, newProductId: saved.newProductId, channelKey, channelLabel, confirmText: confirm.text, newUrl: saved.url, sideEffectPossible: false };
  }

  // Cleanup: close any stray pages
  for (const p of context.pages()) {
    if (p !== page) await p.close().catch(() => {});
  }
  return unknownCopyResult(productId, confirm.text, { channelKey, channelLabel, currentUrl, message: "Copy confirmation was clicked but no copy page was detected; do not retry automatically" });
}

function buildListUrl(baseUrl, params = {}) {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
  return baseUrl + (qs ? sep + qs : "");
}

async function submitListSearch(listUrl, keyword) {
  // Prefer GET URL search because the platform's form submit may drop pagesize=100.
  await page.goto(buildListUrl(listUrl, { pagesize: 100, keyword: keyword || "" }), { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const kwInput = await page.$("input[name='keyword']")
    || await page.$("input[placeholder*='ID'], input[placeholder*='名称'], input[placeholder*='编号']")
    || await page.$(".form-search input[type='text']");
  if (!kwInput) return { ok: false, message: "Search input not found", url: page.url() };
  return { ok: true };
}

function normalizeText(val) {
  return String(val || "").trim();
}

function extractNumericPrices(val) {
  const raw = normalizeText(val).replace(/[,，￥¥]/g, "");
  return (raw.match(/\d+(?:\.\d+)?/g) || [])
    .map(x => Number(x))
    .filter(n => Number.isFinite(n));
}

function rowHasLinkPrice(row) {
  for (const val of row.cells || []) {
    if (extractNumericPrices(val).some(n => Math.abs(n - 0.01) < 0.000001 || Math.abs(n - 0.1) < 0.000001)) return true;
  }
  return false;
}

function rowStartsWithMq(row) {
  return [row.name, ...(row.cells || [])].some(v => /^MQ/i.test(normalizeText(v)));
}

function classifyPlatformSearchExclusion(row) {
  if (rowStartsWithMq(row)) return { excluded: true, reason: "mq-maintained", message: "Product name or platform row text starts with MQ" };
  if (rowHasLinkPrice(row)) return { excluded: true, reason: "link-price", message: "Product row contains link price 0.01/0.1" };
  return { excluded: false };
}

function filterPlatformProducts(rows) {
  const products = [];
  const excluded = [];
  for (const row of rows || []) {
    const r = classifyPlatformSearchExclusion(row);
    if (r.excluded) excluded.push({ id: row.id, name: row.name, reason: r.reason, message: r.message, text: row.text, channelKey: row.channelKey, channelLabel: row.channelLabel });
    else products.push(row);
  }
  return { products, excluded };
}

async function scrapeProductRows() {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll("tbody tr");
    const result = [];
    for (const row of rows) {
      const editLink = row.querySelector("a[href*='goods.edit'][href*='id=']");
      if (!editLink) continue;
      const href = editLink.getAttribute("href") || "";
      const idMatch = href.match(/[?&]id=(\d+)/);
      if (!idMatch) continue;
      const cells = Array.from(row.querySelectorAll("td")).map(td => td.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
      const copyLink = row.querySelector("a[data-toggle='ajaxModal'][href*='copyGoods']");
      result.push({
        id: idMatch[1],
        name: (cells.find(t => !/^\d+$/.test(t) && t.length > 2) || "").substring(0, 120),
        text: cells.join(" | ").substring(0, 500),
        cells,
        editUrl: href,
        copyAvailable: Boolean(copyLink),
      });
    }
    return result;
  });
}

// --- Platform search: scrape product list by keyword ---
async function actionPlatformSearch(keyword) {
  const channels = getProductSearchChannels();
  const products = [];
  const excluded = [];
  for (const channel of channels) {
    await page.goto(buildListUrl(channel.url, { pagesize: 100 }), { waitUntil: "networkidle" });
    await ensureLogin();
    await page.waitForTimeout(1000);

    const sr = await submitListSearch(channel.url, keyword || "");
    if (!sr.ok) return { status: "error", message: sr.message, url: sr.url, channelKey: channel.key, channelLabel: channel.label };

    const rows = (await scrapeProductRows()).map(row => ({ ...row, channelKey: channel.key, channelLabel: channel.label }));
    const filtered = filterPlatformProducts(rows);
    products.push(...filtered.products);
    excluded.push(...filtered.excluded);
  }
  return {
    status: "ok",
    keyword,
    count: products.length,
    products,
    excluded,
    excludedCount: excluded.length,
    channels: channels.map(channel => ({ key: channel.key, label: channel.label, url: channel.url })),
    filterRules: ["exclude MQ-maintained products", "exclude link-price products with row price 0.01/0.1"],
  };
}

async function readProductOnTab(tab, productId, fields, explicitFields = false) {
  const navigation = await navigateProductTab(tab, productId);
  await tab.waitForTimeout(1000);
  const url = tab.url();
  if (url.includes("login") || url.includes("c=user")) throw new Error("redirected to login");
  if (navigation.status !== "ok") {
    throw new Error(navigation.message + ": expected product " + productId + ", got " + (navigation.currentProductId || "unknown") + " at " + url);
  }

  const specs = await tab.evaluate(() => {
    const result = [];
    const rows = document.querySelectorAll("#options table tbody tr");
    for (const row of rows) {
      const idEl = row.querySelector("input.option_ids");
      const titleEl = row.querySelector("input.option_title");
      if (idEl) result.push({ specId: idEl.value.trim(), title: titleEl ? titleEl.value.trim() : "" });
    }
    return result;
  });
  if (specs.length === 0) throw new Error("no specs found; product may not exist or page structure changed");

  const vals = {};
  const warnings = [];
  const missingFields = [];
  let requestedCount = 0;
  let readCount = 0;
  const sel = config.selectors.product;
  const dynamicRentFields = {};
  for (const spec of specs) {
    vals[spec.specId] = {};
    // Determine fields to read: static + dynamically discovered rent fields
    let fieldsToRead = fields;
    if (!explicitFields) {
      const rentFields = await discoverRentFieldsForSpec(tab, spec.specId);
      dynamicRentFields[spec.specId] = rentFields;
      fieldsToRead = [...fields, ...Object.keys(rentFields)];
    }
    for (const f of fieldsToRead) {
      requestedCount++;
      const selector = resolveFieldSelector(f, spec.specId);
      if (!selector) {
        const item = { specId: spec.specId, field: f, message: "Selector not configured" };
        missingFields.push(item);
        warnings.push({ level: "error", ...item });
        continue;
      }
      try {
        const el = await tab.$(selector);
        if (!el) {
          const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field: f, message: "Element not found" };
          warnings.push(warning);
          if (explicitFields) missingFields.push({ specId: spec.specId, field: f, message: warning.message });
          continue;
        }
        const tag = await el.evaluate(node => node.tagName.toLowerCase());
        let val;
        if (tag === "input" || tag === "textarea") val = await el.inputValue();
        else if (tag === "select") val = await el.evaluate(node => node.options[node.selectedIndex]?.textContent || node.value);
        else val = await el.textContent();
        vals[spec.specId][f] = (val || "").trim();
        readCount++;
      } catch (err) {
        const warning = { level: explicitFields ? "error" : "warn", specId: spec.specId, field: f, message: err.message };
        warnings.push(warning);
        if (explicitFields) missingFields.push({ specId: spec.specId, field: f, message: warning.message });
      }
    }
  }
  const status = explicitFields && missingFields.length > 0 ? (readCount > 0 ? "partial" : "error") : "ok";
  return { status, productId, url, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals, warnings, missingFields, requestedCount, readCount, dynamicRentFields };
}

const BATCH_READ_CONCURRENCY = Math.max(1, Number(process.env.RENTAL_PRICE_AGENT_BATCH_READ_CONCURRENCY || 6));

// --- Batch read: parallel multi-tab read (default max 6 concurrent) ---
async function actionBatchRead(productIds, fields) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { status: "error", message: "productIds must be a non-empty array" };
  }

  const explicitFields = Array.isArray(fields) && fields.length > 0;
  const flds = explicitFields ? fields : getProductFields();
  const results = {};
  const errors = [];
  const warnings = [];

  for (let i = 0; i < productIds.length; i += BATCH_READ_CONCURRENCY) {
    const chunk = productIds.slice(i, i + BATCH_READ_CONCURRENCY).map(String);
    const jobs = chunk.map(async pid => {
      let tab = null;
      try {
        tab = await context.newPage();
        results[pid] = await readProductOnTab(tab, pid, flds, explicitFields);
        if (results[pid].warnings && results[pid].warnings.length > 0) warnings.push(...results[pid].warnings.map(w => ({ productId: pid, ...w })));
      } catch (err) {
        errors.push({ productId: pid, error: err.message });
      } finally {
        if (tab) await tab.close().catch(() => {});
      }
    });
    await Promise.all(jobs);
  }

  const hasPartial = Object.values(results).some(r => r.status === "partial") || warnings.some(w => w.level === "error");
  const status = errors.length > 0
    ? (Object.keys(results).length > 0 ? "partial" : "error")
    : (hasPartial ? "partial" : "ok");
  return { status, count: Object.keys(results).length, results, errors, warnings };
}

// ================================================================
// Daemon server
// ================================================================

async function startDaemon(port) {
  ensureDir(OUTPUT_DIR);
  ensureDir(LAYOUT.daemonDir);
  const existing = await validateDaemonIdentity({ layout: LAYOUT, targetDir: LAYOUT.targetDir });
  const restart = await enforceRestartForCommand({
    layout: LAYOUT,
    command: { action: "login" },
    loadedIdentity: LOADED_RELEASE_IDENTITY,
    allowedDoctorBlockers: existing.valid || existing.code === "DAEMON_IDENTITY_ABSENT" ? [] : [existing.code],
    validateDoctor: () => require("./lifecycle").runDoctor({ targetDir: LAYOUT.targetDir }),
    validateDaemon: async () => existing.valid
      ? { compatible: existing.identity.releaseTreeSha256 === LOADED_RELEASE_IDENTITY.releaseTreeSha256 }
      : { noDaemon: existing.code === "DAEMON_IDENTITY_ABSENT" || existing.code === "DAEMON_PROCESS_ABSENT" },
  });
  if (!restart.allowed) { output(restart); return; }
  if (existing.valid) {
    output({ status: "ok", reused: true, instanceId: existing.identity.instanceId, port: existing.identity.port });
    return;
  }
  const cleanup = await cleanupDaemonState({ layout: LAYOUT, targetDir: LAYOUT.targetDir });
  if (cleanup.reason === "DAEMON_RECOVERY_REQUIRED") {
    output({
      status: "error",
      code: "DAEMON_RECOVERY_REQUIRED",
      causeCode: cleanup.causeCode,
      message: "Live daemon identity requires recovery before replacement: " + cleanup.causeCode,
    });
    return;
  }
  if (!cleanup.cleaned && cleanup.reason !== "DAEMON_IDENTITY_ABSENT") {
    output({ status: "error", code: cleanup.reason, message: "Daemon state could not be safely replaced" });
    return;
  }
  const daemonToken = crypto.randomBytes(24).toString("hex");

  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.headers["x-rental-agent-token"] !== daemonToken) {
      res.writeHead(403);
      res.end(JSON.stringify({ status: "error", code: "DAEMON_AUTH_FAILED", message: "Forbidden" }));
      return;
    }

    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const cmd = body ? JSON.parse(body) : {};
        const result = await enqueueCommand(cmd);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ status: "error", message: err.message }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actualPort = server.address().port;
  await createDaemonIdentity({
    layout: LAYOUT,
    targetDir: LAYOUT.targetDir,
    pid: process.pid,
    port: actualPort,
    token: daemonToken,
    instanceId: DAEMON_INSTANCE_ID,
    releaseTreeSha256: RELEASE_TREE_SHA256,
  });
  log("Daemon listening on http://127.0.0.1:" + actualPort);

  // Init browser (lazy — on first command)
  log("Daemon ready (browser will init on first command)");

  const shutdown = async () => {
    await closeBrowser();
    await new Promise(resolve => server.close(resolve));
    const current = readDaemonIdentity(LAYOUT);
    if (current.identity && current.identity.instanceId === DAEMON_INSTANCE_ID) removeDaemonFiles(LAYOUT);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

let browserInitPromise = null;
let commandQueue = Promise.resolve();
let daemonDraining = false;

function enqueueCommand(cmd) {
  if (cmd && cmd.action === "lifecycle-drain") {
    if (cmd.expectedInstanceId !== DAEMON_INSTANCE_ID || cmd.releaseTreeSha256 !== RELEASE_TREE_SHA256) {
      return Promise.resolve({ status: "error", code: "DAEMON_HELLO_MISMATCH", drained: false });
    }
    daemonDraining = true;
    return commandQueue.catch(() => {}).then(async () => {
      await closeBrowser();
      return { status: "ok", code: "DAEMON_DRAINED", drained: true, instanceId: DAEMON_INSTANCE_ID };
    });
  }
  if (cmd && (cmd.action === "ping" || cmd.action === "hello")) return handleCommand(cmd);
  if (daemonDraining) return Promise.resolve({ status: "error", code: "DAEMON_UPGRADE_LOCKED", message: "Daemon is drained for lifecycle activation" });
  const run = commandQueue.catch(() => {}).then(() => handleCommand(cmd));
  commandQueue = run.catch(() => {});
  return run;
}

async function ensureBrowser() {
  if (context) return;
  if (browserInitPromise) return browserInitPromise;
  browserInitPromise = initBrowser();
  try { await browserInitPromise; } finally { browserInitPromise = null; }
}

async function handleCommand(cmd) {
  if (cmd && cmd.action === "ping") return invokeRegisteredAction("ping", async () => ({ status: "ok", pong: true, ...currentHandshakeMetadata() }));
  if (cmd && cmd.action === "hello") {
    const negotiationNonce = typeof cmd.negotiationNonce === "string" && cmd.negotiationNonce.trim() ? cmd.negotiationNonce : null;
    if (negotiationNonce) NEGOTIATION_NONCES.issue(negotiationNonce);
    return invokeRegisteredAction("hello", async () => ({ status: "ok", hello: true, ...(negotiationNonce ? { negotiationNonce } : {}), ...currentHandshakeMetadata() }));
  }
  const liveHandshake = currentHandshakeMetadata();
  const negotiation = validateDaemonCommand(cmd, { handshake: liveHandshake, nonceStore: NEGOTIATION_NONCES });
  if (!negotiation.allowed) return negotiation;
  const { action, productId, fields, changesFile, specDimId, itemTitle, days, allowCurrentPage, expectedProductId } = cmd;
  const fileNames = cmd.fileNames;
  const fileName = cmd.fileName;
  const categoryName = cmd.categoryName;
  const orderedUrls = cmd.orderedUrls;
  const sectionType = cmd.sectionType;
  const uploadFile = cmd.uploadFile;
  const confirmSelection = cmd.confirmSelection;
  const allowDuplicateFileName = cmd.allowDuplicateFileName;
  const skipIfAlreadyPresent = cmd.skipIfAlreadyPresent;
  const skipIfWhiteImageMatched = cmd.skipIfWhiteImageMatched;
  const expectedImages = cmd.expectedImages;
  const expectedVAS = cmd.expectedVAS;
  const vasIds = cmd.ids;
  const vasKeyword = cmd.keyword;
  const submitValidation = validateSubmitCommand(cmd);
  if (submitValidation && submitValidation.status === "error") return submitValidation;

  // Lazy init browser
  await ensureBrowser();
  const login = await ensureLogin();
  if (login && login.status === "error") return login;
  const dispatchBinding = validatePersistedStateBinding(cmd, currentHandshakeMetadata());
  if (!dispatchBinding.allowed) return dispatchBinding;

  switch (action) {
    case "ping":
    case "hello":
      return { status: "error", code: "HANDSHAKE_DISPATCH_ERROR", message: "Handshake actions must bypass queued dispatch" };
    case "login":   return await invokeRegisteredAction("login", () => actionLogin());
    case "navigate":return await invokeRegisteredAction("navigate", () => actionNavigate(productId));
    case "read":    return await invokeRegisteredAction("read", () => actionRead(productId, fields));
    case "apply":   return await invokeRegisteredAction("apply", () => actionApply(productId, changesFile));
    case "apply-current":
      // Apply changes on current page without navigation
      if (!allowCurrentPage || !expectedProductId) return { status: "error", message: "apply-current requires allowCurrentPage=true and expectedProductId" };
      return await invokeRegisteredAction("apply-current", () => actionApplyOnPage(changesFile, expectedProductId));
    case "submit":  return await invokeRegisteredAction("submit", () => actionSubmit(submitValidation.expectedProductId));
    case "spec-discover":
    case "spec-add-item":
    case "spec-add-dim":
      if (productId) {
        const navigation = await actionNavigate(productId);
        if (navigation.status !== "ok") return navigation;
      } else if (!allowCurrentPage || !expectedProductId) {
        return { status: "error", message: "productId is required unless allowCurrentPage=true and expectedProductId is provided" };
      }
      {
        const currentCheck = assertCurrentProduct(expectedProductId || productId);
        if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      }
      if (action === "spec-discover") return await invokeRegisteredAction(action, () => actionSpecDiscover());
      if (action === "spec-add-item") return await invokeRegisteredAction(action, () => actionSpecAddItem(specDimId, itemTitle));
      if (action === "spec-add-dim") return await invokeRegisteredAction(action, () => actionSpecAddDim(itemTitle));
      break;
    case "spec-remove-item":
    case "spec-remove-dim": {
      if (productId) {
        const navigation = await actionNavigate(productId);
        if (navigation.status !== "ok") return navigation;
      }
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      if (action === "spec-remove-item") return await invokeRegisteredAction(action, () => actionSpecRemoveItem(specDimId));
      if (action === "spec-remove-dim") return await invokeRegisteredAction(action, () => actionSpecRemoveDim(specDimId));
      break;
    }
    case "spec-add-and-refresh": {
      if (productId) {
        const navigation = await actionNavigate(productId);
        if (navigation.status !== "ok") return { ...navigation, step: "spec-precheck" };
      }
      else if (!allowCurrentPage) return { status: "error", step: "spec-precheck", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", step: "spec-precheck", message: "Current page product mismatch", ...currentCheck };
      const targetTitle = normalizeSpecTitle(itemTitle);
      if (!specDimId || !targetTitle) return { status: "error", step: "spec-precheck", message: "specDimId and itemTitle are required", specDimId, itemTitle };
      const beforeDims = await actionSpecDiscover();
      const beforeTargetDim = findSpecDim(beforeDims.dimensions, specDimId);
      if (!beforeTargetDim) return { status: "error", step: "spec-precheck", message: "Target spec dimension not found before add", specDimId, itemTitle: targetTitle };
      const beforeHadItem = specDimHasItem(beforeTargetDim, targetTitle);
      const beforeSpecs = await discoverSpecs();

      const ar = await invokeRegisteredAction(action, () => actionSpecAddItem(specDimId, targetTitle));
      if (!ar || ar.status !== "ok") return { ...(ar || {}), status: "error", step: "spec-add-item" };
      const afterAddDims = await actionSpecDiscover();
      const afterAddTargetDim = findSpecDim(afterAddDims.dimensions, specDimId);
      if (!afterAddTargetDim || !specDimHasItem(afterAddTargetDim, targetTitle)) {
        return { status: "error", step: "spec-postcheck", message: "Added spec item not found before refresh", specDimId, itemTitle: targetTitle, beforeHadItem };
      }

      const rr = await actionSpecRefresh();
      if (!rr || rr.status !== "ok") return { ...(rr || {}), status: "error", step: "spec-refresh" };
      const afterDims = await actionSpecDiscover();
      const targetDim = findSpecDim(afterDims.dimensions, specDimId);
      const hasItem = specDimHasItem(targetDim, targetTitle);
      if (!hasItem) {
        return { status: "error", step: "spec-postcheck", message: "Added spec item not found after refresh", specDimId, itemTitle: targetTitle };
      }
      const specs = await discoverSpecs();
      if (specs.length === 0) return { status: "error", step: "spec-postcheck", message: "no specs found after spec refresh", specDimId, itemTitle: targetTitle, refresh: rr };
      if (!beforeHadItem && beforeSpecs.length > 0 && specs.length < beforeSpecs.length) {
        return { status: "error", step: "spec-postcheck", message: "spec rows decreased after adding item", specDimId, itemTitle: targetTitle, beforeRows: beforeSpecs.length, afterRows: specs.length };
      }
      const specTitleMatched = specs.some(s => normalizeSpecTitle(s.title).includes(targetTitle));
      if (!specTitleMatched) {
        return { status: "error", step: "spec-postcheck", message: "refreshed spec table does not include added item", specDimId, itemTitle: targetTitle, beforeRows: beforeSpecs.length, afterRows: specs.length };
      }

      const staticFlds = getProductFields();
      const vals = {};
      for (const spec of specs) {
        vals[spec.specId] = {};
        const rentFields = await discoverRentFieldsForSpec(page, spec.specId);
        const allFlds = [...staticFlds, ...Object.keys(rentFields)];
        for (const f of allFlds) {
          const selector = resolveFieldSelector(f, spec.specId);
          if (!selector) continue;
          try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
        }
      }
      return { ...ar, itemTitle: targetTitle, refresh: rr, postcheck: { status: "ok", beforeRows: beforeSpecs.length, afterRows: specs.length, beforeHadItem }, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals };
    }
    case "spec-refresh": {
      if (productId) {
        const navigation = await actionNavigate(productId);
        if (navigation.status !== "ok") return navigation;
      }
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      return await invokeRegisteredAction("spec-refresh", () => actionSpecRefresh());
    }
    case "tenancy-set": {
      if (productId) {
        const navigation = await actionNavigate(productId);
        if (navigation.status !== "ok") return navigation;
      }
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      return await invokeRegisteredAction("tenancy-set", () => actionTenancySet(days));
    }
    case "delist":
      return await invokeRegisteredAction("delist", () => actionDelist(productId));
    case "copy":
      return await invokeRegisteredAction("copy", () => actionCopyProduct(productId));
    case "platform-search":
      return await invokeRegisteredAction("platform-search", () => actionPlatformSearch(cmd.keyword || productId));
    case "batch-read":
      return await invokeRegisteredAction("batch-read", () => actionBatchRead(cmd.productIds, cmd.fields));
    case "image-read":
      return await invokeRegisteredAction("image-read", () => actionImageRead(productId, allowCurrentPage, expectedProductId));
    case "image-pick":
      return await invokeRegisteredAction("image-pick", () => actionImagePick(productId, categoryName, fileNames, allowCurrentPage, expectedProductId, { skipIfAlreadyPresent }));
    case "image-order":
      return await invokeRegisteredAction("image-order", () => actionImageOrder(productId, orderedUrls, allowCurrentPage, expectedProductId));
    case "white-image-set":
      return await invokeRegisteredAction("white-image-set", () => actionWhiteImageSet(productId, categoryName, fileName, allowCurrentPage, expectedProductId, { skipIfWhiteImageMatched }));
    case "image-upload":
      return await invokeRegisteredAction("image-upload", () => actionImageUpload(productId, sectionType || "thumbs", categoryName, uploadFile, allowCurrentPage, expectedProductId, { confirmSelection, allowDuplicateFileName }));
    case "image-verify":
      return await invokeRegisteredAction("image-verify", () => actionImageVerify(productId, expectedImages || {}, allowCurrentPage, expectedProductId));
    case "vas-read":
      return await invokeRegisteredAction("vas-read", () => actionVASRead(productId, allowCurrentPage, expectedProductId));
    case "vas-catalog-read":
      return await invokeRegisteredAction("vas-catalog-read", () => actionVASCatalogRead(productId, vasKeyword, vasIds, allowCurrentPage, expectedProductId));
    case "vas-apply":
      return await invokeRegisteredAction("vas-apply", () => actionVASApply(productId, expectedVAS, allowCurrentPage, expectedProductId));
    case "vas-verify":
      return await invokeRegisteredAction("vas-verify", () => actionVASVerify(productId, expectedVAS || {}, allowCurrentPage, expectedProductId));
    case "discard-current-form":
      return await invokeRegisteredAction("discard-current-form", () => actionDiscardCurrentForm(expectedProductId));
    default: return { status: "error", message: "Unknown action: " + action };
  }
}

function sendCommand(port, cmd) {
  if (typeof cmd === "string") {
    try { cmd = JSON.parse(cmd); } catch { return Promise.resolve({ status: "error", code: "COMMAND_JSON_INVALID", message: "Command must be valid JSON" }); }
  }
  const token = readDaemonToken();
  return sendNegotiatedCommand({ port, token, command: cmd });
}

async function stopDaemon() {
  const existing = await validateDaemonIdentity({ layout: LAYOUT, targetDir: LAYOUT.targetDir });
  const restart = await enforceRestartForCommand({
    layout: LAYOUT,
    command: { action: "login" },
    loadedIdentity: LOADED_RELEASE_IDENTITY,
    allowedDoctorBlockers: existing.valid || existing.code === "DAEMON_IDENTITY_ABSENT" ? [] : [existing.code],
    validateDoctor: () => require("./lifecycle").runDoctor({ targetDir: LAYOUT.targetDir }),
    validateDaemon: async () => existing.valid
      ? { compatible: existing.identity.releaseTreeSha256 === LOADED_RELEASE_IDENTITY.releaseTreeSha256 }
      : { noDaemon: existing.code === "DAEMON_IDENTITY_ABSENT" || existing.code === "DAEMON_PROCESS_ABSENT" },
  });
  if (!restart.allowed) { output(restart); return restart; }
  const result = await stopValidatedDaemon({ layout: LAYOUT, targetDir: LAYOUT.targetDir, wait: () => new Promise(resolve => setTimeout(resolve, 500)) });
  output({ status: result.stopped ? "ok" : "error", ...result });
  return result;
}

// ================================================================
// Legacy single-invocation mode
// ================================================================

async function legacyMode(action, args) {
  const classification = classifyAction(action);
  if (!classification.allowed || !classification.surfaces.includes("legacy")) {
    output({ status: "error", code: "ACTION_NOT_CLASSIFIED", message: "Unknown legacy action: " + action });
    return;
  }
  const restart = await enforceRestartForCommand({
    layout: LAYOUT,
    command: { action },
    loadedIdentity: LOADED_RELEASE_IDENTITY,
    validateDoctor: () => require("./lifecycle").runDoctor({ targetDir: LAYOUT.targetDir }),
    validateDaemon: async () => ({ noDaemon: !readDaemonIdentity(LAYOUT).present }),
  });
  if (!restart.allowed) { output(restart); return; }
  await initBrowser();
  try {
    const result = await handleLegacyAction(action, args);
    output(result);
  } finally {
    await closeBrowser();
  }
}

async function handleLegacyAction(action, args) {
  if (action === "submit" && !args[0]) return { status: "error", message: "Usage: submit <productId>" };
  const login = await actionLogin();
  if (login && login.status === "error") return login;

  switch (action) {
    case "login":  return await invokeRegisteredAction("login", () => login);
    case "navigate": return await invokeRegisteredAction("navigate", () => actionNavigate(args[0]));
    case "read":   return await invokeRegisteredAction("read", () => actionRead(args[0], args.slice(1)));
    case "apply": {
      const result = await invokeRegisteredAction("apply", () => actionApply(args[0], args[1]));
      const submitDecision = buildLegacyApplySubmitDecision(result, args.includes("--submit"));
      if (submitDecision.shouldSubmit) {
        const sr = await invokeRegisteredAction("submit", () => actionSubmit(args[0]));
        return mergeLegacyApplySubmitOutcome(result, sr);
      } else if (submitDecision.submitResult) {
        result.submit = submitDecision.submitResult;
      }
      return result;
    }
    case "submit": return await invokeRegisteredAction("submit", () => actionSubmit(args[0]));
    case "verify": {
      // Read current values and compare with expected changes file
      const productId = args[0];
      const changesFile = args[1];
      if (!changesFile) return { status: "error", message: "Usage: verify <productId> <changes.json>" };
      const current = await actionRead(productId);
      if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
      const expected = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
      delete expected.__broadcast;
      return { productId, ...compareLegacyVerification(current, expected) };
    }
    case "screenshot": {
      await page.screenshot({ path: OUTPUT_DIR + "/" + (args[0] || "cap") + ".png" });
      return { status: "ok" };
    }
    case "delist": return await invokeRegisteredAction("delist", () => actionDelist(args[0]));
    case "copy":   return await invokeRegisteredAction("copy", () => actionCopyProduct(args[0]));
    case "platform-search": return await invokeRegisteredAction("platform-search", () => actionPlatformSearch(args[0]));
    case "batch-read": {
      const ids = args[0] ? args[0].split(",") : [];
      return await invokeRegisteredAction("batch-read", () => actionBatchRead(ids));
    }
    case "image-read": {
      return await invokeRegisteredAction("image-read", () => actionImageRead(args[0]));
    }
    case "image-upload": {
      return await invokeRegisteredAction("image-upload", () => actionImageUpload(args[0], args[1] || "thumbs", args[2] || "", args[3], false, args[0], { confirmSelection: args[4] !== "false" }));
    }
    case "image-verify": {
      const expectedFile = args[1];
      if (!expectedFile || !fs.existsSync(expectedFile)) return { status: "error", message: "Usage: image-verify <productId> <expected-images.json>" };
      const expected = JSON.parse(fs.readFileSync(expectedFile, "utf-8"));
      return await invokeRegisteredAction("image-verify", () => actionImageVerify(args[0], expected, false, args[0]));
    }
    default: return { status: "error", message: "Unknown action: " + action };
  }
}

// ================================================================
// Main
// ================================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) die("Usage: daemon start|stop|send|legacy ...");

  if (args[0] === "daemon") {
    const sub = args[1];
    if (sub === "start") {
      const port = Number(args.find(a => a.startsWith("--port="))?.split("=")[1] || "9223");
      await startDaemon(port);
      return; // keep running
    }
    if (sub === "stop") {
      await stopDaemon();
      return;
    }
    if (sub === "send") {
      const portFile = PORT_FILE;
      if (!fs.existsSync(portFile)) die("Daemon not running. Start it first: daemon start");
      const port = Number(fs.readFileSync(portFile, "utf-8").trim());
      let cmd;
      // --file mode: read JSON from file, bypasses PowerShell quoting issues
      if (args[2] === "--file" && args[3]) {
        cmd = JSON.parse(fs.readFileSync(args[3], "utf-8"));
      } else if (args[2]) {
        cmd = typeof args[2] === "string" ? JSON.parse(args[2]) : args[2];
      } else {
        // Read from stdin (strip BOM if present)
        let stdin = "";
        process.stdin.setEncoding("utf-8");
        for await (const chunk of process.stdin) stdin += chunk;
        if (stdin.charCodeAt(0) === 0xFEFF) stdin = stdin.slice(1);
        cmd = JSON.parse(stdin);
      }
      const result = await sendCommand(port, cmd);
      output(result);
      return;
    }
    die("Unknown daemon sub-command: " + sub);
  }

  // Legacy mode
  await legacyMode(args[0], args.slice(1));
}

if (require.main === module) {
  main().catch(err => { die(err.message); });
} else {
  module.exports = {
    normalizeStatusText,
    isSubmitSuccessText,
    redactPreview,
    matchesSubmitResponseEvidence,
    classifySubmitResponseEvidence,
    createSubmitResponseObserver,
    excludeBaselineToastCandidates,
    validateSubmitCommand,
    buildLegacyApplySubmitDecision,
    mergeLegacyApplySubmitOutcome,
    compareLegacyVerification,
	    checkExpectedProductUrl,
	    validateProductPageAfterNavigation,
	    checkSaasOrigin,
	    validateCopyDestination,
    classifySubmitClickError,
    resolveImmediateSubmitOutcome,
    dispatchSubmitClick,
    normalizeMaterialUrl,
	    compareImageState,
	    compareVASState,
	    actionVASApply,
	    actionNavigate,
	    actionLogin,
	    actionBatchRead,
	    findProductOnList,
	    handleLegacyAction,
	    classifyPlatformSearchExclusion,
    filterPlatformProducts,
    readProductOnTab,
    isDynamicRentField,
    resolveFieldSelector,
    resolveDynamicRentSelector,
	    getDynamicRentConfig,
	    handleCommand,
	    currentHandshakeMetadata,
	    resolveRuntimeBrowserPolicy,
	    __setReadinessEvaluatorForTest(nextEvaluator) { readinessEvaluator = nextEvaluator; },
	    __resetReadinessEvaluatorForTest() { readinessEvaluator = evaluateLiveStateReadiness; },
	    __issueNegotiationNonceForTest(nonce) { NEGOTIATION_NONCES.issue(nonce); },
	    __setConfigForTest(nextConfig) { config = nextConfig; },
	    __setPageForTest(nextPage) { page = nextPage; },
	    __setContextForTest(nextContext) { context = nextContext; },
	  };
}
