import { describe, expect, it } from 'vitest';
import { chooseBestPageSizeProbe, normalizePageSizeCandidates } from '../src/crawler/pageSizeProbe.js';

describe('chooseBestPageSizeProbe', () => {
  it('selects the highest successful candidate', () => {
    expect(
      chooseBestPageSizeProbe([
        { size: 100, ok: false, actualSize: null, rowCount: 0, error: 'closed' },
        { size: 50, ok: true, actualSize: 50, rowCount: 50 },
        { size: 20, ok: true, actualSize: 20, rowCount: 20 },
      ]),
    ).toMatchObject({ size: 50, ok: true });
  });
});

describe('normalizePageSizeCandidates', () => {
  it('puts preferred size first and appends safe fallbacks without duplicates', () => {
    expect(normalizePageSizeCandidates(50)).toEqual([50, 100, 20, 10]);
  });

  it('uses 100, 50, 20, 10 when preferred is already 100', () => {
    expect(normalizePageSizeCandidates(100)).toEqual([100, 50, 20, 10]);
  });
});
