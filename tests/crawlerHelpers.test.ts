import { describe, expect, it } from 'vitest';
import { shouldKeepBrowserOpenOnFailure } from '../src/crawler/failureHandling.js';
import { dedupeRowsByProductId, isCollectionComplete } from '../src/crawler/pagination.js';

describe('crawler helpers', () => {
  it('keeps the last row for duplicate product ids', () => {
    expect(
      dedupeRowsByProductId(['商品名称', '商品ID', '访问'], [
        ['商品A', '10001', '10'],
        ['商品A', '10001', '12'],
        ['商品B', '10002', '5'],
      ]),
    ).toEqual([
      ['商品A', '10001', '12'],
      ['商品B', '10002', '5'],
    ]);
  });

  it('uses displayed total when available', () => {
    expect(isCollectionComplete(86, 86, false)).toBe(true);
    expect(isCollectionComplete(85, 86, false)).toBe(false);
  });

  it('uses next-page disabled state when total is unavailable', () => {
    expect(isCollectionComplete(20, null, true)).toBe(true);
    expect(isCollectionComplete(20, null, false)).toBe(false);
  });

  it('keeps the browser open after crawler failures by default', () => {
    expect(shouldKeepBrowserOpenOnFailure(undefined)).toBe(true);
    expect(shouldKeepBrowserOpenOnFailure('0')).toBe(false);
    expect(shouldKeepBrowserOpenOnFailure('false')).toBe(false);
  });
});
