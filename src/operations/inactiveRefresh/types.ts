export interface InactiveRefreshNewLinkItem {
  keyword: string;
  count: number;
  sourceProductId: string;
  sourceProductName: string;
  sameSkuGroupId?: string;
}

export interface InactiveRefreshMetricEvidence {
  daysCovered: number;
  dashboardDaysCovered: number;
  custodyDays?: number;
  exposure14d?: number;
  avgExposure14d?: number;
  visits14d?: number;
  visitRate?: number;
  amount14d?: number;
  dashboardAmount14d?: number;
  missingDashboardDays: number;
}

export interface InactiveRefreshLinkEvidence {
  productId: string;
  productName: string;
  groupId: string;
  decision: 'executable' | 'manual' | 'excluded';
  reason: string;
  metrics: InactiveRefreshMetricEvidence;
}

export interface InactiveRefreshSourceEvidence {
  productId: string;
  productName: string;
  groupId: string;
  reason: string;
  metrics: InactiveRefreshMetricEvidence;
}

export interface InactiveRefreshGroupEvidence {
  groupId: string;
  activeCount: number;
  limit: number;
  selectedProductIds: string[];
  limitExcludedProductIds: string[];
  source?: InactiveRefreshSourceEvidence;
}

export interface InactiveRefreshPlanEvidence {
  executableLinks: InactiveRefreshLinkEvidence[];
  manualReviewLinks: InactiveRefreshLinkEvidence[];
  excludedLinks: InactiveRefreshLinkEvidence[];
  groups: InactiveRefreshGroupEvidence[];
}

export interface InactiveRefreshPlan {
  date: string;
  delistProductIds: string[];
  newLinkItems: InactiveRefreshNewLinkItem[];
  skippedGroups: string[];
  executableCount: number;
  evidence?: InactiveRefreshPlanEvidence;
}

export interface InactiveRefreshPlanSummary {
  candidates: number;
  executable: number;
  manualReview: number;
  excluded: number;
}

export interface InactiveRefreshPlanResult {
  plan: InactiveRefreshPlan | null;
  summary: InactiveRefreshPlanSummary;
  lines: string[];
}
