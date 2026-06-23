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

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");

const { loadConfig, SKILL_DIR } = require("./lib/config-loader");
const USER_DATA_DIR = SKILL_DIR + "/.browser-data";
const OUTPUT_DIR = SKILL_DIR + "/tasks";
const PID_FILE = SKILL_DIR + "/.daemon.pid";
const PORT_FILE = SKILL_DIR + "/.daemon.port";
const TOKEN_FILE = SKILL_DIR + "/.daemon.token";

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
  const skipKeys = ["_note", "saveButton", "saveSuccessToast", "specTable", "goodsName"];
  return Object.keys(sel).filter(k => typeof sel[k] === "string" && sel[k] !== null && !skipKeys.includes(k));
}

function getCurrentProductIdFromUrl() {
  const match = page.url().match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

function assertCurrentProduct(expectedProductId) {
  if (!expectedProductId) return { ok: true, currentProductId: getCurrentProductIdFromUrl(), url: page.url() };
  const currentProductId = getCurrentProductIdFromUrl();
  const ok = String(currentProductId || "") === String(expectedProductId);
  return { ok, currentProductId, expectedProductId: String(expectedProductId), url: page.url() };
}

// ================================================================
// Action imports (shared between daemon and legacy mode)
// ================================================================

let config;
let context, page;

async function initBrowser() {
  ensureDir(USER_DATA_DIR);
  // Remove stale locks
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonLock"); } catch {}
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonSocket"); } catch {}
  try { fs.unlinkSync(USER_DATA_DIR + "/SingletonCookie"); } catch {}

  config = loadConfig();
  const browserConfig = config.browser || {};
  const launchOptions = {
    headless: browserConfig.headless !== false,
    viewport: browserConfig.viewport || { width: 1440, height: 900 },
    slowMo: browserConfig.slowMo || 100,
  };
  if (browserConfig.channel) launchOptions.channel = browserConfig.channel;
  if (browserConfig.executablePath) launchOptions.executablePath = browserConfig.executablePath;
  context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
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
  if (url.includes("login") || url.includes("c=user")) {
    return await actionLogin();
  }
  return { status: "ok", alreadyLoggedIn: true };
}

// --- Navigate ---
async function actionNavigate(productId) {
  const url = config.saas.productDetailUrl.replace("{productId}", productId);
  await page.goto(url, { waitUntil: "networkidle" });
  return { status: "ok", url };
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
  await actionNavigate(productId);
  await ensureLogin();
  // Re-navigate: login may have redirected away from product page
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    await actionNavigate(productId);
  }
  await page.waitForTimeout(1500);

  const sel = config.selectors.product;
  const specs = await discoverSpecs();
  if (specs.length === 0) {
    return { status: "error", productId, message: "no specs found; product may not exist or page structure changed", url: page.url() };
  }
  const explicitFields = Array.isArray(fields) && fields.length > 0;
  const selectableFields = explicitFields ? fields : getProductFields();

  const result = { status: "ok", productId, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: {}, warnings: [], missingFields: [] };
  let requestedCount = 0;
  let readCount = 0;
  for (const spec of specs) {
    const specValues = {};
    for (const field of selectableFields) {
      requestedCount++;
      const selector = resolveSelector(sel[field], spec.specId);
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
        const selector = resolveSelector(sel[field], specId);
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
    for (const spec of specs) {
      result.applied[spec.specId] = {};
      for (const [field, newValue] of Object.entries(raw)) {
        result.requestedCount++;
        const selector = resolveSelector(sel[field], spec.specId);
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
  await actionNavigate(productId);
  await ensureLogin();
  if (page.url().includes("c=site") && !page.url().includes("goods.edit")) {
    await actionNavigate(productId);
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
async function actionSubmit() {
  const sel = config.selectors.product;
  const saveBtn = await page.$(sel.saveButton);
  if (!saveBtn) {
    const alt = await page.$("input[type=submit],button:has-text('保存')");
    if (alt) await alt.click();
    else return { status: "error", message: "Save button not found" };
  } else {
    await saveBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await saveBtn.click();
  }

  let success = false;
  let detail = "";

  // Check 1: URL redirect away from edit page
  try {
    await page.waitForURL(u => !u.includes("goods.edit"), { timeout: 15000 });
    success = true;
    detail = "redirected";
  } catch {
    // Check 2: Success toast on same page (try multiple selectors)
    const toastSels = [
      ".layui-layer-dialog", ".layui-layer-msg", ".layui-layer",
      ".alert-success", ".alert-info", ".toast", ".success", ".success_tip",
      ".message", ".notification", "#msg", ".layui-m-layer",
    ];
    // Parallel detection — race all selectors, first match wins
    const toastResult = await Promise.race(
      toastSels.map(sel => page.waitForSelector(sel, { timeout: 3000 }).then(el => ({ sel, el })).catch(() => null))
    );
    if (toastResult) {
      const text = await toastResult.el.textContent().catch(() => "");
      if (text) {
        success = true;
        detail = "toast(" + toastResult.sel + "): " + text.trim().substring(0, 40);
      }
    }
    // Check 3: URL changed even without full redirect
    if (!success) {
      const currentUrl = page.url();
      if (!currentUrl.includes("goods.edit")) {
        success = true;
        detail = "url_changed: " + currentUrl.substring(0, 60);
      }
    }
    // Check 4: Page is still on edit but content indicates save (e.g., form values retained)
    if (!success) await page.waitForTimeout(2000);
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  return { status: success ? "ok" : "unknown", submitted: success, detail, verified: success ? null : "check_with_readback" };
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
  const sel = config.selectors.product;
  const flds = getProductFields();
  const vals = {};
  for (const spec of specs) {
    vals[spec.specId] = {};
    for (const f of flds) {
      const selector = resolveSelector(sel[f], spec.specId);
      if (!selector) continue;
      try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
    }
  }
  return { status: "ok", days, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals };
}

// --- Shared: find product on list page via search + large page size ---
async function findProductOnList(productId) {
  // Navigate to list with 100 per page
  await page.goto(config.saas.productListUrl + "&pagesize=100", { waitUntil: "networkidle" });
  await ensureLogin();
  await page.waitForTimeout(1500);

  // Search by product ID
  const kwInput = await page.$("input[name='keyword']");
  if (kwInput) {
    await kwInput.fill(String(productId));
    await kwInput.press("Enter");
    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  // Find the product row
  const editLink = await page.$(`a[href*="goods.edit&id=${productId}"]`);
  if (editLink) {
    const row = await editLink.evaluateHandle(el => el.closest("tr"));
    const copyBtn = await page.$(`a[data-toggle="ajaxModal"][href*="copyGoods"][href*="id=${productId}"]`);
    return { found: true, row, copyBtn };
  }

  // Fallback: scan pages (with 100 per page, fewer pages needed)
  for (let pg = 2; pg <= 5; pg++) {
    await page.goto(config.saas.productListUrl + "&pagesize=100&page=" + pg, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const link = await page.$(`a[href*="goods.edit&id=${productId}"]`);
    if (link) {
      const row = await link.evaluateHandle(el => el.closest("tr"));
      const copyBtn = await page.$(`a[data-toggle="ajaxModal"][href*="copyGoods"][href*="id=${productId}"]`);
      return { found: true, row, copyBtn };
    }
  }

  return { found: false };
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
  const { found, row } = await findProductOnList(productId);
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
    return { status: "error", action: "delist", productId, confirmed: false, confirmText: confirm.text, message: "Delist confirmation dialog was not confirmed" };
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
  if (stillVisible) return { status: "error", action: "delist", productId, confirmed: confirm.confirmed, confirmText: confirm.text, message: "Product still visible after delist" };

  return { status: "ok", action: "delist", productId, confirmed: confirm.confirmed, confirmText: confirm.text };
}

// --- Copy product ---
async function actionCopyProduct(productId) {
  const { found, copyBtn } = await findProductOnList(productId);
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
    // Same-tab navigation: we're on the copy/edit page with original product data
    const saveBtn = await page.$(config.selectors.product.saveButton).catch(() => null)
      || await page.$("input[type=submit],button:has-text('保存')").catch(() => null);
    if (!saveBtn) return { status: "error", message: "Save button not found on copy page" };
    await saveBtn.click();
    const saved = await waitForNewProductIdAfterSave(productId, page);
    // Restore page state: navigate back to list page so daemon is in a known state
    await page.goto(config.saas.productListUrl, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    if (!saved.newProductId) return unknownCopyResult(productId, confirm.text, { currentUrl: saved.url });
    return { status: copyResultStatus(saved.newProductId), action: "copy", originalProductId: productId, newProductId: saved.newProductId, confirmText: confirm.text, currentUrl: saved.url, sideEffectPossible: false };
  }

  // Check for new page/tab
  const pages = context.pages();
  const newPage = pages.find(p => p !== page && p.url().includes("goods.edit"));
  if (newPage) {
    await newPage.waitForLoadState("networkidle").catch(() => {});
    await newPage.waitForTimeout(1000);
    const saveBtn = await newPage.$(config.selectors.product.saveButton).catch(() => null)
      || await newPage.$("input[type=submit],button:has-text('保存')").catch(() => null);
    if (saveBtn) { await saveBtn.click(); }
    const saved = await waitForNewProductIdAfterSave(productId, newPage);
    await newPage.close().catch(() => {});
    if (!saved.newProductId) return unknownCopyResult(productId, confirm.text, { newUrl: saved.url });
    return { status: copyResultStatus(saved.newProductId), action: "copy", originalProductId: productId, newProductId: saved.newProductId, confirmText: confirm.text, newUrl: saved.url, sideEffectPossible: false };
  }

  // Cleanup: close any stray pages
  for (const p of context.pages()) {
    if (p !== page) await p.close().catch(() => {});
  }
  return unknownCopyResult(productId, confirm.text, { currentUrl, message: "Copy confirmation was clicked but no copy page was detected; do not retry automatically" });
}

function buildListUrl(params = {}) {
  const sep = config.saas.productListUrl.includes("?") ? "&" : "?";
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
  return config.saas.productListUrl + (qs ? sep + qs : "");
}

async function submitListSearch(keyword) {
  // Prefer GET URL search because the platform's form submit may drop pagesize=100.
  await page.goto(buildListUrl({ pagesize: 100, keyword: keyword || "" }), { waitUntil: "networkidle" });
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
    if (r.excluded) excluded.push({ id: row.id, name: row.name, reason: r.reason, message: r.message, text: row.text });
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
  await page.goto(buildListUrl({ pagesize: 100 }), { waitUntil: "networkidle" });
  await ensureLogin();
  await page.waitForTimeout(1000);

  const sr = await submitListSearch(keyword || "");
  if (!sr.ok) return { status: "error", message: sr.message, url: sr.url };

  const rows = await scrapeProductRows();
  const filtered = filterPlatformProducts(rows);
  return {
    status: "ok",
    keyword,
    count: filtered.products.length,
    products: filtered.products,
    excluded: filtered.excluded,
    excludedCount: filtered.excluded.length,
    filterRules: ["exclude MQ-maintained products", "exclude link-price products with row price 0.01/0.1"],
  };
}

async function readProductOnTab(tab, productId, fields, explicitFields = false) {
  await tab.goto(config.saas.productDetailUrl.replace("{productId}", productId), { waitUntil: "networkidle" });
  await tab.waitForTimeout(1000);
  const url = tab.url();
  if (url.includes("login") || url.includes("c=user")) throw new Error("redirected to login");

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
  const sel = config.selectors.product;
  for (const spec of specs) {
    vals[spec.specId] = {};
    for (const f of fields) {
      const selector = resolveSelector(sel[f], spec.specId);
      if (!selector) {
        const item = { specId: spec.specId, field: f, message: "Selector not configured" };
        missingFields.push(item);
        if (explicitFields) warnings.push({ level: "error", ...item });
        continue;
      }
      try {
        const el = await tab.$(selector);
        vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : "";
      } catch (err) {
        warnings.push({ level: "warn", specId: spec.specId, field: f, message: err.message });
        vals[spec.specId][f] = "";
      }
    }
  }
  const status = explicitFields && missingFields.length > 0 ? "partial" : "ok";
  return { status, productId, url, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals, warnings, missingFields };
}

// --- Batch read: parallel multi-tab read (max 3 concurrent) ---
async function actionBatchRead(productIds, fields) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { status: "error", message: "productIds must be a non-empty array" };
  }

  const explicitFields = Array.isArray(fields) && fields.length > 0;
  const flds = explicitFields ? fields : getProductFields();
  const results = {};
  const errors = [];
  const warnings = [];

  for (let i = 0; i < productIds.length; i += 3) {
    const chunk = productIds.slice(i, i + 3).map(String);
    const jobs = chunk.map(async pid => {
      const tab = await context.newPage();
      try {
        results[pid] = await readProductOnTab(tab, pid, flds, explicitFields);
        if (results[pid].warnings && results[pid].warnings.length > 0) warnings.push(...results[pid].warnings.map(w => ({ productId: pid, ...w })));
      } catch (err) {
        errors.push({ productId: pid, error: err.message });
      } finally {
        await tab.close().catch(() => {});
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
  const daemonToken = getOrCreateDaemonToken();

  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.headers["x-rental-agent-token"] !== daemonToken) {
      res.writeHead(403);
      res.end(JSON.stringify({ status: "error", message: "Forbidden" }));
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

  server.listen(port, "127.0.0.1", () => {
    log("Daemon listening on http://127.0.0.1:" + port);
    fs.writeFileSync(PID_FILE, String(process.pid));
    fs.writeFileSync(PORT_FILE, String(port));
  });

  // Init browser (lazy — on first command)
  log("Daemon ready (browser will init on first command)");

  process.on("SIGINT", async () => { await closeBrowser(); server.close(); process.exit(0); });
  process.on("SIGTERM", async () => { await closeBrowser(); server.close(); process.exit(0); });
}

let browserInitPromise = null;
let commandQueue = Promise.resolve();

function enqueueCommand(cmd) {
  if (cmd && cmd.action === "ping") return handleCommand(cmd);
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
  const { action, productId, fields, changesFile, specDimId, itemTitle, days, allowCurrentPage, expectedProductId } = cmd;

  // Lazy init browser
  if (action !== "ping") {
    await ensureBrowser();
    await ensureLogin();
  }

  switch (action) {
    case "ping":    return { status: "ok", pong: true };
    case "login":   return await actionLogin();
    case "navigate":return await actionNavigate(productId);
    case "read":    return await actionRead(productId, fields);
    case "apply":   return await actionApply(productId, changesFile);
    case "apply-current":
      // Apply changes on current page without navigation
      if (!allowCurrentPage || !expectedProductId) return { status: "error", message: "apply-current requires allowCurrentPage=true and expectedProductId" };
      return await actionApplyOnPage(changesFile, expectedProductId);
    case "submit":  return await actionSubmit();
    case "spec-discover":
    case "spec-add-item":
    case "spec-add-dim":
      if (productId) await actionNavigate(productId);
      if (action === "spec-discover") return await actionSpecDiscover();
      if (action === "spec-add-item") return await actionSpecAddItem(specDimId, itemTitle);
      if (action === "spec-add-dim") return await actionSpecAddDim(itemTitle);
      break;
    case "spec-remove-item":
    case "spec-remove-dim": {
      if (productId) await actionNavigate(productId);
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      if (action === "spec-remove-item") return await actionSpecRemoveItem(specDimId);
      if (action === "spec-remove-dim") return await actionSpecRemoveDim(specDimId);
      break;
    }
    case "spec-add-and-refresh": {
      if (productId) await actionNavigate(productId);
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

      const ar = await actionSpecAddItem(specDimId, targetTitle);
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

      const sel = config.selectors.product;
      const flds = getProductFields();
      const vals = {};
      for (const spec of specs) {
        vals[spec.specId] = {};
        for (const f of flds) {
          const selector = resolveSelector(sel[f], spec.specId);
          if (!selector) continue;
          try { const el = await page.$(selector); vals[spec.specId][f] = el ? ((await el.inputValue()) || "").trim() : ""; } catch {}
        }
      }
      return { ...ar, itemTitle: targetTitle, refresh: rr, postcheck: { status: "ok", beforeRows: beforeSpecs.length, afterRows: specs.length, beforeHadItem }, specs: specs.map(s => ({ specId: s.specId, title: s.title })), values: vals };
    }
    case "spec-refresh": {
      if (productId) await actionNavigate(productId);
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      return await actionSpecRefresh();
    }
    case "tenancy-set": {
      if (productId) await actionNavigate(productId);
      else if (!allowCurrentPage) return { status: "error", message: "productId is required unless allowCurrentPage is true", expectedProductId };
      const currentCheck = assertCurrentProduct(expectedProductId || productId);
      if (!currentCheck.ok) return { status: "error", message: "Current page product mismatch", ...currentCheck };
      return await actionTenancySet(days);
    }
    case "delist":
      return await actionDelist(productId);
    case "copy":
      return await actionCopyProduct(productId);
    case "platform-search":
      return await actionPlatformSearch(cmd.keyword || productId);
    case "batch-read":
      return await actionBatchRead(cmd.productIds, cmd.fields);
    default: return { status: "error", message: "Unknown action: " + action };
  }
}

function sendCommand(port, cmd) {
  return new Promise((resolve, reject) => {
    const data = typeof cmd === "string" ? cmd : JSON.stringify(cmd);
    const token = readDaemonToken();
    const req = http.request({
      hostname: "127.0.0.1", port, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "X-Rental-Agent-Token": token },
    }, (res) => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function stopDaemon(port) {
  return sendCommand(port, { action: "ping" }).catch(() => {}).then(async () => {
  // Also SIGTERM fallback via taskkill on Windows
  const pid = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
  try { process.kill(pid, "SIGTERM"); } catch {}
  await new Promise(r => setTimeout(r, 500));
  try { process.kill(pid, 0); require("child_process").execSync("taskkill /F /PID " + pid, { stdio: "ignore" }); } catch {}
  try { fs.unlinkSync(PID_FILE); fs.unlinkSync(PORT_FILE); fs.unlinkSync(TOKEN_FILE); } catch {}
  output({ status: "ok", stopped: true });
  });
}

// ================================================================
// Legacy single-invocation mode
// ================================================================

async function legacyMode(action, args) {
  await initBrowser();
  try {
    const result = await handleLegacyAction(action, args);
    output(result);
  } finally {
    await closeBrowser();
  }
}

async function handleLegacyAction(action, args) {
  await actionLogin();

  switch (action) {
    case "login":  return { status: "ok", loggedIn: true };
    case "navigate": return await actionNavigate(args[0]);
    case "read":   return await actionRead(args[0], args.slice(1));
    case "apply": {
      const result = await actionApply(args[0], args[1]);
      if (args.includes("--submit")) {
        if (result.status === "ok") {
          const sr = await actionSubmit();
          result.submit = sr;
        } else {
          result.submit = { status: "skipped", reason: "apply_not_ok" };
        }
      }
      return result;
    }
    case "submit": return await actionSubmit();
    case "verify": {
      // Read current values and compare with expected changes file
      const productId = args[0];
      const changesFile = args[1];
      if (!changesFile) return { status: "error", message: "Usage: verify <productId> <changes.json>" };
      const current = await actionRead(productId);
      if (!fs.existsSync(changesFile)) return { status: "error", message: "Changes file not found: " + changesFile };
      const expected = JSON.parse(fs.readFileSync(changesFile, "utf-8"));
      delete expected.__broadcast;
      const result = { status: "ok", productId, matches: {}, mismatches: [] };
      for (const [specId, specValues] of Object.entries(current.values)) {
        result.matches[specId] = {};
        for (const [field, expectedVal] of Object.entries(expected)) {
          const actual = specValues[field];
          const match = actual !== undefined && actual === String(expectedVal);
          result.matches[specId][field] = match;
          if (!match) result.mismatches.push({ specId, field, expected: String(expectedVal), actual: actual || "(missing)" });
        }
      }
      if (result.mismatches.length > 0) result.status = "mismatch";
      return result;
    }
    case "screenshot": {
      await page.screenshot({ path: OUTPUT_DIR + "/" + (args[0] || "cap") + ".png" });
      return { status: "ok" };
    }
    case "delist": return await actionDelist(args[0]);
    case "copy":   return await actionCopyProduct(args[0]);
    case "platform-search": return await actionPlatformSearch(args[0]);
    case "batch-read": {
      const ids = args[0] ? args[0].split(",") : [];
      return await actionBatchRead(ids);
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
      const portFile = SKILL_DIR + "/.daemon.port";
      if (!fs.existsSync(portFile)) die("Daemon not running (no port file)");
      const port = Number(fs.readFileSync(portFile, "utf-8").trim());
      await stopDaemon(port);
      return;
    }
    if (sub === "send") {
      const portFile = SKILL_DIR + "/.daemon.port";
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

main().catch(err => { die(err.message); });
