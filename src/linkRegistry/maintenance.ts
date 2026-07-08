import { buildLinkRegistryAudit } from './audit.js';
import type { LinkRegistryOverrideRisk } from './overrides.js';
import { MIN_SAME_SKU_GROUP_SAMPLE_SIZE } from './queryRegistry.js';
import type { LinkRegistryEntry } from './types.js';

export type LinkRegistryMaintenanceReasonCode =
  | 'same_sku_group_missing'
  | 'classification_missing'
  | 'platform_mapping_missing'
  | 'recent_new_link'
  | 'same_sku_group_sample_insufficient'
  | 'override_risk'
  | 'mixed_product_type'
  | 'promo_title_slug_leak'
  | 'group_classification_missing';

export type LinkRegistryMaintenancePriority = 'p0' | 'p1' | 'p2';

export interface LinkRegistryMaintenanceCoverageMetric {
  ready: number;
  total: number;
  ratio: number;
}

export interface LinkRegistryMaintenanceCoverage {
  grouped: LinkRegistryMaintenanceCoverageMetric;
  classified: LinkRegistryMaintenanceCoverageMetric;
  mapped: LinkRegistryMaintenanceCoverageMetric;
}

export interface LinkRegistryMaintenanceSummary {
  totalEntries: number;
  activeEntries: number;
  removedEntries: number;
  unknownEntries: number;
  readyCount: number;
  pendingCount: number;
}

export interface LinkRegistryMaintenanceQueueItem {
  kind: 'entry' | 'same_sku_group' | 'override_risk';
  priority: LinkRegistryMaintenancePriority;
  reasonCodes: LinkRegistryMaintenanceReasonCode[];
  reasonLabels: string[];
  internalProductId?: string;
  platformProductId?: string;
  productName?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status?: LinkRegistryEntry['status'];
  firstSeenDate?: string;
  updatedAt?: string;
  message?: string;
}

export interface LinkRegistryMaintenanceReport {
  summary: LinkRegistryMaintenanceSummary;
  coverage: LinkRegistryMaintenanceCoverage;
  queue: LinkRegistryMaintenanceQueueItem[];
}

export interface BuildLinkRegistryMaintenanceOptions {
  referenceDate?: string;
  recentWindowDays?: number;
}

const DEFAULT_RECENT_WINDOW_DAYS = 7;

const REASON_LABELS: Record<LinkRegistryMaintenanceReasonCode, string> = {
  same_sku_group_missing: '\u7f3a\u540c\u6b3e\u7ec4',
  classification_missing: '\u7f3a\u5206\u7c7b',
  platform_mapping_missing: '\u7f3a\u5e73\u53f0\u6620\u5c04',
  recent_new_link: '\u8fd17\u5929\u65b0\u94fe\u63a5',
  same_sku_group_sample_insufficient: '\u540c\u6b3e\u7ec4\u6837\u672c\u4e0d\u8db3',
  override_risk: '\u4eba\u5de5\u8986\u76d6\u98ce\u9669',
  mixed_product_type: '\u7ec4\u5185\u6df7\u7c7b',
  promo_title_slug_leak: '\u4fc3\u9500\u6807\u9898 slug \u6cc4\u6f0f',
  group_classification_missing: '\u7f3a\u7ec4\u7ea7\u5206\u7c7b',
};

function ratio(ready: number, total: number): number {
  if (!Number.isFinite(ready) || !Number.isFinite(total) || total <= 0) return 0;
  return Number((ready / total).toFixed(4));
}

function metric(ready: number, total: number): LinkRegistryMaintenanceCoverageMetric {
  return { ready, total, ratio: ratio(ready, total) };
}

function hasClassification(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.categoryId?.trim() && entry.productType?.trim());
}

function hasGroup(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.sameSkuGroupId?.trim());
}

function hasMapping(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.platformProductId?.trim());
}

function isPlatformMappingExpected(entry: LinkRegistryEntry): boolean {
  if (hasMapping(entry)) return true;
  if (!entry.source.includes('daemon_catalog')) return true;

  const syncStatus = entry.daemonSyncStatus?.trim() ?? '';
  if (!syncStatus) return false;

  return /(?:\u53ef\u552e\u5356|\u5df2\u540c\u6b65|\u901a\u8fc7)/u.test(syncStatus);
}

function isReady(entry: LinkRegistryEntry): boolean {
  return hasGroup(entry) && hasClassification(entry) && hasMapping(entry);
}

export function isMqOfflineLinkText(value: string): boolean {
  return /(^|[\s\-_()])mq(?=$|[\s\-_()])/i.test(value.trim());
}

