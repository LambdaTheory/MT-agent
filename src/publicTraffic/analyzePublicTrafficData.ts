import type { PeriodKey } from '../domain/types.js';
import type {
  ExposureOverviewMetric,
  PublicTrafficDataAnalysisInput,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficEmptySectionNotes,
  PublicTrafficProductDataRow,
  PublicTrafficReportSectionItem,
} from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

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
  recommendedActions: '暂无需要立即处理的建议操作。',
};

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function signedNumber(value: number): string {
  if (value > 0) return `上升 ${Number.isInteger(value) ? value : value.toFixed(2)}`;
  if (value < 0) return `下降 ${Number.isInteger(value) ? Math.abs(value) : Math.abs(value).toFixed(2)}`;
  return '持平 0';
}

function changeText(label: string, current: number, previous: number, unit = ''): string {
  const diff = current - previous;
  const change = previous > 0 ? `，变化 ${((diff / previous) * 100).toFixed(2)}%` : '';
  return `${label} ${current}${unit}，较昨日${signedNumber(diff)}${unit}${change}`;
}

function pointChangeText(label: string, current: number, previous: number): string {
  const diff = (current - previous) * 100;
  if (diff > 0) return `${label} ${percent(current)}，较昨日上升 ${diff.toFixed(2)} 个百分点`;
  if (diff < 0) return `${label} ${percent(current)}，较昨日下降 ${Math.abs(diff).toFixed(2)} 个百分点`;
  return `${label} ${percent(current)}，较昨日持平 0.00 个百分点`;
}

