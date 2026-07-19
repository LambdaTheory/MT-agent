import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readInventorySameSkuSnapshotHistory } from '../src/inventoryStatus/history.js';
import { writeInventorySameSkuSnapshot } from '../src/inventoryStatus/store.js';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

const period = {
  exposure: 1,
  publicVisits: 1,
  amount: 1,
  createdOrders: null,
  signedOrders: null,
  reviewedOrders: null,
  shippedOrders: null,
  createdOrderAmount: null,
  signedOrderAmount: null,
  reviewedOrderAmount: null,
  shippedOrderAmount: null,
  exposureVisitRate: 1,
  visitCreatedOrderRate: null,
  visitShipmentRate: null,
};

function snapshot(date: string): InventoryStatusSnapshot {
  return {
    schemaVersion: 1,
    generationId: `generation-${date}`,
    date,
    sourceReportDate: date,
    generatedAt: `${date}T00:00:00.000Z`,
    warnings: [],
    summary: { sameSkuGroupCount: 1, activeLinkCount: 1, totalLinkCount: 1 },
    coverage: { groupedLinkCount: 1, ungroupedLinkCount: 0, groupsWithMetrics: 1, groupsWithoutMetrics: 0 },
    registryAuditSummary: { totalLinks: 1, onSaleLinks: 1, delistedLinks: 0, goneLinks: 0, unknownLinks: 0, overrideRiskCount: 0 },
    groups: [{
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      activeLinkCount: 1,
      totalLinkCount: 1,
      mappedRowCount: 1,
      missingMetricLinkCount: 0,
      periods: { '1d': period, '7d': period, '30d': period },
      topLinks: [],
      risks: [],
    }],
  };
}

async function writeSnapshot(outputDir: string, date: string): Promise<void> {
  const paths = buildPublicTrafficPaths(outputDir, date);
  await mkdir(paths.dir, { recursive: true });
  await writeInventorySameSkuSnapshot(snapshot(date), paths.sameSkuSnapshot);
}

describe('readInventorySameSkuSnapshotHistory', () => {
  it('only reads recent history needed for the seven-day trend', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-inventory-history-'));
    await writeSnapshot(outputDir, '2026-04-01');
    await writeSnapshot(outputDir, '2026-06-10');
    await writeSnapshot(outputDir, '2026-07-18');

    const history = await readInventorySameSkuSnapshotHistory(outputDir, '2026-07-18');

    expect(history.map((item) => item.date)).toEqual(['2026-06-10', '2026-07-18']);
  });
});
