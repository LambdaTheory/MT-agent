import { describe, expect, it } from 'vitest';
import { arbitrateListingState, listingStateToStatus, parseListingStateFromText } from '../src/linkRegistry/listingState.js';

describe('listing state helpers', () => {
  it('parses source status text into listing states', () => {
    expect(parseListingStateFromText('可售卖')).toBe('on_sale');
    expect(parseListingStateFromText('2026-07-04 10:00:00 上架 展示')).toBe('on_sale');
    expect(parseListingStateFromText('出售中')).toBe('on_sale');
    expect(parseListingStateFromText('已下架')).toBe('delisted');
    expect(parseListingStateFromText('停售')).toBe('delisted');
    expect(parseListingStateFromText('未同步')).toBe('unknown');
    expect(parseListingStateFromText('审核失败')).toBe('unknown');
    expect(parseListingStateFromText(undefined)).toBe('unknown');
  });

  it('maps listing states to the existing registry status enum', () => {
    expect(listingStateToStatus('on_sale')).toBe('active');
    expect(listingStateToStatus('delisted')).toBe('removed');
    expect(listingStateToStatus('gone')).toBe('removed');
    expect(listingStateToStatus('unknown')).toBe('unknown');
  });

  it('arbitrates explicit observations by trust order by default', () => {
    expect(arbitrateListingState([
      { source: 'goods_snapshot', state: 'on_sale', observedAt: '2026-07-04T10:00:00.000Z' },
      { source: 'daemon_catalog', state: 'delisted', observedAt: '2026-07-03T10:00:00.000Z' },
    ])).toEqual({ state: 'delisted', source: 'daemon_catalog', observedAt: '2026-07-03T10:00:00.000Z' });
  });

  it('allows a newer lower-trust observation to override beyond a deterministic freshness threshold', () => {
    expect(arbitrateListingState([
      { source: 'daemon_catalog', state: 'delisted', observedAt: '2026-07-01T00:00:00.000Z' },
      { source: 'goods_snapshot', state: 'on_sale', observedAt: '2026-07-04T01:00:00.000Z' },
    ], { freshnessOverrideMs: 24 * 60 * 60 * 1000 })).toEqual({
      state: 'on_sale',
      source: 'goods_snapshot',
      observedAt: '2026-07-04T01:00:00.000Z',
    });
  });

  it('does not infer delisted from missing or unknown observations', () => {
    expect(arbitrateListingState([])).toEqual({ state: 'unknown' });
    expect(arbitrateListingState([
      { source: 'daemon_catalog', state: 'unknown', observedAt: '2026-07-04T00:00:00.000Z' },
    ])).toEqual({ state: 'unknown', source: 'daemon_catalog', observedAt: '2026-07-04T00:00:00.000Z' });
  });
});
