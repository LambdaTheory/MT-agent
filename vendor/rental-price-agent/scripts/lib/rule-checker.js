/**
 * Shared rule checker — validates price/stock changes against config rules.
 */

function checkRules(field, oldVal, newVal, rules) {
  const issues = [];
  const oldNum = Number(oldVal);
  const newNum = Number(newVal);

  // Price bounds
  if (field.includes("rent") || field === "marketPrice" || field === "deposit" || field === "purchasePrice" || field === "costPrice" || field === "finalPayment") {
    if (rules.maxPrice && newNum > rules.maxPrice) issues.push({ level: "error", msg: "超过最大价格 " + rules.maxPrice });
    if (rules.minPrice !== undefined && newNum < rules.minPrice) issues.push({ level: "error", msg: "低于最小价格 " + rules.minPrice });
  }

  // Stock
  if (field === "stock") {
    if (rules.minStock !== undefined && newNum < rules.minStock) issues.push({ level: "error", msg: "库存不能为负" });
  }

  // Max change percentage
  if (rules.maxChangePercent && oldNum !== 0) {
    const changePct = Math.abs((newNum - oldNum) / oldNum * 100);
    if (changePct > rules.maxChangePercent) issues.push({ level: "warn", msg: "变动 " + changePct.toFixed(1) + "% 超过阈值 " + rules.maxChangePercent + "%" });
  }

  return issues;
}

module.exports = { checkRules };
