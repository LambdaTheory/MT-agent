export type ClosedOrderReasonTag = 'pricing' | 'spec' | 'inventory' | 'service' | 'logistics' | 'irrelevant' | 'unclear';

export type ClosedOrderRecommendedAction = 'manual_review_only';

export interface ClosedOrderFeedbackInput {
  internalProductId: string;
  rawRemark: string;
  closeId?: string;
  closedAt?: string;
  orderNo?: string;
  merchant?: string;
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
  orderNo?: string;
  merchant?: string;
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

export interface ClosedOrderRemarkRecord {
  id: string;
  orderNo: string;
  internalProductId: string;
  merchant: string;
  merchantRemark: string;
  capturedAt: string;
  receivedAt: string;
}

export interface ClosedOrderRemarksResponse {
  sourceAppCode: string;
  items: ClosedOrderRemarkRecord[];
}

export interface ClosedOrderFeedbackRecentProvider {
  listRecentFeedback(limit?: number): Promise<ClosedOrderFeedbackInput[]>;
}

export interface ClosedOrderIngestedRecord extends ClosedOrderFeedbackInput {
  dedupeKey: string;
  firstIngestedAt: string;
  lastIngestedAt: string;
  seenCount: number;
}

export interface ClosedOrderIngestState {
  version: 1;
  items: ClosedOrderIngestedRecord[];
}

export interface ClosedOrderIngestBatchResult {
  state: ClosedOrderIngestState;
  addedCount: number;
  updatedCount: number;
}

export interface ClosedOrderSyncResult {
  fetchedCount: number;
  addedCount: number;
  updatedCount: number;
  totalCount: number;
  state: ClosedOrderIngestState;
}

export interface ClosedOrderObservationGroup {
  groupKey: string;
  displayLabel: string;
  sameSkuGroupId: string | null;
  internalProductIds: string[];
  recordCount: number;
  totalSeenCount: number;
  latestClosedAt: string | null;
  topReason: ClosedOrderReasonTag;
  reasonCounts: Record<ClosedOrderReasonTag, number>;
  sampleRemarks: string[];
  needsManualReview: boolean;
  manualReviewReasons: string[];
  missingLinkRegistryCount: number;
  missingSameSkuGroupCount: number;
  lowConfidenceCount: number;
}

export interface ClosedOrderObservationSummary {
  recordCount: number;
  totalSeenCount: number;
  todayRecordCount: number;
  groupCount: number;
  manualReviewGroupCount: number;
  linkedRecordCount: number;
  groupedRecordCount: number;
  reasonCounts: Record<ClosedOrderReasonTag, number>;
}

export interface ClosedOrderObservationReport {
  date: string;
  windowDays: number;
  generatedAt: string;
  summary: ClosedOrderObservationSummary;
  groups: ClosedOrderObservationGroup[];
}