export function isXianyuTrafficEntryText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes('\u95f2\u9c7c') || trimmed.includes('\u54b8\u9c7c');
}

export function isGenericFreeDepositEntryText(value: string): boolean {
  return value.trim().includes('\u514d\u62bc\u94fe\u63a5');
}

function entryTexts(entry: LinkRegistryEntry): string[] {
  return [
    entry.productName,
    entry.shortName,
    entry.sameSkuGroupId,
    ...(entry.aliases ?? []),
  ].flatMap((value) => (value?.trim() ? [value.trim()] : []));
}

export function isLinkRegistryMaintenanceIgnoredEntry(entry: LinkRegistryEntry): boolean {
  return entryTexts(entry).some((value) => (
    isMqOfflineLinkText(value)
    || isXianyuTrafficEntryText(value)
    || isGenericFreeDepositEntryText(value)
  ));
}

function parseDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(`${value.trim()}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecent(entry: LinkRegistryEntry, referenceDate: string | undefined, recentWindowDays: number): boolean {
  if (!referenceDate) return false;
  const candidate = parseDate(entry.firstSeenDate) ?? parseDate(entry.updatedAt);
  const reference = parseDate(referenceDate);
  if (!candidate || !reference) return false;
  const diff = reference.getTime() - candidate.getTime();
  return diff >= 0 && diff <= recentWindowDays * 24 * 60 * 60 * 1000;
}

function entryReasonCodes(
  entry: LinkRegistryEntry,
  options: Required<BuildLinkRegistryMaintenanceOptions>,
): LinkRegistryMaintenanceReasonCode[] {
  const reasons: LinkRegistryMaintenanceReasonCode[] = [];
  if (entry.status !== 'removed' && !hasGroup(entry)) reasons.push('same_sku_group_missing');
  if (entry.status !== 'removed' && !hasClassification(entry)) reasons.push('classification_missing');
  if (!hasMapping(entry) && isPlatformMappingExpected(entry)) reasons.push('platform_mapping_missing');
  if (entry.status === 'active' && reasons.length > 0 && isRecent(entry, options.referenceDate, options.recentWindowDays)) {
    reasons.push('recent_new_link');
  }
  return reasons;
}

function entryPriority(
  entry: LinkRegistryEntry,
  reasons: LinkRegistryMaintenanceReasonCode[],
): LinkRegistryMaintenancePriority {
  if (entry.status === 'active' && reasons.includes('recent_new_link')) return 'p0';
  if (entry.status === 'active') return 'p1';
  return 'p2';
}

function priorityScore(priority: LinkRegistryMaintenancePriority): number {
  if (priority === 'p0') return 0;
  if (priority === 'p1') return 1;
  return 2;
}

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? '').localeCompare(right ?? '');
}

function queueSort(left: LinkRegistryMaintenanceQueueItem, right: LinkRegistryMaintenanceQueueItem): number {
  return priorityScore(left.priority) - priorityScore(right.priority)
    || compareText(right.firstSeenDate, left.firstSeenDate)
    || compareText(right.updatedAt, left.updatedAt)
    || compareText(left.internalProductId ?? left.sameSkuGroupId, right.internalProductId ?? right.sameSkuGroupId);
}

function labelsFor(reasons: LinkRegistryMaintenanceReasonCode[]): string[] {
  return reasons.map((reason) => REASON_LABELS[reason]);
}

function isNaturallySparseSameSkuGroup(groupId: string | undefined): boolean {
  const trimmed = groupId?.trim() ?? '';
  if (!trimmed) return false;
  return /^canon-ixus-\d+(?:is|hs)?$/i.test(trimmed);
}

function entryQueueItem(
  entry: LinkRegistryEntry,
  reasons: LinkRegistryMaintenanceReasonCode[],
  priority: LinkRegistryMaintenancePriority,
): LinkRegistryMaintenanceQueueItem {
  return {
    kind: 'entry',
    priority,
    reasonCodes: reasons,
    reasonLabels: labelsFor(reasons),
    internalProductId: entry.internalProductId,
    ...(entry.platformProductId ? { platformProductId: entry.platformProductId } : {}),
    ...(entry.productName ? { productName: entry.productName } : {}),
    ...(entry.shortName ? { shortName: entry.shortName } : {}),
    ...(entry.sameSkuGroupId ? { sameSkuGroupId: entry.sameSkuGroupId } : {}),
    status: entry.status,
    ...(entry.firstSeenDate ? { firstSeenDate: entry.firstSeenDate } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
  };
}

function overrideRiskQueueItem(risk: LinkRegistryOverrideRisk): LinkRegistryMaintenanceQueueItem {
  return {
    kind: 'override_risk',
    priority: 'p1',
    reasonCodes: ['override_risk'],
    reasonLabels: labelsFor(['override_risk']),
    ...(risk.internalProductId ? { internalProductId: risk.internalProductId } : {}),
    ...(risk.shortName ? { shortName: risk.shortName } : {}),
    message: risk.message,
  };
}

function isActionableOverrideRisk(risk: LinkRegistryOverrideRisk): boolean {
  return Boolean(risk.internalProductId?.trim());
}

export function buildLinkRegistryMaintenanceReport(
  entries: LinkRegistryEntry[],
  overrideRisks: LinkRegistryOverrideRisk[] = [],
  options: BuildLinkRegistryMaintenanceOptions = {},
): LinkRegistryMaintenanceReport {
  const normalizedOptions: Required<BuildLinkRegistryMaintenanceOptions> = {
    referenceDate: options.referenceDate ?? '',
    recentWindowDays: options.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS,
  };

  const groupedReady = entries.filter(hasGroup).length;
  const classifiedReady = entries.filter(hasClassification).length;
  const mappedReady = entries.filter(hasMapping).length;
  const readyCount = entries.filter(isReady).length;

  const audit = buildLinkRegistryAudit(entries, overrideRisks);
  const entryQueue = entries
    .filter((entry) => !isLinkRegistryMaintenanceIgnoredEntry(entry))
    .map((entry) => {
      const reasons = entryReasonCodes(entry, normalizedOptions);
      if (reasons.length === 0) return null;
      return entryQueueItem(entry, reasons, entryPriority(entry, reasons));
    })
    .filter((item): item is LinkRegistryMaintenanceQueueItem => Boolean(item));

  const groupQueue = audit.sameSkuGroups
    .map<LinkRegistryMaintenanceQueueItem | null>((group) => {
      const visibleEntries = group.entries.filter((entry) => !isLinkRegistryMaintenanceIgnoredEntry(entry));
      if (visibleEntries.length === 0) return null;
      const governanceReasonCodes = buildLinkRegistryAudit(visibleEntries).sameSkuGroups
        .find((visibleGroup) => visibleGroup.sameSkuGroupId === group.sameSkuGroupId)?.risks
        .map((risk) => {
          if (risk.type === 'mixed_product_type') return 'mixed_product_type';
          if (risk.type === 'promo_title_slug_leak') return 'promo_title_slug_leak';
          if (risk.type === 'group_classification_missing') return 'group_classification_missing';
          return null;
        })
        .filter((reason): reason is Extract<LinkRegistryMaintenanceReasonCode, 'mixed_product_type' | 'promo_title_slug_leak' | 'group_classification_missing'> => reason !== null) ?? [];
      const sampleReasonCodes = visibleEntries.length < MIN_SAME_SKU_GROUP_SAMPLE_SIZE && !isNaturallySparseSameSkuGroup(group.sameSkuGroupId)
        ? ['same_sku_group_sample_insufficient' as const]
        : [];
      const reasonCodes = [...new Set([...governanceReasonCodes, ...sampleReasonCodes])];
      if (reasonCodes.length === 0) return null;
      const updatedAt = visibleEntries.find((entry) => entry.updatedAt)?.updatedAt;
      return {
        kind: 'same_sku_group',
        priority: governanceReasonCodes.length > 0 ? 'p0' : 'p1',
        reasonCodes,
        reasonLabels: labelsFor(reasonCodes),
        sameSkuGroupId: group.sameSkuGroupId,
        ...(updatedAt ? { updatedAt } : {}),
      };
    })
    .filter((item): item is LinkRegistryMaintenanceQueueItem => item !== null);

  const riskQueue = overrideRisks.filter(isActionableOverrideRisk).map(overrideRiskQueueItem);
  const queue = [...entryQueue, ...groupQueue, ...riskQueue].sort(queueSort);

  return {
    summary: {
      totalEntries: entries.length,
      activeEntries: entries.filter((entry) => entry.status === 'active').length,
      removedEntries: entries.filter((entry) => entry.status === 'removed').length,
      unknownEntries: entries.filter((entry) => entry.status === 'unknown').length,
      readyCount,
      pendingCount: queue.length,
    },
    coverage: {
      grouped: metric(groupedReady, entries.length),
      classified: metric(classifiedReady, entries.length),
      mapped: metric(mappedReady, entries.length),
    },
    queue,
  };
}

export function maintenanceReasonLabel(reason: LinkRegistryMaintenanceReasonCode): string {
  return REASON_LABELS[reason];
}
