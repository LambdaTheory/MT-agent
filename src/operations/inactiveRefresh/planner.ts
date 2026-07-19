import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../../agentData/windowAggregate.js';
import { createLinkRegistry } from '../../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../../linkRegistry/types.js';
import type { InactiveRefreshLinkEvidence, InactiveRefreshMetricEvidence, InactiveRefreshNewLinkItem, InactiveRefreshPlanEvidence, InactiveRefreshPlanResult, InactiveRefreshSourceEvidence } from './types.js';

const DAILY_LIMIT = 20;
const EVIDENCE_LIMIT = 30;

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

function pushBounded<T>(target: T[], value: T): void {
  if (target.length < EVIDENCE_LIMIT) target.push(value);
}

export async function buildInactiveRefreshPlan(input: { outputDir: string; date: string; registryEntries: LinkRegistryEntry[] }): Promise<InactiveRefreshPlanResult> {
  const aggregates = await aggregateWindowProducts({ outputDir: input.outputDir, endDate: input.date, windowDays: 14 });
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
    if (entry && entry.status !== 'active') continue;
    const groupId = entry?.sameSkuGroupId ?? `ungrouped:${aggregate.internalProductId}`;
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
    const candidateIds = new Set(group.entries.map((entry) => entry.internalProductId));
    const source = registry
      .listBySameSkuGroup(groupId, { includeRemoved: false })
      .filter((entry) => entry.status === 'active' && !candidateIds.has(entry.internalProductId))
      .find((entry) => isSafeSourceAggregate(aggregatesByInternalId.get(entry.internalProductId)));
    if (!source) {
      skippedGroups.push(`${groupId}: 无安全源`);
      continue;
    }
    const activeCount = registry.listBySameSkuGroup(groupId, { includeRemoved: false }).filter((entry) => entry.status === 'active').length;
    const limit = Math.min(groupLimit(activeCount), remaining, group.entries.length);
    const selected = group.entries.slice(0, limit);
    const limitExcludedProductIds = group.entries.slice(limit).map((entry) => entry.internalProductId);
    if (selected.length === 0) continue;
    delistProductIds.push(...selected.map((entry) => entry.internalProductId));
    for (const entry of selected) {
      const evidence = evidencesByInternalId.get(entry.internalProductId);
      if (evidence) executableLinks.push(evidence);
    }
    newLinkItems.push({
      keyword: source.sameSkuGroupId ?? displayName(source, group.aggregates[0]!),
      count: selected.length,
      sourceProductId: source.internalProductId,
      sourceProductName: source.shortName ?? source.productName ?? source.internalProductId,
      ...(source.sameSkuGroupId ? { sameSkuGroupId: source.sameSkuGroupId } : {}),
    });
    groupEvidence.push({
      groupId,
      activeCount,
      limit,
      selectedProductIds: selected.map((entry) => entry.internalProductId),
      limitExcludedProductIds,
      source: sourceEvidence(source, aggregatesByInternalId.get(source.internalProductId), groupId),
    });
    lines.push(`- ${source.sameSkuGroupId ?? groupId}：下架 ${selected.map((entry) => entry.internalProductId).join('、')}，补链源 ${source.internalProductId}`);
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
