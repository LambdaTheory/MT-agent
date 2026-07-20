import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InactiveRefreshGroupEvidence, InactiveRefreshLinkEvidence, InactiveRefreshMetricEvidence, InactiveRefreshNewLinkItem, InactiveRefreshPlan, InactiveRefreshPlanEvidence, InactiveRefreshSourceEvidence } from './types.js';

interface StoredInactiveRefreshPlan {
  ref: string;
  createdAt: string;
  plan: InactiveRefreshPlan;
}

function planDir(outputDir: string): string {
  return join(outputDir, 'latest', 'inactive-refresh-plans');
}

export function isInactiveRefreshPlanRef(value: unknown): value is string {
  return typeof value === 'string' && /^inactive_refresh_\d+_[a-f0-9]{16}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseMetricEvidence(value: unknown): InactiveRefreshMetricEvidence | null {
  if (!isRecord(value)) return null;
  const daysCovered = readNumber(value.daysCovered);
  const dashboardDaysCovered = readNumber(value.dashboardDaysCovered);
  const missingDashboardDays = readNumber(value.missingDashboardDays);
  if (daysCovered === undefined || dashboardDaysCovered === undefined || missingDashboardDays === undefined) return null;
  return {
    daysCovered,
    dashboardDaysCovered,
    ...(readNumber(value.custodyDays) === undefined ? {} : { custodyDays: readNumber(value.custodyDays) }),
    ...(readNumber(value.exposure14d) === undefined ? {} : { exposure14d: readNumber(value.exposure14d) }),
    ...(readNumber(value.avgExposure14d) === undefined ? {} : { avgExposure14d: readNumber(value.avgExposure14d) }),
    ...(readNumber(value.visits14d) === undefined ? {} : { visits14d: readNumber(value.visits14d) }),
    ...(readNumber(value.visitRate) === undefined ? {} : { visitRate: readNumber(value.visitRate) }),
    ...(readNumber(value.amount14d) === undefined ? {} : { amount14d: readNumber(value.amount14d) }),
    ...(readNumber(value.dashboardAmount14d) === undefined ? {} : { dashboardAmount14d: readNumber(value.dashboardAmount14d) }),
    missingDashboardDays,
  };
}

function parseLinkEvidence(value: unknown): InactiveRefreshLinkEvidence | null {
  if (!isRecord(value)) return null;
  if (typeof value.productId !== 'string') return null;
  if (typeof value.productName !== 'string') return null;
  if (typeof value.groupId !== 'string') return null;
  if (value.decision !== 'executable' && value.decision !== 'manual' && value.decision !== 'excluded') return null;
  if (typeof value.reason !== 'string') return null;
  const metrics = parseMetricEvidence(value.metrics);
  if (!metrics) return null;
  return {
    productId: value.productId,
    productName: value.productName,
    groupId: value.groupId,
    decision: value.decision,
    reason: value.reason,
    metrics,
  };
}

function parseLinkEvidenceArray(value: unknown): InactiveRefreshLinkEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const links: InactiveRefreshLinkEvidence[] = [];
  for (const item of value) {
    const parsed = parseLinkEvidence(item);
    if (!parsed) return null;
    links.push(parsed);
  }
  return links;
}

function parseSourceEvidence(value: unknown): InactiveRefreshSourceEvidence | null {
  if (!isRecord(value)) return null;
  if (typeof value.productId !== 'string') return null;
  if (typeof value.productName !== 'string') return null;
  if (typeof value.groupId !== 'string') return null;
  if (typeof value.reason !== 'string') return null;
  const metrics = parseMetricEvidence(value.metrics);
  if (!metrics) return null;
  return { productId: value.productId, productName: value.productName, groupId: value.groupId, reason: value.reason, metrics };
}

function parseGroupEvidence(value: unknown): InactiveRefreshGroupEvidence | null {
  if (!isRecord(value)) return null;
  if (typeof value.groupId !== 'string') return null;
  const activeCount = readNumber(value.activeCount);
  const limit = readNumber(value.limit);
  if (activeCount === undefined || limit === undefined) return null;
  if (!isStringArray(value.selectedProductIds)) return null;
  if (!isStringArray(value.limitExcludedProductIds)) return null;
  const source = value.source === undefined ? undefined : parseSourceEvidence(value.source);
  if (value.source !== undefined && !source) return null;
  return {
    groupId: value.groupId,
    activeCount,
    limit,
    selectedProductIds: value.selectedProductIds,
    limitExcludedProductIds: value.limitExcludedProductIds,
    ...(source ? { source } : {}),
  };
}

