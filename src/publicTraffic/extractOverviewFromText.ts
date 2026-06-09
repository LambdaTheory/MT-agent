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
    exposure: parseCompactNumber(exposureMatch[1]),
    visits: parseCompactNumber(visitsMatch[1]),
    amount: parseCompactNumber(amountMatch[1]),
    conversionRate: Number.parseFloat(rateMatch[1]) || 0,
  };
}
