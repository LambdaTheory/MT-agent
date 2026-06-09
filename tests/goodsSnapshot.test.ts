import { describe, expect, it } from 'vitest';
import { detectNewGoods, latestInternalIds } from '../src/publicTraffic/goodsSnapshot.js';

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
});
