import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPublicTrafficMetric, publicTrafficMetricKeys, type MetricAvailability, type PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';

export interface WindowAggregateInput {
  outputDir: string;
  endDate: string;
  windowDays: number;
}

export interface WindowProductAggregate {
  internalProductId: string;
  platformProductId?: string;
  productName: string;
  daysCovered: number;
  dashboardDaysCovered: number;
  missingDates: string[];
  missingDashboardDates: string[];
  metrics: Partial<Record<PublicTrafficMetricKey, number>>;
  availability: Record<PublicTrafficMetricKey, MetricAvailability>;
}

interface DailyMetricRecord {
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
  hasExposureData: boolean;
  hasDashboardData: boolean;
}

interface DailyRowRecord {
  productName: string;
  platformProductId?: string;
  displayProductId: string;
  custodyDays: number | null;
  periods: {
    '1d'?: DailyMetricRecord;
  };
}

interface DailyReportRecord {
  rows: DailyRowRecord[];
}

interface MutableWindowProductAggregate extends WindowProductAggregate {
  coveredDates: Set<string>;
  dashboardCoveredDates: Set<string>;
  exposureCoveredDates: Set<string>;
  metricCoveredDates: Partial<Record<PublicTrafficMetricKey, Set<string>>>;
  latestDate: string;
  latestCustodyDays?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: keyof DailyMetricRecord): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function hasFiniteNumber(record: Record<string, unknown>, key: keyof DailyMetricRecord): boolean {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value);
}

function readHasDashboardData(record: Record<string, unknown>): boolean {
  return record.hasDashboardData !== false
    && hasFiniteNumber(record, 'dashboardVisits')
    && hasFiniteNumber(record, 'createdOrders')
    && hasFiniteNumber(record, 'signedOrders')
    && hasFiniteNumber(record, 'reviewedOrders')
    && hasFiniteNumber(record, 'shippedOrders')
}

function readHasExposureData(record: Record<string, unknown>): boolean {
  return record.hasExposureData !== false
    && hasFiniteNumber(record, 'exposure')
    && hasFiniteNumber(record, 'publicVisits')
    && hasFiniteNumber(record, 'amount');
}

function readOptionalNumber(record: Record<string, unknown>, key: keyof DailyMetricRecord): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readMetric(value: unknown): DailyMetricRecord | null {
  if (!isRecord(value)) return null;
  return {
    exposure: readNumber(value, 'exposure'),
    publicVisits: readNumber(value, 'publicVisits'),
    dashboardVisits: readNumber(value, 'dashboardVisits'),
    createdOrders: readNumber(value, 'createdOrders'),
    signedOrders: readNumber(value, 'signedOrders'),
    reviewedOrders: readNumber(value, 'reviewedOrders'),
    shippedOrders: readNumber(value, 'shippedOrders'),
    ...(readOptionalNumber(value, 'createdOrderAmount') !== undefined ? { createdOrderAmount: readOptionalNumber(value, 'createdOrderAmount') } : {}),
    ...(readOptionalNumber(value, 'signedOrderAmount') !== undefined ? { signedOrderAmount: readOptionalNumber(value, 'signedOrderAmount') } : {}),
    ...(readOptionalNumber(value, 'reviewedOrderAmount') !== undefined ? { reviewedOrderAmount: readOptionalNumber(value, 'reviewedOrderAmount') } : {}),
    ...(readOptionalNumber(value, 'shippedOrderAmount') !== undefined ? { shippedOrderAmount: readOptionalNumber(value, 'shippedOrderAmount') } : {}),
    amount: readNumber(value, 'amount'),
    hasExposureData: readHasExposureData(value),
    hasDashboardData: readHasDashboardData(value),
  };
}

function readDailyReport(value: unknown): DailyReportRecord {
  if (!isRecord(value) || !Array.isArray(value.rows)) return { rows: [] };
  const rows = value.rows.flatMap((row): DailyRowRecord[] => {
    if (!isRecord(row) || !isRecord(row.periods)) return [];
    const productName = typeof row.productName === 'string' ? row.productName : '';
    const displayProductId = typeof row.displayProductId === 'string' ? row.displayProductId : '';
    const custodyDays = typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays) ? row.custodyDays : null;
    if (!displayProductId) return [];
    const metric = readMetric(row.periods['1d']);
    if (!metric) return [];
    const platformProductId = typeof row.platformProductId === 'string' ? row.platformProductId : undefined;
    return [{ productName, displayProductId, custodyDays, periods: { '1d': metric }, ...(platformProductId ? { platformProductId } : {}) }];
  });
  return { rows };
}

