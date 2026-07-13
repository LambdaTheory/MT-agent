import { describe, expect, it } from 'vitest';
import { runPublicTrafficReportDateComparison, runPublicTrafficReportQuery } from '../src/feishuBot/reportQuery.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function period(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

function row(id: string, productName: string, sevenDay: Partial<PublicTrafficPeriodMetrics>): PublicTrafficProductDataRow {
  return {
    productName,
    platformProductId: `platform-${id}`,
    displayProductId: `端内ID ${id}`,
    custodyDays: 8,
    periods: {
      '1d': period({ publicVisits: Number(id), exposure: Number(id) * 2 }),
      '7d': period(sevenDay),
      '30d': period({ publicVisits: 3000, exposure: 30000 }),
    },
  };
}

const reportContext: PublicTrafficDataReportContext = {
  date: '2026-06-22',
  summary: {
    '1d': { exposure: 1000, publicVisits: 50, dashboardVisits: 45, createdOrders: 3, shippedOrders: 1, amount: 88, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.06, visitShipmentRate: 0.02 },
    '7d': { exposure: 7000, publicVisits: 300, dashboardVisits: 280, createdOrders: 20, shippedOrders: 8, amount: 500, exposureVisitRate: 0.04, visitCreatedOrderRate: 0.07, visitShipmentRate: 0.026 },
    '30d': { exposure: 30000, publicVisits: 1000, dashboardVisits: 920, createdOrders: 60, shippedOrders: 20, amount: 2000, exposureVisitRate: 0.033, visitCreatedOrderRate: 0.06, visitShipmentRate: 0.02 },
  },
  previousSummary: { exposure: 800, publicVisits: 40, dashboardVisits: 36, createdOrders: 2, shippedOrders: 1, amount: 44, exposureVisitRate: 0.04, visitCreatedOrderRate: 0.055, visitShipmentRate: 0.027 },
  conclusions: [{ label: '重点', text: '访问增长但发货偏低。' }],
  dataQualityNotes: ['访问页 30 日首版缺失。'],
  newProductPoolItems: [
    {
      productId: '301',
      productName: 'Pocket 3 新链',
      shortTitle: 'Pocket3',
      submittedAt: '2026-06-21 10:00:00',
      merchant: '门店A',
      alipaySyncStatus: '已同步',
      alipayCode: 'ALP301',
      stock: 5,
      skuCount: 3,
      maintenanceStatus: '待维护',
      note: '',
    },
  ],
  rows: [
    row('101', 'Pocket 3 标准版', { exposure: 2000, publicVisits: 500, amount: 1200, shippedOrders: 3 }),
    row('102', 'Pocket 3 套装版', { exposure: 3000, publicVisits: 900, amount: 2200, shippedOrders: 5, hasExposureData: false }),
    row('103', 'SX70 长焦相机', { exposure: 100, publicVisits: 20, amount: 80, shippedOrders: 0, hasDashboardData: false }),
  ],
  lowExposure: [{ identifier: '端内ID 103', action: '观察', reason: '7日曝光低', priority: 'medium' }],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 101', action: '改素材', reason: '访问到发货低', priority: 'high' }],
  highPotential: [{ identifier: '端内ID 102', action: '加新链', reason: '访问高', priority: 'high' }],
  newProductObservation: [],
  lifecycleGovernance: [],
  custodyAbnormal: [
    { identifier: '端内ID 201', action: '检查托管', reason: '托管异常', priority: 'high' },
    { identifier: '端内ID 202', action: '检查托管', reason: '托管异常', priority: 'medium' },
  ],
  recommendedActions: [{ identifier: '端内ID 102', action: '铺新链', reason: '高潜', priority: 'high' }],
  emptySectionNotes: {
    lowExposure: '',
    weakClick: '',
    weakConversion: '',
    highPotential: '',
    newProductObservation: '',
    lifecycleGovernance: '',
    recommendedActions: '',
  },
  orderAnalysis: {
    runDate: '2026-06-23',
    capturedAt: '2026-06-23T01:00:00.000Z',
    pages: {
      overview: {
        key: 'overview',
        label: '标准订单分析',
        dataDate: '2026-06-22',
        indicators: [
          { label: '创建订单数', value: '12', delta: '+2' },
          { label: '签约订单数', value: '6', delta: '+1' },
          { label: '审出订单数', value: '4', delta: '+1' },
          { label: '发货订单数', value: '3', delta: '+1' },
          { label: '签约完成金额（元）', value: '240', delta: '+40' },
          { label: '签约发货率', value: '66.67%', delta: '+1.00%' },
        ],
      },
      delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-22', indicators: [] },
      return: { key: 'return', label: '归还分析', dataDate: '2026-06-22', indicators: [] },
      customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-22', indicators: [{ label: '关单数', value: '5', delta: '+1' }] },
    },
  },
};

