import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWindowedProducts } from '../src/agentData/windowedFindings.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';

function context(date: string, exposure: number, amount: number) {
  const metric = {
    exposure,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
  };
  return {
    date,
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [{ productName: 'A 相机', platformProductId: 'p101', displayProductId: '端内ID 101', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [], weakClick: [], weakConversion: [], highPotential: [], newProductObservation: [], lifecycleGovernance: [], recommendedActions: [],
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
  };
}

describe('findWindowedProducts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-windowed-'));
    for (const [date, exposure, amount] of [['2026-07-01', 100, 0], ['2026-07-02', 50, 0], ['2026-07-03', 10, 20]] as const) {
      await mkdir(join(dir, date), { recursive: true });
      await writeFile(join(dir, date, 'report-context.json'), JSON.stringify(context(date, exposure, amount)), 'utf8');
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('aggregates products with exposure but no order amount across a lookback window', async () => {
    const result = await findWindowedProducts(dir, { lookbackDays: 3, predicate: 'exposure_without_orders', endDate: '2026-07-03' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ productId: '101', productName: 'A 相机', daysMatched: 2, exposure: 150, amount: 0 });
  });

  it('registers and dispatches publicTraffic.windowedFindings as a read tool', async () => {
    expect(findAgentTool('publicTraffic.windowedFindings')).toMatchObject({ risk: 'read', requiresConfirmation: false });

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.windowedFindings', arguments: { lookbackDays: 3, predicate: 'exposure_without_orders', endDate: '2026-07-03' }, reason: 'test' },
      dir,
    );

    expect(response.text).toContain('A 相机');
    expect(response.text).toContain('命中 2 天');
  });
});
