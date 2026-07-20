import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluateOperationObservationOutcome,
  loadOperationObservations,
  type OperationObservation,
  type OperationObservationMetricSnapshot,
  type OperationObservationOutcome,
  type OperationObservationType,
} from '../operationObservations/store.js';
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export interface OperationReviewSummary {
  generatedAt: string;
  observations: {
    total: number;
    byType: Record<OperationObservationType, number>;
    observing: number;
    expiredObserving: number;
    outcomeHealth: Record<OperationObservationOutcome, number>;
    outcomeMetricPeriod: PeriodKey;
    outcomeMetricDate?: string;
  };
  inactiveRefreshAuditGaps: InactiveRefreshAuditGap[];
  warnings: string[];
}

export interface InactiveRefreshAuditGap {
  auditPath: string;
  planRef: string;
  date?: string;
  status: 'partial_copy_without_observation';
  copiedNewProductIds: string[];
  missingObservationNewProductIds: string[];
  observedNewProductIds: string[];
  sourceProductIds: string[];
  plannedDelistProductIds: string[];
  attemptedDelistProductIds: string[];
  failedDelistProductIds: string[];
  firstFailureReason?: string;
}

interface InactiveRefreshAuditShape {
  ok?: unknown;
  plan?: {
    date?: unknown;
    delistProductIds?: unknown;
    newLinkItems?: unknown;
  };
  copyResults?: unknown;
  delistResults?: unknown;
}

interface CopyResultShape {
  ok?: unknown;
  newProductId?: unknown;
  productId?: unknown;
}

interface DelistResultShape {
  ok?: unknown;
  productId?: unknown;
  message?: unknown;
  lines?: unknown;
}

interface NewLinkItemShape {
  count?: unknown;
  sourceProductId?: unknown;
}

const EMPTY_BY_TYPE: Record<OperationObservationType, number> = {
  price_change: 0,
  inactive_refresh: 0,
  goods_table_new_link: 0,
};

export async function buildOperationReview(outputDir: string, now = new Date()): Promise<OperationReviewSummary> {
  const warnings: string[] = [];
  const store = await loadObservationsBestEffort(outputDir, warnings);
  const observations = store?.observations ?? [];
  const latestReport = await loadLatestReportContextBestEffort(outputDir, warnings);
  const observedNewProductIds = new Set(observations.flatMap(newLinkProductIds));
  const auditGaps = await loadInactiveRefreshAuditGaps(outputDir, observedNewProductIds, warnings);
  return {
    generatedAt: now.toISOString(),
    observations: summarizeObservations(observations, now, latestReport?.context),
    inactiveRefreshAuditGaps: auditGaps,
    warnings,
  };
}

function summarizeObservations(observations: OperationObservation[], now: Date, reportContext?: PublicTrafficDataReportContext): OperationReviewSummary['observations'] {
  const byType = { ...EMPTY_BY_TYPE };
  let observing = 0;
  let expiredObserving = 0;
  for (const observation of observations) {
    byType[observation.operationType] += 1;
    if (observation.status === 'observing') {
      observing += 1;
      const observeUntilMs = Date.parse(observation.observeUntil);
      if (Number.isFinite(observeUntilMs) && observeUntilMs <= now.getTime()) expiredObserving += 1;
    }
  }
  return { total: observations.length, byType, observing, expiredObserving, ...summarizeOutcomeHealth(observations, reportContext, '7d') };
}

function summarizeOutcomeHealth(observations: OperationObservation[], reportContext: PublicTrafficDataReportContext | undefined, period: PeriodKey): Pick<OperationReviewSummary['observations'], 'outcomeHealth' | 'outcomeMetricPeriod' | 'outcomeMetricDate'> {
  const outcomeHealth: Record<OperationObservationOutcome, number> = { positive: 0, neutral: 0, negative: 0, insufficient_data: 0 };
  const rowsByProductId = reportContext ? reportRowsByProductId(reportContext.rows) : new Map<string, PublicTrafficProductDataRow>();
  for (const observation of observations) {
    const outcome = evaluateOperationObservationOutcome(metricsForObservation(observation, rowsByProductId, period));
    outcomeHealth[outcome] += 1;
  }
  return {
    outcomeHealth,
    outcomeMetricPeriod: period,
    ...(reportContext?.date ? { outcomeMetricDate: reportContext.date } : {}),
  };
}

