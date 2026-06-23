import { describe, expect, it } from 'vitest';
import { buildClosedOrderObservationMarkdown, buildClosedOrderObservationReport } from '../src/closedOrderFeedback/observation.js';
import { createLinkRegistryQuery } from '../src/linkRegistry/queryRegistry.js';
import type { ClosedOrderIngestedRecord } from '../src/closedOrderFeedback/types.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const registryEntries: LinkRegistryEntry[] = [
  { internalProductId: '560', platformProductId: 'platform-560', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '561', platformProductId: 'platform-561', shortName: 'DJI Pocket 3 Creator', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '850', platformProductId: 'platform-850', shortName: 'Instax Wide 40', status: 'active', source: ['product_id_mapping'] },
];

describe('closed order observation', () => {
  it('aggregates ingested records into same-sku groups and manual-review signals', async () => {
    const records: ClosedOrderIngestedRecord[] = [
      {
        dedupeKey: 'close:1',
        closeId: '1',
        internalProductId: '560',
        rawRemark: '价格太低，不接单',
        closedAt: '2026-06-22T01:00:00.000Z',
        firstIngestedAt: '2026-06-22T01:05:00.000Z',
        lastIngestedAt: '2026-06-22T01:05:00.000Z',
        seenCount: 1,
      },
      {
        dedupeKey: 'close:2',
        closeId: '2',
        internalProductId: '561',
        rawRemark: '库存不足',
        closedAt: '2026-06-21T09:00:00.000Z',
        firstIngestedAt: '2026-06-21T09:10:00.000Z',
        lastIngestedAt: '2026-06-21T09:10:00.000Z',
        seenCount: 2,
      },
      {
        dedupeKey: 'close:3',
        closeId: '3',
        internalProductId: '999',
        rawRemark: '联系不上客户',
        closedAt: '2026-06-20T09:00:00.000Z',
        firstIngestedAt: '2026-06-20T09:10:00.000Z',
        lastIngestedAt: '2026-06-20T09:10:00.000Z',
        seenCount: 1,
      },
      {
        dedupeKey: 'close:stale',
        closeId: 'stale',
        internalProductId: '560',
        rawRemark: '过期数据',
        closedAt: '2026-06-10T09:00:00.000Z',
        firstIngestedAt: '2026-06-10T09:10:00.000Z',
        lastIngestedAt: '2026-06-10T09:10:00.000Z',
        seenCount: 1,
      },
    ];

    const report = await buildClosedOrderObservationReport(records, createLinkRegistryQuery(registryEntries), {
      reportDate: '2026-06-22',
      windowDays: 7,
      generatedAt: '2026-06-22T10:00:00.000Z',
    });

    expect(report.summary).toMatchObject({
      recordCount: 3,
      totalSeenCount: 4,
      todayRecordCount: 1,
      groupCount: 2,
      manualReviewGroupCount: 2,
      linkedRecordCount: 2,
      groupedRecordCount: 2,
    });
    expect(report.summary.reasonCounts).toMatchObject({
      pricing: 1,
      inventory: 1,
      service: 1,
    });
    expect(report.groups[0]).toMatchObject({
      groupKey: 'dji-pocket-3',
      displayLabel: 'DJI Pocket 3',
      sameSkuGroupId: 'dji-pocket-3',
      recordCount: 2,
      totalSeenCount: 3,
      topReason: 'pricing',
      needsManualReview: true,
    });
    expect(report.groups[0].manualReviewReasons).toEqual(expect.arrayContaining([
      'same_group_repeated_closed_orders',
      'pricing_signal',
      'inventory_signal',
    ]));
    expect(report.groups[1]).toMatchObject({
      groupKey: 'product:999',
      displayLabel: '商品 999',
      sameSkuGroupId: null,
      recordCount: 1,
      missingLinkRegistryCount: 1,
      missingSameSkuGroupCount: 1,
      lowConfidenceCount: 1,
      needsManualReview: true,
    });
    const markdown = buildClosedOrderObservationMarkdown(report);
    expect(markdown).toContain('关单观察 2026-06-22');
    expect(markdown).toContain('DJI Pocket 3');
    expect(markdown).toContain('同组重复关单');
    expect(markdown).toContain('价格:1');
  });
});
