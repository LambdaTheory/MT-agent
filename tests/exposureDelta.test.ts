import { describe, expect, it } from 'vitest';
import { computeExposureDailyDelta } from '../src/publicTraffic/exposureDelta.js';
import type { ExposureCumulativeProduct } from '../src/publicTraffic/types.js';

const oldRows: ExposureCumulativeProduct[] = [
  { productName: 'A', platformProductId: '1001', exposure: 100, visits: 10, amount: 20, custodyDays: 5, raw: {} },
  { productName: 'B', platformProductId: '1002', exposure: 50, visits: 5, amount: 0, custodyDays: 10, raw: {} },
  { productName: 'D', platformProductId: '1004', exposure: 25, visits: 2, amount: 1, custodyDays: 20, raw: {} },
];

const newRows: ExposureCumulativeProduct[] = [
  { productName: 'A', platformProductId: '1001', exposure: 130, visits: 14, amount: 35, custodyDays: 6, raw: {} },
  { productName: 'C', platformProductId: '1003', exposure: 8, visits: 1, amount: 0, custodyDays: 1, raw: {} },
  { productName: 'B', platformProductId: '1002', exposure: 40, visits: 4, amount: 0, custodyDays: 11, raw: {} },
];

describe('computeExposureDailyDelta', () => {
  it('computes deltas and flags new and reset rows', () => {
    expect(computeExposureDailyDelta('2026-06-09', oldRows, newRows)).toEqual([
      { date: '2026-06-09', productName: 'A', platformProductId: '1001', exposure: 30, visits: 4, amount: 15, custodyDays: 6, flags: [] },
      { date: '2026-06-09', productName: 'C', platformProductId: '1003', exposure: 8, visits: 1, amount: 0, custodyDays: 1, flags: ['new_product'] },
      { date: '2026-06-09', productName: 'B', platformProductId: '1002', exposure: 0, visits: 0, amount: 0, custodyDays: 11, flags: ['counter_reset_or_data_error'] },
      { date: '2026-06-09', productName: 'D', platformProductId: '1004', exposure: 0, visits: 0, amount: 0, custodyDays: 20, flags: ['missing'] },
    ]);
  });
});
