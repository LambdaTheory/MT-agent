import { describe, expect, it } from 'vitest';
import { adaptLegacyRefreshCandidateExplainInput, explainRefreshCandidates } from '../src/agentData/refreshCandidateExplain.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

const baseMetric: PublicTrafficPeriodMetrics = {
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
};

function row(internalProductId: string, metrics: Partial<Record<'1d' | '7d' | '30d', Partial<PublicTrafficPeriodMetrics>>>, custodyDays: number | null = 40): PublicTrafficProductDataRow {
  return {
    productName: `R50 ${internalProductId}`,
    platformProductId: `p${internalProductId}`,
    displayProductId: `端内ID ${internalProductId}`,
    custodyDays,
    periods: {
      '1d': { ...baseMetric, ...metrics['1d'] },
      '7d': { ...baseMetric, ...metrics['7d'] },
      '30d': { ...baseMetric, ...metrics['30d'] },
    },
  };
}

const registryEntries: LinkRegistryEntry[] = [
  { internalProductId: '680', platformProductId: 'p680', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '681', platformProductId: 'p681', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '682', platformProductId: 'p682', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '683', platformProductId: 'p683', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '684', platformProductId: 'p684', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'removed', source: ['link_registry_override'] },
  { internalProductId: '685', platformProductId: 'p685', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '686', platformProductId: 'p686', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
];

const context: PublicTrafficDataReportContext = {
  date: '2026-07-06',
  summary: { '1d': baseMetric, '7d': baseMetric, '30d': baseMetric },
  conclusions: [],
  rows: [
    row('680', { '30d': { createdOrders: 1, amount: 100 } }),
    row('681', { '30d': { createdOrders: 1, amount: 0 } }),
    row('682', { '30d': { createdOrders: 0, amount: 0, hasDashboardData: false } }),
    row('683', { '30d': { createdOrders: 0, amount: 0 } }, 12),
    row('686', { '30d': { createdOrders: 0, amount: 0 } }, null),
  ],
  lowExposure: [],
  weakClick: [],
  weakConversion: [],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
};

describe('explainRefreshCandidates', () => {
  it('explains why a same-sku group has zero created-order candidates', () => {
    expect(explainRefreshCandidates(registryEntries, context, { sameSkuGroupId: 'canon-eos-r50', metric: 'createdOrders', operator: 'eq', value: 0, date: '2026-07-06' })).toEqual({
      scopeLine: '筛选范围：R50 / canon-eos-r50',
      sameSkuGroupId: 'canon-eos-r50',
      windowDays: 30,
      metric: 'createdOrders',
      operator: 'eq',
      value: 0,
      candidateCount: 0,
      candidateProductIds: [],
      missing30dDashboardProductIds: ['682'],
      missingRowProductIds: ['685'],
      skipped: {
        inactive: 1,
        missingRow: 1,
        missing30dDashboard: 1,
        onlineLessThan30d: 1,
        onlineDaysUnknown: 1,
      },
      reasonSummary: [
        '没有找到符合 近30天创建订单数 = 0 的 active 链接。',
        '另有 1 条非 active、1 条无日报行、1 条 30日访问页缺失、1 条上线不足 30 天、1 条上线天数未知。',
      ],
    });
  });

  it('counts amount-zero candidates independently from the workflow', () => {
    const result = explainRefreshCandidates(registryEntries, context, { query: 'r50', metric: 'amount', operator: 'eq', value: 0, date: '2026-07-06' });

    expect(result.candidateCount).toBe(2);
    expect(result.candidateProductIds).toEqual(['681', '682']);
    expect(result.missing30dDashboardProductIds).toEqual([]);
    expect(result.missingRowProductIds).toEqual(['685']);
    expect(result.sameSkuGroupId).toBe('canon-eos-r50');
    expect(result.scopeLine).toBe('筛选范围：R50 / canon-eos-r50');
    expect(result.reasonSummary[0]).toBe('找到 2 条符合 近30天公域交易金额 = 0 的 active 链接。');
  });

  it('uses windowDays in zero-candidate explanations', () => {
    const input = { sameSkuGroupId: 'canon-eos-r50', metric: 'createdOrders' as const, operator: 'eq' as const, value: 0 as const, date: '2026-07-06', windowDays: 15 };

    const result = explainRefreshCandidates(registryEntries, context, input);

    expect(result.reasonSummary).toEqual([
      '没有找到符合 近15天创建订单数 = 0 的 active 链接。',
      '另有 1 条非 active、1 条无日报行、1 条 15日访问页缺失、1 条上线不足 15 天、1 条上线天数未知。',
    ]);
    expect(result.reasonSummary.join('\n')).not.toContain('近 30 天');
    expect(result.reasonSummary.join('\n')).not.toContain('30日访问页缺失');
    expect(result.reasonSummary.join('\n')).not.toContain('上线不足 30 天');
  });

  it('does not require dashboard data when explaining public-visit thresholds', () => {
    const result = explainRefreshCandidates(registryEntries, context, { query: 'r50', metric: 'publicVisits', operator: 'eq', value: 0, date: '2026-07-06' });

    expect(result.candidateProductIds).toContain('682');
    expect(result.missing30dDashboardProductIds).toEqual([]);
    expect(result.reasonSummary.join('\n')).toContain('公域访问量 = 0');
  });

  it('keeps the only legacy adapter explicit and rejects missing zeroMetric', () => {
    expect(adaptLegacyRefreshCandidateExplainInput({ query: 'r50', zeroMetric: 'created_orders', date: '2026-07-06' })).toEqual({
      query: 'r50',
      metric: 'createdOrders',
      operator: 'eq',
      value: 0,
      date: '2026-07-06',
    });
    expect(() => adaptLegacyRefreshCandidateExplainInput({ query: 'r50', date: '2026-07-06' })).toThrow('zeroMetric is required');
  });
});
