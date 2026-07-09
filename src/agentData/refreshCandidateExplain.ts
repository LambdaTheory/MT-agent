import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

const REFRESH_ACTIVITY_MIN_ONLINE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RefreshCandidateExplainInput {
  query?: string;
  sameSkuGroupId?: string;
  zeroMetric: 'created_orders' | 'amount';
  date: string;
  windowDays?: number;
}

export interface RefreshCandidateExplainResult {
  scopeLine: string;
  sameSkuGroupId?: string;
  candidateCount: number;
  candidateProductIds: string[];
  missing30dDashboardProductIds: string[];
  missingRowProductIds: string[];
  skipped: {
    inactive: number;
    missingRow: number;
    missing30dDashboard: number;
    onlineLessThan30d: number;
    onlineDaysUnknown: number;
  };
  reasonSummary: string[];
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内ID\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function findReportRowForEntry(context: PublicTrafficDataReportContext, entry: LinkRegistryEntry): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => {
    const internalProductId = extractInternalProductId(row.displayProductId);
    return internalProductId === entry.internalProductId || (!!entry.platformProductId && row.platformProductId === entry.platformProductId);
  });
}

function parseDateToUtcDay(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return utc;
}

function estimateOnlineDays(row: PublicTrafficProductDataRow, entry: LinkRegistryEntry, reportDate: string): number | null {
  if (typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays) && row.custodyDays >= 0) {
    return Math.floor(row.custodyDays);
  }
  const reportDay = parseDateToUtcDay(reportDate);
  const firstSeenDay = parseDateToUtcDay(entry.firstSeenDate);
  if (reportDay === null || firstSeenDay === null || firstSeenDay > reportDay) return null;
  return Math.floor((reportDay - firstSeenDay) / MS_PER_DAY) + 1;
}

function isZeroMetricMatch(row: PublicTrafficProductDataRow, zeroMetric: RefreshCandidateExplainInput['zeroMetric']): boolean {
  const thirty = row.periods['30d'];
  return zeroMetric === 'amount' ? thirty.amount === 0 : thirty.createdOrders === 0;
}

function zeroMetricLabel(zeroMetric: RefreshCandidateExplainInput['zeroMetric'], windowDays: number): string {
  if (zeroMetric === 'amount') return `近${windowDays}天订单金额为0`;
  return windowDays === REFRESH_ACTIVITY_MIN_ONLINE_DAYS ? '近 30 天创单为 0' : `近${windowDays}天创单为0`;
}

function resolveScopedEntries(registryEntries: LinkRegistryEntry[], input: RefreshCandidateExplainInput): { entries: LinkRegistryEntry[]; scopeLine: string; sameSkuGroupId?: string } {
  const sameSkuGroupId = input.sameSkuGroupId?.trim();
  if (sameSkuGroupId) {
    const entries = registryEntries.filter((entry) => entry.sameSkuGroupId?.trim() === sameSkuGroupId);
    const label = entries.find((entry) => entry.shortName?.trim())?.shortName?.trim() || sameSkuGroupId;
    return { entries, scopeLine: `筛选范围：${label} / ${sameSkuGroupId}`, sameSkuGroupId };
  }

  const query = input.query?.trim();
  if (!query) return { entries: registryEntries, scopeLine: '筛选范围：全部链接档案' };

  const registry = createLinkRegistry(registryEntries);
  if (/^\d+$/.test(query)) {
    const entry = registry.getByInternalId(query);
    const groupId = entry?.sameSkuGroupId?.trim();
    if (groupId) {
      const entries = registry.listBySameSkuGroup(groupId, { includeRemoved: true, includeUnknown: true });
      const label = entries.find((item) => item.shortName?.trim())?.shortName?.trim() || groupId;
      return { entries, scopeLine: `筛选范围：${label} / ${groupId}`, sameSkuGroupId: groupId };
    }
  }

  const directGroup = registry.listBySameSkuGroup(query, { includeRemoved: true, includeUnknown: true });
  if (directGroup.length > 0) {
    const label = directGroup.find((entry) => entry.shortName?.trim())?.shortName?.trim() || query;
    return { entries: directGroup, scopeLine: `筛选范围：${label} / ${query}`, sameSkuGroupId: query };
  }

  const alias = registry.resolveAlias(query);
  if (alias.status === 'unique' && alias.sameSkuGroupId) {
    const entries = registry.listBySameSkuGroup(alias.sameSkuGroupId, { includeRemoved: true, includeUnknown: true });
    const label = entries.find((entry) => entry.shortName?.trim())?.shortName?.trim() || query;
    return { entries, scopeLine: `筛选范围：${label} / ${alias.sameSkuGroupId}`, sameSkuGroupId: alias.sameSkuGroupId };
  }

  return { entries: [], scopeLine: `筛选范围：${query}` };
}

