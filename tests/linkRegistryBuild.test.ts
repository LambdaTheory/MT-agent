import { describe, expect, it } from 'vitest';
import { buildLinkRegistry } from '../src/linkRegistry/buildRegistry.js';
import type { GoodsLinkLifecycleState } from '../src/publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../src/publicTraffic/goodsSnapshot.js';

describe('link registry build', () => {
  it('aggregates mapping, short names, first-seen dates, and lifecycle status', () => {
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
      productNameMap: { '701': '佳能 SX70' },
      firstSeen,
      lifecycle,
    })).toEqual([
      {
        internalProductId: '701',
        platformProductId: 'platform-701-map',
        shortName: '佳能 SX70',
        status: 'active',
        firstSeenDate: '2026-06-10',
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

    expect(buildLinkRegistry({ lifecycle })).toEqual([
      {
        internalProductId: '701',
        platformProductId: 'platform-701-new',
        status: 'removed',
        lastSeenDate: '2026-06-12',
        source: ['goods_link_lifecycle'],
      },
    ]);
  });

  it('keeps entries with no lifecycle as unknown and ignores invalid internal ids', () => {
    expect(buildLinkRegistry({
      productIdMapping: { 'platform-valid': '702', 'platform-invalid': 'abc' },
      productNameMap: { '702': '大疆 Pocket3', blank: 'Bad' },
    })).toEqual([
      {
        internalProductId: '702',
        platformProductId: 'platform-valid',
        shortName: '大疆 Pocket3',
        status: 'unknown',
        source: ['product_id_mapping', 'product_name_map'],
      },
    ]);
  });

  it('sorts registry entries by numeric internal id', () => {
    expect(buildLinkRegistry({
      productNameMap: { '10': 'Ten', '2': 'Two' },
    }).map((entry) => entry.internalProductId)).toEqual(['2', '10']);
  });
});
