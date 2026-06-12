import { describe, expect, it } from 'vitest';
import { detectNewGoods, filterFirstSeenWithinDays, latestInternalIds, updateGoodsFirstSeen } from '../src/publicTraffic/goodsSnapshot.js';

describe('goods snapshot', () => {
  it('detects new internal product ids from snapshots', () => {
    expect(
      detectNewGoods(
        '2026-06-09',
        [{ platformProductId: 'p1', internalProductId: '100', productName: 'Old' }],
        [
          { platformProductId: 'p1', internalProductId: '100', productName: 'Old' },
          { platformProductId: 'p2', internalProductId: '105', productName: 'New' },
        ],
      ),
    ).toEqual([{ date: '2026-06-09', platformProductId: 'p2', internalProductId: '105', productName: 'New', source: 'goods_diff' }]);
  });

  it('ignores invalid internal ids and de-duplicates current snapshot rows', () => {
    expect(
      detectNewGoods(
        '2026-06-09',
        [
          { platformProductId: 'old-1', internalProductId: '100', productName: 'Old' },
          { platformProductId: 'old-2', internalProductId: '100', productName: 'Old Duplicate' },
        ],
        [
          { platformProductId: 'existing', internalProductId: '100', productName: 'Existing' },
          { platformProductId: 'blank', internalProductId: '   ', productName: 'Blank' },
          { platformProductId: 'partial', internalProductId: '123abc', productName: 'Partial' },
          { platformProductId: 'new-1', internalProductId: '105', productName: 'New' },
          { platformProductId: 'new-2', internalProductId: '105', productName: 'New Duplicate' },
        ],
      ),
    ).toEqual([{ date: '2026-06-09', platformProductId: 'new-1', internalProductId: '105', productName: 'New', source: 'goods_diff' }]);
  });

  it('finds largest internal ids as recent candidates', () => {
    expect(
      latestInternalIds([
        { platformProductId: 'p1', internalProductId: '100', productName: 'A' },
        { platformProductId: 'p2', internalProductId: '120', productName: 'B' },
        { platformProductId: 'p3', internalProductId: '110', productName: 'C' },
      ], 2),
    ).toEqual([
      { platformProductId: 'p2', internalProductId: '120', productName: 'B' },
      { platformProductId: 'p3', internalProductId: '110', productName: 'C' },
    ]);
  });

  it('filters invalid internal ids when selecting recent candidates', () => {
    expect(
      latestInternalIds([
        { platformProductId: 'p1', internalProductId: '100', productName: 'A' },
        { platformProductId: 'p2', internalProductId: '123abc', productName: 'Partial' },
        { platformProductId: 'p3', internalProductId: '   ', productName: 'Blank' },
        { platformProductId: 'p4', internalProductId: '090', productName: 'B' },
      ], 10),
    ).toEqual([
      { platformProductId: 'p1', internalProductId: '100', productName: 'A' },
      { platformProductId: 'p4', internalProductId: '090', productName: 'B' },
    ]);
  });

  it('returns no recent candidates when limit is not positive', () => {
    expect(
      latestInternalIds([
        { platformProductId: 'p1', internalProductId: '100', productName: 'A' },
      ], 0),
    ).toEqual([]);
  });

  it('preserves existing first-seen dates and records newly observed internal ids', () => {
    expect(updateGoodsFirstSeen({
      currentDate: '2026-06-12',
      previous: {
        '701': { firstSeenDate: '2026-06-09', platformProductId: 'p701', productName: 'Old Link' },
      },
      current: [
        { platformProductId: 'p701-new', internalProductId: '701', productName: 'Old Link Renamed' },
        { platformProductId: 'p702', internalProductId: '702', productName: 'New Link' },
        { platformProductId: 'invalid', internalProductId: 'abc', productName: 'Invalid' },
      ],
    })).toEqual({
      '701': { firstSeenDate: '2026-06-09', platformProductId: 'p701', productName: 'Old Link' },
      '702': { firstSeenDate: '2026-06-12', platformProductId: 'p702', productName: 'New Link' },
    });
  });

  it('filters current goods to internal ids first seen within the requested window', () => {
    const current = [
      { platformProductId: 'p701', internalProductId: '701', productName: 'Recent' },
      { platformProductId: 'p702', internalProductId: '702', productName: 'Old' },
      { platformProductId: 'p703', internalProductId: '703', productName: 'Missing First Seen' },
    ];

    expect(filterFirstSeenWithinDays(current, {
      '701': { firstSeenDate: '2026-06-06', platformProductId: 'p701', productName: 'Recent' },
      '702': { firstSeenDate: '2026-06-04', platformProductId: 'p702', productName: 'Old' },
    }, '2026-06-12', 7).map((item) => item.internalProductId)).toEqual(['701']);
  });
});
