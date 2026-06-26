import { describe, expect, it } from 'vitest';
import { buildLinkRegistryMergeReviewReport } from '../src/linkRegistry/mergeReview.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

describe('linkRegistryMergeReview', () => {
  it('builds merge candidates from duplicate short names', () => {
    const entries: LinkRegistryEntry[] = [
      { internalProductId: '1', sameSkuGroupId: 'canon-r50-a', shortName: 'r50', status: 'active', source: ['goods_first_seen'] },
      { internalProductId: '2', sameSkuGroupId: 'canon-r50-a', shortName: 'r50', status: 'active', source: ['goods_first_seen'] },
      { internalProductId: '3', sameSkuGroupId: 'canon-r50-b', shortName: 'r50', status: 'active', source: ['goods_first_seen'] },
      { internalProductId: '4', sameSkuGroupId: 'sony-zv1', shortName: 'zv-1', status: 'active', source: ['goods_first_seen'] },
      { internalProductId: '5', sameSkuGroupId: 'sony-zv1-b', shortName: 'zv-1', status: 'active', source: ['goods_first_seen'] },
    ];

    const report = buildLinkRegistryMergeReviewReport(entries, '2026-06-26T10:00:00.000Z');
    expect(report.summary.candidateBuckets).toBe(2);
    expect(report.candidates[0]?.shortName).toBe('r50');
    expect(report.candidates[0]?.suggestedTargetGroupId).toBe('canon-r50-a');
    expect(report.candidates[0]?.groups).toHaveLength(2);
  });
});
