import { describe, expect, it } from 'vitest';
import {
  buildLinkRegistryMergeReviewApprovalResult,
  mergeLinkRegistryOverrides,
} from '../src/linkRegistry/mergeReviewApproval.js';
import type { LinkRegistryOverrides } from '../src/linkRegistry/overrides.js';

describe('linkRegistryMergeReviewApproval', () => {
  it('builds merge overrides from accepted rows', () => {
    const result = buildLinkRegistryMergeReviewApprovalResult('output/latest/link-registry-group-review/link-registry-merge-review-2026-06-26.csv', [
      {
        priority: 'P0',
        shortName: 'r50',
        suggestedTargetGroupId: 'canon-r50-a',
        candidateGroupId: 'canon-r50-a',
        activeLinkCount: '2',
        totalLinkCount: '2',
        internalProductIds: '1、2',
        productNames: '',
        decision: 'target',
        finalTargetGroupId: '',
        note: '',
      },
      {
        priority: 'P0',
        shortName: 'r50',
        suggestedTargetGroupId: 'canon-r50-a',
        candidateGroupId: 'canon-r50-b',
        activeLinkCount: '1',
        totalLinkCount: '1',
        internalProductIds: '3',
        productNames: '',
        decision: 'accept',
        finalTargetGroupId: '',
        note: '',
      },
    ]);

    expect(result.summary.appliedRows).toBe(1);
    expect(result.summary.anchorRows).toBe(1);
    expect(result.overrides.entries).toEqual([
      expect.objectContaining({
        internalProductId: '3',
        sameSkuGroupId: 'canon-r50-a',
      }),
    ]);
  });

  it('merges generated overrides into existing overrides', () => {
    const base: LinkRegistryOverrides = {
      version: 1,
      entries: [
        { internalProductId: '3', shortName: 'r50' },
        { internalProductId: '9', shortName: 'wide 300' },
      ],
      sameSkuGroupAliasRules: [
        { sameSkuGroupId: 'canon-r50-a', aliases: ['r50'] },
      ],
    };

    const merged = mergeLinkRegistryOverrides(base, {
      version: 1,
      entries: [
        { internalProductId: '3', sameSkuGroupId: 'canon-r50-a', reason: 'merge' },
      ],
    });

    expect(merged.entries).toEqual([
      expect.objectContaining({ internalProductId: '3', shortName: 'r50', sameSkuGroupId: 'canon-r50-a' }),
      expect.objectContaining({ internalProductId: '9', shortName: 'wide 300' }),
    ]);
    expect(merged.sameSkuGroupAliasRules).toHaveLength(1);
  });
});
