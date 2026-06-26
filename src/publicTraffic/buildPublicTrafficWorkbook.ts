import XLSX from 'xlsx-js-style';
import type { PeriodKey } from '../domain/types.js';
import type { GoodsManagerNewProductPoolItem } from './goodsManagerNewProducts.js';
import { ORDER_ANALYSIS_PAGE_KEYS, type OrderAnalysisResult } from './orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportContext, PublicTrafficReportSectionItem } from './types.js';

const PERIOD_HEADER_LABELS: Record<PeriodKey, string> = { '1d': '1日', '7d': '7日', '30d': '30日' };

function sectionSheet(items: PublicTrafficReportSectionItem[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [['identifier', 'action', 'reason']];
  for (const item of items) {
    aoa.push([item.identifier, item.action, item.reason]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function sectionRows(items: PublicTrafficReportSectionItem[], emptyNote: string): (string | number)[][] {
  if (items.length === 0) return [['note'], [emptyNote]];

  return [
    ['identifier', 'action', 'reason'],
    ...items.map((item) => [item.identifier, item.action, item.reason]),
  ];
}

function detailSheet(rows: PublicTrafficProductDataRow[]): XLSX.WorkSheet {
  const periods: PeriodKey[] = ['1d', '7d', '30d'];
  const aoa: (string | number | null)[][] = [
    [
      '平台商品ID',
      '端内ID',
      '商品名称',
      '托管天数',
      ...periods.flatMap((period) => {
        const p = PERIOD_HEADER_LABELS[period];
        return [
          `${p}曝光量`,
          `${p}公域访问`,
          `${p}后链路访问`,
          `${p}创建订单`,
          `${p}签约订单`,
          `${p}审出订单`,
          `${p}发货订单`,
          `${p}金额（元）`,
          `${p}创建订单金额（元）`,
          `${p}签约订单金额（元）`,
          `${p}审出订单金额（元）`,
          `${p}发货订单金额（元）`,
          `${p}曝光→访问率`,
          `${p}访问→创单率`,
          `${p}访问→发货率`,
        ];
      }),
    ],
  ];
  for (const row of rows) {
    aoa.push([
      row.platformProductId,
      row.displayProductId,
      row.productName,
      row.custodyDays,
      ...periods.flatMap((period) => {
        const metric = row.periods[period];
        return [
          metric.exposure,
          metric.publicVisits,
          metric.dashboardVisits,
          metric.createdOrders,
          metric.signedOrders,
          metric.reviewedOrders,
          metric.shippedOrders,
          metric.amount,
          metric.createdOrderAmount ?? 0,
          metric.signedOrderAmount ?? 0,
          metric.reviewedOrderAmount ?? 0,
          metric.shippedOrderAmount ?? 0,
          metric.exposureVisitRate,
          metric.visitCreatedOrderRate,
          metric.visitShipmentRate,
        ];
      }),
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function orderAnalysisSheet(result: OrderAnalysisResult): XLSX.WorkSheet {
  const aoa: string[][] = [];
  for (const key of ORDER_ANALYSIS_PAGE_KEYS) {
    const page = result.pages[key];
    aoa.push([`【${page.label}】数据日期：${page.dataDate ?? '未知'}`]);
    aoa.push(['指标', '数值', '环比']);
    for (const item of page.indicators) {
      aoa.push([item.label, item.value, item.delta]);
    }
    aoa.push([]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function newProductPoolSheetFromItems(items: GoodsManagerNewProductPoolItem[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ['商品ID', '商品名称', '短标题', '最近提交时间', '商家', '同步状态', '支付宝编码', '库存', 'SKU数', '维护状态', '备注'],
    ...items.map((item) => [
      item.productId,
      item.productName,
      item.shortTitle,
      item.submittedAt,
      item.merchant,
      item.alipaySyncStatus,
      item.alipayCode,
      item.stock,
      item.skuCount,
      item.maintenanceStatus,
      item.note,
    ]),
  ]);
}

function newProductPoolSheetFromIds(ids: string[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ['商品ID', '维护状态', '备注'],
    ...ids.map((id) => [id, '待维护', '']),
  ]);
}

function writeLegacyWorkbookBuffer(context: PublicTrafficReportContext): Buffer {
  const workbook = XLSX.utils.book_new();
  const overviewAoa: (string | number)[][] = [['period', 'exposure', 'visits', 'conversionRate', 'amount']];
  for (const row of context.overview) {
    overviewAoa.push([row.period, row.exposure, row.visits, row.conversionRate, row.amount]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(overviewAoa), '总览');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.exposureOptimization), '曝光优化');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.conversionOptimization), '转化优化');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.newProductObservation), '新品观察');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.lifecycleGovernance), '生命周期治理');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function writePublicTrafficWorkbookBuffer(context: PublicTrafficDataReportContext | PublicTrafficReportContext): Buffer {
  if (!('summary' in context)) return writeLegacyWorkbookBuffer(context);

  const workbook = XLSX.utils.book_new();

  const overviewAoa: (string | number)[][] = [['period', 'exposure', 'publicVisits', 'dashboardVisits', 'createdOrders', 'shippedOrders', 'amount', 'exposureVisitRate', 'visitCreatedOrderRate', 'visitShipmentRate']];
  for (const period of ['1d', '7d', '30d'] as PeriodKey[]) {
    const summary = context.summary[period];
    overviewAoa.push([period, summary.exposure, summary.publicVisits, summary.dashboardVisits, summary.createdOrders, summary.shippedOrders, summary.amount, summary.exposureVisitRate, summary.visitCreatedOrderRate, summary.visitShipmentRate]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(overviewAoa), '总览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.recommendedActions, context.emptySectionNotes.recommendedActions)), '建议操作');
  XLSX.utils.book_append_sheet(workbook, detailSheet(context.rows), '商品明细');
  if (context.custodyAbnormal?.length) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.custodyAbnormal, context.emptySectionNotes.custodyAbnormal ?? '暂无曝光页托管异常商品。')), '托管异常');
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.lowExposure, context.emptySectionNotes.lowExposure)), '曝光不足');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.weakClick, context.emptySectionNotes.weakClick)), '点击弱');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.weakConversion, context.emptySectionNotes.weakConversion)), '转化弱');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.highPotential, context.emptySectionNotes.highPotential)), '高潜力');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.newProductObservation, context.emptySectionNotes.newProductObservation)), '新品观察');
  if (context.newProductPoolItems?.length) {
    XLSX.utils.book_append_sheet(workbook, newProductPoolSheetFromItems(context.newProductPoolItems), '新品池维护');
  } else if (context.newProductPoolIds?.length) {
    XLSX.utils.book_append_sheet(workbook, newProductPoolSheetFromIds(context.newProductPoolIds), '新品池维护');
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sectionRows(context.lifecycleGovernance, context.emptySectionNotes.lifecycleGovernance)), '生命周期治理');
  if (context.orderAnalysis) {
    XLSX.utils.book_append_sheet(workbook, orderAnalysisSheet(context.orderAnalysis), '订单分析');
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
