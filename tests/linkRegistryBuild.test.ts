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
        productName: 'Old name',
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
        shortName: 'DJI Pocket3',
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
        sameSkuGroupId: 'dji-pocket-3',
        status: 'active',
        source: ['goods_link_lifecycle'],
      },
      {
        internalProductId: '531',
        platformProductId: 'platform-530-b',
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
        sameSkuGroupId: 'dji-pocket-3',
        status: 'unknown',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '561',
        platformProductId: 'platform-560-b',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'unknown',
        source: ['product_id_mapping'],
      },
    ]);
    expect(registry[0]?.aliases).toEqual(expect.arrayContaining(['DJI Pocket3 Creator']));
  });

  it('sorts registry entries by numeric internal id', () => {
    expect(buildLinkRegistry({
      productNameMap: { '10': 'Ten', '2': 'Two' },
    }).map((entry) => entry.internalProductId)).toEqual(['2', '10']);
  });
});
