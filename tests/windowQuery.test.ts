import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryPublicTrafficWindow } from '../src/agentData/windowQuery.js';

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
}

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
      custodyDays: 20,
      periods: {
        '1d': {
          ...baseMetric,
          exposure: row.exposure ?? baseMetric.exposure,
          publicVisits: row.publicVisits ?? baseMetric.publicVisits,
          dashboardVisits: row.dashboardVisits ?? baseMetric.dashboardVisits,
          createdOrders: row.createdOrders ?? baseMetric.createdOrders,
        },
      },
    })),
  }), 'utf8');
}

function dateAt(day: number): string {
  return `2026-07-${String(day).padStart(2, '0')}`;
}

describe('queryPublicTrafficWindow', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-window-query-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds only fully covered products whose 15-day public visits equal zero', async () => {
    for (let day = 1; day <= 15; day += 1) {
      await writeDay(dir, dateAt(day), [
        { id: '215', name: 'Zero Visit A', exposure: 10, publicVisits: 0 },
        { id: '218', name: 'Zero Visit B', exposure: 30, publicVisits: 0 },
        { id: '242', name: 'Has Visits', exposure: 50, publicVisits: day },
        ...(day === 15 ? [{ id: '300', name: 'Partial Zero', exposure: 100, publicVisits: 0 }] : []),
      ]);
    }

    const result = await queryPublicTrafficWindow(dir, {
      endDate: '2026-07-15',
      windowDays: 15,
      metrics: ['publicVisits', 'exposure'],
      filters: [{ field: 'publicVisits', operator: 'eq', value: 0 }],
      sortBy: 'exposure',
      sortDirection: 'desc',
    });

    expect(result.items.map((item) => item.internalProductId)).toEqual(['218', '215']);
    expect(result.items.every((item) => item.availability.publicVisits?.available)).toBe(true);
    expect(result.items.some((item) => item.internalProductId === '242')).toBe(false);
    expect(result.items.some((item) => item.internalProductId === '300')).toBe(false);
  });

  it('rejects a created-order filter when dashboard coverage is incomplete rather than treating it as zero', async () => {
    for (let day = 1; day <= 15; day += 1) {
      await writeDay(dir, dateAt(day), [
        { id: '215', name: 'Dashboard Missing', exposure: 10, publicVisits: 0, dashboardVisits: day === 15 ? '异常' : 1, createdOrders: 0 },
      ]);
    }

    await expect(queryPublicTrafficWindow(dir, {
      endDate: '2026-07-15',
      windowDays: 15,
      filters: [{ field: 'createdOrders', operator: 'eq', value: 0 }],
    })).rejects.toThrow('创建订单数在近15天窗口内不可用');
  });

  it('rejects unsupported window lengths before reading daily files', async () => {
    await expect(queryPublicTrafficWindow(dir, { windowDays: 91 })).rejects.toThrow('windowDays must be between 1 and 90');
  });
});
