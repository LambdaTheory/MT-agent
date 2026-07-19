export interface InactiveRefreshNewLinkItem {
  keyword: string;
  count: number;
  sourceProductId: string;
  sourceProductName: string;
  sameSkuGroupId?: string;
}

export interface InactiveRefreshPlan {
  date: string;
  delistProductIds: string[];
  newLinkItems: InactiveRefreshNewLinkItem[];
  skippedGroups: string[];
  executableCount: number;
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
