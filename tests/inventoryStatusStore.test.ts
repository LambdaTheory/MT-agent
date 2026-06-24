import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readInventorySameSkuSnapshot, writeInventorySameSkuSnapshot } from '../src/inventoryStatus/store.js';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';

const snapshot: InventoryStatusSnapshot = {
  date: '2026-06-24',
  sourceReportDate: '2026-06-24',
  generatedAt: '2026-06-24T00:00:00.000Z',
  summary: {
    sameSkuGroupCount: 1,
    activeLinkCount: 2,
    totalLinkCount: 3,
  },
  coverage: {
    groupedLinkCount: 3,
    ungroupedLinkCount: 0,
    groupsWithMetrics: 1,
    groupsWithoutMetrics: 0,
  },
  registryAuditSummary: {
    totalLinks: 3,
    activeLinks: 2,
    removedLinks: 1,
    unknownLinks: 0,
    overrideRiskCount: 0,
  },
  groups: [
    {
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 2,
      totalLinkCount: 3,
      mappedRowCount: 2,
      missingMetricLinkCount: 1,
      periods: {
        '1d': {
          exposure: 300,
          publicVisits: 30,
          amount: 120,
          createdOrders: 3,
          signedOrders: 3,
          reviewedOrders: 3,
          shippedOrders: 2,
          createdOrderAmount: 140,
          signedOrderAmount: 125,
          reviewedOrderAmount: 120,
          shippedOrderAmount: 110,
          exposureVisitRate: 0.1,
          visitCreatedOrderRate: 0.1,
          visitShipmentRate: 2 / 30,
        },
        '7d': {
          exposure: 0,
          publicVisits: 0,
          amount: 0,
          createdOrders: 0,
          signedOrders: 0,
          reviewedOrders: 0,
          shippedOrders: 0,
          createdOrderAmount: 0,
          signedOrderAmount: 0,
          reviewedOrderAmount: 0,
          shippedOrderAmount: 0,
          exposureVisitRate: 0,
          visitCreatedOrderRate: 0,
          visitShipmentRate: 0,
        },
        '30d': {
          exposure: 0,
          publicVisits: 0,
          amount: 0,
          createdOrders: 0,
          signedOrders: 0,
          reviewedOrders: 0,
          shippedOrders: 0,
          createdOrderAmount: 0,
          signedOrderAmount: 0,
          reviewedOrderAmount: 0,
          shippedOrderAmount: 0,
          exposureVisitRate: 0,
          visitCreatedOrderRate: 0,
          visitShipmentRate: 0,
        },
      },
      topLinks: [
        {
          internalProductId: '702',
          platformProductId: 'platform-702',
          productName: 'DJI Pocket 3 创作者套装',
          shortName: 'Pocket 3',
          status: 'active',
          oneDayExposure: 200,
          oneDayPublicVisits: 20,
          oneDayAmount: 80,
        },
      ],
      risks: ['组内 1 条链接无日报数据'],
    },
  ],
};

describe('inventory same sku snapshot store', () => {
  it('writes and reloads the dated same sku snapshot artifact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-inventory-snapshot-'));
    const path = join(dir, '同款组经营快照_2026-06-24.json');
    try {
      await writeInventorySameSkuSnapshot(snapshot, path);
      const raw = await readFile(path, 'utf8');
      const loaded = await readInventorySameSkuSnapshot(path);

      expect(raw).toContain('"sameSkuGroupId": "dji-pocket-3"');
      expect(loaded?.groups[0]?.sameSkuGroupId).toBe('dji-pocket-3');
      expect(await readInventorySameSkuSnapshot(join(dir, 'missing.json'))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
