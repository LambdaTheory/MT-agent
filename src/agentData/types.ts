import type { PeriodKey } from '../domain/types.js';

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

export type AgentIntent =
  | { type: 'overview' }
  | { type: 'product'; keyword: string }
  | { type: 'tasks' }
  | { type: 'problem_products'; problemType: AgentProblemType }
  | { type: 'new_product_pool' }
  | { type: 'order_summary' }
  | { type: 'unknown'; text: string };
