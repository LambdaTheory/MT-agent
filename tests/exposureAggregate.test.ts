import { describe, expect, it } from 'vitest';
import { aggregateExposureDeltas } from '../src/publicTraffic/exposureAggregate.js';

describe('aggregateExposureDeltas', () => {
  it('aggregates deltas by product id', () => {
    expect(
      aggregateExposureDeltas([
        { date: '2026-06-08', productName: 'A', platformProductId: '1001', exposure: 10, visits: 1, amount: 2, custodyDays: 5, flags: [] },
        { date: '2026-06-09', productName: 'A', platformProductId: '1001', exposure: 20, visits: 3, amount: 5, custodyDays: 6, flags: [] },
      ]),
    ).toEqual([
      {
        productName: 'A',
        platformProductId: '1001',
        exposure: 30,
        visits: 4,
        amount: 7,
        visitRate: 4 / 30,
        days: 2,
        flags: [],
      },
    ]);
  });

  it('preserves unique flags across product rows', () => {
    expect(
      aggregateExposureDeltas([
        { date: '2026-06-08', productName: 'B', platformProductId: '1002', exposure: 0, visits: 0, amount: 0, custodyDays: 10, flags: ['missing'] },
        { date: '2026-06-09', productName: 'B', platformProductId: '1002', exposure: 0, visits: 0, amount: 0, custodyDays: 11, flags: ['missing', 'counter_reset_or_data_error'] },
      ]),
    ).toEqual([
      {
        productName: 'B',
        platformProductId: '1002',
        exposure: 0,
        visits: 0,
        amount: 0,
        visitRate: 0,
        days: 2,
        flags: ['missing', 'counter_reset_or_data_error'],
      },
    ]);
  });
});
