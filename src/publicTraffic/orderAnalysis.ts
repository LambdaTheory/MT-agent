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

export function shortDataDate(date: string | null | undefined): string {
  return date ? date.slice(5) : '未知';
}