function buildConclusions(summary: PublicTrafficDataSummary, previous?: PublicTrafficDataSummary) {
  if (!previous) {
    return [
      {
        label: '基准',
        text: `暂无昨日公域数据上下文，今日仅展示基准值：曝光 ${summary.exposure}，公域访问 ${summary.publicVisits}，发货 ${summary.shippedOrders}，金额 ¥${summary.amount.toFixed(2)}。`,
      },
    ];
  }

  return [
    { label: '曝光', text: changeText('曝光', summary.exposure, previous.exposure) },
    { label: '公域访问', text: changeText('公域访问', summary.publicVisits, previous.publicVisits) },
    { label: '金额', text: changeText('金额', summary.amount, previous.amount, '元') },
    { label: '发货', text: changeText('发货', summary.shippedOrders, previous.shippedOrders) },
    { label: '曝光到访问率', text: pointChangeText('曝光到访问率', summary.exposureVisitRate, previous.exposureVisitRate) },
    { label: '访问到发货率', text: pointChangeText('访问到发货率', summary.visitShipmentRate, previous.visitShipmentRate) },
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
  return summary;
}

function applyOverview(summary: PublicTrafficDataSummary, overview: ExposureOverviewMetric | undefined): PublicTrafficDataSummary {
  if (!overview) return summary;
  return {
    ...summary,
    exposure: overview.exposure,
    publicVisits: overview.visits,
    amount: overview.amount,
    exposureVisitRate: overview.conversionRate / 100,
  };
}

function item(row: PublicTrafficProductDataRow, action: string, reason: string): PublicTrafficReportSectionItem {
  return { identifier: row.displayProductId, action, reason };
}

function internalIdNumber(row: PublicTrafficProductDataRow): number | null {
  const match = /^端内ID\s+(\d+)$/.exec(row.displayProductId.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function monitoringReason(row: PublicTrafficProductDataRow): string {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const oneVisits = one.publicVisits || one.dashboardVisits;
  const sevenVisits = seven.publicVisits || seven.dashboardVisits;
  return `1日曝光 ${one.exposure}，访问 ${oneVisits}，发货 ${one.shippedOrders}，金额 ${one.amount.toFixed(2)}；7日曝光 ${seven.exposure}，访问 ${sevenVisits}，发货 ${seven.shippedOrders}，金额 ${seven.amount.toFixed(2)}`;
}

function byPlatformId(rows: PublicTrafficProductDataRow[]): Map<string, PublicTrafficProductDataRow> {
  return new Map(rows.map((row) => [row.platformProductId, row]));
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
  return [
    ...sections.weakConversion,
    ...sections.weakClick,
    ...sections.lifecycleGovernance,
    ...sections.highPotential,
    ...sections.newProductObservation,
    ...sections.lowExposure,
  ];
}

export function analyzePublicTrafficData(input: PublicTrafficDataAnalysisInput): PublicTrafficDataReportContext {
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

  const lowExposure = rows
    .filter((row) => {
      const custodyLowExposure = typeof row.custodyDays === 'number' && row.custodyDays > 5 && one(row).hasExposureData && one(row).exposure < 100;
      const exposureHistoryLow = one(row).hasExposureData && seven(row).hasExposureData && one(row).exposure <= 50 && seven(row).exposure <= 300;
      const hasVisitEvidence = one(row).publicVisits > 0 || seven(row).publicVisits > 0 || thirty(row).publicVisits > 0;
      const visitEvidenceLow = (seven(row).hasExposureData || seven(row).hasDashboardData || thirty(row).hasDashboardData) && hasVisitEvidence && seven(row).publicVisits <= 3 && thirty(row).publicVisits <= 10;
      return custodyLowExposure || exposureHistoryLow || visitEvidenceLow;
    })
    .filter((row) => one(row).shippedOrders === 0 && seven(row).shippedOrders === 0)
    .sort((a, b) => seven(a).exposure - seven(b).exposure || one(a).exposure - one(b).exposure)
    .map((row) =>
      item(row, '检查托管状态、标题、主图、类目和是否继续投放', `已托管 ${row.custodyDays ?? '未知'} 天，1日曝光 ${one(row).exposure}，7日曝光 ${seven(row).exposure}，7日访问 ${seven(row).publicVisits}`),
    );

  const weakClick = rows
    .filter((row) => (one(row).hasExposureData || seven(row).hasExposureData) && (one(row).exposure >= 1000 || seven(row).exposure >= 3000))
    .filter((row) => (one(row).exposure >= 1000 && one(row).exposureVisitRate < 0.01) || (seven(row).exposure >= 3000 && seven(row).exposureVisitRate < 0.015))
    .sort((a, b) => seven(a).exposureVisitRate - seven(b).exposureVisitRate || one(a).exposureVisitRate - one(b).exposureVisitRate || seven(b).exposure - seven(a).exposure)
    .map((row) =>
      item(
        row,
        '优化主图、标题、价格露出和首屏卖点',
        `1日曝光 ${one(row).exposure}，1日访问率 ${percent(one(row).exposureVisitRate)}，7日曝光 ${seven(row).exposure}，7日访问率 ${percent(seven(row).exposureVisitRate)}`,
      ),
    );

  const weakConversion = rows
    .filter((row) => (one(row).hasDashboardData || seven(row).hasDashboardData) && (one(row).dashboardVisits >= 50 || seven(row).dashboardVisits >= 100))
    .filter((row) => (one(row).dashboardVisits >= 50 && one(row).shippedOrders === 0) || (seven(row).dashboardVisits >= 100 && seven(row).visitShipmentRate < 0.01))
    .sort((a, b) => one(b).dashboardVisits - one(a).dashboardVisits || seven(b).dashboardVisits - seven(a).dashboardVisits)
    .map((row) =>
      item(
        row,
        '检查价格/押金/库存/风控/履约链路',
        `1日后链路访问 ${one(row).dashboardVisits}，1日发货 ${one(row).shippedOrders}，7日后链路访问 ${seven(row).dashboardVisits}，7日发货 ${seven(row).shippedOrders}`,
      ),
    );

  const highPotential = rows
    .filter((row) => (one(row).hasExposureData || seven(row).hasExposureData) && (one(row).shippedOrders > 0 || seven(row).shippedOrders >= 3 || seven(row).amount >= 500))
    .filter((row) => one(row).publicVisits >= 100 || seven(row).publicVisits >= 300 || seven(row).amount >= 500)
    .sort((a, b) => seven(b).amount - seven(a).amount || seven(b).shippedOrders - seven(a).shippedOrders || one(b).publicVisits - one(a).publicVisits)
    .map((row) =>
      item(
        row,
        '继续放量，并复制标题/图片/价格结构到同类商品',
        `7日曝光 ${seven(row).exposure}，7日访问 ${seven(row).publicVisits}，7日发货 ${seven(row).shippedOrders}，7日金额 ${seven(row).amount.toFixed(2)}`,
      ),
    );

  const newProductObservationFromDelta = dailyDelta
    .filter((row) => row.flags.includes('new_product'))
    .map((delta) => ({ delta, row: rowsById.get(delta.platformProductId) }))
    .filter((entry): entry is { delta: (typeof dailyDelta)[number]; row: PublicTrafficProductDataRow } => Boolean(entry.row))
    .sort((a, b) => a.delta.exposure - b.delta.exposure || a.delta.visits - b.delta.visits)
    .map(({ row }) => item(row, '新品数据监控', monitoringReason(row)));

  const newProductObservation = [
    ...rows
      .filter((row) => (internalIdNumber(row) ?? 0) > 700)
      .sort((a, b) => (internalIdNumber(a) ?? 0) - (internalIdNumber(b) ?? 0))
      .map((row) => item(row, '新品数据监控', monitoringReason(row))),
    ...newProductObservationFromDelta,
  ].filter((entry, index, all) => all.findIndex((candidate) => candidate.identifier === entry.identifier) === index);

  const lifecycleGovernance = rows
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays >= 30)
    .filter((row) => thirty(row).hasExposureData)
    .filter((row) => hasReliableThirtyDaySummary(input.thirtyDaySummary, row.platformProductId))
    .filter((row) => thirty(row).exposure <= 100 && thirty(row).publicVisits <= 3 && thirty(row).amount <= 1)
    .sort((a, b) => (b.custodyDays ?? 0) - (a.custodyDays ?? 0) || thirty(a).exposure - thirty(b).exposure)
    .map((row) => item(row, '下架、替换或重做素材', `已托管 ${row.custodyDays} 天，30日曝光 ${thirty(row).exposure}，访问 ${thirty(row).publicVisits}，金额 ${thirty(row).amount.toFixed(2)}`));

  const recommendedActions = buildRecommendedActions({ weakConversion, weakClick, lifecycleGovernance, highPotential, newProductObservation, lowExposure });

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
    recommendedActions,
    emptySectionNotes: EMPTY_SECTION_NOTES,
    orderAnalysis: input.orderAnalysis,
  };
}
