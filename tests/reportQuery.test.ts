import { describe, expect, it } from 'vitest';
import { runPublicTrafficReportQuery } from '../src/feishuBot/reportQuery.js';
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
    row('102', 'Pocket 3 套装版', { exposure: 3000, publicVisits: 900, amount: 2200, shippedOrders: 5 }),
    row('103', 'SX70 长焦相机', { exposure: 100, publicVisits: 20, amount: 80, shippedOrders: 0 }),
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
          { label: '签约发货率', value: '66.67%', delta: '+1.00%' },
        ],
      },
      delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-22', indicators: [] },
      return: { key: 'return', label: '归还分析', dataDate: '2026-06-22', indicators: [] },
      customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-22', indicators: [] },
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
    expect(text).toContain('曝光：当前 1000，前日 800，变化 +200（+25.00%）');
    expect(text).toContain('曝光到访问率：当前 5.00%，前日 4.00%，变化 +1.00 个百分点（+25.00%）');
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
    expect(text.indexOf('端内ID 102')).toBeLessThan(text.indexOf('端内ID 101'));
    expect(text).toContain('访问 900');
    expect(text).not.toContain('端内ID 103');
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
    expect(sum).toContain('访问总和 = 1400');

    const avg = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      period: '7d',
      metrics: ['publicVisits'],
      aggregation: 'avg',
    });
    expect(avg).toContain('访问平均值 = 700');
    expect(avg).toContain('参与计算：2 条');

    const max = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      productQuery: 'Pocket 3',
      period: '7d',
      metrics: ['amount'],
      aggregation: 'max',
    });
    expect(max).toContain('金额最大值 = ¥2200.00');
    expect(max).toContain('端内ID 102');

    const min = runPublicTrafficReportQuery(reportContext, {
      target: 'productAggregation',
      period: '7d',
      metrics: ['publicVisits'],
      aggregation: 'min',
    });
    expect(min).toContain('访问最小值 = 20');
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
    expect(text).toContain('1d：曝光 204');
    expect(text).toContain('7d：曝光 3000');
    expect(text).toContain('30d：曝光 30000');
    expect(text).toContain('签约订单 0');
    expect(text).toContain('访问到发货率');
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

  it('reports source data quality and conclusions', () => {
    expect(runPublicTrafficReportQuery(reportContext, { target: 'dataQuality' })).toContain('访问页 30 日首版缺失');
    expect(runPublicTrafficReportQuery(reportContext, { target: 'conclusions' })).toContain('访问增长但发货偏低');
  });
});
