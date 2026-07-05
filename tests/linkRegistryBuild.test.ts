import { describe, expect, it } from 'vitest';
import { buildLinkRegistry } from '../src/linkRegistry/buildRegistry.js';
import type { GoodsLinkLifecycleState } from '../src/publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../src/publicTraffic/goodsSnapshot.js';

describe('link registry build', () => {
  it('aggregates mapping, names, aliases, and lifecycle status', () => {
    const firstSeen: GoodsFirstSeenIndex = {
      '701': { firstSeenDate: '2026-06-10', platformProductId: 'platform-701-old', productName: 'Old name' },
    };
    const lifecycle: GoodsLinkLifecycleState = {
      active: {
        '701': { platformProductId: 'platform-701-live', productName: 'Live name' },
      },
      removedLinks: [],
    };

    expect(buildLinkRegistry({
      productIdMapping: { 'platform-701-map': '701' },
      productNameMap: { '701': 'Canon SX70' },
      firstSeen,
      lifecycle,
    })).toMatchObject([
      {
        internalProductId: '701',
        platformProductId: 'platform-701-map',
        productName: 'Live name',
        shortName: 'Canon SX70',
        sameSkuGroupId: 'canon-sx70',
        status: 'active',
        firstSeenDate: '2026-06-10',
        updatedAt: '2026-06-10',
        source: ['goods_first_seen', 'goods_link_lifecycle', 'product_id_mapping', 'product_name_map'],
      },
    ]);
  });

  it('marks lifecycle-only removed links and keeps the latest removal date', () => {
    const lifecycle: GoodsLinkLifecycleState = {
      active: {},
      removedLinks: [
        { productId: '701', platformProductId: 'platform-701-old', productName: 'Old', removedDate: '2026-06-10', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
        { productId: '701', platformProductId: 'platform-701-new', productName: 'New', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
      ],
    };

    expect(buildLinkRegistry({ lifecycle })).toMatchObject([
      {
        internalProductId: '701',
        platformProductId: 'platform-701-new',
        productName: 'New',
        status: 'removed',
        lastSeenDate: '2026-06-12',
        updatedAt: '2026-06-12',
        source: ['goods_link_lifecycle'],
      },
    ]);
  });

  it('keeps entries with no lifecycle as unknown and ignores invalid internal ids', () => {
    expect(buildLinkRegistry({
      productIdMapping: { 'platform-valid': '702', 'platform-invalid': 'abc' },
      productNameMap: { '702': 'DJI Pocket3', blank: 'Bad' },
    })).toMatchObject([
      {
        internalProductId: '702',
        platformProductId: 'platform-valid',
        shortName: 'Pocket 3',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'unknown',
        source: ['product_id_mapping', 'product_name_map'],
      },
    ]);
  });

  it('infers same sku groups from fallback product name hints when manual short names are absent', () => {
    const lifecycle: GoodsLinkLifecycleState = {
      active: {
        '530': { platformProductId: 'platform-530-a', productName: 'DJI Pocket3 Creator Combo' },
        '531': { platformProductId: 'platform-530-b', productName: 'DJI Pocket 3 Standard' },
      },
      removedLinks: [],
    };

    expect(buildLinkRegistry({ lifecycle })).toMatchObject([
      {
        internalProductId: '530',
        platformProductId: 'platform-530-a',
        shortName: 'Pocket 3',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'gimbal-camera',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'active',
        source: ['goods_link_lifecycle'],
      },
      {
        internalProductId: '531',
        platformProductId: 'platform-530-b',
        shortName: 'Pocket 3',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'gimbal-camera',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'active',
        source: ['goods_link_lifecycle'],
      },
    ]);
  });

  it('accepts artifact-derived product name hints as same sku grouping input', () => {
    const registry = buildLinkRegistry({
      productIdMapping: { 'platform-560-a': '560', 'platform-560-b': '561' },
      productNameHints: {
        '560': ['DJI Pocket3 Creator'],
        '561': ['DJI Pocket 3 Standard'],
      },
    });

    expect(registry).toMatchObject([
      {
        internalProductId: '560',
        platformProductId: 'platform-560-a',
        shortName: 'Pocket 3',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'gimbal-camera',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'unknown',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '561',
        platformProductId: 'platform-560-b',
        shortName: 'Pocket 3',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'gimbal-camera',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'unknown',
        source: ['product_id_mapping'],
      },
    ]);
    expect(registry[0]?.aliases).toEqual(expect.arrayContaining(['DJI Pocket3 Creator']));
  });

  it('infers short names and classifications from merged same sku groups', () => {
    const registry = buildLinkRegistry({
      lifecycle: {
        active: {
          '901': { platformProductId: 'platform-901', productName: '三星 Galaxy S23 Ultra 演唱会神器' },
          '902': { platformProductId: 'platform-902', productName: 'vivo 蔡司 2.35x增距镜演唱会神器' },
        },
        removedLinks: [],
      },
      productNameMap: {
        '901': 's23U',
        '902': 'vivo 蔡司增距镜',
      },
    });

    expect(registry).toMatchObject([
      {
        internalProductId: '901',
        shortName: 's23U',
        categoryId: 'phone',
        categoryName: '手机',
        productType: 'smartphone',
      },
      {
        internalProductId: '902',
        shortName: 'vivo 蔡司增距镜',
        categoryId: 'lens',
        categoryName: '镜头',
        productType: 'lens-accessory',
      },
    ]);
  });

  it('classifies common shorthand short names used in manual maintenance', () => {
    const registry = buildLinkRegistry({
      productNameMap: {
        '1001': 'x200 u',
        '1002': 'x300u',
        '1003': 'rx10m4',
        '1004': 'mini liplay',
        '1005': 'Osmo Nano',
      },
    });

    expect(registry).toMatchObject([
      { internalProductId: '1001', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' },
      { internalProductId: '1002', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' },
      { internalProductId: '1003', categoryId: 'camera', categoryName: '相机', productType: 'camera' },
      { internalProductId: '1004', categoryId: 'camera', categoryName: '相机', productType: 'instant-camera' },
      { internalProductId: '1005', categoryId: 'camera', categoryName: '相机', productType: 'camera' },
    ]);
  });

  it('sorts registry entries by numeric internal id', () => {
    expect(buildLinkRegistry({
      productNameMap: { '10': 'Ten', '2': 'Two' },
    }).map((entry) => entry.internalProductId)).toEqual(['2', '10']);
  });

  it('prefers daemon catalog names and keeps daemon status metadata after merging', () => {
    const registry = buildLinkRegistry({
      productIdMapping: {
        'platform-876': '876',
      },
      goodsSnapshot: [
        { platformProductId: 'platform-876', internalProductId: '876', productName: 'Old mapped name' },
      ],
      daemonCatalog: {
        generatedAt: '2026-06-27T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          {
            internalProductId: '876',
            productName: 'Ipod touch6 顺丰发货，1天起租',
            listingStatusText: '上架 展示',
            syncStatus: '未同步',
            channels: ['支付宝', '小程序'],
            tags: ['新品', '热租'],
            discoveredAt: '2026-06-27T10:00:00.000Z',
          },
          {
            internalProductId: '999',
            productName: 'Pocket 3 Creator Combo',
            listingStatusText: '上架 展示',
            syncStatus: '可售卖',
            discoveredAt: '2026-06-27T10:00:00.000Z',
          },
        ],
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        internalProductId: '876',
        platformProductId: 'platform-876',
        productName: 'Ipod touch6 顺丰发货，1天起租',
        status: 'unknown',
        listingState: 'unknown',
        statusSource: 'daemon_catalog',
        daemonStatusText: '上架 展示',
        daemonSyncStatus: '未同步',
        daemonChannels: ['小程序', '支付宝'],
        daemonTags: ['新品', '热租'],
        source: expect.arrayContaining(['product_id_mapping', 'goods_snapshot', 'daemon_catalog']),
      }),
      expect.objectContaining({
        internalProductId: '999',
        productName: 'Pocket 3 Creator Combo',
        status: 'active',
        listingState: 'on_sale',
        statusSource: 'daemon_catalog',
        source: ['daemon_catalog'],
      }),
    ]));
  });

  it('maps daemon delisted sync statuses to removed listing states', () => {
    expect(buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-04T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '701', productName: '下架商品', syncStatus: '已下架', discoveredAt: '2026-07-04T10:00:00.000Z' },
          { internalProductId: '702', productName: '停售商品', syncStatus: '停售', discoveredAt: '2026-07-04T10:00:00.000Z' },
        ],
      },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '701', status: 'removed', listingState: 'delisted', statusSource: 'daemon_catalog' }),
      expect.objectContaining({ internalProductId: '702', status: 'removed', listingState: 'delisted', statusSource: 'daemon_catalog' }),
    ]));
  });

  it('uses daemon listing status text when sync status is unknown but listing status is delisted', () => {
    expect(buildLinkRegistry({
      lifecycle: {
        active: {
          '703': { platformProductId: 'platform-703', productName: '生命周期仍活跃商品' },
        },
        removedLinks: [],
      },
      daemonCatalog: {
        generatedAt: '2026-07-04T10:00:00.000Z',
        count: 1,
        excludedCount: 0,
        entries: [
          { internalProductId: '703', productName: '生命周期仍活跃商品', syncStatus: '未同步', listingStatusText: '已下架', discoveredAt: '2026-07-04T10:00:00.000Z' },
        ],
      },
    })).toEqual([
      expect.objectContaining({
        internalProductId: '703',
        status: 'removed',
        listingState: 'delisted',
        statusSource: 'daemon_catalog',
      }),
    ]);
  });

  it('lets newer goods snapshot status override stale daemon status beyond freshness threshold', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [
        {
          platformProductId: 'platform-704',
          internalProductId: '704',
          productName: '重新上架商品',
          listingState: 'on_sale',
          listingStatusText: '出售中',
          observedAt: '2026-07-04T10:00:00.000Z',
        },
      ],
      daemonCatalog: {
        generatedAt: '2026-07-01T00:00:00.000Z',
        count: 1,
        excludedCount: 0,
        entries: [
          { internalProductId: '704', productName: '重新上架商品', syncStatus: '已下架', discoveredAt: '2026-07-01T00:00:00.000Z' },
        ],
      },
    })).toEqual([
      expect.objectContaining({
        internalProductId: '704',
        status: 'active',
        listingState: 'on_sale',
        statusSource: 'goods_snapshot',
        statusObservedAt: '2026-07-04T10:00:00.000Z',
      }),
    ]);
  });

  it('uses explicit exposure listing status as a low-trust registry observation', () => {
    expect(buildLinkRegistry({
      productIdMapping: {
        'platform-801': '801',
      },
      exposureCumulativeProducts: [
        {
          platformProductId: 'platform-801',
          productName: '曝光下架商品',
          exposure: 10,
          visits: 1,
          amount: 0,
          custodyDays: null,
          raw: { 商品状态: '已下架' },
        },
      ],
    })).toEqual([
      expect.objectContaining({
        internalProductId: '801',
        platformProductId: 'platform-801',
        productName: '曝光下架商品',
        status: 'removed',
        listingState: 'delisted',
        statusSource: 'exposure',
        source: expect.arrayContaining(['exposure']),
      }),
    ]);
  });

  it('prefers explicit exposure delisted status over weaker status-like columns', () => {
    expect(buildLinkRegistry({
      productIdMapping: {
        'platform-803': '803',
      },
      exposureCumulativeProducts: [
        {
          platformProductId: 'platform-803',
          productName: '多状态曝光商品',
          exposure: 10,
          visits: 1,
          amount: 0,
          custodyDays: null,
          raw: { 审核状态: '通过', 商品状态: '已下架' },
        },
      ],
    })).toEqual([
      expect.objectContaining({
        internalProductId: '803',
        status: 'removed',
        listingState: 'delisted',
        statusSource: 'exposure',
      }),
    ]);
  });

  it('does not infer delisted from exposure rows without explicit status text', () => {
    expect(buildLinkRegistry({
      productIdMapping: {
        'platform-802': '802',
      },
      exposureCumulativeProducts: [
        {
          platformProductId: 'platform-802',
          productName: '曝光无状态商品',
          exposure: 10,
          visits: 1,
          amount: 0,
          custodyDays: null,
          raw: { 商品信息: '曝光无状态商品' },
        },
      ],
    })).toEqual([
      expect.objectContaining({
        internalProductId: '802',
        platformProductId: 'platform-802',
        productName: '曝光无状态商品',
        status: 'unknown',
        listingState: 'unknown',
        source: expect.arrayContaining(['exposure']),
      }),
    ]);
  });

  it('normalizes bare daemon catalog model names into stable groups without manual overrides', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-06-27T10:00:00.000Z',
        count: 8,
        excludedCount: 0,
        entries: [
          { internalProductId: '1101', productName: 'ixus100is', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1102', productName: 'rf50f1.8', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1103', productName: 'rfs18-150', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1104', productName: 'mini link2', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1105', productName: 'mini se', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1106', productName: 'sq20', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1107', productName: 'action6', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1108', productName: 'AMIRO 彩虹光面罩ABM502', discoveredAt: '2026-06-27T10:00:00.000Z' },
        ],
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1101', shortName: 'IXUS 100IS', sameSkuGroupId: 'canon-ixus-100is', categoryId: 'camera', productType: 'camera' }),
      expect.objectContaining({ internalProductId: '1102', shortName: 'RF 50 F1.8', sameSkuGroupId: 'canon-rf-50-f1-8', categoryId: 'lens', productType: 'lens-accessory' }),
      expect.objectContaining({ internalProductId: '1103', shortName: 'RF-S 18-150', sameSkuGroupId: 'canon-rf-s-18-150', categoryId: 'lens', productType: 'lens-accessory' }),
      expect.objectContaining({ internalProductId: '1104', shortName: 'Mini Link 2', sameSkuGroupId: 'fujifilm-instax-mini-link-2', categoryId: 'camera', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1105', shortName: 'Mini SE', sameSkuGroupId: 'fujifilm-instax-mini-se', categoryId: 'camera', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1106', shortName: 'SQ20', sameSkuGroupId: 'fujifilm-instax-square-sq20', categoryId: 'camera', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1107', shortName: 'Action 6', sameSkuGroupId: 'dji-action-6', categoryId: 'camera', productType: 'action-camera' }),
      expect.objectContaining({ internalProductId: '1108', shortName: 'AMIRO ABM502', sameSkuGroupId: 'amiro-rainbow-light-mask-abm502', categoryId: 'beauty-device', productType: 'led-face-mask' }),
    ]));
  });

  it('prefers the inferred group short name when equivalent variants only differ by casing or marketing wrapper', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-06-27T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '1201', productName: '佳能 RF100-400mm 长焦镜头演唱会追星出游打鸟防抖高清体验租赁 ZFB', discoveredAt: '2026-06-27T10:00:00.000Z' },
          { internalProductId: '1202', productName: '富士 mini link3 手机照片打印机短租 旅游拍照神器', discoveredAt: '2026-06-27T10:00:00.000Z' },
        ],
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1201', shortName: 'RF 100-400', sameSkuGroupId: 'canon-rf-100-400' }),
      expect.objectContaining({ internalProductId: '1202', shortName: 'Mini Link 3', sameSkuGroupId: 'fujifilm-instax-mini-link-3' }),
    ]));
  });

  it('normalizes known misclassification edges for pocket, vivo lens, go3s, and g9', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-06-28T10:00:00.000Z',
        count: 4,
        excludedCount: 0,
        entries: [
          { internalProductId: '1301', productName: '99新大疆pocket3 手持云台相机 租物', discoveredAt: '2026-06-28T10:00:00.000Z' },
          { internalProductId: '1302', productName: 'vivoX200Ultra增距镜 蔡司2.35倍长焦演唱会追星 免押ZFB', discoveredAt: '2026-06-28T10:00:00.000Z' },
          { internalProductId: '1303', productName: '影石 Insta360 GO3S 拇指相机 4K 高清防抖', discoveredAt: '2026-06-28T10:00:00.000Z' },
          { internalProductId: '1304', productName: '佳能 G9 CCD 复古相机', discoveredAt: '2026-06-28T10:00:00.000Z' },
        ],
      },
      productNameMap: {
        '1302': 'vivo 蔡司增距镜',
        '1304': 'G9',
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1301', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera' }),
      expect.objectContaining({ internalProductId: '1302', categoryId: 'lens', categoryName: '镜头', productType: 'lens-accessory' }),
      expect.objectContaining({ internalProductId: '1303', categoryId: 'camera', categoryName: '运动相机', productType: 'action-camera' }),
      expect.objectContaining({ internalProductId: '1304', categoryId: 'camera', categoryName: '相机', productType: 'camera' }),
    ]));
  });
});
