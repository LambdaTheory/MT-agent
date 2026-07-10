import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregateWindowProducts, readWindowMetric } from '../src/agentData/windowAggregate.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

const baseMetric = {
  publicVisits: 0,
  dashboardVisits: 0,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  hasExposureData: true,
  hasDashboardData: true,
  createdOrderAmount: 0,
  signedOrderAmount: 0,
  reviewedOrderAmount: 0,
  shippedOrderAmount: 0,
  exposureVisitRate: 0,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
};

async function writeDay(root: string, date: string, rows: Array<{ id: string; name: string; exposure: number; amount: number; createdOrders?: number; signedOrders?: number; reviewedOrders?: number; shippedOrders?: number; dashboardVisits?: number | string; createdOrderAmount?: number; signedOrderAmount?: number; reviewedOrderAmount?: number; shippedOrderAmount?: number }>) {
  const dir = join(root, date);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `公域数据上下文_${date}.json`), JSON.stringify({
    date,
    summary: {},
    conclusions: [],
    dataQualityNotes: [],
    rows: rows.map((row) => ({
      productName: row.name,
      platformProductId: `p${row.id}`,
      displayProductId: `端内ID ${row.id}`,
      custodyDays: 10,
      periods: {
        '1d': {
          ...baseMetric,
          exposure: row.exposure,
          amount: row.amount,
          dashboardVisits: row.dashboardVisits ?? baseMetric.dashboardVisits,
          createdOrders: row.createdOrders ?? 0,
          signedOrders: row.signedOrders ?? 0,
          reviewedOrders: row.reviewedOrders ?? 0,
          shippedOrders: row.shippedOrders ?? 0,
          ...(row.createdOrderAmount !== undefined ? { createdOrderAmount: row.createdOrderAmount } : {}),
          ...(row.signedOrderAmount !== undefined ? { signedOrderAmount: row.signedOrderAmount } : {}),
          ...(row.reviewedOrderAmount !== undefined ? { reviewedOrderAmount: row.reviewedOrderAmount } : {}),
          ...(row.shippedOrderAmount !== undefined ? { shippedOrderAmount: row.shippedOrderAmount } : {}),
        },
        '30d': {
          ...baseMetric,
          exposure: 9999,
          amount: 9999,
          createdOrders: 9999,
          shippedOrders: 9999,
        },
      },
    })),
  }), 'utf8');
}

