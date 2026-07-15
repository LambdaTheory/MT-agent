import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveQueryFullListText } from '../src/feishuBot/queryFullListAction.js';

const metric = {
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

describe('query full-list card action', () => {
  it('resolves a controlled section reference to a complete text list', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-query-full-list-'));
    await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
    await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
      date: '2026-06-11',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: [
        { productName: '托管异常商品', platformProductId: 'platform-565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      ],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      custodyAbnormal: [{ identifier: '端内ID 565', action: '检查托管', reason: '托管异常', priority: 'high' }],
      recommendedActions: [],
      emptySectionNotes: {},
    }), 'utf8');

    const text = await resolveQueryFullListText(outputDir, '2026-06-11:custodyAbnormal');

    expect(text).toContain('托管异常完整清单 2026-06-11');
    expect(text).toContain('端内ID 565｜商品ID platform-565');
    expect(text).toContain('托管异常商品');
  });

  it('rejects uncontrolled query references', async () => {
    await expect(resolveQueryFullListText('output', '../secret:custodyAbnormal')).resolves.toContain('完整清单引用无效或已过期');
  });
});
