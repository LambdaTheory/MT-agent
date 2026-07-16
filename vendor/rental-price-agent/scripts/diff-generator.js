#!/usr/bin/env node

/**
 * Diff Generator — step 7: compare current SaaS values with user intent,
 * apply business rules, produce changes.json + markdown preview.
 *
 * Usage:
 *   node diff-generator.js <currentValues.json> <userChanges.json> [--html]
 *
 * Output:
 *   - Markdown table → stderr (always, low token)
 *   - JSON result → stdout (machine-readable)
 *   - HTML preview → tasks/preview_xxx.html (only with --html flag)
 */

const fs = require("fs");
const path = require("path");
const { loadConfig, LAYOUT } = require("./lib/config-loader");
const { checkRules } = require("./lib/rule-checker");

const TASKS_DIR = LAYOUT.tasksDir;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function die(msg) {
  process.stderr.write("[diff] ERROR: " + msg + "\n");
  process.exit(1);
}

const FIELD_META = {
  stock:          { label: "库存",         unit: "",    isPrice: false, isInteger: true  },
  rent1day:       { label: "1天租金",      unit: "元",  isPrice: true,  isInteger: false },
  rent10day:      { label: "10天租金",     unit: "元",  isPrice: true,  isInteger: false },
  rent30day:      { label: "30天租金",     unit: "元",  isPrice: true,  isInteger: false },
  marketPrice:    { label: "市场价",       unit: "元",  isPrice: true,  isInteger: false },
  deposit:        { label: "押金",         unit: "元",  isPrice: true,  isInteger: false },
  purchasePrice:  { label: "采购价",       unit: "元",  isPrice: true,  isInteger: false },
  costPrice:      { label: "成本价",       unit: "元",  isPrice: true,  isInteger: false },
  finalPayment:   { label: "尾款",         unit: "元",  isPrice: true,  isInteger: false },
};

