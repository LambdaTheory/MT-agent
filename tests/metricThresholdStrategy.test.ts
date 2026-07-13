import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateMetricThresholdStrategy } from '../src/agentData/metricThresholdStrategy.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const baseMetric = {
  exposure: 10,
  publicVisits: 0,
  dashboardVisits: 1,
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

interface DayRow {
  id: string;
  name: string;
  exposure?: number;
  publicVisits?: number;
  dashboardVisits?: number | string;
  createdOrders?: number;
  amount?: number | string;
  signedOrderAmount?: number;
  custodyDays?: number | null;
}

const registry: LinkRegistryEntry[] = [
  { internalProductId: '215', platformProductId: 'p215', shortName: 'Zero Visit A', aliases: ['zero-a'], sameSkuGroupId: 'zero-visits', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '218', platformProductId: 'p218', shortName: 'Zero Visit B', aliases: ['zero-b'], sameSkuGroupId: 'zero-visits', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '242', platformProductId: 'p242', shortName: 'Has Visits', aliases: ['has-visits'], sameSkuGroupId: 'zero-visits', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '301', platformProductId: 'p301', shortName: 'Removed Zero', aliases: ['removed-zero'], sameSkuGroupId: 'zero-visits', status: 'removed', source: ['link_registry_override'] },
];

const compoundRegistry: LinkRegistryEntry[] = [
  ...registry,
  { internalProductId: '243', platformProductId: 'p243', shortName: 'Zero Visits With Amount', aliases: [], sameSkuGroupId: 'zero-visits', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '244', platformProductId: 'p244', shortName: 'Unavailable Amount', aliases: [], sameSkuGroupId: 'zero-visits', status: 'active', source: ['link_registry_override'] },
];

async function writeDay(root: string, date: string, rows: DayRow[]) {
  const dayDir = join(root, date);
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, `公域数据上下文_${date}.json`), JSON.stringify({
    date,
    summary: {},
    conclusions: [],
    dataQualityNotes: [],
    rows: rows.map((row) => ({
      productName: row.name,
      platformProductId: `p${row.id}`,
      displayProductId: `端内ID ${row.id}`,
      custodyDays: row.custodyDays ?? 20,
      periods: {
        '1d': {
          ...baseMetric,
          exposure: row.exposure ?? baseMetric.exposure,
          publicVisits: row.publicVisits ?? baseMetric.publicVisits,
          dashboardVisits: row.dashboardVisits ?? baseMetric.dashboardVisits,
          createdOrders: row.createdOrders ?? baseMetric.createdOrders,
          amount: row.amount ?? baseMetric.amount,
          ...(row.signedOrderAmount !== undefined ? { signedOrderAmount: row.signedOrderAmount } : {}),
        },
      },
    })),
  }), 'utf8');
}

function dateAt(day: number): string {
  return `2026-07-${String(day).padStart(2, '0')}`;
}

describe('evaluateMetricThresholdStrategy', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-metric-threshold-'));
    for (let day = 1; day <= 15; day += 1) {
      await writeDay(outputDir, dateAt(day), [
        { id: '215', name: 'Zero Visit A', exposure: 10, publicVisits: 0, dashboardVisits: day === 15 ? '异常' : 1, createdOrders: 0, amount: 0 },
        { id: '218', name: 'Zero Visit B', exposure: 30, publicVisits: 0, dashboardVisits: day === 15 ? '异常' : 1, createdOrders: 0, amount: 0 },
        { id: '242', name: 'Has Visits', exposure: 50, publicVisits: day, dashboardVisits: day === 15 ? '异常' : 1, createdOrders: 0, amount: day },
        { id: '243', name: 'Zero Visits With Amount', exposure: 20, publicVisits: 0, dashboardVisits: 1, createdOrders: 0, amount: day },
        { id: '244', name: 'Unavailable Amount', exposure: 20, publicVisits: 0, dashboardVisits: 1, createdOrders: 0, amount: day === 15 ? '异常' : 0 },
        { id: '301', name: 'Removed Zero', exposure: 20, publicVisits: 0, dashboardVisits: day === 15 ? '异常' : 1, createdOrders: 0, amount: 0 },
        ...(day === 15 ? [{ id: '300', name: 'Partial Zero', exposure: 100, publicVisits: 0, dashboardVisits: '异常', createdOrders: 0, amount: 0 }] : []),
      ]);
    }
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('finds active products with complete 15-day public visits equal to zero without requiring dashboard data', async () => {
    const result = await evaluateMetricThresholdStrategy(outputDir, registry, {
      metric: 'publicVisits', operator: 'eq', value: 0,
      date: '2026-07-15', windowDays: 15, requireActive: true, requireOnlineDays: 15,
    });

    expect(result.candidateProductIds).toEqual(['215', '218']);
    expect(result.skipped.unavailableMetric).toBe(0);
  });

  it('does not interpret missing dashboard created orders as zero', async () => {
    const result = await evaluateMetricThresholdStrategy(outputDir, registry, {
      metric: 'createdOrders', operator: 'eq', value: 0,
      date: '2026-07-15', windowDays: 15, requireActive: true, requireOnlineDays: 15,
    });

    expect(result.candidateProductIds).toEqual([]);
    expect(result.skipped.unavailableMetric).toBeGreaterThan(0);
    expect(result.reasonSummary.join('\n')).toContain('创建订单');
    expect(result.reasonSummary.join('\n')).toContain('访问页数据缺失');
    expect(result.reasonSummary.join('\n')).toContain('未将缺失值按0筛选');
  });

  it('requires every compound condition to be available and matched', async () => {
    const conditions = [
      { metric: 'publicVisits' as const, operator: 'eq' as const, value: 0 },
      { metric: 'amount' as const, operator: 'eq' as const, value: 0 },
    ];
    const result = await evaluateMetricThresholdStrategy(outputDir, compoundRegistry, {
      metric: conditions[0].metric, operator: conditions[0].operator, value: conditions[0].value,
      conditions,
      date: '2026-07-15', windowDays: 15, requireActive: true, requireOnlineDays: 15,
    });

    expect(result.candidateProductIds).toEqual(['215', '218']);
    expect(result.conditions).toEqual(conditions);
    expect(result.unavailableMetricProductIds).toEqual(['244']);
    expect(result.availability?.conditions).toEqual([
      { metric: 'publicVisits', unavailableMetricCount: 1, unavailableMetricProductIds: ['244'] },
      { metric: 'amount', unavailableMetricCount: 1, unavailableMetricProductIds: ['244'] },
    ]);
  });

  it('keeps public amount distinct from signed order amount', async () => {
    const publicAmount = await evaluateMetricThresholdStrategy(outputDir, registry, {
      metric: 'amount', operator: 'eq', value: 0, date: '2026-07-15', windowDays: 15,
    });
    const signedAmount = await evaluateMetricThresholdStrategy(outputDir, registry, {
      metric: 'signedOrderAmount', operator: 'eq', value: 0, date: '2026-07-15', windowDays: 15,
    });

    expect(publicAmount.metric).toBe('amount');
    expect(signedAmount.metric).toBe('signedOrderAmount');
    expect(signedAmount.reasonSummary.join('\n')).toContain('签约订单金额');
  });
});