function compactSkipSummary(skipped: RefreshCandidateExplainResult['skipped'], windowDays: number): string {
  return [
    skipped.inactive ? `${skipped.inactive} 条非 active` : undefined,
    skipped.missingRow ? `${skipped.missingRow} 条无日报行` : undefined,
    skipped.missing30dDashboard ? `${skipped.missing30dDashboard} 条 ${windowDays}日访问页缺失` : undefined,
    skipped.onlineLessThan30d ? `${skipped.onlineLessThan30d} 条上线不足 ${windowDays} 天` : undefined,
    skipped.onlineDaysUnknown ? `${skipped.onlineDaysUnknown} 条上线天数未知` : undefined,
  ].filter((item): item is string => Boolean(item)).join('、');
}

export function explainRefreshCandidates(
  registryEntries: LinkRegistryEntry[],
  context: PublicTrafficDataReportContext,
  input: RefreshCandidateExplainInput,
): RefreshCandidateExplainResult {
  const scoped = resolveScopedEntries(registryEntries, input);
  const windowDays = input.windowDays ?? REFRESH_ACTIVITY_MIN_ONLINE_DAYS;
  const skipped = { inactive: 0, missingRow: 0, missing30dDashboard: 0, onlineLessThan30d: 0, onlineDaysUnknown: 0 };
  const candidateProductIds: string[] = [];
  const missing30dDashboardProductIds: string[] = [];
  const missingRowProductIds: string[] = [];
  let candidateCount = 0;

  for (const entry of scoped.entries) {
    if (entry.status !== 'active') {
      skipped.inactive += 1;
      continue;
    }
    const row = findReportRowForEntry(context, entry);
    if (!row) {
      skipped.missingRow += 1;
      missingRowProductIds.push(entry.internalProductId);
      continue;
    }
    if (!row.periods['30d'].hasDashboardData) {
      skipped.missing30dDashboard += 1;
      missing30dDashboardProductIds.push(entry.internalProductId);
      continue;
    }
    const onlineDays = estimateOnlineDays(row, entry, input.date);
    if (onlineDays === null) {
      skipped.onlineDaysUnknown += 1;
      continue;
    }
    if (onlineDays < windowDays) {
      skipped.onlineLessThan30d += 1;
      continue;
    }
    if (isZeroMetricMatch(row, input.zeroMetric)) {
      candidateCount += 1;
      candidateProductIds.push(entry.internalProductId);
    }
  }

  const metricLabel = zeroMetricLabel(input.zeroMetric, windowDays);
  const skippedSummary = compactSkipSummary(skipped, windowDays);
  return {
    scopeLine: scoped.scopeLine,
    ...(scoped.sameSkuGroupId ? { sameSkuGroupId: scoped.sameSkuGroupId } : {}),
    candidateCount,
    candidateProductIds,
    missing30dDashboardProductIds,
    missingRowProductIds,
    skipped,
    reasonSummary: [
      candidateCount > 0 ? `找到 ${candidateCount} 条符合 ${metricLabel} 的 active 链接。` : `没有找到符合 ${metricLabel} 的 active 链接。`,
      ...(skippedSummary ? [`另有 ${skippedSummary}。`] : []),
    ],
  };
}
