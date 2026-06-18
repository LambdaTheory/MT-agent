import type { LinkRegistryQuery } from '../linkRegistry/queryRegistry.js';
import type { ClosedOrderConfidenceFeedback, ClosedOrderDataCompleteness, ClosedOrderFeedbackInput, ClosedOrderReasonTag } from './types.js';

const REVIEW_ONLY_ACTION = 'manual_review_only' as const;

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function inferClosedOrderReasonTags(rawRemark: string): ClosedOrderReasonTag[] {
  const remark = rawRemark.trim();
  if (!remark) return ['unclear'];

  const tags: ClosedOrderReasonTag[] = [];
  if (/价格|价低|价高|涨价|降价|太低|太高/.test(remark)) tags.push('pricing');
  if (/规格|套餐|租期|型号|配置/.test(remark)) tags.push('spec');
  if (/库存|缺货|无货|没货/.test(remark)) tags.push('inventory');
  if (/服务|态度|沟通|客服/.test(remark)) tags.push('service');
  if (/物流|快递|配送|发货/.test(remark)) tags.push('logistics');

  if (tags.length > 0) return tags;
  if (/^[\s\p{P}\p{S}a-zA-Z0-9]+$/u.test(remark)) return ['irrelevant'];
  return ['unclear'];
}

function buildDataCompleteness(input: ClosedOrderFeedbackInput, hasLinkRegistryEntry: boolean, hasSameSkuGroupId: boolean): ClosedOrderDataCompleteness {
  const missingFields: string[] = [];
  if (!hasText(input.closeId)) missingFields.push('closeId');
  if (!hasText(input.closedAt)) missingFields.push('closedAt');
  if (!hasLinkRegistryEntry) missingFields.push('linkRegistryEntry');
  if (!hasSameSkuGroupId) missingFields.push('sameSkuGroupId');

  return {
    hasCloseId: hasText(input.closeId),
    hasClosedAt: hasText(input.closedAt),
    hasLinkRegistryEntry,
    hasSameSkuGroupId,
    missingFields,
  };
}

function calculateConfidence(reasonTags: ClosedOrderReasonTag[], dataCompleteness: ClosedOrderDataCompleteness, sampleInsufficient: boolean, sameSkuSampleSize: number): number {
  if (!dataCompleteness.hasLinkRegistryEntry) return 0.05;
  if (!dataCompleteness.hasSameSkuGroupId) return 0.1;

  let score = sameSkuSampleSize >= 3 ? 0.5 : 0.2;
  if (reasonTags.some((tag) => tag !== 'unclear' && tag !== 'irrelevant')) score += 0.08;
  if (!dataCompleteness.hasCloseId) score -= 0.05;
  if (!dataCompleteness.hasClosedAt) score -= 0.05;
  if (sampleInsufficient) score = Math.min(score, 0.25);

  return Math.max(0.05, Math.min(0.58, Number(score.toFixed(2))));
}

export async function buildClosedOrderConfidenceFeedback(input: ClosedOrderFeedbackInput, linkRegistry: LinkRegistryQuery): Promise<ClosedOrderConfidenceFeedback> {
  const internalProductId = input.internalProductId.trim();
  const rawRemark = input.rawRemark;
  const reasonTags = inferClosedOrderReasonTags(rawRemark);
  const linkEntry = linkRegistry.byInternalId(internalProductId);
  const sameSkuGroupId = linkEntry?.sameSkuGroupId?.trim() || null;
  const sameSkuGroup = sameSkuGroupId ? linkRegistry.bySameSkuGroup(sameSkuGroupId) : null;
  const sameSkuSampleSize = sameSkuGroup?.sampleSize ?? 0;
  const sampleInsufficient = sameSkuGroup?.sampleInsufficient ?? true;
  const dataCompleteness = buildDataCompleteness(input, Boolean(linkEntry), Boolean(sameSkuGroupId));

  return {
    internalProductId,
    rawRemark,
    closeId: input.closeId,
    closedAt: input.closedAt,
    inferredReason: reasonTags[0],
    reasonTags,
    sameSkuGroupId,
    sameSkuSampleSize,
    sampleInsufficient,
    confidence: calculateConfidence(reasonTags, dataCompleteness, sampleInsufficient, sameSkuSampleSize),
    dataCompleteness,
    recommendedAction: REVIEW_ONLY_ACTION,
  };
}
