import { describe, expect, it } from 'vitest';
import { buildLinkRegistryAuditReviewApprovalResult } from '../src/linkRegistry/auditReviewApproval.js';
import type { LinkRegistryAuditReviewApprovalRow } from '../src/linkRegistry/auditReviewApproval.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

describe('linkRegistryAuditReviewApproval', () => {
  it('treats note-only removed decisions as status overrides', () => {
    const rows: LinkRegistryAuditReviewApprovalRow[] = [
      {
        reviewKey: 'entry:798',
        kind: 'entry',
        priority: 'P1',
        reviewReasons: '缺同款组 / 缺分类',
        internalProductId: '798',
        internalProductIds: '798',
        platformProductId: 'platform-798',
        sameSkuGroupId: '',
        originalProductName: '未抓到',
        productName: '',
        shortName: '',
        categoryName: '',
        productType: '',
        status: 'active',
        activeLinkCount: '1',
        totalLinkCount: '1',
        sampleSize: '0',
        confidence: '0.65',
        message: '',
        firstSeenDate: '2026-06-12',
        updatedAt: '2026-06-12',
        suggestedShortName: '',
        decision: '',
        finalSameSkuGroupId: '',
        finalCategoryName: '',
        finalProductType: '',
        finalShortName: '',
        note: '这个品已经不存在了',
      },
    ];
    const entries: LinkRegistryEntry[] = [
      {
        internalProductId: '798',
        platformProductId: 'platform-798',
        status: 'active',
        source: ['goods_first_seen'],
      },
    ];

    const result = buildLinkRegistryAuditReviewApprovalResult(
      'output/latest/link-registry-audit/link-registry-audit-review-approval-2026-06-26.md',
      rows,
      entries,
      '2026-06-26T10:00:00.000Z',
    );

    expect(result.summary.changedRows).toBe(1);
    expect(result.summary.appliedRows).toBe(1);
    expect(result.summary.skippedRows).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({
        reviewKey: 'entry:798',
        status: 'applied',
        finalStatus: 'removed',
      }),
    ]);
    expect(result.overrides.entries).toEqual([
      expect.objectContaining({
        internalProductId: '798',
        status: 'removed',
      }),
    ]);
  });
});
