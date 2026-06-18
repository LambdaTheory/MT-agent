export type ClosedOrderReasonTag = 'pricing' | 'spec' | 'inventory' | 'service' | 'logistics' | 'irrelevant' | 'unclear';

export type ClosedOrderRecommendedAction = 'manual_review_only';

export interface ClosedOrderFeedbackInput {
  internalProductId: string;
  rawRemark: string;
  closeId?: string;
  closedAt?: string;
}

export interface ClosedOrderDataCompleteness {
  hasCloseId: boolean;
  hasClosedAt: boolean;
  hasLinkRegistryEntry: boolean;
  hasSameSkuGroupId: boolean;
  missingFields: string[];
}

export interface ClosedOrderConfidenceFeedback {
  internalProductId: string;
  rawRemark: string;
  closeId?: string;
  closedAt?: string;
  inferredReason: ClosedOrderReasonTag;
  reasonTags: ClosedOrderReasonTag[];
  sameSkuGroupId: string | null;
  sameSkuSampleSize: number;
  sampleInsufficient: boolean;
  confidence: number;
  dataCompleteness: ClosedOrderDataCompleteness;
  recommendedAction: ClosedOrderRecommendedAction;
}

export interface ClosedOrderFeedbackProvider {
  getFeedback(input: ClosedOrderFeedbackInput): Promise<ClosedOrderFeedbackInput>;
}
