import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../../agentData/windowAggregate.js';
import { createLinkRegistry } from '../../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../../linkRegistry/types.js';
import { loadActiveInactiveRefreshDelistedProductIds } from '../../operationObservations/store.js';
import type { InactiveRefreshLinkEvidence, InactiveRefreshMetricEvidence, InactiveRefreshNewLinkItem, InactiveRefreshPlanEvidence, InactiveRefreshPlanResult, InactiveRefreshSourceEvidence } from './types.js';

const DAILY_LIMIT = 20;
const EVIDENCE_LIMIT = 30;

interface PartialCopyAuditShape {
  ok?: unknown;
  plan?: { delistProductIds?: unknown };
  copyResults?: unknown;
  delistResults?: unknown;
}

function positiveDashboardAmount(aggregate: WindowProductAggregate): number | undefined {
  for (const key of ['createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount'] as const) {
    const value = readWindowMetric(aggregate, key);
    if (typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

function groupLimit(activeCount: number): number {
  if (activeCount <= 3) return 1;
  if (activeCount <= 10) return 2;
  return Math.floor(activeCount * 0.2);
}

function classify(aggregate: WindowProductAggregate): { decision: 'executable' | 'manual' | 'excluded'; reason: string } {
  const amount = readWindowMetric(aggregate, 'amount');
  const exposure = readWindowMetric(aggregate, 'exposure');
  const visitRate = readWindowMetric(aggregate, 'exposureVisitRate');
  const visits = readWindowMetric(aggregate, 'publicVisits');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  const dashboardAmount = positiveDashboardAmount(aggregate);
  if (custodyDays === undefined) return { decision: 'manual', reason: '上线天数缺失，需人工确认是否满足 14 天观察期。' };
  if (custodyDays < 14) return { decision: 'excluded', reason: `上线 ${custodyDays} 天，不满 14 天新链保护。` };
  if (amount === undefined) return { decision: 'manual', reason: '14 天曝光金额缺失，不能按 0 金额自动刷新。' };
  if (amount > 0) return { decision: 'excluded', reason: `14 天曝光金额 ${formatNumber(amount)} > 0，仍有成交贡献。` };
  if (dashboardAmount !== undefined) return { decision: 'manual', reason: `曝光金额为 0，但订单金额口径 ${formatNumber(dashboardAmount)} > 0，需人工核对。` };
  if ((exposure ?? 0) / 14 >= 1000 && (visitRate ?? 0) > 0.05) return { decision: 'excluded', reason: '高曝光且访问率高但金额为 0，按转化异常排除。' };
  if (visits === undefined && aggregate.missingDashboardDates.length > 0) return { decision: 'manual', reason: '访问数据缺失，需先补抓或人工复核。' };
  return { decision: 'executable', reason: '上线满 14 天，14 天金额为 0，且无正向订单金额或转化异常证据。' };
}

function isSafeSourceAggregate(aggregate: WindowProductAggregate | undefined): boolean {
  if (!aggregate) return false;
  const amount = readWindowMetric(aggregate, 'amount');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  return typeof amount === 'number' && amount > 0 && typeof custodyDays === 'number' && custodyDays >= 14;
}

function isCurrentlyActionable(entry: LinkRegistryEntry): boolean {
  return entry.source.includes('daemon_catalog') && entry.status === 'active' && entry.listingState !== 'delisted' && entry.listingState !== 'gone';
}

function displayName(entry: LinkRegistryEntry | undefined, aggregate: WindowProductAggregate): string {
  return entry?.shortName ?? entry?.productName ?? aggregate.productName ?? entry?.sameSkuGroupId ?? aggregate.internalProductId;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function metricsEvidence(aggregate: WindowProductAggregate): InactiveRefreshMetricEvidence {
  const exposure = readWindowMetric(aggregate, 'exposure');
  const visits = readWindowMetric(aggregate, 'publicVisits');
  const visitRate = readWindowMetric(aggregate, 'exposureVisitRate');
  const amount = readWindowMetric(aggregate, 'amount');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  const dashboardAmount = positiveDashboardAmount(aggregate);
  return {
    daysCovered: aggregate.daysCovered,
    dashboardDaysCovered: aggregate.dashboardDaysCovered,
    ...(custodyDays !== undefined ? { custodyDays } : {}),
    ...(exposure !== undefined ? { exposure14d: exposure, avgExposure14d: exposure / 14 } : {}),
    ...(visits !== undefined ? { visits14d: visits } : {}),
    ...(visitRate !== undefined ? { visitRate } : {}),
    ...(amount !== undefined ? { amount14d: amount } : {}),
    ...(dashboardAmount !== undefined ? { dashboardAmount14d: dashboardAmount } : {}),
    missingDashboardDays: aggregate.missingDashboardDates.length,
  };
}

function linkEvidence(aggregate: WindowProductAggregate, entry: LinkRegistryEntry | undefined, groupId: string, decision: 'executable' | 'manual' | 'excluded', reason: string): InactiveRefreshLinkEvidence {
  return {
    productId: aggregate.internalProductId,
    productName: displayName(entry, aggregate),
    groupId,
    decision,
    reason,
    metrics: metricsEvidence(aggregate),
  };
}

function sourceEvidence(source: LinkRegistryEntry, aggregate: WindowProductAggregate | undefined, groupId: string): InactiveRefreshSourceEvidence {
  return {
    productId: source.internalProductId,
    productName: source.shortName ?? source.productName ?? source.internalProductId,
    groupId,
    reason: '同款组内 active，非本次失活候选，14 天金额 > 0，且上线满 14 天。',
    metrics: aggregate ? metricsEvidence(aggregate) : { daysCovered: 0, dashboardDaysCovered: 0, missingDashboardDays: 0 },
  };
}

function newLinkItemFromSource(source: LinkRegistryEntry, count: number, fallbackAggregate: WindowProductAggregate): InactiveRefreshNewLinkItem {
  return {
    keyword: source.sameSkuGroupId ?? displayName(source, fallbackAggregate),
    count,
    sourceProductId: source.internalProductId,
    sourceProductName: source.shortName ?? source.productName ?? source.internalProductId,
    sourceStrategy: 'healthy_source',
    ...(source.sameSkuGroupId ? { sameSkuGroupId: source.sameSkuGroupId } : {}),
  };
}

function selfCopyNewLinkItem(entry: LinkRegistryEntry, aggregate: WindowProductAggregate): InactiveRefreshNewLinkItem {
  return {
    keyword: entry.sameSkuGroupId ?? displayName(entry, aggregate),
    count: 1,
    sourceProductId: entry.internalProductId,
    sourceProductName: entry.shortName ?? entry.productName ?? aggregate.productName ?? entry.internalProductId,
    sourceStrategy: 'self_copy_fallback',
    ...(entry.sameSkuGroupId ? { sameSkuGroupId: entry.sameSkuGroupId } : {}),
  };
}

function pushBounded<T>(target: T[], value: T): void {
  if (target.length < EVIDENCE_LIMIT) target.push(value);
}

export async function buildInactiveRefreshPlan(input: { outputDir: string; date: string; registryEntries: LinkRegistryEntry[] }): Promise<InactiveRefreshPlanResult> {
  const aggregates = await aggregateWindowProducts({ outputDir: input.outputDir, endDate: input.date, windowDays: 14 });
  const cooldownProductIds = await loadActiveInactiveRefreshDelistedProductIds(input.outputDir);
  const partialCopyBlockedProductIds = await loadPartialCopyBlockedProductIds(input.outputDir);
  const registry = createLinkRegistry(input.registryEntries);
  const entriesByInternalId = new Map(input.registryEntries.map((entry) => [entry.internalProductId, entry]));
  const groups = new Map<string, { entries: LinkRegistryEntry[]; aggregates: WindowProductAggregate[] }>();
  const aggregatesByInternalId = new Map(aggregates.map((aggregate) => [aggregate.internalProductId, aggregate]));
  const evidencesByInternalId = new Map<string, InactiveRefreshLinkEvidence>();
  const manualReviewLinks: InactiveRefreshLinkEvidence[] = [];
  const excludedLinks: InactiveRefreshLinkEvidence[] = [];
  let manualReview = 0;
  let excluded = 0;

  for (const aggregate of aggregates) {
    const entry = entriesByInternalId.get(aggregate.internalProductId);
    if (entry && !isCurrentlyActionable(entry)) continue;
    const groupId = entry?.sameSkuGroupId ?? `ungrouped:${aggregate.internalProductId}`;
    if (cooldownProductIds.has(aggregate.internalProductId)) {
      const evidence = linkEvidence(aggregate, entry, groupId, 'excluded', '14 天操作观察期内已执行失活刷新，暂不重复入选。');
      evidencesByInternalId.set(aggregate.internalProductId, evidence);
      excluded += 1;
      pushBounded(excludedLinks, evidence);
      continue;
    }
    if (partialCopyBlockedProductIds.has(aggregate.internalProductId)) {
      const evidence = linkEvidence(aggregate, entry, groupId, 'excluded', '已有补链复制成功但旧链下架失败的审计记录，暂不重复复制；请先处理已复制新链。');
      evidencesByInternalId.set(aggregate.internalProductId, evidence);
      excluded += 1;
      pushBounded(excludedLinks, evidence);
      continue;
    }
    const { decision, reason } = classify(aggregate);
    const evidence = linkEvidence(aggregate, entry, groupId, decision, reason);
    evidencesByInternalId.set(aggregate.internalProductId, evidence);
    if (decision === 'manual') {
      manualReview += 1;
      pushBounded(manualReviewLinks, evidence);
      continue;
    }
    if (decision === 'excluded') {
      excluded += 1;
      pushBounded(excludedLinks, evidence);
      continue;
    }
    const current = groups.get(groupId) ?? { entries: [], aggregates: [] };
    if (entry) current.entries.push(entry);
    current.aggregates.push(aggregate);
    groups.set(groupId, current);
  }

  const delistProductIds: string[] = [];
  const newLinkItems: InactiveRefreshNewLinkItem[] = [];
  const skippedGroups: string[] = [];
  const lines: string[] = [];
  const executableLinks: InactiveRefreshLinkEvidence[] = [];
  const groupEvidence: InactiveRefreshPlanEvidence['groups'] = [];
  let remaining = DAILY_LIMIT;

  for (const [groupId, group] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (remaining <= 0) break;
    const activeCount = registry.listBySameSkuGroup(groupId, { includeRemoved: false }).filter((entry) => isCurrentlyActionable(entry)).length;
    const limit = Math.min(groupLimit(activeCount), remaining, group.entries.length);
    const selected = group.entries.slice(0, limit);
    const limitExcludedProductIds = group.entries.slice(limit).map((entry) => entry.internalProductId);
    if (selected.length === 0) continue;
    const candidateIds = new Set(group.entries.map((entry) => entry.internalProductId));
    const source = registry
      .listBySameSkuGroup(groupId, { includeRemoved: false })
      .filter((entry) => isCurrentlyActionable(entry) && !candidateIds.has(entry.internalProductId))
      .find((entry) => isSafeSourceAggregate(aggregatesByInternalId.get(entry.internalProductId)));
    delistProductIds.push(...selected.map((entry) => entry.internalProductId));
    for (const entry of selected) {
      const evidence = evidencesByInternalId.get(entry.internalProductId);
      if (evidence) executableLinks.push(evidence);
    }
    if (source) {
      newLinkItems.push(newLinkItemFromSource(source, selected.length, group.aggregates[0]!));
    } else {
      for (const entry of selected) newLinkItems.push(selfCopyNewLinkItem(entry, aggregatesByInternalId.get(entry.internalProductId)!));
    }
    groupEvidence.push({
      groupId,
      activeCount,
      limit,
      selectedProductIds: selected.map((entry) => entry.internalProductId),
      limitExcludedProductIds,
      ...(source ? { source: sourceEvidence(source, aggregatesByInternalId.get(source.internalProductId), groupId) } : {}),
    });
    lines.push(`- ${source?.sameSkuGroupId ?? groupId}：下架 ${selected.map((entry) => entry.internalProductId).join('、')}，补链源 ${source ? source.internalProductId : '自复制'}`);
    remaining -= selected.length;
    excluded += Math.max(0, group.entries.length - selected.length);
  }

  const plan = delistProductIds.length > 0 ? {
    date: input.date,
    delistProductIds,
    newLinkItems,
    skippedGroups,
    executableCount: delistProductIds.length,
    evidence: { executableLinks, manualReviewLinks, excludedLinks, groups: groupEvidence },
  } : null;
  return {
    plan,
    summary: { candidates: manualReview + excluded + delistProductIds.length, executable: delistProductIds.length, manualReview, excluded },
    lines,
  };
}

async function loadPartialCopyBlockedProductIds(outputDir: string): Promise<Set<string>> {
  const auditDir = join(outputDir, 'latest', 'inactive-refresh-audits');
  let names: string[];
  try {
    names = await readdir(auditDir);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return new Set();
    throw error;
  }
  const productIds = new Set<string>();
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const parsed = JSON.parse(await readFile(join(auditDir, name), 'utf8')) as unknown;
    for (const productId of partialCopyBlockedProductIdsFromAudit(parsed)) productIds.add(productId);
  }
  return productIds;
}

function partialCopyBlockedProductIdsFromAudit(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const audit = value as PartialCopyAuditShape;
  if (audit.ok === true) return [];
  const copiedCount = arrayOfRecords(audit.copyResults).filter((item) => item.ok === true && stringValue(item.newProductId)).length;
  if (copiedCount === 0) return [];
  const planned = arrayOfStrings(audit.plan?.delistProductIds);
  const delisted = new Set(arrayOfRecords(audit.delistResults).filter((item) => item.ok === true).map((item) => stringValue(item.productId)).filter((item): item is string => Boolean(item)));
  return planned.filter((productId) => !delisted.has(productId));
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : [];
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