function metricsForObservation(observation: OperationObservation, rowsByProductId: Map<string, PublicTrafficProductDataRow>, period: PeriodKey): OperationObservationMetricSnapshot {
  const subjects = observation.subjects.filter((subject) => subject.role === 'price_changed_product' || subject.role === 'new_link');
  const metrics = subjects.map((subject) => rowsByProductId.get(subject.productId)?.periods[period]).filter((item): item is PublicTrafficPeriodMetrics => Boolean(item));
  return aggregateMetricSnapshots(metrics);
}

function aggregateMetricSnapshots(metrics: PublicTrafficPeriodMetrics[]): OperationObservationMetricSnapshot {
  const exposureMetrics = metrics.filter((item) => item.hasExposureData);
  const dashboardMetrics = metrics.filter((item) => item.hasDashboardData);
  return {
    ...(exposureMetrics.length ? { exposure: sum(exposureMetrics.map((item) => item.exposure)) } : {}),
    ...(exposureMetrics.length ? { visits: sum(exposureMetrics.map((item) => item.publicVisits)) } : {}),
    ...(dashboardMetrics.length ? { orders: sum(dashboardMetrics.map((item) => item.createdOrders)) } : {}),
    ...(metrics.length ? { amount: sum(metrics.map((item) => item.amount)) } : {}),
  };
}

function reportRowsByProductId(rows: PublicTrafficProductDataRow[]): Map<string, PublicTrafficProductDataRow> {
  const byId = new Map<string, PublicTrafficProductDataRow>();
  for (const row of rows) {
    for (const id of rowProductIds(row)) byId.set(id, row);
  }
  return byId;
}

function rowProductIds(row: PublicTrafficProductDataRow): string[] {
  return uniqueStrings([
    row.platformProductId,
    ...numericIdParts(row.platformProductId),
    row.displayProductId,
    ...numericIdParts(row.displayProductId),
  ]);
}

function numericIdParts(value: string): string[] {
  return value.match(/\d+/g) ?? [];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function loadLatestReportContextBestEffort(outputDir: string, warnings: string[]): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  try {
    return await loadLatestReportContext(outputDir);
  } catch (error) {
    warnings.push(`最新公域日报上下文读取失败：${errorMessage(error)}`);
    return null;
  }
}

async function loadLatestReportContext(outputDir: string): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  for (const date of await datedOutputDirs(outputDir)) {
    const found = await readReportContextFromDateDir(outputDir, date);
    if (found) return found;
  }
  return null;
}

async function datedOutputDirs(outputDir: string): Promise<string[]> {
  const entries = await readdir(outputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

async function readReportContextFromDateDir(outputDir: string, date: string): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  for (const fileName of [`公域数据上下文_${date}.json`, 'report-context.json']) {
    const path = join(outputDir, date, fileName);
    try {
      return { path, context: JSON.parse(await readFile(path, 'utf8')) as PublicTrafficDataReportContext };
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) continue;
      throw error;
    }
  }
  return null;
}

async function loadObservationsBestEffort(outputDir: string, warnings: string[]): Promise<{ observations: OperationObservation[] } | null> {
  try {
    return await loadOperationObservations(outputDir);
  } catch (error) {
    warnings.push(`operation-observations 读取失败：${errorMessage(error)}`);
    return null;
  }
}

