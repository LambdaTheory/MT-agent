import type { PeriodKey } from '../domain/types.js';
import type {
  ExposureCumulativeProduct,
  ExposureOverviewMetric,
  ExposureProductSummary,
  PublicTrafficDataAnalysisInput,
  PublicTrafficDataReportDraftContext,
  PublicTrafficDataSummary,
  PublicTrafficEmptySectionNotes,
  PublicTrafficPeriodMetrics,
  PublicTrafficProductDataRow,
  PublicTrafficReportSectionItem,
} from './types.js';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG, type PublicTrafficRulesConfig } from './rulesConfig.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];
const PRIORITY_RANK: Record<NonNullable<PublicTrafficReportSectionItem['priority']>, number> = { high: 0, medium: 1, low: 2 };
type AmountKillStatus = 'killed' | 'alive' | 'unknown';

function emptySummary(): PublicTrafficDataSummary {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

const EMPTY_SECTION_NOTES: PublicTrafficEmptySectionNotes = {
  lowExposure: '暂无达到阈值的曝光不足商品。',
  weakClick: '暂无达到阈值的高曝光低点击商品。',
  weakConversion: '暂无达到阈值的高访问低转化商品。',
  highPotential: '暂无达到放量阈值的高潜力商品。',
  newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
  lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
  custodyAbnormal: '暂无曝光页托管异常商品。',
  recommendedActions: '暂无需要立即处理的建议操作。',
};

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function count(value: number): number {
  return Math.round(value);
}

function money(value: number): number {
  return roundTo(value, 2);
}

function rate(value: number): number {
  return roundTo(value, 6);
}

function displayNumber(value: number, digits: number): string {
  const rounded = roundTo(value, digits);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

function normalizeSummary(summary: PublicTrafficDataSummary): PublicTrafficDataSummary {
  return {
    exposure: count(summary.exposure),
    publicVisits: count(summary.publicVisits),
    dashboardVisits: count(summary.dashboardVisits),
    createdOrders: count(summary.createdOrders),
    shippedOrders: count(summary.shippedOrders),
    amount: money(summary.amount),
    exposureVisitRate: rate(summary.exposureVisitRate),
    visitCreatedOrderRate: rate(summary.visitCreatedOrderRate),
    visitShipmentRate: rate(summary.visitShipmentRate),
  };
}

function signedNumber(value: number, digits: number): string {
  const rounded = roundTo(value, digits);
  if (rounded > 0) return `上升 ${displayNumber(rounded, digits)}`;
  if (rounded < 0) return `下降 ${displayNumber(Math.abs(rounded), digits)}`;
  return '持平 0';
}

function changeText(label: string, current: number, previous: number, unit = '', digits = 2): string {
  const normalizedCurrent = roundTo(current, digits);
  const normalizedPrevious = roundTo(previous, digits);
  const diff = normalizedCurrent - normalizedPrevious;
  const change = previous > 0 ? `，变化 ${((diff / previous) * 100).toFixed(2)}%` : '';
  return `${label} ${displayNumber(normalizedCurrent, digits)}${unit}，较昨日${signedNumber(diff, digits)}${unit}${change}`;
}

function pointChangeText(label: string, current: number, previous: number): string {
  const diff = (current - previous) * 100;
  if (diff > 0) return `${label} ${percent(current)}，较昨日上升 ${diff.toFixed(2)} 个百分点`;
  if (diff < 0) return `${label} ${percent(current)}，较昨日下降 ${Math.abs(diff).toFixed(2)} 个百分点`;
  return `${label} ${percent(current)}，较昨日持平 0.00 个百分点`;
}

function buildConclusions(summary: PublicTrafficDataSummary, previous?: PublicTrafficDataSummary) {
  const current = normalizeSummary(summary);
  if (!previous) {
    return [
      {
        label: '基准',
        text: `暂无昨日公域数据上下文，今日仅展示基准值：曝光 ${current.exposure}，公域访问 ${current.publicVisits}，公域金额 ¥${current.amount.toFixed(2)}，转化率 ${percent(current.exposureVisitRate)}。`,
      },
    ];
  }
  const baseline = normalizeSummary(previous);

  return [
    { label: '曝光', text: changeText('曝光', current.exposure, baseline.exposure, '', 0) },
    { label: '公域访问', text: changeText('公域访问', current.publicVisits, baseline.publicVisits, '', 0) },
    { label: '公域金额', text: changeText('公域金额', current.amount, baseline.amount, '元') },
    { label: '转化率', text: pointChangeText('转化率', current.exposureVisitRate, baseline.exposureVisitRate) },
  ];
}

function summarize(rows: PublicTrafficProductDataRow[], period: PeriodKey): PublicTrafficDataSummary {
  const summary = rows.reduce((acc, row) => {
    const metrics = row.periods[period];
    acc.exposure += metrics.exposure;
    acc.publicVisits += metrics.publicVisits;
    acc.dashboardVisits += metrics.dashboardVisits;
    acc.createdOrders += metrics.createdOrders;
    acc.shippedOrders += metrics.shippedOrders;
    acc.amount += metrics.amount;
    return acc;
  }, emptySummary());
  summary.exposureVisitRate = summary.exposure > 0 ? summary.publicVisits / summary.exposure : 0;
  summary.visitCreatedOrderRate = summary.dashboardVisits > 0 ? summary.createdOrders / summary.dashboardVisits : 0;
  summary.visitShipmentRate = summary.dashboardVisits > 0 ? summary.shippedOrders / summary.dashboardVisits : 0;
  return normalizeSummary(summary);
}

function applyOverview(summary: PublicTrafficDataSummary, overview: ExposureOverviewMetric | undefined): PublicTrafficDataSummary {
  if (!overview) return summary;
  return normalizeSummary({
    ...summary,
    exposure: count(overview.exposure),
    publicVisits: count(overview.visits),
    amount: money(overview.amount),
    exposureVisitRate: rate(overview.conversionRate / 100),
  });
}

function item(row: PublicTrafficProductDataRow, action: string, reason: string, priority?: PublicTrafficReportSectionItem['priority']): PublicTrafficReportSectionItem {
  return { identifier: row.displayProductId, action, reason, priority };
}

function monitoringReason(row: PublicTrafficProductDataRow): string {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  return `1日曝光 ${one.exposure}，公域访问 ${one.publicVisits}，金额 ${one.amount.toFixed(2)}；7日曝光 ${seven.exposure}，公域访问 ${seven.publicVisits}，金额 ${seven.amount.toFixed(2)}`;
}

function byPlatformId(rows: PublicTrafficProductDataRow[]): Map<string, PublicTrafficProductDataRow> {
  return new Map(rows.map((row) => [row.platformProductId, row]));
}

function normalizeRawText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function custodyStatusText(product: ExposureCumulativeProduct): string {
  for (const [key, value] of Object.entries(product.raw ?? {})) {
    if (normalizeRawText(key).includes('托管状态')) return normalizeRawText(value);
  }
  return '';
}

function rawValuesByKey(product: ExposureCumulativeProduct, keyPattern: RegExp): string[] {
  return Object.entries(product.raw ?? {})
    .filter(([key]) => keyPattern.test(normalizeRawText(key)))
    .map(([, value]) => normalizeRawText(value))
    .filter(Boolean);
}

function rawText(product: ExposureCumulativeProduct): string {
  return Object.entries(product.raw ?? {})
    .map(([key, value]) => `${normalizeRawText(key)}:${normalizeRawText(value)}`)
    .join(' ');
}

function statusSignal(product: ExposureCumulativeProduct): string {
  return rawValuesByKey(product, /商品状态|上架状态|售卖状态|上下架状态/u).join(' ');
}

function hasCustodyActiveSignal(status: string): boolean {
  return /托管中/u.test(status);
}

function hasListedSignal(status: string): boolean {
  return /上架|出售中|可售卖|已同步/u.test(status);
}

function hasDelistedSignal(status: string): boolean {
  return /已下架|下架|停售/u.test(status);
}

function hasFailureSignal(product: ExposureCumulativeProduct): boolean {
  return /失败|不通过|未同步|拒绝|驳回/u.test(rawText(product));
}

function custodyAbnormalCase(product: ExposureCumulativeProduct): 'listed_failed_custody' | 'delisted_custody' | null {
  const custodyStatus = custodyStatusText(product);
  if (!hasCustodyActiveSignal(custodyStatus)) return null;
  const listingStatus = statusSignal(product);
  if (hasDelistedSignal(listingStatus)) return 'delisted_custody';
  if (hasListedSignal(listingStatus) && hasFailureSignal(product)) return 'listed_failed_custody';
  return null;
}

function custodyAbnormalReason(productName: string, product: ExposureCumulativeProduct, abnormalCase: NonNullable<ReturnType<typeof custodyAbnormalCase>>): string {
  const listingStatus = statusSignal(product) || '未知';
  const custodyStatus = custodyStatusText(product);
  const caseText = abnormalCase === 'listed_failed_custody' ? '上架失败但仍托管中' : '已下架但仍托管中';
  return `${productName}｜${caseText}｜商品状态：${listingStatus}｜托管状态：${custodyStatus}`;
}

function rowForCumulativeProduct(product: ExposureCumulativeProduct, rowsById: Map<string, PublicTrafficProductDataRow>): PublicTrafficProductDataRow | undefined {
  const platformProductId = normalizeRawText(product.platformProductId);
  return rowsById.get(platformProductId) ?? rowsById.get(platformProductId.slice(0, -1));
}

function buildCustodyAbnormalItems(input: PublicTrafficDataAnalysisInput, rowsById: Map<string, PublicTrafficProductDataRow>): PublicTrafficReportSectionItem[] {
  const seen = new Set<string>();
  return (input.cumulativeProducts ?? [])
    .map((product) => ({ product, abnormalCase: custodyAbnormalCase(product), row: rowForCumulativeProduct(product, rowsById) }))
    .filter((entry): entry is { product: ExposureCumulativeProduct; abnormalCase: NonNullable<ReturnType<typeof custodyAbnormalCase>>; row: PublicTrafficProductDataRow | undefined } => entry.abnormalCase !== null)
    .map(({ product, abnormalCase, row }) => {
      const identifier = row?.displayProductId ?? `平台商品ID ${product.platformProductId}`;
      const productName = product.productName || row?.productName || identifier;
      return {
        identifier,
        action: '检查托管异常',
        reason: custodyAbnormalReason(productName, product, abnormalCase),
        priority: 'high' as const,
      };
    })
    .filter((entry) => {
      if (seen.has(entry.identifier)) return false;
      seen.add(entry.identifier);
      return true;
    })
    .sort((a, b) => a.identifier.localeCompare(b.identifier, 'zh-CN'));
}

function hasReliableThirtyDaySummary(summary: PublicTrafficDataAnalysisInput['thirtyDaySummary'], platformProductId: string): boolean {
  if (!summary) return true;
  const item = summary.find((entry) => entry.platformProductId === platformProductId);
  return Boolean(item && item.days >= 30 && !item.flags.includes('missing') && !item.flags.includes('counter_reset_or_data_error'));
}

function buildRecommendedActions(sections: {
  weakConversion: PublicTrafficReportSectionItem[];
  weakClick: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
  highPotential: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lowExposure: PublicTrafficReportSectionItem[];
}): PublicTrafficReportSectionItem[] {
  const seen = new Set<string>();
  return [
    ...sections.weakConversion,
    ...sections.weakClick,
    ...sections.lifecycleGovernance,
    ...sections.lowExposure,
    ...sections.highPotential,
    ...sections.newProductObservation,
  ]
    .filter((entry) => {
      if (seen.has(entry.identifier)) return false;
      seen.add(entry.identifier);
      return true;
    })
    .sort((a, b) => PRIORITY_RANK[a.priority ?? 'low'] - PRIORITY_RANK[b.priority ?? 'low']);
}

function dailyAverage(metrics: Pick<PublicTrafficPeriodMetrics, 'exposure'>, days: number): number {
  return metrics.exposure / days;
}

function reliableSummary(summary: ExposureProductSummary | undefined, requiredDays: number): summary is ExposureProductSummary {
  return Boolean(summary && summary.days >= requiredDays && !summary.flags.includes('missing') && !summary.flags.includes('counter_reset_or_data_error'));
}

function healthAmountSummary(input: PublicTrafficDataAnalysisInput): Map<string, ExposureProductSummary> {
  return new Map((input.healthAmountSummary ?? []).map((entry) => [entry.platformProductId, entry]));
}

function amountKillStatus(row: PublicTrafficProductDataRow, rules: PublicTrafficRulesConfig, summaries: Map<string, ExposureProductSummary>): AmountKillStatus {
  const summary = summaries.get(row.platformProductId);
  if (!reliableSummary(summary, rules.health.amountKill.windowDays)) {
    return row.periods['1d'].amount > rules.health.amountKill.threshold || row.periods['7d'].amount > rules.health.amountKill.threshold ? 'alive' : 'unknown';
  }
  return summary.amount <= rules.health.amountKill.threshold ? 'killed' : 'alive';
}

function matchesLowExposure(row: PublicTrafficProductDataRow, rules: PublicTrafficRulesConfig, amountStatus: AmountKillStatus): boolean {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const thirty = row.periods['30d'];
  const failExposure = rules.health.exposureDailyAverage.failBelow;
  const custodyLowExposure = typeof row.custodyDays === 'number' && row.custodyDays > 5 && one.hasExposureData && dailyAverage(one, 1) < failExposure;
  const exposureHistoryLow = one.hasExposureData && seven.hasExposureData && dailyAverage(one, 1) < failExposure && dailyAverage(seven, 7) < failExposure;
  const hasVisitEvidence = one.publicVisits > 0 || seven.publicVisits > 0 || thirty.publicVisits > 0;
  const visitEvidenceLow = (seven.hasExposureData || seven.hasDashboardData || thirty.hasDashboardData) && hasVisitEvidence && seven.publicVisits <= 3 && thirty.publicVisits <= 10;
  return (custodyLowExposure || exposureHistoryLow || visitEvidenceLow) && amountStatus !== 'alive';
}

function matchesWeakClick(row: PublicTrafficProductDataRow, rules: PublicTrafficRulesConfig): boolean {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const normalExposure = rules.health.exposureDailyAverage.normalBelow;
  const badVisitRate = rules.health.visitRate.badBelow;
  return (
    (one.hasExposureData || seven.hasExposureData) &&
    (dailyAverage(one, 1) >= normalExposure || dailyAverage(seven, 7) >= normalExposure) &&
    ((one.hasExposureData && dailyAverage(one, 1) >= normalExposure && one.exposureVisitRate < badVisitRate) ||
      (seven.hasExposureData && dailyAverage(seven, 7) >= normalExposure && seven.exposureVisitRate < badVisitRate))
  );
}

function matchesWeakConversion(row: PublicTrafficProductDataRow, rules: PublicTrafficRulesConfig, amountStatus: AmountKillStatus): boolean {
  const one = row.periods['1d'];
  return one.hasExposureData && amountStatus !== 'alive' && one.publicVisits >= 100 && one.exposureVisitRate >= rules.health.visitRate.normalBelow;
}

function matchesLifecycleGovernance(row: PublicTrafficProductDataRow, input: PublicTrafficDataAnalysisInput, rules: PublicTrafficRulesConfig, amountStatus: AmountKillStatus): boolean {
  const thirty = row.periods['30d'];
  const weakExposure = thirty.hasExposureData && dailyAverage(thirty, 30) < rules.health.exposureDailyAverage.failBelow;
  const weakVisitRate = thirty.hasExposureData && thirty.exposure > 0 && thirty.exposureVisitRate < rules.health.visitRate.badBelow;
  return typeof row.custodyDays === 'number' && row.custodyDays >= rules.lifecycleGovernance.minCustodyDays && hasReliableThirtyDaySummary(input.thirtyDaySummary, row.platformProductId) && amountStatus === 'killed' && (weakExposure || weakVisitRate);
}

function matchesHighPotential(row: PublicTrafficProductDataRow, rules: PublicTrafficRulesConfig, amountStatus: AmountKillStatus): boolean {
  const one = row.periods['1d'];
  return one.hasExposureData && amountStatus !== 'killed' && one.amount > rules.health.amountKill.threshold && (one.publicVisits >= 10 || dailyAverage(one, 1) >= rules.health.exposureDailyAverage.failBelow);
}

function lifecyclePriority(row: PublicTrafficProductDataRow): PublicTrafficReportSectionItem['priority'] {
  return (row.custodyDays ?? 0) >= 60 || row.periods['30d'].exposure <= 20 ? 'high' : 'medium';
}

export function analyzePublicTrafficData(input: PublicTrafficDataAnalysisInput): PublicTrafficDataReportDraftContext {
  const rulesConfig = input.rulesConfig ?? DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG;
  const rows = input.rows;
  const one = (row: PublicTrafficProductDataRow) => row.periods['1d'];
  const seven = (row: PublicTrafficProductDataRow) => row.periods['7d'];
  const thirty = (row: PublicTrafficProductDataRow) => row.periods['30d'];
  const summary = Object.fromEntries(PERIODS.map((period) => [period, applyOverview(summarize(rows, period), input.overview?.find((item) => item.period === period))])) as Record<
    PeriodKey,
    PublicTrafficDataSummary
  >;
  const rowsById = byPlatformId(rows);
  const dailyDelta = input.dailyDelta ?? [];
  const amountSummaries = healthAmountSummary(input);

  const newProductIds = new Set(dailyDelta.filter((row) => row.flags.includes('new_product')).map((row) => row.platformProductId));
  const lowExposureRows: PublicTrafficProductDataRow[] = [];
  const weakClickRows: PublicTrafficProductDataRow[] = [];
  const weakConversionRows: PublicTrafficProductDataRow[] = [];
  const highPotentialRows: PublicTrafficProductDataRow[] = [];
  const newProductObservationRows: PublicTrafficProductDataRow[] = [];
  const lifecycleGovernanceRows: PublicTrafficProductDataRow[] = [];

  for (const row of rows) {
    const amountStatus = amountKillStatus(row, rulesConfig, amountSummaries);
    if (matchesWeakConversion(row, rulesConfig, amountStatus)) {
      weakConversionRows.push(row);
    } else if (matchesWeakClick(row, rulesConfig)) {
      weakClickRows.push(row);
    } else if (matchesLifecycleGovernance(row, input, rulesConfig, amountStatus)) {
      lifecycleGovernanceRows.push(row);
    } else if (matchesLowExposure(row, rulesConfig, amountStatus)) {
      lowExposureRows.push(row);
    } else if (matchesHighPotential(row, rulesConfig, amountStatus)) {
      highPotentialRows.push(row);
    } else if (newProductIds.has(row.platformProductId)) {
      newProductObservationRows.push(row);
    }
  }

  const lowExposure = lowExposureRows
    .sort((a, b) => seven(a).exposure - seven(b).exposure || one(a).exposure - one(b).exposure)
    .map((row) => item(row, '检查托管状态、标题、主图、类目和是否继续投放', `已托管 ${row.custodyDays ?? '未知'} 天，1日曝光 ${one(row).exposure}，7日曝光 ${seven(row).exposure}，7日访问 ${seven(row).publicVisits}`, 'medium'));

  const weakClick = weakClickRows
    .sort((a, b) => seven(a).exposureVisitRate - seven(b).exposureVisitRate || one(a).exposureVisitRate - one(b).exposureVisitRate || seven(b).exposure - seven(a).exposure)
    .map((row) => item(row, '优化主图、标题、价格露出和首屏卖点', `1日曝光 ${one(row).exposure}，1日访问率 ${percent(one(row).exposureVisitRate)}，7日曝光 ${seven(row).exposure}，7日访问率 ${percent(seven(row).exposureVisitRate)}`, 'high'));

  const weakConversion = weakConversionRows
    .sort((a, b) => one(b).publicVisits - one(a).publicVisits || one(b).exposure - one(a).exposure)
    .map((row) => item(row, '检查价格/押金/库存/风控/履约链路', `提转化标准：1日公域访问 >=100 且公域金额为 0；当前1日公域访问 ${one(row).publicVisits}，公域金额 ${one(row).amount.toFixed(2)}`, 'high'));

  const highPotential = highPotentialRows
    .sort((a, b) => one(b).amount - one(a).amount || one(b).publicVisits - one(a).publicVisits)
    .map((row) => item(row, '继续放量，并复制标题/图片/价格结构到同类商品', `放量标准：单品1日公域金额 >0，且公域访问 >=10 或曝光 >=100；当前1日曝光 ${one(row).exposure}，公域访问 ${one(row).publicVisits}，公域金额 ${one(row).amount.toFixed(2)}`, one(row).amount >= 100 || one(row).publicVisits >= 50 ? 'medium' : 'low'));

  const newProductObservation = newProductObservationRows
    .sort((a, b) => one(a).exposure - one(b).exposure || one(a).publicVisits - one(b).publicVisits)
    .map((row) => item(row, '新品数据监控', monitoringReason(row), 'low'));

  const newProductObservationFromDelta = dailyDelta
    .filter((row) => row.flags.includes('new_product'))
    .map((delta) => ({ delta, row: rowsById.get(delta.platformProductId) }))
    .filter((entry): entry is { delta: (typeof dailyDelta)[number]; row: PublicTrafficProductDataRow } => {
      if (!entry.row) return false;
      return amountKillStatus(entry.row, rulesConfig, amountSummaries) !== 'alive';
    })
    .filter((entry) => !weakConversionRows.includes(entry.row) && !weakClickRows.includes(entry.row) && !lifecycleGovernanceRows.includes(entry.row) && !lowExposureRows.includes(entry.row) && !highPotentialRows.includes(entry.row))
    .sort((a, b) => a.delta.exposure - b.delta.exposure || a.delta.visits - b.delta.visits)
    .map(({ row }) => item(row, '新品数据监控', monitoringReason(row), 'low'));

  for (const deltaItem of newProductObservationFromDelta) {
    if (!newProductObservation.some((entry) => entry.identifier === deltaItem.identifier)) newProductObservation.push(deltaItem);
  }

  const lifecycleGovernance = lifecycleGovernanceRows
    .sort((a, b) => (b.custodyDays ?? 0) - (a.custodyDays ?? 0) || thirty(a).exposure - thirty(b).exposure)
    .map((row) => item(row, '下架、替换或重做素材', `已托管 ${row.custodyDays} 天，30日曝光 ${thirty(row).exposure}，访问 ${thirty(row).publicVisits}，金额 ${thirty(row).amount.toFixed(2)}`, lifecyclePriority(row)));

  const recommendedActions = buildRecommendedActions({ weakConversion, weakClick, lifecycleGovernance, highPotential, newProductObservation, lowExposure });
  const custodyAbnormal = buildCustodyAbnormalItems(input, rowsById);

  return {
    date: input.date,
    summary,
    conclusions: buildConclusions(summary['1d'], input.previousSummary),
    dataQualityNotes: input.dataQualityNotes,
    rows,
    lowExposure,
    weakClick,
    weakConversion,
    highPotential,
    newProductObservation,
    lifecycleGovernance,
    custodyAbnormal,
    recommendedActions,
    emptySectionNotes: EMPTY_SECTION_NOTES,
    orderAnalysis: input.orderAnalysis,
    previousSummary: input.previousSummary,
  };
}
