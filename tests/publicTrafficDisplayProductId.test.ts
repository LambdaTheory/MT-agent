import { describe, expect, it } from 'vitest';
import { buildDisplayProductId } from '../src/publicTraffic/displayProductId.js';

describe('buildDisplayProductId', () => {
  it('uses internal product id when mapping exists', () => {
    expect(buildDisplayProductId('platform-1', { 'platform-1': '558' })).toBe('端内ID 558');
  });

  it('falls back to platform product id when mapping is missing', () => {
    expect(buildDisplayProductId('platform-2', { 'platform-1': '558' })).toBe('平台商品ID platform-2');
  });

  it('falls back when mapped value is empty', () => {
    expect(buildDisplayProductId('platform-3', { 'platform-3': '' })).toBe('平台商品ID platform-3');
  });
});