function extractInternalProductId(displayProductId: string): string {
  return /^端内\s*id\s*(\d+)$/iu.exec(displayProductId.trim())?.[1] ?? displayProductId.trim();
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error('endDate must be YYYY-MM-DD');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function windowDates(endDate: string, windowDays: number): string[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error('windowDays must be a positive integer');
  const end = parseDate(endDate);
  return Array.from({ length: windowDays }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (windowDays - 1 - index));
    return formatDate(date);
  });
}

async function readDay(outputDir: string, date: string): Promise<DailyReportRecord | null> {
  const path = join(outputDir, date, `公域数据上下文_${date}.json`);
  try {
    return readDailyReport(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function createAggregate(row: DailyRowRecord): MutableWindowProductAggregate {
  const internalProductId = extractInternalProductId(row.displayProductId);
  return {
    internalProductId,
    ...(row.platformProductId ? { platformProductId: row.platformProductId } : {}),
    productName: row.productName,
    daysCovered: 0,
    dashboardDaysCovered: 0,
    missingDates: [],
    missingDashboardDates: [],
    metrics: {},
    availability: emptyAvailability(1),
    coveredDates: new Set<string>(),
    dashboardCoveredDates: new Set<string>(),
    exposureCoveredDates: new Set<string>(),
    metricCoveredDates: {},
    latestDate: '',
  };
}

function emptyAvailability(requiredDays: number): Record<PublicTrafficMetricKey, MetricAvailability> {
  const availability = {} as Record<PublicTrafficMetricKey, MetricAvailability>;
  for (const key of publicTrafficMetricKeys) {
    const definition = getPublicTrafficMetric(key)!;
    availability[key] = { available: false, source: definition.source, requiredDays, coveredDays: 0, missingDates: [] };
  }
  return availability;
}

function addMetricCoverage(target: MutableWindowProductAggregate, metric: PublicTrafficMetricKey, date: string): void {
  const dates = target.metricCoveredDates[metric] ?? new Set<string>();
  dates.add(date);
  target.metricCoveredDates[metric] = dates;
}

function addMetricValue(target: MutableWindowProductAggregate, metric: PublicTrafficMetricKey, value: number, date: string): void {
  target.metrics[metric] = (target.metrics[metric] ?? 0) + value;
  addMetricCoverage(target, metric, date);
}

function addMetric(target: MutableWindowProductAggregate, date: string, metric: DailyMetricRecord): void {
  target.daysCovered += 1;
  target.coveredDates.add(date);
  if (date >= target.latestDate) {
    target.latestDate = date;
    if (typeof target.latestCustodyDays === 'number') delete target.latestCustodyDays;
  }
  if (metric.hasExposureData) target.exposureCoveredDates.add(date);
  if (metric.hasDashboardData) {
    target.dashboardDaysCovered += 1;
    target.dashboardCoveredDates.add(date);
  }
  if (metric.hasExposureData) {
    addMetricValue(target, 'exposure', metric.exposure, date);
    addMetricValue(target, 'publicVisits', metric.publicVisits, date);
    addMetricValue(target, 'amount', metric.amount, date);
  }
  if (metric.hasDashboardData) {
    addMetricValue(target, 'dashboardVisits', metric.dashboardVisits, date);
    addMetricValue(target, 'createdOrders', metric.createdOrders, date);
    addMetricValue(target, 'signedOrders', metric.signedOrders, date);
    addMetricValue(target, 'reviewedOrders', metric.reviewedOrders, date);
    addMetricValue(target, 'shippedOrders', metric.shippedOrders, date);
    for (const key of ['createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount'] as const) {
      const value = metric[key];
      if (typeof value === 'number' && Number.isFinite(value)) addMetricValue(target, key, value, date);
    }
  }
}

function setLatestStateMetric(target: MutableWindowProductAggregate, row: DailyRowRecord, date: string): void {
  if (date < target.latestDate) return;
  if (typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays)) {
    target.latestCustodyDays = row.custodyDays;
    target.metrics.custodyDays = row.custodyDays;
    addMetricCoverage(target, 'custodyDays', date);
  }
}

function metricDates(target: MutableWindowProductAggregate, metric: PublicTrafficMetricKey): Set<string> {
  return target.metricCoveredDates[metric] ?? new Set<string>();
}

function buildMetricAvailability(target: MutableWindowProductAggregate, metric: PublicTrafficMetricKey, dates: string[]): MetricAvailability {
  const definition = getPublicTrafficMetric(metric)!;
  const requiredDays = dates.length;
  const coveredDates = metricDates(target, metric);
  const coveredDays = coveredDates.size;
  const missingDates = dates.filter((date) => !coveredDates.has(date));
  if (definition.windowAggregation === 'weighted_ratio') {
    const numeratorAvailability = buildMetricAvailability(target, definition.numerator!, dates);
    const denominatorAvailability = buildMetricAvailability(target, definition.denominator!, dates);
    const denominator = target.metrics[definition.denominator!];
    if (!numeratorAvailability.available || !denominatorAvailability.available) {
      return { available: false, source: definition.source, requiredDays, coveredDays: Math.min(numeratorAvailability.coveredDays, denominatorAvailability.coveredDays), missingDates: Array.from(new Set([...numeratorAvailability.missingDates, ...denominatorAvailability.missingDates])), reason: definition.source === 'derived_dashboard' ? 'missing_dashboard_data' : 'missing_exposure_data' };
    }
    if (typeof denominator !== 'number' || denominator <= 0) return { available: false, source: definition.source, requiredDays, coveredDays: requiredDays, missingDates: [], reason: 'zero_denominator' };
    return { available: true, source: definition.source, requiredDays, coveredDays: requiredDays, missingDates: [] };
  }
  if (metric === 'custodyDays') return { available: coveredDays > 0, source: definition.source, requiredDays, coveredDays, missingDates };
  if (coveredDays === requiredDays) return { available: true, source: definition.source, requiredDays, coveredDays, missingDates: [] };
  const reason = definition.source === 'exposure' ? 'missing_exposure_data' : ['createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount'].includes(metric) && target.dashboardCoveredDates.size === requiredDays ? 'missing_optional_dashboard_column' : 'missing_dashboard_data';
  return { available: false, source: definition.source, requiredDays, coveredDays, missingDates, reason };
}

function finalizeMetrics(target: MutableWindowProductAggregate, dates: string[]): void {
  const availability = emptyAvailability(dates.length);
  for (const key of publicTrafficMetricKeys) availability[key] = buildMetricAvailability(target, key, dates);
  for (const key of publicTrafficMetricKeys) {
    const definition = getPublicTrafficMetric(key)!;
    if (definition.windowAggregation === 'weighted_ratio' && availability[key].available && definition.numerator && definition.denominator) {
      const numerator = target.metrics[definition.numerator];
      const denominator = target.metrics[definition.denominator];
      if (typeof numerator === 'number' && typeof denominator === 'number' && denominator > 0) target.metrics[key] = numerator / denominator;
    }
    if (!availability[key].available) delete target.metrics[key];
  }
  target.availability = availability;
}

export async function aggregateWindowProducts(input: WindowAggregateInput): Promise<WindowProductAggregate[]> {
  const dates = windowDates(input.endDate, input.windowDays);
  const products = new Map<string, MutableWindowProductAggregate>();

  for (const date of dates) {
    const report = await readDay(input.outputDir, date);
    if (!report) continue;
    for (const row of report.rows) {
      const metric = row.periods['1d'];
      if (!metric) continue;
      const internalProductId = extractInternalProductId(row.displayProductId);
      const current = products.get(internalProductId) ?? createAggregate(row);
      products.set(internalProductId, current);
      addMetric(current, date, metric);
      setLatestStateMetric(current, row, date);
    }
  }

  return Array.from(products.values())
    .map((product) => {
      finalizeMetrics(product, dates);
      const { coveredDates, dashboardCoveredDates, exposureCoveredDates, metricCoveredDates, latestDate, latestCustodyDays, ...aggregate } = product;
      return {
        ...aggregate,
        missingDates: dates.filter((date) => !coveredDates.has(date)),
        missingDashboardDates: dates.filter((date) => !dashboardCoveredDates.has(date)),
      };
    })
    .sort((left, right) => Number(left.internalProductId) - Number(right.internalProductId) || left.internalProductId.localeCompare(right.internalProductId));
}

export function readWindowMetric(aggregate: WindowProductAggregate, metric: PublicTrafficMetricKey): number | undefined {
  if (!aggregate.availability[metric]?.available) return undefined;
  const value = aggregate.metrics[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
