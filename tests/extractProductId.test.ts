import { describe, expect, it } from 'vitest';
import { extractProductIdFromInfo } from '../src/publicTraffic/extractProductIdFromInfo.js';

describe('extractProductIdFromInfo', () => {
  it('extracts platform product ID from composite cell text', () => {
    expect(extractProductIdFromInfo('Apple iPhone 17 Pro Max 2026041022000711843522 已上架')).toBe('2026041022000711843522');
  });

  it('extracts ID from text with ID: prefix', () => {
    expect(extractProductIdFromInfo('DJI Pocket 3 (ID:2026052122000827682227)')).toBe('2026052122000827682227');
  });

  it('returns null when no product ID found', () => {
    expect(extractProductIdFromInfo('暂无数据')).toBeNull();
  });
});