function parseGroupEvidenceArray(value: unknown): InactiveRefreshGroupEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const groups: InactiveRefreshGroupEvidence[] = [];
  for (const item of value) {
    const parsed = parseGroupEvidence(item);
    if (!parsed) return null;
    groups.push(parsed);
  }
  return groups;
}

function parsePlanEvidence(value: unknown): InactiveRefreshPlanEvidence | null {
  if (!isRecord(value)) return null;
  const executableLinks = parseLinkEvidenceArray(value.executableLinks);
  const manualReviewLinks = parseLinkEvidenceArray(value.manualReviewLinks);
  const excludedLinks = parseLinkEvidenceArray(value.excludedLinks);
  const groups = parseGroupEvidenceArray(value.groups);
  if (!executableLinks || !manualReviewLinks || !excludedLinks || !groups) return null;
  return { executableLinks, manualReviewLinks, excludedLinks, groups };
}

function parseNewLinkItems(value: unknown): InactiveRefreshNewLinkItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: InactiveRefreshNewLinkItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.keyword !== 'string') return null;
    if (typeof item.count !== 'number' || !Number.isInteger(item.count) || item.count < 1) return null;
    if (typeof item.sourceProductId !== 'string') return null;
    if (typeof item.sourceProductName !== 'string') return null;
    if (item.sourceStrategy !== undefined && item.sourceStrategy !== 'healthy_source' && item.sourceStrategy !== 'self_copy_fallback') return null;
    if (item.sameSkuGroupId !== undefined && typeof item.sameSkuGroupId !== 'string') return null;
    items.push({
      keyword: item.keyword,
      count: item.count,
      sourceProductId: item.sourceProductId,
      sourceProductName: item.sourceProductName,
      ...(item.sourceStrategy === undefined ? {} : { sourceStrategy: item.sourceStrategy }),
      ...(item.sameSkuGroupId === undefined ? {} : { sameSkuGroupId: item.sameSkuGroupId }),
    });
  }
  return items;
}

function parseInactiveRefreshPlan(value: unknown): InactiveRefreshPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.date !== 'string') return null;
  if (!isStringArray(value.delistProductIds)) return null;
  const newLinkItems = parseNewLinkItems(value.newLinkItems);
  if (!newLinkItems) return null;
  if (!isStringArray(value.skippedGroups)) return null;
  if (typeof value.executableCount !== 'number' || !Number.isInteger(value.executableCount) || value.executableCount < 0) return null;
  const evidence = value.evidence === undefined ? undefined : parsePlanEvidence(value.evidence);
  if (value.evidence !== undefined && !evidence) return null;
  return {
    date: value.date,
    delistProductIds: value.delistProductIds,
    newLinkItems,
    skippedGroups: value.skippedGroups,
    executableCount: value.executableCount,
    ...(evidence ? { evidence } : {}),
  };
}

function planRef(plan: InactiveRefreshPlan): string {
  const hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
  return `inactive_refresh_${Date.now()}_${hash}`;
}

export async function saveInactiveRefreshPlan(outputDir: string, plan: InactiveRefreshPlan): Promise<string> {
  const ref = planRef(plan);
  const dir = planDir(outputDir);
  await mkdir(dir, { recursive: true });
  const record: StoredInactiveRefreshPlan = { ref, createdAt: new Date().toISOString(), plan };
  await writeFile(join(dir, `${ref}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return ref;
}

export async function loadInactiveRefreshPlan(outputDir: string, ref: string): Promise<InactiveRefreshPlan | null> {
  if (!isInactiveRefreshPlanRef(ref)) return null;
  try {
    const parsed = JSON.parse(await readFile(join(planDir(outputDir), `${ref}.json`), 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.ref !== ref) return null;
    return parseInactiveRefreshPlan(parsed.plan);
  } catch (_error) {
    return null;
  }
}

export function inactiveRefreshPlanConfirmationKey(plan: InactiveRefreshPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 24);
}

export function verifyInactiveRefreshPlanKey(plan: InactiveRefreshPlan, suppliedKey: unknown): boolean {
  return typeof suppliedKey === 'string' && inactiveRefreshPlanConfirmationKey(plan) === suppliedKey;
}

export type { InactiveRefreshPlan } from './types.js';
