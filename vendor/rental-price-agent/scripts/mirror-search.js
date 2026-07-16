#!/usr/bin/env node

/**
 * Mirror API client — search products and generate batch specs.
 *
 * Usage:
 *   node mirror-search.js search <keyword>             — search and show candidates
 *   node mirror-search.js batch-spec <keyword>         — search + generate batch spec template
 *   node mirror-search.js writeback-state <state.json> — write delayed-verified changes back
 *
 * Reads API key from config.json (mirror.apiKey), MIRROR_API_KEY, or legacy GOODS_MANAGER_SKILL_API_KEY.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const { loadConfig, SKILL_DIR } = require("./lib/config-loader");

function getApiKey() {
  const cfg = loadConfig();
  return (cfg.mirror && cfg.mirror.apiKey) ? cfg.mirror.apiKey
    : process.env.MIRROR_API_KEY || process.env.GOODS_MANAGER_SKILL_API_KEY || die("No API key. Set mirror.apiKey in config.json or env var MIRROR_API_KEY.");
}

function getBaseUrl() {
  const cfg = loadConfig();
  return (cfg.mirror && cfg.mirror.baseUrl) || die("No mirror baseUrl in config.json");
}

function die(msg) { process.stderr.write("[mirror] ERROR: " + msg + "\n"); process.exit(1); }
function log(msg) { process.stderr.write("[mirror] " + msg + "\n"); }
function output(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const url = new URL(endpoint, baseUrl);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { "X-API-Key": apiKey },
    };
    if (body) { opts.headers["Content-Type"] = "application/json"; }
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function searchProducts(keyword) {
  log("Searching: " + keyword);
  const resp = await request("GET", "/skill/products/search?q=" + encodeURIComponent(keyword) + "&limit=50");
  log("Found " + resp.total + " results");
  return resp.data || [];
}

async function batchDetail(ids) {
  log("Fetching details for " + ids.length + " products...");
  const resp = await request("POST", "/skill/products/batch", { ids, include_skus: true });
  log("Got " + resp.data.length + " details, " + (resp.missing_ids || []).length + " missing");
  return resp;
}

function skuToFieldName(skuKey) {
  // Map mirror SKU field names to our internal field names
  const map = {
    "1天租金": "rent1day", "2天租金": "rent2day", "3天租金": "rent3day",
    "4天租金": "rent4day", "5天租金": "rent5day", "7天租金": "rent7day",
    "10天租金": "rent10day", "15天租金": "rent15day", "30天租金": "rent30day",
    "60天租金": "rent60day", "90天租金": "rent90day", "180天租金": "rent180day",
    "库存": "stock", "市场价": "marketPrice", "押金": "deposit",
    "购买价": "purchasePrice", "采购价": "costPrice", "购买尾款": "finalPayment",
  };
  if (map[skuKey]) return map[skuKey];
  // Dynamic fallback: "N天租金" → rent{N}day (covers any custom rent period)
  const match = skuKey.match(/^(\d+)天租金$/);
  if (match) return "rent" + match[1] + "day";
  return null;
}

function formatPrice(val) {
  if (!val || val === "") return "0.00";
  return String(val);
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

function isLinkPrice(val) {
  return extractNumericPrices(val).some(n => Math.abs(n - 0.01) < 0.000001 || Math.abs(n - 0.1) < 0.000001);
}

function isMqMaintainedProduct(product) {
  return /^MQ/i.test(normalizeText(product && product.name));
}

function hasLinkPriceSku(product) {
  for (const sku of product.skus || []) {
    for (const [key, val] of Object.entries(sku || {})) {
      const k = normalizeText(key);
      if ((k.includes("租金") || k === "价格" || k === "售价") && isLinkPrice(val)) return true;
    }
  }
  return false;
}

function classifyProductExclusion(product) {
  if (isMqMaintainedProduct(product)) return { excluded: true, reason: "mq-maintained", message: "Product name starts with MQ" };
  if (hasLinkPriceSku(product)) return { excluded: true, reason: "link-price", message: "Product has link price 0.01/0.1" };
  return { excluded: false };
}

function filterSearchDetails(products) {
  const items = [];
  const excluded = [];
  for (const product of products || []) {
    const r = classifyProductExclusion(product);
    if (r.excluded) excluded.push({ productId: product.id, name: product.name, reason: r.reason, message: r.message });
    else items.push(product);
  }
  return { items, excluded };
}

function reverseFieldMap() {
  const map = {};
  for (const [cn, en] of Object.entries({
    "1天租金":"rent1day","2天租金":"rent2day","3天租金":"rent3day","4天租金":"rent4day",
    "5天租金":"rent5day","7天租金":"rent7day","10天租金":"rent10day","15天租金":"rent15day",
    "30天租金":"rent30day","60天租金":"rent60day","90天租金":"rent90day","180天租金":"rent180day",
    "库存":"stock","市场价":"marketPrice","押金":"deposit","购买价":"purchasePrice",
    "采购价":"costPrice","购买尾款":"finalPayment",
  })) { map[en] = cn; }
  return map;
}

function buildMirrorFieldUpdates(changes) {
  const reverseMap = reverseFieldMap();
  const skuFields = {};
  const unmappedFields = [];
  for (const [field, value] of Object.entries(changes || {})) {
    const rentMatch = field.match(/^rent(\d+)day$/);
    const mirrorField = reverseMap[field] || (rentMatch ? rentMatch[1] + "天租金" : null);
    if (!mirrorField) unmappedFields.push(field);
    else skuFields[mirrorField] = String(value);
  }
  if (unmappedFields.length > 0) return { ok: false, skuFields: {}, unmappedFields };
  return { ok: true, skuFields, unmappedFields: [] };
}

function isNestedChanges(changes) {
  const firstVal = Object.values(changes || {})[0];
  return typeof firstVal === "object" && firstVal !== null && !Array.isArray(firstVal);
}

function buildMirrorWritebackPayload(productId, skuUpdates, verificationAt) {
  return { goods_id: productId, sku_updates: skuUpdates, source: "saas_verify", verified_at: verificationAt };
}

function resolveVerifiedWritebackTimestamp(state) {
  if (!state || state.status !== "delayed_verified") return { ok: false, message: "Writeback requires delayed_verified state" };
  const verificationAt = String(state && state.delayedVerify && state.delayedVerify.at || "").trim();
  if (!verificationAt || !Number.isFinite(Date.parse(verificationAt))) return { ok: false, message: "Writeback requires a valid delayedVerify.at timestamp" };
  return { ok: true, verificationAt };
}

async function writebackItems(items, verificationAt) {
  if (items.length === 0) die("No items to write back");
  log("Writeback " + items.length + " products to mirror...");

  const results = [];
  for (const item of items) {
    const pid = item.productId;
    const rawChanges = item.changes || item.fields || {};
    if (isNestedChanges(rawChanges)) {
      results.push({ productId: pid, status: "skipped", reason: "nested writeback requires SKU mapping" });
      continue;
    }
    const changes = rawChanges;
    if (Object.keys(changes).length === 0) { results.push({ productId: pid, status: "skipped", reason: "no changes" }); continue; }
    const fieldUpdates = buildMirrorFieldUpdates(changes);
    if (!fieldUpdates.ok) {
      results.push({ productId: pid, status: "error", reason: "unmapped fields", unmappedFields: fieldUpdates.unmappedFields });
      continue;
    }
    const skuFields = fieldUpdates.skuFields;

    // Get mirror data (for SKU strings)
    const detail = await batchDetail([pid]);
    const product = detail.data[0];
    if (!product || !product.skus || product.skus.length === 0) { results.push({ productId: pid, status: "error", reason: "not in mirror" }); continue; }

    if (Object.keys(skuFields).length === 0) { results.push({ productId: pid, status: "skipped", reason: "no mappable fields" }); continue; }

    const skuUpdates = product.skus.map(sku => ({ SKU: sku.SKU, fields: skuFields }));

    try {
      const resp = await request("POST", "/skill/products/update-local", buildMirrorWritebackPayload(pid, skuUpdates, verificationAt));
      results.push({ productId: pid, status: resp.status || "ok", updated: resp.updated_sku_count, rows: resp.updated_row_count, missing: resp.missing_skus });
      log("  " + pid + ": " + resp.updated_sku_count + " SKUs / " + resp.updated_row_count + " rows");
    } catch (err) {
      results.push({ productId: pid, status: "error", error: err.message });
      log("  " + pid + " ERROR: " + err.message);
    }
  }
  const success = results.filter(r => r.status === "ok" || r.status === "success").length;
  const failed = results.filter(r => r.status === "error" || r.status === "skipped");
  const status = failed.length === 0 ? "ok" : (success > 0 ? "partial" : "skipped");
  output({ status, total: results.length, success, skipped: results.filter(r => r.status === "skipped").length, errors: results.filter(r => r.status === "error").length, results });
  if (failed.length > 0) process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd) die("Usage: mirror-search.js <search|batch-spec> <keyword>");

  switch (cmd) {
    case "search": {
      const products = await searchProducts(args[1] || "");
      output(products.map(p => ({
        id: p.id, name: p.name, category: p.category, inventory: p.inventory, skuCount: p.sku_count, status: p.sync_status
      })));
      break;
    }
    case "batch-spec": {
      const products = await searchProducts(args[1] || "");
      if (products.length === 0) { output({ items: [], excluded: [] }); break; }
      const ids = products.map(p => p.id);
      const details = await batchDetail(ids);
      const filtered = filterSearchDetails(details.data);

      const items = filtered.items.map(product => {
        const sku = product.skus && product.skus[0];
        const fields = {};
        if (sku) {
          for (const [key, val] of Object.entries(sku)) {
            const field = skuToFieldName(key);
            if (field && val && val !== "") {
              fields[field] = formatPrice(val);
            }
          }
        }
        return { productId: product.id, name: product.name, mirrorFields: fields, changed: false };
      });

      output({ items, excluded: filtered.excluded, filterRules: ["exclude MQ-maintained products", "exclude link-price products with rental price 0.01/0.1"] });
      if (filtered.excluded.length > 0) log("Excluded " + filtered.excluded.length + " products by search filter rules");
      log("Run: batch-runner.js preview <this-file>");
      break;
    }
    case "writeback": {
      die("Unsafe writeback from raw spec is disabled. Run delayed verify first, then use: mirror-search.js writeback-state <batch_state.json>");
      break;
    }
    case "writeback-state": {
      const statePath = args[1];
      if (!statePath) die("Usage: mirror-search.js writeback-state <batch_state.json>");
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      if (state.status !== "delayed_verified") die("Writeback requires delayed_verified state");
      if ((state.verifyFailed || []).length > 0 || (state.failed || []).length > 0) die("Writeback requires no failed or verifyFailed items");
      const timestampDecision = resolveVerifiedWritebackTimestamp(state);
      if (!timestampDecision.ok) die(timestampDecision.message);
      const completedIds = new Set((state.completed || []).filter(entry => entry && entry.status !== "preview_only").map(x => String(x.productId)));
      const items = (state.spec && state.spec.items ? state.spec.items : []).filter(item => completedIds.has(String(item.productId)));
      await writebackItems(items, timestampDecision.verificationAt);
      break;
    }
    default:
      die("Unknown command: " + cmd);
  }
}

if (require.main === module) {
  main().catch(err => { die(err.message); });
} else {
  module.exports = {
    normalizeText,
    extractNumericPrices,
    isLinkPrice,
    isMqMaintainedProduct,
    hasLinkPriceSku,
    classifyProductExclusion,
    filterSearchDetails,
    skuToFieldName,
    buildMirrorWritebackPayload,
    buildMirrorFieldUpdates,
    resolveVerifiedWritebackTimestamp,
  };
}
