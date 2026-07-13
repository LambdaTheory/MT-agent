import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export const publicTrafficMetricKeys = [
  'exposure',
  'publicVisits',
  'dashboardVisits',
  'createdOrders',
  'signedOrders',
  'reviewedOrders',
  'shippedOrders',
  'createdOrderAmount',
  'signedOrderAmount',
  'reviewedOrderAmount',
  'shippedOrderAmount',
  'amount',
  'exposureVisitRate',
  'visitCreatedOrderRate',
  'visitShipmentRate',
  'custodyDays',
] as const;

export type PublicTrafficMetricKey = typeof publicTrafficMetricKeys[number];
export type PublicTrafficMetricSource = 'exposure' | 'dashboard' | 'derived_exposure' | 'derived_dashboard' | 'state';
export type PublicTrafficWindowAggregation = 'sum' | 'weighted_ratio' | 'latest';

export interface MetricAvailability {
  available: boolean;
  source: PublicTrafficMetricSource;
  requiredDays: number;
  coveredDays: number;
  missingDates: string[];
  reason?: 'missing_exposure_data' | 'missing_dashboard_data' | 'missing_optional_dashboard_column' | 'zero_denominator' | 'not_window_aggregatable';
}

export interface PublicTrafficMetricDefinition {
  key: PublicTrafficMetricKey;
  label: string;
  aliases: readonly string[];
  source: PublicTrafficMetricSource;
  format: 'number' | 'money' | 'percent';
  windowAggregation: PublicTrafficWindowAggregation | null;
  numerator?: PublicTrafficMetricKey;
  denominator?: PublicTrafficMetricKey;
  strategyConditionAllowed: boolean;
  executableDelistAllowed: boolean;
}

const periodDays: Record<PeriodKey, number> = { '1d': 1, '7d': 7, '30d': 30 };

const optionalDashboardAmountMetrics = new Set<PublicTrafficMetricKey>([
  'createdOrderAmount',
  'signedOrderAmount',
  'reviewedOrderAmount',
  'shippedOrderAmount',
]);

const metricDefinitions: Record<PublicTrafficMetricKey, PublicTrafficMetricDefinition> = {
  exposure: metric('exposure', '曝光量', ['曝光'], 'exposure', 'number', 'sum', true, true),
  publicVisits: metric('publicVisits', '公域访问量', ['访问量', '公域访问', '公域访问数'], 'exposure', 'number', 'sum', true, true),
  dashboardVisits: metric('dashboardVisits', '后链路访问量', ['后链路访问', '访问页访问'], 'dashboard', 'number', 'sum', true, false),
  createdOrders: metric('createdOrders', '创建订单数', ['创建订单', '创单', '创单数'], 'dashboard', 'number', 'sum', true, true),
  signedOrders: metric('signedOrders', '签约订单数', ['签约订单', '签单'], 'dashboard', 'number', 'sum', true, true),
  reviewedOrders: metric('reviewedOrders', '审核订单数', ['审核订单', '审出订单'], 'dashboard', 'number', 'sum', true, true),
  shippedOrders: metric('shippedOrders', '发货订单数', ['发货订单', '发货'], 'dashboard', 'number', 'sum', true, true),
  createdOrderAmount: metric('createdOrderAmount', '创建订单金额', ['创建金额', '创单金额'], 'dashboard', 'money', 'sum', true, true),
  signedOrderAmount: metric('signedOrderAmount', '签约订单金额', ['签约金额', '签单金额'], 'dashboard', 'money', 'sum', true, true),
  reviewedOrderAmount: metric('reviewedOrderAmount', '审核订单金额', ['审核金额', '审出金额', '审出订单金额'], 'dashboard', 'money', 'sum', true, true),
  shippedOrderAmount: metric('shippedOrderAmount', '发货订单金额', ['发货金额', '发货订单金额'], 'dashboard', 'money', 'sum', true, true),
  amount: metric('amount', '公域交易金额', ['订单金额', '交易金额', '公域金额'], 'exposure', 'money', 'sum', true, true),
  exposureVisitRate: metric('exposureVisitRate', '曝光到访问率', ['曝光访问率'], 'derived_exposure', 'percent', 'weighted_ratio', true, false, 'publicVisits', 'exposure'),
  visitCreatedOrderRate: metric('visitCreatedOrderRate', '后链路访问到创单率', ['访问到创建率', '访问到创单率'], 'derived_dashboard', 'percent', 'weighted_ratio', true, false, 'createdOrders', 'dashboardVisits'),
  visitShipmentRate: metric('visitShipmentRate', '后链路访问到发货率', ['访问到发货率'], 'derived_dashboard', 'percent', 'weighted_ratio', true, false, 'shippedOrders', 'dashboardVisits'),
  custodyDays: metric('custodyDays', '托管/上线天数', ['托管天数', '上线天数'], 'state', 'number', 'latest', false, false),
};

