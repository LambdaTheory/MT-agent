import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLatestReportContext, formatLatestSummary, queryProductRows } from '../src/feishuBot/reportStore.js';

const period = {
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

const context = {
  date: '2026-06-11',
  summary: {
    '1d': { exposure: 1000, publicVisits: 50, dashboardVisits: 40, createdOrders: 3, shippedOrders: 1, amount: 88, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.075, visitShipmentRate: 0.025 },
    '7d': { exposure: 7000, publicVisits: 300, dashboardVisits: 280, createdOrders: 20, shippedOrders: 8, amount: 500, exposureVisitRate: 0.04, visitCreatedOrderRate: 0.071, visitShipmentRate: 0.028 },
    '30d': { exposure: 30000, publicVisits: 1000, dashboardVisits: 900, createdOrders: 60, shippedOrders: 20, amount: 2000, exposureVisitRate: 0.033, visitCreatedOrderRate: 0.066, visitShipmentRate: 0.022 },
  },
  conclusions: [],
  rows: [{ productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': period, '7d': period, '30d': period } }],
  lowExposure: [],
  weakClick: [],
  weakConversion: [],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: {},
};

describe('feishu bot report store', () => {
  it('finds latest report context by date directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-'));
    await mkdir(join(dir, '2026-06-10'), { recursive: true });
    await mkdir(join(dir, '2026-06-11'), { recursive: true });
    await writeFile(join(dir, '2026-06-10', 'report-context.json'), JSON.stringify({ ...context, date: '2026-06-10' }));
    await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify(context));
    const found = await findLatestReportContext(dir);
    expect(found?.context.date).toBe('2026-06-11');
  });

  it('finds latest 公域数据上下文 file by date directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-'));
    await mkdir(join(dir, '2026-06-12'), { recursive: true });
    await writeFile(join(dir, '2026-06-12', '公域数据上下文_2026-06-12.json'), JSON.stringify({ ...context, date: '2026-06-12' }));

    const found = await findLatestReportContext(dir);

    expect(found?.context.date).toBe('2026-06-12');
    expect(found?.path).toContain('公域数据上下文_2026-06-12.json');
  });

  it('formats latest summary', () => {
    expect(formatLatestSummary(context as any)).toContain('2026-06-11');
    expect(formatLatestSummary(context as any)).toContain('曝光 1000');
  });

  it('queries product rows by id or name', () => {
    expect(queryProductRows(context as any, '565')).toHaveLength(1);
    expect(queryProductRows(context as any, 'iPhone')).toHaveLength(1);
  });
});
