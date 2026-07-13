import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';

export interface AgentOverviewMetric {
  period: PeriodKey;
  exposure: number;
  publicVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
  exposureVisitRate: number;
  visitShipmentRate: number;
}

export interface AgentOverviewAnswer {
  date: string;
  metrics: AgentOverviewMetric[];
  dataQualityNotes: string[];
}

export interface AgentProductPeriodMetric extends AgentOverviewMetric {}

export interface AgentProductAnswer {
  productId: string;
  productName: string;
  platformProductId: string;
  custodyDays: number | null;
  periods: AgentProductPeriodMetric[];
}

export type AgentProblemType = 'low_exposure' | 'weak_conversion' | 'high_potential' | 'new_product_pool' | 'recommended_action';

export interface AgentProblemProduct {
  type: AgentProblemType;
  productId: string;
  action: string;
  reason: string;
}

export interface AgentNewProductPoolItem {
  productId: string;
  productName: string;
  maintenanceStatus: string;
}

export interface AgentRemovedLinkItem {
  productId: string;
  platformProductId: string;
  productName: string;
  removedDate: string;
  reason: '商品总表缺失';
  source: 'goods_snapshot_diff';
}

export interface AgentInactiveLinkItem {
  productId: string;
  identifier: string;
  action: string;
  reason: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface AgentOrderSummary {
  text: string;
}

export interface AgentTaskItem {
  productId: string;
  productName: string;
  taskType: AgentProblemType;
  priority: number;
  reason: string;
  suggestedAction: string;
  status: '待处理';
}

export type AgentRankingMetric = PublicTrafficMetricKey;

export type AgentIntent =
  | { type: 'overview' }
  | { type: 'product'; keyword: string }
  | { type: 'best_product_by_same_sku'; query: string; periodDays?: number; metric?: AgentRankingMetric }
  | ({ type: 'refresh_candidate_explain'; query?: string; sameSkuGroupId?: string; windowDays?: number } & (
      | { metric: PublicTrafficMetricKey; operator: 'eq'; value: 0 }
      | { zeroMetric: 'created_orders' | 'amount' }
    ))
  | { type: 'safe_source_resolve'; query?: string; sameSkuGroupId?: string }
  | { type: 'safe_source_groups' }
  | { type: 'tasks' }
  | { type: 'problem_products'; problemType: AgentProblemType }
  | { type: 'new_product_pool' }
  | { type: 'inactive_links' }
  | { type: 'removed_links' }
  | { type: 'order_summary' }
  | { type: 'unknown'; text: string };