function metric(
  key: PublicTrafficMetricKey,
  label: string,
  aliases: readonly string[],
  source: PublicTrafficMetricSource,
  format: PublicTrafficMetricDefinition['format'],
  windowAggregation: PublicTrafficWindowAggregation | null,
  strategyConditionAllowed: boolean,
  executableDelistAllowed: boolean,
  numerator?: PublicTrafficMetricKey,
  denominator?: PublicTrafficMetricKey,
): PublicTrafficMetricDefinition {
  return {
    key,
    label,
    aliases,
    source,
    format,
    windowAggregation,
    ...(numerator ? { numerator } : {}),
    ...(denominator ? { denominator } : {}),
    strategyConditionAllowed,
    executableDelistAllowed,
  };
}

export function getPublicTrafficMetric(key: string): PublicTrafficMetricDefinition | undefined {
  return Object.hasOwn(metricDefinitions, key) ? metricDefinitions[key as PublicTrafficMetricKey] : undefined;
}

function sourceAvailable(
  metrics: PublicTrafficPeriodMetrics,
  source: PublicTrafficMetricSource,
): boolean {
  if (source === 'exposure' || source === 'derived_exposure') return metrics.hasExposureData;
  if (source === 'dashboard' || source === 'derived_dashboard') return metrics.hasDashboardData;
  return true;
}

function fixedAvailability(
  source: PublicTrafficMetricSource,
  period: PeriodKey,
  available: boolean,
  reason?: MetricAvailability['reason'],
): MetricAvailability {
  const requiredDays = periodDays[period];
  return {
    available,
    source,
    requiredDays,
    coveredDays: available ? requiredDays : 0,
    missingDates: [],
    ...(reason ? { reason } : {}),
  };
}

function readMetricValue(row: PublicTrafficProductDataRow, period: PeriodKey, key: PublicTrafficMetricKey): number | undefined {
  if (key === 'custodyDays') return typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays) ? row.custodyDays : undefined;
  const metrics = row.periods[period];
  const value = metrics[key as keyof PublicTrafficPeriodMetrics];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function metricAvailabilityForFixedPeriod(row: PublicTrafficProductDataRow, period: PeriodKey, key: PublicTrafficMetricKey): MetricAvailability {
  const definition = metricDefinitions[key];
  const metrics = row.periods[period];

  if (key === 'custodyDays') {
    return fixedAvailability(definition.source, period, typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays));
  }

  if (!metrics) return fixedAvailability(definition.source, period, false, definition.source.includes('dashboard') ? 'missing_dashboard_data' : 'missing_exposure_data');

  if (!sourceAvailable(metrics, definition.source)) {
    return fixedAvailability(definition.source, period, false, definition.source.includes('dashboard') ? 'missing_dashboard_data' : 'missing_exposure_data');
  }

  if (optionalDashboardAmountMetrics.has(key) && readMetricValue(row, period, key) === undefined) {
    return fixedAvailability(definition.source, period, false, 'missing_optional_dashboard_column');
  }

  if (definition.windowAggregation === 'weighted_ratio') {
    const numerator = definition.numerator ? readMetricValue(row, period, definition.numerator) : undefined;
    const denominator = definition.denominator ? readMetricValue(row, period, definition.denominator) : undefined;
    if (numerator === undefined || denominator === undefined) return fixedAvailability(definition.source, period, false, definition.source.includes('dashboard') ? 'missing_dashboard_data' : 'missing_exposure_data');
    if (denominator === 0) return fixedAvailability(definition.source, period, false, 'zero_denominator');
  }

  return fixedAvailability(definition.source, period, true);
}