async function loadInactiveRefreshAuditGaps(outputDir: string, observedNewProductIds: Set<string>, warnings: string[]): Promise<InactiveRefreshAuditGap[]> {
  const auditDir = join(outputDir, 'latest', 'inactive-refresh-audits');
  let names: string[];
  try {
    names = await readdir(auditDir);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return [];
    warnings.push(`inactive-refresh audit 目录读取失败：${errorMessage(error)}`);
    return [];
  }
  const gaps: InactiveRefreshAuditGap[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const auditPath = join(auditDir, name);
    try {
      const parsed = JSON.parse(await readFile(auditPath, 'utf8')) as unknown;
      const gap = inactiveRefreshAuditGapFromParsed(auditPath, parsed, observedNewProductIds);
      if (gap) gaps.push(gap);
    } catch (error) {
      warnings.push(`${name} 读取失败：${errorMessage(error)}`);
    }
  }
  return gaps;
}

function inactiveRefreshAuditGapFromParsed(auditPath: string, parsed: unknown, observedNewProductIds: Set<string>): InactiveRefreshAuditGap | null {
  if (!isRecord(parsed)) return null;
  const audit = parsed as InactiveRefreshAuditShape;
  const copyResults = arrayOfRecords(audit.copyResults) as CopyResultShape[];
  const copiedNewProductIds = uniqueStrings(copyResults.filter((item) => item.ok === true).map((item) => stringValue(item.newProductId)));
  if (audit.ok === true || copiedNewProductIds.length === 0) return null;
  const missingObservationNewProductIds = copiedNewProductIds.filter((productId) => !observedNewProductIds.has(productId));
  if (missingObservationNewProductIds.length === 0) return null;

  const delistResults = arrayOfRecords(audit.delistResults) as DelistResultShape[];
  const failedDelists = delistResults.filter((item) => item.ok !== true);
  return {
    auditPath,
    planRef: planRefFromAuditPath(auditPath),
    ...(typeof audit.plan?.date === 'string' ? { date: audit.plan.date } : {}),
    status: 'partial_copy_without_observation',
    copiedNewProductIds,
    missingObservationNewProductIds,
    observedNewProductIds: copiedNewProductIds.filter((productId) => observedNewProductIds.has(productId)),
    sourceProductIds: sourceProductIdsFromPlan(audit.plan?.newLinkItems),
    plannedDelistProductIds: uniqueStrings(arrayOfStrings(audit.plan?.delistProductIds)),
    attemptedDelistProductIds: uniqueStrings(delistResults.map((item) => stringValue(item.productId))),
    failedDelistProductIds: uniqueStrings(failedDelists.map((item) => stringValue(item.productId))),
    ...firstFailureReason(failedDelists),
  };
}

function firstFailureReason(failedDelists: DelistResultShape[]): { firstFailureReason?: string } {
  const first = failedDelists[0];
  if (!first) return {};
  if (typeof first.message === 'string' && first.message.trim()) return { firstFailureReason: first.message.trim() };
  const lines = arrayOfStrings(first.lines);
  const line = lines.find((item) => item.trim() && !/^delist:/i.test(item));
  return line ? { firstFailureReason: line.trim() } : {};
}

function sourceProductIdsFromPlan(value: unknown): string[] {
  const items = arrayOfRecords(value) as NewLinkItemShape[];
  const expanded: string[] = [];
  for (const item of items) {
    const sourceProductId = stringValue(item.sourceProductId);
    if (!sourceProductId) continue;
    const count = typeof item.count === 'number' && Number.isFinite(item.count) ? Math.max(1, Math.floor(item.count)) : 1;
    for (let index = 0; index < count; index += 1) expanded.push(sourceProductId);
  }
  return uniqueStrings(expanded);
}

function newLinkProductIds(observation: OperationObservation): string[] {
  return observation.subjects.filter((subject) => subject.role === 'new_link').map((subject) => subject.productId);
}

function planRefFromAuditPath(auditPath: string): string {
  return auditPath.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? auditPath;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((item): item is string => Boolean(item)))];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
