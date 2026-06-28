function parseCompactNumber(text: string): number {
  const cleaned = text.replace(/[,，\s]/g, '');
  if (cleaned.includes('万')) {
    return Number.parseFloat(cleaned.replace('万', '')) * 10000;
  }
  if (cleaned.includes('亿')) {
    return Number.parseFloat(cleaned.replace('亿', '')) * 100000000;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCompactCount(text: string): number {
  return Math.round(parseCompactNumber(text));
}

function parseCompactMoney(text: string): number {
  return roundTo(parseCompactNumber(text), 2);
}

export interface OverviewMetrics {
  exposure: number;
  visits: number;
  amount: number;
  conversionRate: number;
}

export function extractOverviewFromText(text: string): OverviewMetrics | null {
  const exposureMatch = text.match(/曝光次数\s+([\d.,]+\s*万?亿?)/);
  const visitsMatch = text.match(/商品访问次数\s+([\d.,]+\s*万?亿?)/);
  const amountMatch = text.match(/交易金额\s+([\d.,]+\s*万?亿?)/);
  const rateMatch = text.match(/交易转化率\s+([\d.]+)\s*%/);

  if (!exposureMatch || !visitsMatch || !amountMatch || !rateMatch) {
    return null;
  }

  return {
    exposure: parseCompactCount(exposureMatch[1]),
    visits: parseCompactCount(visitsMatch[1]),
    amount: parseCompactMoney(amountMatch[1]),
    conversionRate: roundTo(Number.parseFloat(rateMatch[1]) || 0, 2),
  };
}
