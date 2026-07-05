import { describe, expect, it } from 'vitest';
import { mergeGoodsSnapshotWithDaemon, parseDaemonCatalogSnapshot } from '../src/linkRegistry/daemonCatalog.js';

describe('daemonCatalog parsing', () => {
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
});
