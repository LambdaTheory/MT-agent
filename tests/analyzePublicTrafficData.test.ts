import { describe, expect, it } from 'vitest';
import { analyzePublicTrafficData } from '../src/publicTraffic/analyzePublicTrafficData.js';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG } from '../src/publicTraffic/rulesConfig.js';
import type { ExposureOverviewMetric, ExposureProductSummary, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function metric(
  exposure: number,
  publicVisits: number,
  dashboardVisits: number,
  shippedOrders: number,
  hasExposureData = true,
  hasDashboardData = true,
): PublicTrafficPeriodMetrics {
  return {
    exposure,
    publicVisits,
    dashboardVisits,
    createdOrders: shippedOrders,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders,
    amount: shippedOrders * 100,
    exposureVisitRate: exposure > 0 ? publicVisits / exposure : 0,
    visitCreatedOrderRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    visitShipmentRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    hasExposureData,
    hasDashboardData,
  };
}

function row(
  displayProductId: string,
  oneDay = metric(0, 0, 0, 0),
  sevenDay = oneDay,
  thirtyDay = sevenDay,
  custodyDays: number | null = null,
): PublicTrafficProductDataRow {
  return {
    productName: displayProductId,
    platformProductId: displayProductId,
    displayProductId,
    custodyDays,
    periods: { '1d': oneDay, '7d': sevenDay, '30d': thirtyDay },
  };
}

function summary(platformProductId: string, overrides: Partial<ExposureProductSummary>): ExposureProductSummary {
  return {
    productName: platformProductId,
    platformProductId,
    exposure: 0,
    visits: 0,
    amount: 0,
    visitRate: 0,
    days: 14,
    flags: [],
    ...overrides,
  };
}

describe('analyzePublicTrafficData', () => {
  it('builds one-day funnel summary', () => {
    const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [row('端内ID 1', metric(1000, 50, 40, 4))] });
    expect(report.summary['1d']).toMatchObject({
      exposure: 1000,
      publicVisits: 50,
      dashboardVisits: 40,
      shippedOrders: 4,
      amount: 400,
    });
    expect(report.summary['1d'].exposureVisitRate).toBeCloseTo(0.05);
  });

  it('uses exposure page overview for public summary metrics while preserving dashboard metrics', () => {
    const overview: ExposureOverviewMetric[] = [
      { period: '1d', exposure: 30500, visits: 1043, amount: 2673, conversionRate: 3.42 },
    ];

    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID 1', metric(2959313, 117792, 40, 4))],
      overview,
    });

    expect(report.summary['1d']).toMatchObject({
      exposure: 30500,
      publicVisits: 1043,
      dashboardVisits: 40,
      shippedOrders: 4,
      amount: 2673,
    });
    expect(report.summary['1d'].exposureVisitRate).toBeCloseTo(0.0342);
    expect(report.summary['1d'].visitShipmentRate).toBeCloseTo(0.1);
  });

  it('normalizes floating point artifacts from overview metrics before writing summary text', () => {
    const overview: ExposureOverviewMetric[] = [
      { period: '1d', exposure: 32599.999999999996, visits: 1481, amount: 2138.000000000004, conversionRate: 1.32 },
    ];

    const report = analyzePublicTrafficData({
      date: '2026-06-27',
      rows: [row('端内ID 1', metric(1, 1, 1, 0))],
      overview,
      previousSummary: {
        exposure: 39400,
        publicVisits: 1723,
        dashboardVisits: 0,
        createdOrders: 0,
        shippedOrders: 0,
        amount: 3160,
        exposureVisitRate: 0.0199,
        visitCreatedOrderRate: 0,
        visitShipmentRate: 0,
      },
    });

    expect(report.summary['1d'].exposure).toBe(32600);
    expect(report.summary['1d'].amount).toBe(2138);
    expect(report.conclusions[0].text).toContain('曝光 32600');
    expect(report.conclusions[0].text).not.toContain('999999');
  });

  it('classifies problem and opportunity groups', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID low', metric(10, 0, 0, 0)),
        row('端内ID click-weak', metric(2000, 5, 4, 0)),
        row('端内ID potential', metric(1500, 180, 10, 1)),
      ],
    });

    expect(report.lowExposure[0].identifier).toBe('端内ID low');
    expect(report.weakClick[0].identifier).toBe('端内ID click-weak');
    expect(report.weakConversion).toHaveLength(0);
    expect(report.highPotential[0].identifier).toBe('端内ID potential');
  });

  it('excludes healthy rows with public amount from every operation bucket and action', () => {
    const healthyOne = metric(20, 0, 0, 0);
    const healthySeven = metric(20, 0, 0, 1);
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID healthy', healthyOne, healthySeven)],
    });

    expect(report.lowExposure).toHaveLength(0);
    expect(report.weakClick).toHaveLength(0);
    expect(report.weakConversion).toHaveLength(0);
    expect(report.highPotential).toHaveLength(0);
    expect(report.lifecycleGovernance).toHaveLength(0);
    expect(report.recommendedActions).toHaveLength(0);
  });

  it('uses public amount instead of created order count for healthy detection', () => {
    const oneDay = { ...metric(20, 0, 10, 1), createdOrders: 1 };
    const sevenDay = { ...metric(20, 0, 10, 0), createdOrders: 0 };
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID created-only', oneDay, sevenDay)],
    });

    expect(report.recommendedActions).toHaveLength(0);
    expect(report.weakConversion).toHaveLength(0);
    expect(report.lowExposure).toHaveLength(0);
  });

  it('uses public amount per period for healthy detection', () => {
    const oneDay = { ...metric(20, 0, 10, 1), createdOrders: 0, createdOrderAmount: 0 };
    const sevenDay = { ...metric(20, 0, 10, 1), createdOrders: 1 };
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID mixed-created', oneDay, sevenDay)],
    });

    expect(report.recommendedActions).toHaveLength(0);
    expect(report.weakConversion).toHaveLength(0);
    expect(report.lowExposure).toHaveLength(0);
  });

  it('assigns overlapping rows only to the highest severity bucket with priority', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID overlap', metric(80, 2, 60, 0), metric(200, 2, 120, 0), metric(200, 2, 120, 0), 6)],
    });

    expect(report.weakConversion).toHaveLength(0);
    expect(report.lowExposure).toHaveLength(1);
    expect(report.lowExposure[0]).toMatchObject({ identifier: '端内ID overlap', priority: 'medium' });
    expect(report.recommendedActions).toHaveLength(1);
    expect(report.recommendedActions[0]).toMatchObject({ identifier: '端内ID overlap', priority: 'medium' });
  });

  it('does not classify rows when required one-day source data is missing', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID missing-low', metric(0, 0, 0, 0, false, false)),
        row('端内ID missing-click', metric(2000, 5, 4, 0, false, true)),
        row('端内ID missing-conversion', metric(1500, 40, 100, 0, true, false)),
        row('端内ID missing-potential', metric(1500, 180, 160, 8, false, true)),
      ],
    });

    expect(report.lowExposure).toHaveLength(0);
    expect(report.weakClick).toHaveLength(0);
    expect(report.weakConversion).toHaveLength(0);
    expect(report.highPotential).toHaveLength(0);
  });

  it('does not classify custody rows as weak performance when exposure history is missing', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row(
          '端内ID missing-history',
          metric(0, 0, 0, 0, false, true),
          metric(0, 0, 0, 0, false, true),
          metric(0, 0, 0, 0, false, true),
          45,
        ),
      ],
    });

    expect(report.lowExposure).toHaveLength(0);
    expect(report.lifecycleGovernance).toHaveLength(0);
  });

  it('does not classify low exposure when seven-day exposure history is missing', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID partial-history', metric(20, 0, 0, 0, true, true), metric(0, 0, 0, 0, false, true))],
    });

    expect(report.lowExposure).toHaveLength(0);
  });

  it('skips lifecycle governance when thirty-day summary history is unreliable', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID short-history', metric(0, 0, 0, 0), metric(0, 0, 0, 0), metric(60, 1, 1, 0, true, true), 45),
        row('端内ID missing-history', metric(0, 0, 0, 0), metric(0, 0, 0, 0), metric(60, 1, 1, 0, true, true), 45),
        row('端内ID reset-history', metric(0, 0, 0, 0), metric(0, 0, 0, 0), metric(60, 1, 1, 0, true, true), 45),
      ],
      thirtyDaySummary: [
        { productName: '短历史', platformProductId: '端内ID short-history', exposure: 60, visits: 1, amount: 0, visitRate: 1 / 60, days: 29, flags: [] },
        { productName: '缺失历史', platformProductId: '端内ID missing-history', exposure: 60, visits: 1, amount: 0, visitRate: 1 / 60, days: 30, flags: ['missing'] },
        { productName: '重置历史', platformProductId: '端内ID reset-history', exposure: 60, visits: 1, amount: 0, visitRate: 1 / 60, days: 30, flags: ['counter_reset_or_data_error'] },
      ],
    });

    expect(report.lifecycleGovernance).toHaveLength(0);
  });

  it('builds multiple conclusions compared with yesterday', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID 1', metric(1200, 80, 60, 6))],
      previousSummary: {
        exposure: 1000,
        publicVisits: 50,
        dashboardVisits: 45,
        createdOrders: 4,
        shippedOrders: 3,
        amount: 300,
        exposureVisitRate: 0.05,
        visitCreatedOrderRate: 0.0889,
        visitShipmentRate: 0.0667,
      },
    });

    expect(report.conclusions.map((item) => item.label)).toEqual(['曝光', '公域访问', '公域金额', '转化率']);
    expect(report.conclusions[0].text).toContain('较昨日上升 200');
    expect(report.conclusions[1].text).toContain('较昨日上升 30');
    expect(report.conclusions[3].text).toContain('百分点');
    expect(report.previousSummary).toMatchObject({
      exposure: 1000,
      publicVisits: 50,
      amount: 300,
      exposureVisitRate: 0.05,
    });
  });

  it('builds baseline conclusions when yesterday summary is missing', () => {
    const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [row('端内ID 1', metric(1000, 50, 40, 4))] });

    expect(report.conclusions.length).toBeGreaterThan(0);
    expect(report.conclusions[0].text).toContain('暂无昨日公域数据上下文');
  });

  it('builds new product observation from daily new_product deltas', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID 888', metric(500, 20, 10, 0))],
      dailyDelta: [
        {
          date: '2026-06-10',
          productName: '新品',
          platformProductId: '端内ID 888',
          exposure: 12,
          visits: 0,
          amount: 0,
          custodyDays: 1,
          flags: ['new_product'],
        },
      ],
    });

    expect(report.newProductObservation[0]).toMatchObject({
      identifier: '端内ID 888',
      action: '新品数据监控',
    });
    expect(report.newProductObservation[0]?.reason).toContain('1日曝光 500，公域访问 20，金额 0.00');
  });

  it('does not classify high internal ids as new products without a daily new_product delta', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID 888', metric(500, 20, 10, 0))],
      dailyDelta: [],
    });

    expect(report.newProductObservation).toHaveLength(0);
  });

  it('builds lifecycle governance from weak thirty-day performance', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID old', metric(0, 0, 0, 0), metric(5, 0, 0, 0), metric(60, 1, 1, 0), 45)],
      healthAmountSummary: [summary('端内ID old', { amount: 0, days: 14 })],
    });

    expect(report.lifecycleGovernance[0]).toMatchObject({
      identifier: '端内ID old',
      action: '下架、替换或重做素材',
    });
  });

  it('summarizes only listed-failed-custody and delisted-custody rows as custody abnormal', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID 733', metric(100, 5, 5, 0), metric(500, 20, 20, 0), metric(1000, 60, 60, 0), 3),
        row('端内ID 848', metric(80, 2, 2, 0), metric(300, 8, 8, 0), metric(900, 20, 20, 0), 2),
        row('端内ID 900', metric(80, 2, 2, 0), metric(300, 8, 8, 0), metric(900, 20, 20, 0), 2),
      ],
      cumulativeProducts: [
        {
          productName: '大疆 Pocket3',
          platformProductId: '端内ID 733',
          exposure: 100,
          visits: 5,
          amount: 0,
          custodyDays: 3,
          raw: { 商品状态: '上架 展示', 审核状态: '审核失败', 托管状态: '托管中 2天' },
        },
        {
          productName: '佳能 G12',
          platformProductId: '端内ID 848',
          exposure: 80,
          visits: 2,
          amount: 0,
          custodyDays: 2,
          listingStatus: 'removed',
          raw: { 商品状态: '已下架', 托管状态: '托管中 3天' },
        },
        {
          productName: '普通托管异常文本',
          platformProductId: '端内ID 900',
          exposure: 80,
          visits: 2,
          amount: 0,
          custodyDays: 2,
          raw: { 托管状态: '托管异常' },
        },
        {
          productName: '上架托管无失败',
          platformProductId: '端内ID 901',
          exposure: 80,
          visits: 2,
          amount: 0,
          custodyDays: 2,
          raw: { 商品状态: '上架 展示', 托管状态: '托管中' },
        },
        {
          productName: '上架失败未托管',
          platformProductId: '端内ID 902',
          exposure: 80,
          visits: 2,
          amount: 0,
          custodyDays: 2,
          raw: { 商品状态: '上架 展示', 审核状态: '审核失败' },
        },
      ],
    });

    expect(report.custodyAbnormal).toHaveLength(2);
    expect(report.custodyAbnormal?.[0]).toMatchObject({
      identifier: '端内ID 733',
      action: '检查托管异常',
      priority: 'high',
    });
    expect(report.custodyAbnormal?.[0]?.reason).toContain('大疆 Pocket3');
    expect(report.custodyAbnormal?.[0]?.reason).toContain('上架失败但仍托管中');
    expect(report.custodyAbnormal?.[1]).toMatchObject({
      identifier: '端内ID 848',
      action: '检查托管异常',
      priority: 'high',
    });
    expect(report.custodyAbnormal?.[1]?.reason).toContain('已下架但仍托管中');
    expect(report.custodyAbnormal?.map((item) => item.identifier)).not.toContain('端内ID 900');
    expect(report.custodyAbnormal?.map((item) => item.reason).join('\n')).not.toContain('上架托管无失败');
    expect(report.custodyAbnormal?.map((item) => item.reason).join('\n')).not.toContain('上架失败未托管');
  });

  it('builds prioritized recommended actions with executable action text', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID conversion', metric(1000, 120, 100, 0)),
        row('端内ID click', metric(2000, 5, 5, 0), metric(5000, 20, 20, 0)),
        row('端内ID potential', metric(1500, 160, 20, 1), metric(3000, 320, 40, 1)),
      ],
    });

    expect(report.recommendedActions[0]).toMatchObject({
      identifier: '端内ID conversion',
      action: '检查价格/押金/库存/风控/履约链路',
      priority: 'high',
    });
    expect(report.recommendedActions.map((item) => item.action).join('\n')).toContain('检查价格/押金/库存/风控/履约链路');
    expect(report.recommendedActions.map((item) => item.action).join('\n')).toContain('优化主图、标题、价格露出和首屏卖点');
    expect(report.recommendedActions.map((item) => item.action).join('\n')).toContain('继续放量');
  });

  it('provides explanatory notes for empty sections', () => {
    const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [] });

    expect(report.emptySectionNotes.lowExposure).toBe('暂无达到阈值的曝光不足商品。');
    expect(report.emptySectionNotes.weakClick).toBe('暂无达到阈值的高曝光低点击商品。');
    expect(report.emptySectionNotes.weakConversion).toBe('暂无达到阈值的高访问低转化商品。');
    expect(report.emptySectionNotes.highPotential).toBe('暂无达到放量阈值的高潜力商品。');
    expect(report.emptySectionNotes.newProductObservation).toBe('暂无可识别的新进入公域商品，或今日缺少上一日快照。');
    expect(report.emptySectionNotes.lifecycleGovernance).toBe('暂无达到长期弱表现阈值的托管商品。');
    expect(report.emptySectionNotes.recommendedActions).toBe('暂无需要立即处理的建议操作。');
  });

  it('uses default health thresholds for exposure, visit rate, and 14-day amount kill', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID exposure-fail', metric(299, 0, 0, 0), metric(2093, 0, 0, 0), metric(9000, 0, 0, 0), 6),
        row('端内ID exposure-normal', metric(300, 0, 0, 0), metric(2100, 0, 0, 0), metric(9000, 0, 0, 0), 6),
        row('端内ID click-bad', metric(1000, 19, 19, 0), metric(7000, 140, 140, 0), metric(30000, 600, 600, 0)),
        row('端内ID lifecycle-kill', metric(0, 0, 0, 0), metric(0, 0, 0, 0), metric(8999, 100, 100, 0), 45),
        row('端内ID amount-missing', metric(0, 0, 0, 0), metric(0, 0, 0, 0), metric(8999, 100, 100, 0), 45),
      ],
      thirtyDaySummary: [
        summary('端内ID lifecycle-kill', { exposure: 8999, visits: 100, amount: 0, visitRate: 100 / 8999, days: 30 }),
        summary('端内ID amount-missing', { exposure: 8999, visits: 100, amount: 0, visitRate: 100 / 8999, days: 30 }),
      ],
      healthAmountSummary: [
        summary('端内ID exposure-fail', { amount: 0, days: 14 }),
        summary('端内ID exposure-normal', { amount: 0, days: 14 }),
        summary('端内ID click-bad', { amount: 0, days: 14 }),
        summary('端内ID lifecycle-kill', { amount: 0, days: 14 }),
        summary('端内ID amount-missing', { amount: 0, days: 13 }),
      ],
    });

    expect(report.lowExposure.map((item) => item.identifier)).toContain('端内ID exposure-fail');
    expect(report.lowExposure.map((item) => item.identifier)).not.toContain('端内ID exposure-normal');
    expect(report.weakClick.map((item) => item.identifier)).toContain('端内ID click-bad');
    expect(report.lifecycleGovernance.map((item) => item.identifier)).toContain('端内ID lifecycle-kill');
    expect(report.lifecycleGovernance.map((item) => item.identifier)).not.toContain('端内ID amount-missing');
  });

  it('honors custom health rule overrides passed into analysis input', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [row('端内ID custom-exposure', metric(400, 0, 0, 0), metric(2800, 0, 0, 0), metric(12000, 0, 0, 0), 6)],
      healthAmountSummary: [summary('端内ID custom-exposure', { amount: 0, days: 3 })],
      rulesConfig: {
        ...DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
        health: {
          ...DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.health,
          exposureDailyAverage: { failBelow: 500, normalBelow: 1000 },
          amountKill: { windowDays: 3, threshold: 0 },
        },
      },
    });

    expect(report.lowExposure.map((item) => item.identifier)).toContain('端内ID custom-exposure');
  });
});
