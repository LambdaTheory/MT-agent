import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readInventorySameSkuSnapshot, writeInventorySameSkuSnapshot } from '../src/inventoryStatus/store.js';
import {
  INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION,
  type InventoryStatusSnapshot,
} from '../src/inventoryStatus/types.js';

const createdDirs: string[] = [];

const periodMetricFields = [
  'exposure',
  'publicVisits',
  'amount',
  'createdOrders',
  'signedOrders',
  'reviewedOrders',
  'shippedOrders',
  'createdOrderAmount',
  'signedOrderAmount',
  'reviewedOrderAmount',
  'shippedOrderAmount',
  'exposureVisitRate',
  'visitCreatedOrderRate',
  'visitShipmentRate',
] as const;

const topLinkMetricFields = ['oneDayExposure', 'oneDayPublicVisits', 'oneDayAmount'] as const;

const snapshot: InventoryStatusSnapshot = {
  schemaVersion: INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION,
  generationId: 'inventory-status-2026-06-24T00-00-00-000Z',
  date: '2026-06-24',
  sourceReportDate: '2026-06-24',
  generatedAt: '2026-06-24T00:00:00.000Z',
  warnings: [],
  summary: {
    sameSkuGroupCount: 1,
    activeLinkCount: 2,
    totalLinkCount: 4,
  },
  coverage: {
    groupedLinkCount: 4,
    ungroupedLinkCount: 0,
    groupsWithMetrics: 1,
    groupsWithoutMetrics: 0,
  },
  registryAuditSummary: {
    totalLinks: 4,
    onSaleLinks: 2,
    delistedLinks: 1,
    goneLinks: 1,
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
      totalLinkCount: 4,
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
          exposureVisitRate: null,
          visitCreatedOrderRate: null,
          visitShipmentRate: null,
        },
        '30d': {
          exposure: null,
          publicVisits: null,
          amount: null,
          createdOrders: null,
          signedOrders: null,
          reviewedOrders: null,
          shippedOrders: null,
          createdOrderAmount: null,
          signedOrderAmount: null,
          reviewedOrderAmount: null,
          shippedOrderAmount: null,
          exposureVisitRate: null,
          visitCreatedOrderRate: null,
          visitShipmentRate: null,
        },
      },
      topLinks: [
        {
          internalProductId: '702',
          platformProductId: 'platform-702',
          productName: 'DJI Pocket 3 创作者套装',
          shortName: 'Pocket 3',
          listingState: 'on_sale',
          oneDayExposure: 200,
          oneDayPublicVisits: 20,
          oneDayAmount: 80,
        },
      ],
      risks: ['组内 1 条链接无日报数据'],
    },
  ],
};

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-inventory-snapshot-'));
  createdDirs.push(dir);
  return dir;
}

function copySnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) throw new Error(`${label} is not a record`);
  return value;
}

function firstGroup(value: Record<string, unknown>): Record<string, unknown> {
  const groups = value.groups;
  expect(Array.isArray(groups)).toBe(true);
  if (!Array.isArray(groups)) throw new Error('groups is not an array');
  return expectRecord(groups[0], 'first group');
}

function periods(value: Record<string, unknown>): Record<string, unknown> {
  const group = firstGroup(value);
  return expectRecord(group.periods, 'periods');
}

function firstPeriod(value: Record<string, unknown>): Record<string, unknown> {
  const oneDay = periods(value)['1d'];
  return expectRecord(oneDay, '1d period');
}

function firstTopLink(value: Record<string, unknown>): Record<string, unknown> {
  const topLinks = firstGroup(value).topLinks;
  expect(Array.isArray(topLinks)).toBe(true);
  if (!Array.isArray(topLinks)) throw new Error('topLinks is not an array');
  return expectRecord(topLinks[0], 'first top link');
}

async function writeRawAndRead(value: string | Record<string, unknown>): Promise<InventoryStatusSnapshot | null> {
  const dir = await makeTempDir();
  const path = join(dir, '同款组经营快照_2026-06-24.json');
  const raw = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, raw, 'utf8');
  return readInventorySameSkuSnapshot(path);
}

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('inventory same sku snapshot store', () => {
  it('writes and reloads the dated same sku snapshot artifact', async () => {
    const dir = await makeTempDir();
    const path = join(dir, '同款组经营快照_2026-06-24.json');

    await writeInventorySameSkuSnapshot(snapshot, path);

    const raw = await readFile(path, 'utf8');
    const loaded = await readInventorySameSkuSnapshot(path);
    const dirEntries = await readdir(dir);

    expect(loaded).toEqual(snapshot);
    expect(raw).toBe(`${JSON.stringify(snapshot, null, 2)}\n`);
    expect(raw.endsWith('\n')).toBe(true);
    expect(await readInventorySameSkuSnapshot(join(dir, 'missing.json'))).toBeNull();
    expect(dirEntries).toEqual(['同款组经营快照_2026-06-24.json']);
    expect(dirEntries.filter((entry) => entry.includes('inventory') && entry.includes('tmp'))).toEqual([]);
  });

  it.each(periodMetricFields)('returns null when negative metric is persisted in %s', async (field) => {
    const value = copySnapshot();
    firstPeriod(value)[field] = -1;
    await expect(writeRawAndRead(value)).resolves.toBeNull();
  });

  it.each(topLinkMetricFields)('returns null when first top-link %s is negative', async (field) => {
    const value = copySnapshot();
    firstTopLink(value)[field] = -1;
    await expect(writeRawAndRead(value)).resolves.toBeNull();
  });

  it.each([
    ['malformed/truncated JSON', () => '{"schemaVersion": 1,'],
    [
      'old snapshot missing schemaVersion',
      () => {
        const value = copySnapshot();
        delete value.schemaVersion;
        return value;
      },
    ],
    [
      'unsupported future schemaVersion',
      () => ({ ...copySnapshot(), schemaVersion: INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION + 1 }),
    ],
    [
      'missing generationId',
      () => {
        const value = copySnapshot();
        delete value.generationId;
        return value;
      },
    ],
    ['empty generationId', () => ({ ...copySnapshot(), generationId: '' })],
    ['wrong warnings type', () => ({ ...copySnapshot(), warnings: 'none' })],
    [
      'missing one required period key',
      () => {
        const value = copySnapshot();
        delete periods(value)['30d'];
        return value;
      },
    ],
    [
      'metric value with an invalid type',
      () => {
        const value = copySnapshot();
        firstPeriod(value).exposure = '300';
        return value;
      },
    ],
    [
      'invalid top-link listingState',
      () => {
        const value = copySnapshot();
        firstTopLink(value).listingState = 'active';
        return value;
      },
    ],
    [
      'invalid four-state registry audit structure',
      () => {
        const value = copySnapshot();
        value.registryAuditSummary = {
          totalLinks: 4,
          activeLinks: 2,
          removedLinks: 2,
          unknownLinks: 0,
          overrideRiskCount: 0,
        };
        return value;
      },
    ],
  ])('returns null for %s', async (_name, buildRaw) => {
    await expect(writeRawAndRead(buildRaw())).resolves.toBeNull();
  });
});
