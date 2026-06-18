import { describe, expect, it, vi } from 'vitest';
import { buildClosedOrderConfidenceFeedback } from '../src/closedOrderFeedback/feedback.js';
import { createFakeClosedOrderFeedbackProvider } from '../src/closedOrderFeedback/fakeProvider.js';
import { createLinkRegistryQuery } from '../src/linkRegistry/queryRegistry.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

vi.mock('../src/llm/openAiCompatibleProvider.js', () => ({
  createOpenAiCompatibleProvider: vi.fn(() => {
    throw new Error('real LLM provider must not be called');
  }),
}));
vi.mock('../src/crawler/orderAnalysisCrawler.js', () => ({
  crawlOrderAnalysis: vi.fn(() => {
    throw new Error('real order crawler must not be called');
  }),
}));
vi.mock('../src/feishuBot/rentalPrice.js', () => ({
  buildRentalPriceCard: vi.fn(() => {
    throw new Error('real side-effect module must not be called');
  }),
}));

const registryEntries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', shortName: '佳能 SX70 A', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', shortName: '佳能 SX70 B', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '704', platformProductId: 'platform-704', shortName: '佳能 SX70 C', sameSkuGroupId: 'canon-sx70', status: 'removed', source: ['goods_link_lifecycle'] },
  { internalProductId: '705', platformProductId: 'platform-705', shortName: '索尼 ZV-1 A', sameSkuGroupId: 'sony-zv1', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '706', platformProductId: 'platform-706', shortName: '索尼 ZV-1 B', sameSkuGroupId: 'sony-zv1', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '707', platformProductId: 'platform-707', shortName: '未知分组商品', status: 'unknown', source: ['product_name_map'] },
];

describe('closed order feedback fake provider', () => {
  it('builds a confidence feedback object from fake provider samples and same sku lookup', async () => {
    const provider = createFakeClosedOrderFeedbackProvider();
    const input = await provider.getFeedback({ internalProductId: '701', rawRemark: '商家说价格太低，不接单' });
    const feedback = await buildClosedOrderConfidenceFeedback(input, createLinkRegistryQuery(registryEntries));

    expect(provider.calls).toHaveLength(1);
    expect(feedback).toMatchObject({
      internalProductId: '701',
      rawRemark: '商家说价格太低，不接单',
      inferredReason: 'pricing',
      reasonTags: ['pricing'],
      sameSkuGroupId: 'canon-sx70',
      sameSkuSampleSize: 3,
      sampleInsufficient: false,
      recommendedAction: 'manual_review_only',
    });
    expect(feedback.confidence).toBeGreaterThan(0.5);
    expect(feedback.dataCompleteness.missingFields).toEqual([]);
  });

  it('returns low-confidence manual review when internalProductId is missing from link registry', async () => {
    const feedback = await buildClosedOrderConfidenceFeedback(
      { closeId: 'close-missing', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '999', rawRemark: '价格不合适' },
      createLinkRegistryQuery(registryEntries),
    );

    expect(feedback.sameSkuGroupId).toBeNull();
    expect(feedback.sameSkuSampleSize).toBe(0);
    expect(feedback.sampleInsufficient).toBe(true);
    expect(feedback.confidence).toBe(0.05);
    expect(feedback.dataCompleteness.missingFields).toContain('linkRegistryEntry');
    expect(feedback.recommendedAction).toBe('manual_review_only');
  });

  it('downgrades confidence when same sku sample is insufficient', async () => {
    const feedback = await buildClosedOrderConfidenceFeedback(
      { closeId: 'close-low-sample', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '705', rawRemark: '规格不匹配' },
      createLinkRegistryQuery(registryEntries),
    );

    expect(feedback.sameSkuGroupId).toBe('sony-zv1');
    expect(feedback.sameSkuSampleSize).toBe(2);
    expect(feedback.sampleInsufficient).toBe(true);
    expect(feedback.confidence).toBeLessThanOrEqual(0.25);
    expect(feedback.recommendedAction).toBe('manual_review_only');
  });

  it('treats empty or noisy remarks as weak reason signals', async () => {
    const emptyRemark = await buildClosedOrderConfidenceFeedback(
      { closeId: 'close-empty', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '701', rawRemark: '   ' },
      createLinkRegistryQuery(registryEntries),
    );
    const noisyRemark = await buildClosedOrderConfidenceFeedback(
      { closeId: 'close-noise', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '701', rawRemark: '??? 123 abc' },
      createLinkRegistryQuery(registryEntries),
    );

    expect(emptyRemark.reasonTags).toEqual(['unclear']);
    expect(noisyRemark.reasonTags).toEqual(['irrelevant']);
    expect(emptyRemark.confidence).toBeLessThan(0.58);
    expect(noisyRemark.confidence).toBeLessThan(0.58);
    expect(emptyRemark.recommendedAction).toBe('manual_review_only');
    expect(noisyRemark.recommendedAction).toBe('manual_review_only');
  });

  it('allows missing closeId and closedAt but marks data completeness incomplete', async () => {
    const feedback = await buildClosedOrderConfidenceFeedback(
      { internalProductId: '701', rawRemark: '价格太低' },
      createLinkRegistryQuery(registryEntries),
    );

    expect(feedback.dataCompleteness).toMatchObject({
      hasCloseId: false,
      hasClosedAt: false,
      hasLinkRegistryEntry: true,
      hasSameSkuGroupId: true,
    });
    expect(feedback.dataCompleteness.missingFields).toEqual(['closeId', 'closedAt']);
    expect(feedback.confidence).toBeLessThan(0.58);
    expect(feedback.recommendedAction).toBe('manual_review_only');
  });

  it('uses manual_review_only for every feedback outcome', async () => {
    const query = createLinkRegistryQuery(registryEntries);
    const feedbackItems = await Promise.all([
      buildClosedOrderConfidenceFeedback({ closeId: 'close-1', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '701', rawRemark: '价格太低' }, query),
      buildClosedOrderConfidenceFeedback({ closeId: 'close-2', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '705', rawRemark: '规格不符' }, query),
      buildClosedOrderConfidenceFeedback({ internalProductId: '999', rawRemark: '' }, query),
      buildClosedOrderConfidenceFeedback({ closeId: 'close-3', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '707', rawRemark: '库存不足' }, query),
    ]);

    expect(feedbackItems.map((item) => item.recommendedAction)).toEqual([
      'manual_review_only',
      'manual_review_only',
      'manual_review_only',
      'manual_review_only',
    ]);
    expect(feedbackItems[3].dataCompleteness.missingFields).toContain('sameSkuGroupId');
  });

  it('does not import or call real external API, LLM, crawler, or side-effect modules', async () => {
    const provider = createFakeClosedOrderFeedbackProvider();
    const input = await provider.getFeedback({ closeId: 'close-local-only', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '701', rawRemark: '价格太低' });
    const feedback = await buildClosedOrderConfidenceFeedback(input, createLinkRegistryQuery(registryEntries));

    expect(feedback.recommendedAction).toBe('manual_review_only');
    expect(provider.calls).toEqual([{ closeId: 'close-local-only', closedAt: '2026-06-18T00:00:00.000Z', internalProductId: '701', rawRemark: '价格太低' }]);
  });
});