describe('aggregateWindowProducts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-window-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('aggregates arbitrary 20-day windows from daily 1d files instead of 30d summaries', async () => {
    await writeDay(dir, '2026-07-01', [{ id: '648', name: 'R50 A', exposure: 10, amount: 0, createdOrders: 1 }]);
    await writeDay(dir, '2026-07-02', [{ id: '648', name: 'R50 A', exposure: 20, amount: 100, shippedOrders: 2 }]);

    const result = await aggregateWindowProducts({ outputDir: dir, endDate: '2026-07-02', windowDays: 20 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      internalProductId: '648',
      platformProductId: 'p648',
      productName: 'R50 A',
      exposure: 30,
      amount: 100,
      createdOrders: 1,
      shippedOrders: 2,
      daysCovered: 2,
    });
    expect(result[0]?.missingDates).toHaveLength(18);
    expect(result[0]?.missingDates).toContain('2026-06-30');
  });

  it('tracks missing dates per product when a product is absent from an existing daily file', async () => {
    await writeDay(dir, '2026-07-01', [{ id: '648', name: 'R50 A', exposure: 10, amount: 0 }]);
    await writeDay(dir, '2026-07-02', [{ id: '649', name: 'R50 B', exposure: 5, amount: 50 }]);

    const result = await aggregateWindowProducts({ outputDir: dir, endDate: '2026-07-02', windowDays: 2 });

    expect(result.find((item) => item.internalProductId === '648')).toMatchObject({ daysCovered: 1, missingDates: ['2026-07-02'] });
    expect(result.find((item) => item.internalProductId === '649')).toMatchObject({ daysCovered: 1, missingDates: ['2026-07-01'] });
  });

  it('keeps row coverage separate from real dashboard coverage', async () => {
    await writeDay(dir, '2026-07-01', [{ id: '648', name: 'R50 A', exposure: 10, amount: 0, dashboardVisits: 1 }]);
    await writeDay(dir, '2026-07-02', [{ id: '648', name: 'R50 A', exposure: 20, amount: 0, dashboardVisits: '异常' }]);

    const result = await aggregateWindowProducts({ outputDir: dir, endDate: '2026-07-02', windowDays: 2 });

    expect(result[0]).toMatchObject({
      internalProductId: '648',
      daysCovered: 2,
      dashboardDaysCovered: 1,
      missingDashboardDates: ['2026-07-02'],
    });
  });

  it('aggregates every sum metric and derives weighted rates only from complete source windows', async () => {
    await writeDay(dir, '2026-07-01', [{
      id: '648', name: 'R50 A', exposure: 100, amount: 50,
      dashboardVisits: 20, createdOrders: 4, shippedOrders: 2,
      signedOrders: 3, reviewedOrders: 2,
    }]);
    await writeDay(dir, '2026-07-02', [{
      id: '648', name: 'R50 A', exposure: 300, amount: 100,
      dashboardVisits: 30, createdOrders: 6, shippedOrders: 3,
      signedOrders: 5, reviewedOrders: 4,
    }]);

    const [result] = await aggregateWindowProducts({ outputDir: dir, endDate: '2026-07-02', windowDays: 2 });

    expect(readWindowMetric(result!, 'exposure')).toBe(400);
    expect(readWindowMetric(result!, 'publicVisits')).toBe(0);
    expect(readWindowMetric(result!, 'signedOrders')).toBe(8);
    expect(readWindowMetric(result!, 'reviewedOrders')).toBe(6);
    expect(readWindowMetric(result!, 'exposureVisitRate')).toBe(0);
    expect(readWindowMetric(result!, 'visitCreatedOrderRate')).toBeCloseTo(10 / 50);
    expect(result!.availability.signedOrders).toMatchObject({ available: true, coveredDays: 2 });
  });

  it('does not make dashboard metrics available when one daily dashboard row is absent', async () => {
    await writeDay(dir, '2026-07-01', [{ id: '648', name: 'R50 A', exposure: 1, amount: 1, dashboardVisits: 3, createdOrders: 1 }]);
    await writeDay(dir, '2026-07-02', [{ id: '648', name: 'R50 A', exposure: 1, amount: 1, dashboardVisits: '异常' }]);

    const [result] = await aggregateWindowProducts({ outputDir: dir, endDate: '2026-07-02', windowDays: 2 });

    expect(result!.availability.publicVisits).toMatchObject({ available: true });
    expect(result!.availability.createdOrders).toMatchObject({ available: false, reason: 'missing_dashboard_data' });
    expect(readWindowMetric(result!, 'createdOrders')).toBeUndefined();
  });

  it('exposes stable product id metadata for follow-up planner steps', async () => {
    await writeDay(dir, '2026-07-01', [{ id: '648', name: 'R50 A', exposure: 10, amount: 0 }]);
    await writeDay(dir, '2026-07-02', [
      { id: '648', name: 'R50 A', exposure: 20, amount: 100 },
      { id: '649', name: 'R50 B', exposure: 5, amount: 50 },
    ]);

    const response = await executeAgentToolRequest({
      toolName: 'publicTraffic.windowAggregate',
      arguments: { endDate: '2026-07-02', windowDays: 2 },
      reason: 'test stable metadata',
    }, dir);

    expect(response.metadata).toMatchObject({
      status: 'partial',
      productIds: ['648', '649'],
      fullyCoveredProductIds: ['648'],
      partialCoveredProductIds: ['649'],
      missingDatesByProduct: { '649': ['2026-07-01'] },
    });
  });
});
