import { describe, expect, it } from 'vitest';
import { readCanonicalNumericId, readCanonicalNumericIdArray, readCanonicalOpaqueId } from '../src/feishuBot/idCanonicalization.js';

describe('id canonicalization', () => {
  it('canonicalizes safe numeric ids while preserving numeric strings', () => {
    expect(readCanonicalNumericId(1054)).toBe('1054');
    expect(readCanonicalNumericId('001054')).toBe('001054');
    expect(readCanonicalNumericId(' 1054 ')).toBe('1054');
  });

  it('rejects unsafe numeric ids and non-digit numeric strings', () => {
    expect(readCanonicalNumericId(0)).toBeNull();
    expect(readCanonicalNumericId('0')).toBeNull();
    expect(readCanonicalNumericId('000')).toBeNull();
    expect(readCanonicalNumericId(-1)).toBeNull();
    expect(readCanonicalNumericId(1.5)).toBeNull();
    expect(readCanonicalNumericId(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(readCanonicalNumericId('1e3')).toBeNull();
    expect(readCanonicalNumericId('+1054')).toBeNull();
    expect(readCanonicalNumericId('')).toBeNull();
    expect(readCanonicalNumericId(true)).toBeNull();
  });

  it('keeps opaque string ids but only canonicalizes safe numeric values', () => {
    expect(readCanonicalOpaqueId('kit')).toBe('kit');
    expect(readCanonicalOpaqueId(' handle ')).toBe('handle');
    expect(readCanonicalOpaqueId(5764)).toBe('5764');
    expect(readCanonicalOpaqueId(1.2)).toBeNull();
  });

  it('applies array limits before deduplication', () => {
    expect(readCanonicalNumericIdArray([1054, '1055', '001056', 1054], 4)).toEqual(['1054', '1055', '001056']);
    expect(readCanonicalNumericIdArray([1054, 1054, 1054], 2)).toBeNull();
    expect(readCanonicalNumericIdArray([1054, 1.5], 4)).toBeNull();
    expect(readCanonicalNumericIdArray([1054, '0'], 4)).toBeNull();
  });
});
