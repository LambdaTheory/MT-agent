import { describe, expect, it } from 'vitest';
import { buildLinkRegistry } from '../src/linkRegistry/buildRegistry.js';
import { parseLinkRegistryOverrides } from '../src/linkRegistry/overrides.js';
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

  it('propagates one group-level classification to all members of canon-eos-r50', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-06T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '1401', productName: '佳能 EOS R50 微单相机', discoveredAt: '2026-07-06T10:00:00.000Z' },
          { internalProductId: '1402', productName: '佳能 EOS R50 RF-S 18-45mm 套机', discoveredAt: '2026-07-06T10:00:00.000Z' },
        ],
      },
      productNameMap: {
        '1401': 'R50',
        '1402': 'R50',
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1401', sameSkuGroupId: 'canon-eos-r50', categoryId: 'camera', categoryName: '相机', productType: 'camera' }),
      expect.objectContaining({ internalProductId: '1402', sameSkuGroupId: 'canon-eos-r50', categoryId: 'camera', categoryName: '相机', productType: 'camera' }),
    ]));
  });

  it('propagates one group-level classification to all members of insta360-ace-pro-2', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-06T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '1411', productName: 'Insta360 Ace Pro 2 运动相机', discoveredAt: '2026-07-06T10:00:00.000Z' },
          { internalProductId: '1412', productName: '影石 Ace Pro 2 兔笼套餐', discoveredAt: '2026-07-06T10:00:00.000Z' },
        ],
      },
      productNameMap: {
        '1411': 'Ace Pro 2',
        '1412': 'Ace Pro 2',
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1411', sameSkuGroupId: 'insta360-ace-pro-2', categoryId: 'camera', categoryName: '运动相机', productType: 'action-camera' }),
      expect.objectContaining({ internalProductId: '1412', sameSkuGroupId: 'insta360-ace-pro-2', categoryId: 'camera', categoryName: '运动相机', productType: 'action-camera' }),
    ]));
  });

  it('propagates one group-level classification to all members of vivo-x300-pro', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-06T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '1421', productName: 'vivo X300 Pro 手机', discoveredAt: '2026-07-06T10:00:00.000Z' },
          { internalProductId: '1422', productName: 'vivo X300 Pro 蔡司影像旗舰', discoveredAt: '2026-07-06T10:00:00.000Z' },
        ],
      },
      productNameMap: {
        '1421': 'vivo X300 Pro',
        '1422': 'vivo X300 Pro',
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1421', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' }),
      expect.objectContaining({ internalProductId: '1422', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' }),
    ]));
  });

  it('normalizes the known mini90 promo-title product name to the canonical fujifilm-instax-mini-90 group id', () => {
    const registry = buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-06T10:00:00.000Z',
        count: 2,
        excludedCount: 0,
        entries: [
          { internalProductId: '1501', productName: '富士 instax mini90一次成像 婚礼聚会旅游立即出片 相纸可选', discoveredAt: '2026-07-06T10:00:00.000Z' },
          { internalProductId: '1502', productName: '富士 instax mini 90 一次成像相机 演唱会追星神器', discoveredAt: '2026-07-06T10:00:00.000Z' },
        ],
      },
    });

    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1501', sameSkuGroupId: 'fujifilm-instax-mini-90' }),
      expect.objectContaining({ internalProductId: '1502', sameSkuGroupId: 'fujifilm-instax-mini-90' }),
    ]));
    // Neither entry should carry the promo-title leak slug
    for (const entry of registry) {
      expect(entry.sameSkuGroupId ?? '').not.toContain('一次成像');
    }
  });

  it('parses overrides with the known mini90 promo-title sameSkuGroupId via canonical remap', () => {
    const promoSlug = 'fujifilm-instax-mini90一次成像-婚礼聚会旅游立即出片-相纸可选';
    // The parse step should normalize (remap) the known promo-title slug to the canonical form
    const parsed = parseLinkRegistryOverrides({
      version: 1,
      entries: [
        {
          internalProductId: '1601',
          sameSkuGroupId: promoSlug,
        },
      ],
    });
    expect(parsed.entries?.[0]?.sameSkuGroupId).toBe('fujifilm-instax-mini-90');
  });

  it('materializes platform freeze attribution for a delisted goods snapshot', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [{
        platformProductId: 'platform-1701',
        internalProductId: '1701',
        productName: '冻结商品',
        listingState: 'delisted',
        listingStatusText: '已下架',
        observedAt: '2026-07-14T10:00:00.000Z',
        platformRestriction: { kind: 'frozen', reasonText: '涉嫌违规冻结', observedAt: '2026-07-14T10:00:00.000Z' },
      }],
    })[0]).toMatchObject({
      listingState: 'delisted',
      delistCause: 'platform_frozen',
      delistCauseConfidence: 'confirmed',
      delistCauseEvidence: [{ source: 'goods_snapshot', reasonText: '涉嫌违规冻结', listingStatusText: '已下架' }],
    });
  });

  it('rejects an on-sale restriction from a snapshot when daemon later reports delisted', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [{
        platformProductId: 'platform-1705', internalProductId: '1705', productName: '旧限制商品',
        listingState: 'on_sale', listingStatusText: '出售中', observedAt: '2026-07-14T09:00:00.000Z',
        platformRestriction: { kind: 'review_rejected', reasonText: '历史审核原因', observedAt: '2026-07-14T09:00:00.000Z' },
      }],
      daemonCatalog: {
        generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
        entries: [{ internalProductId: '1705', productName: '旧限制商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
      },
    })[0]).toMatchObject({
      listingState: 'delisted',
      delistCause: 'external_manual_off_shelf_pending_confirmation',
    });
  });

  it('rejects a stale restriction when daemon later reports delisted', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [{
        platformProductId: 'platform-1706', internalProductId: '1706', productName: '过期限制商品',
        listingState: 'delisted', listingStatusText: '已下架', observedAt: '2026-07-14T10:00:00.000Z',
        platformRestriction: { kind: 'frozen', reasonText: '过期冻结', observedAt: '2026-07-12T09:00:00.000Z' },
      }],
      daemonCatalog: {
        generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
        entries: [{ internalProductId: '1706', productName: '过期限制商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
      },
    })[0]).toMatchObject({
      listingState: 'delisted',
      delistCause: 'external_manual_off_shelf_pending_confirmation',
    });
  });

  it('retains a current delisted restriction over a matching daemon observation', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [{
        platformProductId: 'platform-1707', internalProductId: '1707', productName: '当前冻结商品',
        listingState: 'delisted', listingStatusText: '已下架', observedAt: '2026-07-14T09:00:00.000Z',
        platformRestriction: { kind: 'frozen', reasonText: '当前冻结', observedAt: '2026-07-14T09:00:00.000Z' },
      }],
      daemonCatalog: {
        generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
        entries: [{ internalProductId: '1707', productName: '当前冻结商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
      },
    })[0]).toMatchObject({
      delistCause: 'platform_frozen',
      delistCauseConfidence: 'confirmed',
    });
  });

  it('suppresses platform and external attribution when requested', () => {
    const entry = buildLinkRegistry({
      suppressDelistAttribution: true,
      goodsSnapshot: [{
        platformProductId: 'platform-1708', internalProductId: '1708', productName: '受抑制商品',
        listingState: 'delisted', listingStatusText: '已下架', observedAt: '2026-07-14T10:00:00.000Z',
        platformRestriction: { kind: 'frozen', reasonText: '冻结', observedAt: '2026-07-14T10:00:00.000Z' },
      }],
    })[0];
    expect(entry).toMatchObject({ listingState: 'delisted' });
    expect(entry).not.toHaveProperty('delistCause');
  });

  it('uses verified agent delist only after a later delisted observation', () => {
    expect(buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
        entries: [{ internalProductId: '1702', productName: 'Agent下架商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
      },
      agentDelistEvents: [{ internalProductId: '1702', at: '2026-07-14T09:00:00.000Z', toolName: 'rental.delist', runId: 'run-1' }],
    })[0]).toMatchObject({
      delistCause: 'agent_confirmed_manual_off_shelf',
      delistCauseConfidence: 'confirmed',
    });
  });

  it('keeps on-sale priority and clears current delist attribution despite old restriction data', () => {
    expect(buildLinkRegistry({
      goodsSnapshot: [{
        platformProductId: 'platform-1703', internalProductId: '1703', productName: '已恢复商品',
        listingState: 'on_sale', listingStatusText: '出售中', observedAt: '2026-07-14T10:00:00.000Z',
        platformRestriction: { kind: 'review_rejected', reasonText: '旧审核原因', observedAt: '2026-07-13T10:00:00.000Z' },
      }],
    })[0]).not.toHaveProperty('delistCause');
  });

  it('uses external manual pending confirmation when a delisted link has no platform or agent evidence', () => {
    expect(buildLinkRegistry({
      daemonCatalog: {
        generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
        entries: [{ internalProductId: '1704', productName: '外部下架商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
      },
    })[0]).toMatchObject({
      delistCause: 'external_manual_off_shelf_pending_confirmation',
      delistCauseConfidence: 'suspected',
      delistCauseEvidence: [],
    });
  });
});
