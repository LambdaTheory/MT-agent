import { describe, expect, it } from 'vitest';
import { parsePreviousCumulativeSnapshot } from '../src/cli/publicTrafficReport.js';

describe('parsePreviousCumulativeSnapshot', () => {
  it('rejects valid JSON that is not an exposure cumulative product array', () => {
    expect(() => parsePreviousCumulativeSnapshot('[{"foo":1}]')).toThrow(/Invalid previous exposure snapshot/);
  });

  it('accepts exposure cumulative products', () => {
    expect(
      parsePreviousCumulativeSnapshot(
        JSON.stringify([
          {
            productName: '商品A',
            platformProductId: '20260603220003308013234',
            exposure: 10,
            visits: 2,
            amount: 1.5,
            custodyDays: null,
            raw: { 商品信息: '商品A' },
          },
        ]),
      ),
    ).toHaveLength(1);
  });
});
