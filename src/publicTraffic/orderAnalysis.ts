export type OrderAnalysisPageKey = 'overview' | 'delivery' | 'return' | 'customs';

export const ORDER_ANALYSIS_PAGE_LABELS: Record<OrderAnalysisPageKey, string> = {
  overview: '标准订单分析',
  delivery: '发货分析',
  return: '归还分析',
  customs: '关单分析',
};

export const ORDER_ANALYSIS_PAGE_KEYS: OrderAnalysisPageKey[] = ['overview', 'delivery', 'return', 'customs'];

export interface OrderAnalysisIndicator {
  label: string;
  value: string;
  delta: string;
}

export interface OrderAnalysisPageData {
  key: OrderAnalysisPageKey;
  label: string;
  dataDate: string | null;
  indicators: OrderAnalysisIndicator[];
}

export interface OrderAnalysisCapture {
  capturedAt: string;
  pages: Record<OrderAnalysisPageKey, OrderAnalysisPageData>;
}

export interface OrderAnalysisResult extends OrderAnalysisCapture {
  runDate: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanOrderAnalysisIndicator(raw: { label: string; value: string; delta: string }): OrderAnalysisIndicator | null {
  const label = normalizeText(raw.label);
  const value = normalizeText(raw.value);
  if (!label || !value) return null;
  return { label, value, delta: normalizeText(raw.delta) };
}

export function resolveOrderAnalysisDataDate(rawValue: string | null | undefined, referenceDate: string): string | null {
  const value = normalizeText(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(referenceDate.slice(0, 4));
  const candidate = `${year}-${value}`;
  return candidate <= referenceDate ? candidate : `${year - 1}-${value}`;
}

export function findOrderAnalysisIndicator(page: OrderAnalysisPageData | undefined, labels: string[]): string {
  for (const label of labels) {
    const found = page?.indicators.find((item) => item.label === label);
    if (found) return found.value;
  }
  return '-';
}

export function parseOrderAnalysisNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (normalized.startsWith('-')) return null;
  const matched = normalized.match(/^\d+(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function findOrderAnalysisNumber(page: OrderAnalysisPageData | undefined, labels: string[]): number | null {
  return parseOrderAnalysisNumber(findOrderAnalysisIndicator(page, labels));
}

function formatFulfillmentRate(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

export function fulfillmentRateLines(overview: OrderAnalysisPageData | undefined): string[] {
  if (!overview) return [];
  const created = findOrderAnalysisNumber(overview, ['创建订单数']);
  const signed = findOrderAnalysisNumber(overview, ['签约订单数']);
  const reviewed = findOrderAnalysisNumber(overview, ['审出订单数']);
  const shipped = findOrderAnalysisNumber(overview, ['发货订单数']);
  return [
    `签约/创建 ${formatFulfillmentRate(signed, created)}｜审出/签约 ${formatFulfillmentRate(reviewed, signed)}｜发货/审出 ${formatFulfillmentRate(shipped, reviewed)}`,
    '暂无昨日履约率对比',
  ];
}

export function shortDataDate(date: string | null | undefined): string {
  return date ? date.slice(5) : '未知';
}