describe('public traffic report freeform query', () => {
  it('summarizes previous-day comparison metrics', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'comparison',
      metrics: ['exposure', 'publicVisits', 'amount', 'exposureVisitRate'],
    });

    expect(text).toContain('公域日报较前日变化 2026-06-22');
    expect(text).toContain('曝光量：当前 1000，前日 800，变化 +200（+25.00%）');
    expect(text).toContain('曝光到访问率：当前 5.00%，前日 4.00%，变化 +1.00 个百分点（+25.00%）');
  });

  it('compares saved report contexts by period', () => {
    const previousContext: PublicTrafficDataReportContext = {
      ...reportContext,
      date: '2026-06-15',
      summary: {
        ...reportContext.summary,
        '7d': {
          ...reportContext.summary['7d'],
          exposure: 8000,
          publicVisits: 240,
          exposureVisitRate: 0.03,
          visitCreatedOrderRate: 0.05,
          visitShipmentRate: 0.02,
        },
      },
    };

    const text = runPublicTrafficReportDateComparison(reportContext, previousContext, {
      target: 'dateComparison',
      period: '7d',
      metrics: ['exposureVisitRate', 'publicVisits'],
    });

    expect(text).toContain('2026-06-22 7d');
    expect(text).toContain('2026-06-15 7d');
    expect(text).toContain('4.00%');
    expect(text).toContain('3.00%');
    expect(text).toContain('+1.00');
    expect(text).toContain('300');
    expect(text).toContain('240');
  });

  it('sorts product rows by selected period metric', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'products',
      period: '7d',
      metrics: ['publicVisits', 'amount'],
      sortBy: 'publicVisits',
      limit: 2,
    });

    expect(text).toContain('公域日报商品查询 2026-06-22');
    expect(text).toContain('按 公域访问量 降序');
    expect(text).toContain('公域访问量 500');
    expect(text).toContain('端内ID 103');
    expect(text).not.toContain('端内ID 102');
  });

  it('aggregates product rows by count, sum, average, min, and max', () => {
    const count = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      aggregation: 'count',
    });
    expect(count).toContain('匹配 2 条商品');
    expect(count).toContain('商品数量 = 2');

    const sum = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      period: '7d',
      metrics: ['publicVisits'],
      aggregation: 'sum',
    });
    expect(sum).toContain('公域访问量总和 = 500');

    const avg = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      period: '7d',
      metrics: ['publicVisits'],
      aggregation: 'avg',
    });
    expect(avg).toContain('公域访问量平均值 = 500');
    expect(avg).toContain('参与计算：1 条');

    const max = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      period: '7d',
      metrics: ['amount'],
      aggregation: 'max',
    });
    expect(max).toContain('公域交易金额最大值 = ¥1200.00');
    expect(max).toContain('端内ID 101');

    const min = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      period: '7d',
      metrics: ['publicVisits'],
      aggregation: 'min',
    });
    expect(min).toContain('公域访问量最小值 = 20');
    expect(min).toContain('端内ID 103');
  });

  it('returns full product details across all report periods', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'productDetail',
      productQuery: '102',
    });

    expect(text).toContain('公域日报商品全量明细 2026-06-22');
    expect(text).toContain('端内ID 102 Pocket 3 套装版');
    expect(text).toContain('平台商品ID platform-102，托管天数 8');
    expect(text).toContain('1d：曝光量 204');
    expect(text).toContain('7d：曝光量 不可用');
    expect(text).toContain('30d：曝光量 30000');
    expect(text).toContain('签约订单数 0');
    expect(text).toContain('后链路访问到发货率');
  });

  it('does not substring-match short numeric product queries against platform product ids', () => {
    const platformId = '2026062922000000000914';
    const context: PublicTrafficDataReportContext = {
      ...reportContext,
      rows: [
        { ...row('914', 'Internal 914 product', { exposure: 100, publicVisits: 10 }), platformProductId: 'platform-internal-914', displayProductId: '端内ID 914' },
        { ...row('777', 'Platform id contains 914', { exposure: 200, publicVisits: 20 }), platformProductId: platformId, displayProductId: '端内ID 777' },
      ],
    };

    const shortNumeric = runPublicTrafficReportQuery(context, {
      target: 'productDetail',
      productQuery: '914',
    });
    expect(shortNumeric).toContain('Internal 914 product');
    expect(shortNumeric).not.toContain('Platform id contains 914');

    const fullPlatform = runPublicTrafficReportQuery(context, {
      target: 'productDetail',
      productQuery: platformId,
    });
    expect(fullPlatform).toContain('Platform id contains 914');
    expect(fullPlatform).not.toContain('Internal 914 product');
  });

  it('does not render unavailable dashboard zero as observed zero in product filters', () => {
    const dashboardMissingContext: PublicTrafficDataReportContext = {
      ...reportContext,
      rows: [
        row('103', 'SX70 长焦相机', { exposure: 100, publicVisits: 20, amount: 80, createdOrders: 0, hasDashboardData: false }),
      ],
    };
    const text = runPublicTrafficReportQuery(dashboardMissingContext, {
      target: 'products',
      period: '7d',
      metrics: ['createdOrders', 'publicVisits'],
      filters: [{ field: 'createdOrders', operator: 'eq', value: 0 }],
    });

    expect(text).toContain('没有可用于筛选的创建订单数数据');
    expect(text).not.toContain('端内ID 103');
  });

  it('labels absent optional order amount as unavailable instead of ¥0.00', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'productDetail',
      productQuery: '101',
      metrics: ['signedOrderAmount'],
    });

    expect(text).toContain('签约订单金额 不可用');
    expect(text).not.toContain('签约金额 ¥0.00');
  });

  it('reports product-level source coverage and missing rows', () => {
    const dashboardMissing = runPublicTrafficReportQuery(reportContext, {
      target: 'sourceCoverage',
      period: '7d',
      source: 'dashboard',
      coverageStatus: 'missing',
    });

    expect(dashboardMissing).toContain('日报数据源覆盖 2026-06-22');
    expect(dashboardMissing).toContain('数据源：访问页，状态：未更新/异常');
    expect(dashboardMissing).toContain('7d：商品 3 条，曝光页已抓取 2 条/未更新 1 条，访问页已抓取 2 条/未更新 1 条，双源完整 1 条');
    expect(dashboardMissing).toContain('端内ID 103');
    expect(dashboardMissing).not.toContain('端内ID 102 Pocket 3 套装版');

    const anyMissing = runPublicTrafficReportQuery(reportContext, {
      target: 'sourceCoverage',
      period: '7d',
      source: 'all',
      coverageStatus: 'missing',
    });

    expect(anyMissing).toContain('端内ID 102 Pocket 3 套装版：曝光页未更新/异常');
    expect(anyMissing).toContain('端内ID 103 SX70 长焦相机：访问页未更新/异常');
  });

  it('counts all report sections for issue-pool questions', () => {
    const text = runPublicTrafficReportQuery(reportContext, { target: 'sectionCounts' });

    expect(text).toContain('公域日报问题池数量 2026-06-22');
    expect(text).toContain('曝光低：1 条');
    expect(text).toContain('托管异常：2 条');
    expect(text).toContain('建议操作：1 条');
  });

  it('queries a named section with filters', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'section',
      section: 'custodyAbnormal',
      filters: [{ field: 'priority', operator: 'eq', value: 'high' }],
    });

    expect(text).toContain('托管异常');
    expect(text).toContain('端内ID 201');
    expect(text).not.toContain('端内ID 202');
  });

  it('keeps extended new-product-pool fields in section details', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'section',
      section: 'newProductPool',
    });

    expect(text).toContain('商品名称 Pocket 3 新链');
    expect(text).toContain('最近提交时间 2026-06-21 10:00:00');
    expect(text).toContain('库存 5');
    expect(text).toContain('SKU数 3');
  });

  it('reports unsupported product-row filter fields instead of returning an empty match set', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'products',
      period: '7d',
      filters: [{ field: 'stock', operator: 'gt', value: 0 }],
    });

    expect(text).toContain('Unsupported');
    expect(text).toContain('target=products');
    expect(text).toContain('stock');
  });

  it('reports unsupported product-row sort fields instead of claiming a no-op sort', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'products',
      period: '7d',
      sortBy: 'stock',
    });

    expect(text).toContain('Unsupported');
    expect(text).toContain('target=products');
    expect(text).toContain('stock');
  });

  it('still allows new-product-pool section filters on stock', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'section',
      section: 'newProductPool',
      filters: [{ field: 'stock', operator: 'gte', value: 5 }],
    });

    expect(text).toContain('Pocket 3');
    expect(text).toContain('5');
  });

  it('filters order analysis indicators by user wording', () => {
    const text = runPublicTrafficReportQuery(reportContext, {
      target: 'orders',
      orderPage: 'overview',
      orderIndicator: '签约发货率',
    });

    expect(text).toContain('订单分析 2026-06-22');
    expect(text).toContain('签约发货率：66.67%');
    expect(text).not.toContain('创建订单数');
  });

  it('answers derived order business metric questions', () => {
    const all = runPublicTrafficReportQuery(reportContext, {
      target: 'orderDerived',
    });

    expect(all).toContain('订单经营指标 2026-06-22');
    expect(all).toContain('订单页日期：经营 2026-06-22，关单 2026-06-22');
    expect(all).toContain('发货率：25.00%');
    expect(all).toContain('关单率：41.67%（目标<=35%，风险）');
    expect(all).toContain('客单价：¥40.00');
    expect(all).toContain('履约链路：签约/创建 50.00%｜审出/签约 66.67%｜发货/审出 75.00%');

    const closeStatus = runPublicTrafficReportQuery(reportContext, {
      target: 'orderDerived',
      orderDerivedMetric: 'closeRateStatus',
    });

    expect(closeStatus).toContain('关单率状态：风险（目标<=35%）');
    expect(closeStatus).not.toContain('客单价');
  });

  it('reports source data quality and conclusions', () => {
    expect(runPublicTrafficReportQuery(reportContext, { target: 'dataQuality' })).toContain('访问页 30 日首版缺失');
    expect(runPublicTrafficReportQuery(reportContext, { target: 'conclusions' })).toContain('访问增长但发货偏低');
  });
});
