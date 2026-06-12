import { describe, expect, it } from 'vitest';
import { extractProductIdFromInfo, resolveFallbackProductId } from '../src/publicTraffic/extractProductIdFromInfo.js';

describe('extractProductIdFromInfo', () => {
  it('extracts platform product ID from composite cell text', () => {
    expect(extractProductIdFromInfo('Apple iPhone 17 Pro Max 2026041022000711843522 已上架')).toBe('2026041022000711843522');
  });

  it('extracts ID from text with ID: prefix', () => {
    expect(extractProductIdFromInfo('DJI Pocket 3 (ID:2026052122000827682227)')).toBe('2026052122000827682227');
  });

  it('does not include the first price digit when ID is adjacent to a decimal price', () => {
    expect(extractProductIdFromInfo('预览佳能SX740HS 演唱会追星神器 站...ID：20251224220006868499757.50 ~ 76.00元/日出售中')).toBe('2025122422000686849975');
    expect(extractProductIdFromInfo('预览vivoX200Ultra增距镜 蔡司2.35倍长...ID：20260105220009902613425.16 ~ 60.00元/日出售中')).toBe('2026010522000990261342');
  });

  it('returns null when no product ID found', () => {
    expect(extractProductIdFromInfo('暂无数据')).toBeNull();
  });
});

describe('resolveFallbackProductId', () => {
  const mapping = {
    '2026030222000898839075': '251',
    '2026011222000691436531': '333',
  };

  it('accepts an exact mapping hit', () => {
    expect(resolveFallbackProductId('2026030222000898839075', mapping)).toBe('2026030222000898839075');
  });

  it('repairs a trailing price digit when the shortened ID exists in mapping', () => {
    expect(resolveFallbackProductId('20260302220008988390751', mapping)).toBe('2026030222000898839075');
  });

  it('rejects fallback IDs that do not match mapping exactly or after one trailing digit is removed', () => {
    expect(resolveFallbackProductId('202603022200089883907599', mapping)).toBeNull();
  });
});
