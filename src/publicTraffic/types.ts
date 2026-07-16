import type { PeriodKey } from '../domain/types.js';
import type { LinkListingState } from '../linkRegistry/types.js';
import type { GoodsManagerNewProductPoolItem } from './goodsManagerNewProducts.js';
import type { OrderAnalysisResult } from './orderAnalysis.js';

export interface ExposureOverviewMetric {
  period: '1d' | '7d' | '30d';
  exposure: number;
  visits: number;
  conversionRate: number;
  amount: number;
}

export type ExposureLinkStatus = 'active' | 'removed' | 'unknown';

export interface ExposureCumulativeProduct {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  listingStatus?: ExposureLinkStatus;
  listingStatusLabel?: string | null;
  raw: Record<string, string>;
}

export type ExposureDeltaFlag = 'new_product' | 'missing' | 'missing_previous_snapshot_row' | 'counter_reset_or_data_error';

export interface ExposureDailyDelta {
  date: string;
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  flags: ExposureDeltaFlag[];
}

export interface ExposureProductSummary {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  visitRate: number;
  days: number;
  flags: ExposureDeltaFlag[];
}

export interface PlatformRestrictionObservation {
  kind: 'review_rejected' | 'frozen' | 'other';
  reasonText: string;
  observedAt?: string;
}

export interface GoodsSnapshotItem {
  platformProductId: string;
  internalProductId: string;
  productName: string;
  listingState?: LinkListingState;
  listingStatusText?: string;
  observedAt?: string;
  platformRestriction?: PlatformRestrictionObservation;
}

export interface NewProductObservationItem extends GoodsSnapshotItem {
  date: string;
  source: 'goods_diff' | 'recent_internal_id';
}

export type ObservationStateName = 'new_observation' | 'watching' | 'candidate_action' | 'cooldown' | 'resolved_or_stable';

export interface ProductObservationState {
  platformProductId: string;
  internalProductId?: string;
  state: ObservationStateName;
  abnormalDays: number;
  cooldownUntil: string | null;
  note: string;
}

export interface ProductObservationSignal {
  abnormal: boolean;
  improved: boolean;
  newProduct: boolean;
}

export interface ProductObservationOverride {
  platformProductId?: string;
  internalProductId?: string;
  state: ObservationStateName;
  cooldownUntil?: string | null;
  note?: string;
}

export interface PublicTrafficReportSectionItem {
  identifier: string;
  action: string;
  reason: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface PublicTrafficReportContext {
  date: string;
  overview: ExposureOverviewMetric[];
  exposureOptimization: PublicTrafficReportSectionItem[];
  conversionOptimization: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
}

export interface PublicTrafficReportPaths {
  markdownPath: string;
  workbookPath: string;
}

export interface PublicTrafficPeriodMetrics {
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  signedOrders: number;
  reviewedOrders: number;
  shippedOrders: number;
  createdOrderAmount?: number;
  signedOrderAmount?: number;
  reviewedOrderAmount?: number;
  shippedOrderAmount?: number;
  amount: number;
  exposureVisitRate: number;
  visitCreatedOrderRate: number;
  visitShipmentRate: number;
  hasExposureData: boolean;
  hasDashboardData: boolean;
}

export interface PublicTrafficProductDataRow {
  productName: string;
  platformProductId: string;
  displayProductId: string;
  custodyDays: number | null;
  periods: Record<PeriodKey, PublicTrafficPeriodMetrics>;
}

export interface PublicTrafficDataContext {
  rows: PublicTrafficProductDataRow[];
}

export interface PublicTrafficDataSummary {
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
  exposureVisitRate: number;
  visitCreatedOrderRate: number;
  visitShipmentRate: number;
}

export interface PublicTrafficConclusion {
  label: string;
  text: string;
}

export interface AgentRemovedLinkContextItem {
  productId: string;
  platformProductId: string;
  productName: string;
  removedDate: string;
  reason: '商品总表缺失';
  source: 'goods_snapshot_diff';
}

export interface PublicTrafficAgentData {
  removedLinks: AgentRemovedLinkContextItem[];
  refreshHealth?: {
    warnings: string[];
    lifecycleSuppressed: boolean;
  };
}

export interface PublicTrafficEmptySectionNotes {
  lowExposure: string;
  weakClick: string;
  weakConversion: string;
  highPotential: string;
  newProductObservation: string;
  lifecycleGovernance: string;
  custodyAbnormal?: string;
  recommendedActions: string;
}

export interface PublicTrafficDataReportContext {
  generationId: string;
  date: string;
  summary: Record<PeriodKey, PublicTrafficDataSummary>;
  conclusions: PublicTrafficConclusion[];
  dataQualityNotes?: string[];
  newProductPoolItems?: GoodsManagerNewProductPoolItem[];
  newProductPoolIds?: string[];
  agentData?: PublicTrafficAgentData;
  rows: PublicTrafficProductDataRow[];
  lowExposure: PublicTrafficReportSectionItem[];
  weakClick: PublicTrafficReportSectionItem[];
  weakConversion: PublicTrafficReportSectionItem[];
  highPotential: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
  custodyAbnormal?: PublicTrafficReportSectionItem[];
  recommendedActions: PublicTrafficReportSectionItem[];
  emptySectionNotes: PublicTrafficEmptySectionNotes;
  orderAnalysis?: OrderAnalysisResult;
  previousSummary?: PublicTrafficDataSummary;
}

export type PublicTrafficDataReportDraftContext = Omit<PublicTrafficDataReportContext, 'generationId'>;

export interface PublicTrafficDataAnalysisInput extends PublicTrafficDataContext {
  date: string;
  overview?: ExposureOverviewMetric[];
  previousSummary?: PublicTrafficDataSummary;
  dataQualityNotes?: string[];
  dailyDelta?: ExposureDailyDelta[];
  sevenDaySummary?: ExposureProductSummary[];
  thirtyDaySummary?: ExposureProductSummary[];
  cumulativeProducts?: ExposureCumulativeProduct[];
  orderAnalysis?: OrderAnalysisResult;
}