// ================================================================
// Main
// ================================================================

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) die("Usage: node diff-generator.js <currentValues.json> <userChanges.json> [--html]");

  const currentFile = args.find(a => !a.startsWith("--"));
  const changesFileIdx = args.findIndex(a => !a.startsWith("--")) + 1;
  const userChangesFile = args[changesFileIdx];
  const wantHtml = args.includes("--html");

  if (!fs.existsSync(currentFile)) die("Current values file not found: " + currentFile);
  if (!fs.existsSync(userChangesFile)) die("User changes file not found: " + userChangesFile);

  const currentValues = JSON.parse(fs.readFileSync(currentFile, "utf-8"));
  const userChanges = JSON.parse(fs.readFileSync(userChangesFile, "utf-8"));
  const rawValues = currentValues.values || currentValues;
  const specInfo = currentValues.specs || [];
  const config = loadConfig();
  const rules = config.rules || {};

  // Detect multi-spec: if values is { specId: {field:val} } → nested; else flat
  const firstVal = Object.values(rawValues)[0];
  const isMultiSpec = typeof firstVal === "object" && firstVal !== null;
  const specMap = isMultiSpec ? rawValues : { "0": rawValues };

  const diff = [];
  const changes = {};
  let hasErrors = false, hasWarnings = false;

  for (const [specId, specValues] of Object.entries(specMap)) {
    const specTitle = specInfo.find(s => s.specId === specId)?.title || "规格" + specId;

    for (const [field, newVal] of Object.entries(userChanges)) {
      const meta = FIELD_META[field] || { label: field, unit: "", isPrice: false, isInteger: false };
      const oldVal = specValues[field];

      if (oldVal === undefined) {
        if (isMultiSpec) diff.push({ specId, specTitle, field, label: meta.label, old: "(未读取)", new: String(newVal), change: "—", changePct: "—", issues: [{ level: "warn", msg: "当前值未读取" }] });
        continue;
      }

      const oldNum = Number(oldVal), newNum = Number(newVal);
      const change = newNum - oldNum;
      const changePct = oldNum !== 0 ? ((change / oldNum) * 100).toFixed(1) + "%" : "N/A";
      const issues = checkRules(field, oldVal, newVal, rules);

      if (issues.some(i => i.level === "error")) hasErrors = true;
      if (issues.some(i => i.level === "warn")) hasWarnings = true;

      diff.push({
        specId: isMultiSpec ? specId : undefined, specTitle: isMultiSpec ? specTitle : undefined,
        field, label: meta.label, unit: meta.unit,
        old: String(oldVal), new: String(newVal),
        change: (change >= 0 ? "+" : "") + change.toFixed(meta.isInteger ? 0 : 2),
        changePct, issues,
      });
    }
  }

  // Save changes.json (flat format, broadcast)
  changes.__broadcast = true;
  for (const [field, newVal] of Object.entries(userChanges)) {
    changes[field] = newVal;
  }

  // Save generated preview artifacts next to the user intent file. MT-agent
  // stores its audit inputs outside tasks/ so lifecycle state scanning remains clean.
  const outputDir = path.dirname(userChangesFile) || TASKS_DIR;
  ensureDir(outputDir);
  const timestamp = Date.now();
  const changesPath = path.join(outputDir, "changes_" + timestamp + ".json");
  fs.writeFileSync(changesPath, JSON.stringify(changes, null, 2), "utf-8");

  // Markdown table → stderr
  const specNames = specInfo.map(s => s.title).join(", ") || "-";
  const statusIcon = hasErrors ? "🔴" : hasWarnings ? "🟡" : "✅";
  const statusText = hasErrors ? "有错误" : hasWarnings ? "有警告" : "全部通过";

  const mdCell = (issues) => issues.length === 0 ? "✅"
    : issues.map(i => (i.level === "error" ? "🔴 " : "🟡 ") + i.msg).join("<br>");

  let md = "\n## 变更预览 — 商品 " + currentValues.productId + "\n\n";
  md += "**规格数:** " + Object.keys(specMap).length + " | **状态:** " + statusIcon + " " + statusText + " | **变更项:** " + diff.length + "条\n\n";

  if (isMultiSpec) {
    const grouped = {};
    for (const d of diff) { if (!grouped[d.specId]) grouped[d.specId] = []; grouped[d.specId].push(d); }
    for (const [specId, items] of Object.entries(grouped)) {
      md += "### " + items[0].specTitle + " (ID:" + specId + ")\n\n";
      md += "| 字段 | 当前值 → 新值 | 变动 | 校验 |\n| --- | --- | --- | --- |\n";
      for (const d of items) {
        const arrow = Number(d.change) >= 0 ? "📈" : "📉";
        md += "| " + d.label + " | " + d.old + (d.unit ? " " + d.unit : "") + " → **" + d.new + (d.unit ? " " + d.unit : "") + "** | " + arrow + " " + d.change + (d.changePct !== "N/A" ? " (" + d.changePct + ")" : "") + " | " + mdCell(d.issues) + " |\n";
      }
      md += "\n";
    }
  } else {
    md += "| 字段 | 当前值 → 新值 | 变动 | 校验 |\n| --- | --- | --- | --- |\n";
    for (const d of diff) {
      const arrow = Number(d.change) >= 0 ? "📈" : "📉";
      md += "| " + d.label + " | " + d.old + (d.unit ? " " + d.unit : "") + " → **" + d.new + (d.unit ? " " + d.unit : "") + "** | " + arrow + " " + d.change + (d.changePct !== "N/A" ? " (" + d.changePct + ")" : "") + " | " + mdCell(d.issues) + " |\n";
    }
  }
  process.stderr.write(md);

  // HTML preview (optional)
  let htmlPath = null;
  if (wantHtml) {
    htmlPath = path.join(outputDir, "preview_" + timestamp + ".html");
    const productName = currentValues.productName || ("商品 " + currentValues.productId);
    const rows = diff.map(d => {
      const n = parseFloat(d.change);
      const c = isNaN(n) ? "#5F5E5A" : n > 0 ? "#A32D2D" : n < 0 ? "#639922" : "#5F5E5A";
      const tags = d.issues.length === 0 ? "<span style=\"color:#639922\">✓</span>"
        : d.issues.map(i => "<span style=\"color:" + (i.level === "error" ? "#A32D2D" : "#BA7517") + ";margin-right:8px\">" + (i.level === "error" ? "✗" : "!") + " " + i.msg + "</span>").join("");
      return "<tr style=\"border-bottom:1px solid #E8E6DE\"><td style=\"padding:10px 14px;font-weight:500\">" + d.label + "</td><td style=\"padding:10px 14px;color:#5F5E5A\">" + d.old + (d.unit ? " " + d.unit : "") + "</td><td style=\"padding:10px 14px;text-align:center;color:#B4B2A9\">→</td><td style=\"padding:10px 14px;font-weight:500\">" + d.new + (d.unit ? " " + d.unit : "") + "</td><td style=\"padding:10px 14px;color:" + c + ";font-weight:500\">" + d.change + (d.changePct !== "N/A" ? " (" + d.changePct + ")" : "") + "</td><td style=\"padding:10px 14px\">" + tags + "</td></tr>";
    }).join("");
    const sColor = hasErrors ? "#A32D2D" : hasWarnings ? "#BA7517" : "#0F6E56";
    const sBg = hasErrors ? "#FCEBEB" : hasWarnings ? "#FAEEDA" : "#E1F5EE";
    const html = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\">\n<title>变更预览 — " + productName + "</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:-apple-system,BlinkMacSystemFont,\"Microsoft YaHei\",sans-serif;background:#F5F4F0;color:#2C2C2A;padding:32px}\n.card{max-width:680px;margin:0 auto;background:#FFF;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}\n.header{padding:24px 28px;border-bottom:1px solid #E8E6DE}\n.header h1{font-size:18px;font-weight:600}\n.header .meta{font-size:13px;color:#888780;margin-top:4px}\ntable{width:100%;border-collapse:collapse}\nthead th{padding:10px 14px;text-align:left;font-size:12px;font-weight:500;color:#888780}\n.footer{padding:16px 28px;border-top:1px solid #E8E6DE;display:flex;justify-content:space-between;align-items:center}\n.status{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500}\n.confirm-hint{margin-top:20px;padding:16px;background:#FAEEDA;border-radius:8px;font-size:13px;color:#854F0B;text-align:center}\n</style>\n</head>\n<body>\n<div class=\"card\">\n<div class=\"header\">\n<h1>" + productName + "</h1>\n<div class=\"meta\">规格: " + specNames + " · 仅修改 " + diff.length + " 个字段</div>\n</div>\n<table>\n<thead><tr><th>字段</th><th>当前值</th><th></th><th>新值</th><th>变动</th><th>校验</th></tr></thead>\n<tbody>" + rows + "</tbody>\n</table>\n<div class=\"footer\">\n<div class=\"status\" style=\"background:" + sBg + ";color:" + sColor + "\">" + statusText + "</div>\n<span style=\"font-size:12px;color:#888780\">变更项: " + diff.length + "条</span>\n</div>\n</div>\n<div class=\"confirm-hint\">⚠ 以上变更尚未提交，请确认后执行 apply 步骤</div>\n</body>\n</html>";
    fs.writeFileSync(htmlPath, html, "utf-8");
  }

  // JSON result → stdout
  const result = { productId: currentValues.productId, specs: specInfo, diff, changes, hasErrors, hasWarnings, rulesApplied: Object.keys(rules), changesFile: changesPath, previewFile: htmlPath };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
