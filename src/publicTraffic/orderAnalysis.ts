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

function formatRate(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function formatCurrency(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '-';
  return `¥${(numerator / denominator).toFixed(2)}`;
}

function closeRateStatus(closeRate: string): '达标' | '风险' | '-' {
  if (closeRate === '-') return '-';
  const value = Number(closeRate.replace('%', ''));
  if (!Number.isFinite(value)) return '-';
  return value <= 35 ? '达标' : '风险';
}

export interface DerivedOrderBusinessMetrics {
  shipmentRate: string;
  closeRate: string;
  closeRateStatus: '达标' | '风险' | '-';
  averageOrderValue: string;
}

export function derivedOrderBusinessMetrics(overview: OrderAnalysisPageData | undefined, customs: OrderAnalysisPageData | undefined): DerivedOrderBusinessMetrics {
  const created = findOrderAnalysisNumber(overview, ['创建订单数']);
  const signed = findOrderAnalysisNumber(overview, ['签约订单数']);
  const shipped = findOrderAnalysisNumber(overview, ['发货订单数']);
  const signedAmount = findOrderAnalysisNumber(overview, ['签约完成金额（元）', '签约完成金额']);
  const closed = findOrderAnalysisNumber(customs, ['关单数']);
  const closeRate = formatRate(closed, created);
  return {
    shipmentRate: formatRate(shipped, created),
    closeRate,
    closeRateStatus: closeRateStatus(closeRate),
    averageOrderValue: formatCurrency(signedAmount, signed),
  };
}

export function businessMetricLines(overview: OrderAnalysisPageData | undefined, customs: OrderAnalysisPageData | undefined): string[] {
  if (!overview && !customs) return [];
  const metrics = derivedOrderBusinessMetrics(overview, customs);
  const statusText = metrics.closeRateStatus === '-' ? '目标<=35%' : `目标<=35%，${metrics.closeRateStatus}`;
  return [`发货率 ${metrics.shipmentRate}｜关单率 ${metrics.closeRate}（${statusText}）｜客单价 ${metrics.averageOrderValue}`];
}

export function fulfillmentRateLines(overview: OrderAnalysisPageData | undefined): string[] {
  if (!overview) return [];
  const created = findOrderAnalysisNumber(overview, ['创建订单数']);
  const signed = findOrderAnalysisNumber(overview, ['签约订单数']);
  const reviewed = findOrderAnalysisNumber(overview, ['审出订单数']);
  const shipped = findOrderAnalysisNumber(overview, ['发货订单数']);
  return [
    `签约/创建 ${formatRate(signed, created)}｜审出/签约 ${formatRate(reviewed, signed)}｜发货/审出 ${formatRate(shipped, reviewed)}`,
    '暂无昨日履约率对比',
  ];
}

export function shortDataDate(date: string | null | undefined): string {
  return date ? date.slice(5) : '未知';
}
