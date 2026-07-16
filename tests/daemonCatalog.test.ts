import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDaemonCatalogSnapshot, mergeGoodsSnapshotWithDaemon, parseDaemonCatalogSnapshot } from '../src/linkRegistry/daemonCatalog.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('daemonCatalog parsing', () => {
  it('fetches catalog through stable daemon negotiation and sibling data-root files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-catalog-'));
    const rootName = rootDir.split(/[\\/]/).at(-1);
    if (!rootName) throw new Error('temporary root missing basename');
    const stableDataRoot = join(tmpdir(), `.${rootName}-data`);
    await mkdir(join(stableDataRoot, 'daemon'), { recursive: true });
    await writeFile(join(stableDataRoot, 'daemon', 'daemon.port'), '9555\n', 'utf8');
    await writeFile(join(stableDataRoot, 'daemon', 'daemon.token'), 'stable-token\n', 'utf8');

    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.action === 'hello') {
        return new Response(JSON.stringify({
          status: 'ok',
          manifest: {
            skillVersion: '1.0.0',
            daemonVersion: '1.0.0',
            daemonProtocolVersion: '1.0.0',
            configSchemaVersion: '1.0.0',
            stateSchemaVersion: '1.0.0',
            instanceId: 'stable-catalog',
            persistedStateDigest: 'b'.repeat(64),
            persistedStateReady: true,
          },
        }));
      }
      return new Response(JSON.stringify({
        status: 'ok',
        products: [{ id: '929', name: '索尼RX10M4长焦相机', cells: ['929', '0', '索尼RX10M4长焦相机', '¥29.37', '¥13800.00', '70'] }],
        excludedCount: 1,
        pagesScraped: 2,
      }));
    }));

    try {
      const snapshot = await fetchDaemonCatalogSnapshot({ rootDir });

      expect(bodies.map((body) => body.action)).toEqual(['hello', 'platform-search']);
      expect(bodies[1]).toMatchObject({ keyword: '', _negotiation: { expectedInstanceId: 'stable-catalog', expectedStateDigest: 'b'.repeat(64), actionClass: 'safe-read' } });
      expect(snapshot).toMatchObject({ count: 1, excludedCount: 1, pagesScraped: 2, entries: [{ internalProductId: '929', productName: '索尼RX10M4长焦相机' }] });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      await rm(stableDataRoot, { recursive: true, force: true });
    }
  });

  it('parses platform rows with explicit sync status', () => {
    const snapshot = parseDaemonCatalogSnapshot({
      generatedAt: '2026-06-27T08:00:00.000Z',
      count: 1,
      excludedCount: 0,
      entries: [{
        id: '929',
        name: '索尼RX10M4长焦相机 1天起租 安心保障',
        text: '929 | 0 | 索尼RX10M4长焦相机 1天起租 安心保障 | ¥29.37 ~ ¥430.00 | ¥13800.00 ~ ¥13800.00 | 70 | 0 | 2026-06-25 11:33:06 上架 展示 | 新品 热租 推荐 精选 | 支付宝小程序，APP，微信小程序，H5网页，抖音小程序，快手小程序 | 可售卖',
        cells: [
          '929',
          '0',
          '索尼RX10M4长焦相机 1天起租 安心保障',
          '¥29.37 ~ ¥430.00',
          '¥13800.00 ~ ¥13800.00',
          '70',
          '0',
          '2026-06-25 11:33:06 上架 展示',
          '新品 热租 推荐 精选',
          '支付宝小程序，APP，微信小程序，H5网页，抖音小程序，快手小程序',
          '可售卖',
        ],
      }],
    });

    expect(snapshot.entries[0]).toMatchObject({
      internalProductId: '929',
      listingStatusText: '2026-06-25 11:33:06 上架 展示',
      syncStatus: '可售卖',
      channels: ['支付宝小程序', 'APP', '微信小程序', 'H5网页', '抖音小程序', '快手小程序'],
      tags: ['新品', '热租', '推荐', '精选'],
      stockText: '70',
    });
  });

  it('parses platform rows without a sync-status cell and keeps channels/tags aligned', () => {
    const snapshot = parseDaemonCatalogSnapshot({
      generatedAt: '2026-06-27T08:00:00.000Z',
      count: 1,
      excludedCount: 0,
      entries: [{
        id: '764',
        name: 'SEAYEO大排灯美容仪经典款 光子嫩肤面罩',
        text: '764 | 0 | SEAYEO大排灯美容仪经典款 光子嫩肤面罩 | ¥2.87 ~ ¥33.00 | ¥2600.00 ~ ¥2600.00 | 100 | 0 | 2026-06-09 11:44:41 上架 展示 | 新品 热租 推荐 精选 | 支付宝小程序，APP，微信小程序，H5网页，抖音小程序，快手小程序',
        cells: [
          '764',
          '0',
          'SEAYEO大排灯美容仪经典款 光子嫩肤面罩',
          '¥2.87 ~ ¥33.00',
          '¥2600.00 ~ ¥2600.00',
          '100',
          '0',
          '2026-06-09 11:44:41 上架 展示',
          '新品 热租 推荐 精选',
          '支付宝小程序，APP，微信小程序，H5网页，抖音小程序，快手小程序',
        ],
      }],
    });

    expect(snapshot.entries[0]).toMatchObject({
      internalProductId: '764',
      listingStatusText: '2026-06-09 11:44:41 上架 展示',
      channels: ['支付宝小程序', 'APP', '微信小程序', 'H5网页', '抖音小程序', '快手小程序'],
      tags: ['新品', '热租', '推荐', '精选'],
      stockText: '100',
    });
    expect(snapshot.entries[0]).not.toHaveProperty('syncStatus');
  });
});

describe('mergeGoodsSnapshotWithDaemon', () => {
  it('preserves goods listing status fields while applying daemon names', () => {
    expect(mergeGoodsSnapshotWithDaemon([
      {
        platformProductId: 'platform-701',
        internalProductId: '701',
        productName: '旧名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
      },
    ], [
      {
        internalProductId: '701',
        productName: 'daemon 名称',
        discoveredAt: '2026-07-04T00:00:00.000Z',
      },
    ])).toEqual([
      {
        platformProductId: 'platform-701',
        internalProductId: '701',
        productName: 'daemon 名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
      },
    ]);
  });

  it('preserves platform restrictions while applying daemon names', () => {
    expect(mergeGoodsSnapshotWithDaemon([
      {
        platformProductId: 'platform-701',
        internalProductId: '701',
        productName: '旧名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
        platformRestriction: { kind: 'review_rejected', reasonText: '资质审核不通过', observedAt: '2026-07-14' },
      },
      {
        platformProductId: 'platform-702',
        internalProductId: '702',
        productName: '仅商品总表名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
        platformRestriction: { kind: 'frozen', reasonText: '涉嫌违规冻结' },
      },
    ], [
      {
        internalProductId: '701',
        productName: 'daemon 名称',
        discoveredAt: '2026-07-04T00:00:00.000Z',
      },
    ])).toEqual([
      {
        platformProductId: 'platform-701',
        internalProductId: '701',
        productName: 'daemon 名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
        platformRestriction: { kind: 'review_rejected', reasonText: '资质审核不通过', observedAt: '2026-07-14' },
      },
      {
        platformProductId: 'platform-702',
        internalProductId: '702',
        productName: '仅商品总表名称',
        listingState: 'delisted',
        listingStatusText: '已下架',
        platformRestriction: { kind: 'frozen', reasonText: '涉嫌违规冻结' },
      },
    ]);
  });
});
