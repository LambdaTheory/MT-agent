import { describe, expect, it } from 'vitest';
import { updateGoodsLinkLifecycle, type GoodsLinkLifecycleState } from '../src/publicTraffic/goodsLinkLifecycle.js';
import type { GoodsSnapshotItem } from '../src/publicTraffic/types.js';

const goods = (ids: string[]): GoodsSnapshotItem[] => ids.map((id) => ({
  internalProductId: id,
  platformProductId: `platform-${id}`,
  productName: `商品 ${id}`,
}));

describe('goods link lifecycle', () => {
  it('initializes baseline without removed links when previous state is missing', () => {
    const result = updateGoodsLinkLifecycle({ currentDate: '2026-06-12', previous: null, current: goods(['701', '702']) });

    expect(Object.keys(result.state.active).sort()).toEqual(['701', '702']);
    expect(result.removedLinks).toEqual([]);
  });

  it('records links that disappeared from the current goods snapshot', () => {
    const previous: GoodsLinkLifecycleState = {
      active: {
        '701': { platformProductId: 'platform-701', productName: '商品 701' },
        '702': { platformProductId: 'platform-702', productName: '商品 702' },
      },
      removedLinks: [],
    };

    const result = updateGoodsLinkLifecycle({ currentDate: '2026-06-12', previous, current: goods(['702']) });

    expect(result.removedLinks).toEqual([
      { productId: '701', platformProductId: 'platform-701', productName: '商品 701', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
    ]);
    expect(Object.keys(result.state.active)).toEqual(['702']);
  });

  it('suppresses newly removed links when refresh health requires lifecycle suppression', () => {
    const result = updateGoodsLinkLifecycle({
      currentDate: '2026-07-06',
      previous: {
        active: {
          '701': { platformProductId: 'p701', productName: '商品701' },
        },
        removedLinks: [],
      },
      current: [],
      suppressNewRemovals: true,
    });

    expect(result.removedLinks).toEqual([]);
    expect(result.state.removedLinks).toEqual([]);
    expect(result.state.active['701']).toEqual({ platformProductId: 'p701', productName: '商品701' });
  });

  it('preserves prior active baseline while merging current snapshot during lifecycle suppression', () => {
    const result = updateGoodsLinkLifecycle({
      currentDate: '2026-07-06',
      previous: {
        active: {
          '701': { platformProductId: 'p701-old', productName: '商品701旧' },
          '702': { platformProductId: 'p702', productName: '商品702' },
        },
        removedLinks: [],
      },
      current: goods(['701', '703']),
      suppressNewRemovals: true,
    });

    expect(result.removedLinks).toEqual([]);
    expect(result.state.active['701']).toEqual({ platformProductId: 'platform-701', productName: '商品 701' });
    expect(result.state.active['702']).toEqual({ platformProductId: 'p702', productName: '商品702' });
    expect(result.state.active['703']).toEqual({ platformProductId: 'platform-703', productName: '商品 703' });
  });

  it('keeps only removed links in the 7 day window and deduplicates by latest removal', () => {
    const previous: GoodsLinkLifecycleState = {
      active: {
        '701': { platformProductId: 'platform-701-new', productName: '商品 701 新' },
      },
      removedLinks: [
        { productId: '701', platformProductId: 'platform-701-old', productName: '商品 701 旧', removedDate: '2026-06-09', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
        { productId: '699', platformProductId: 'platform-699', productName: '商品 699', removedDate: '2026-06-04', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
      ],
    };

    const result = updateGoodsLinkLifecycle({ currentDate: '2026-06-12', previous, current: [] });

    expect(result.removedLinks).toEqual([
      { productId: '701', platformProductId: 'platform-701-new', productName: '商品 701 新', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
    ]);
  });

  it('keeps the latest existing removed link when duplicates are out of order', () => {
    const previous: GoodsLinkLifecycleState = {
      active: {},
      removedLinks: [
        { productId: '701', platformProductId: 'platform-701-new', productName: '商品 701 新', removedDate: '2026-06-11', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
        { productId: '701', platformProductId: 'platform-701-old', productName: '商品 701 旧', removedDate: '2026-06-09', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
      ],
    };

    const result = updateGoodsLinkLifecycle({ currentDate: '2026-06-12', previous, current: [] });

    expect(result.removedLinks).toEqual([
      { productId: '701', platformProductId: 'platform-701-new', productName: '商品 701 新', removedDate: '2026-06-11', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
    ]);
  });

  it('removes existing removed links when the product is active again', () => {
    const previous: GoodsLinkLifecycleState = {
      active: {},
      removedLinks: [
        { productId: '701', platformProductId: 'platform-701', productName: '商品 701', removedDate: '2026-06-11', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
      ],
    };

    const result = updateGoodsLinkLifecycle({ currentDate: '2026-06-12', previous, current: goods(['701']) });

    expect(result.removedLinks).toEqual([]);
    expect(Object.keys(result.state.active)).toEqual(['701']);
  });

  it('ignores invalid internal ids', () => {
    const previous: GoodsLinkLifecycleState = { active: {}, removedLinks: [] };
    const result = updateGoodsLinkLifecycle({
      currentDate: '2026-06-12',
      previous,
      current: [
        { internalProductId: 'abc', platformProductId: 'platform-abc', productName: 'bad' },
        { internalProductId: ' 703 ', platformProductId: 'platform-703', productName: '商品 703' },
      ],
    });

    expect(Object.keys(result.state.active)).toEqual(['703']);
  });
});
