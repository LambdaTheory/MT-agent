import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregateWindowProducts } from '../src/agentData/windowAggregate.js';

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

async function writeDay(root: string, date: string, rows: Array<{ id: string; name: string; exposure: number; amount: number; createdOrders?: number; shippedOrders?: number }>) {
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
          createdOrders: row.createdOrders ?? 0,
          shippedOrders: row.shippedOrders ?? 0,
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
});
