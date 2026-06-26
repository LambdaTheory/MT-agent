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
  | 'override_risk';

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
  same_sku_group_missing: '缺同款组',
  classification_missing: '缺分类',
  platform_mapping_missing: '缺平台映射',
  recent_new_link: '近7天新链接',
  same_sku_group_sample_insufficient: '同款组样本不足',
  override_risk: '人工覆盖风险',
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

function isReady(entry: LinkRegistryEntry): boolean {
  return hasGroup(entry) && hasClassification(entry) && hasMapping(entry);
}

export function isMqOfflineLinkText(value: string): boolean {
  return /(^|[\s\-_()])mq(?=$|[\s\-_()])/i.test(value.trim());
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
  return entryTexts(entry).some(isMqOfflineLinkText);
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
  if (!hasMapping(entry)) reasons.push('platform_mapping_missing');
  if (entry.status === 'active' && !isReady(entry) && isRecent(entry, options.referenceDate, options.recentWindowDays)) {
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
      if (visibleEntries.length === 0 || visibleEntries.length >= MIN_SAME_SKU_GROUP_SAMPLE_SIZE) return null;
      const updatedAt = visibleEntries.find((entry) => entry.updatedAt)?.updatedAt;
      return {
        kind: 'same_sku_group',
        priority: 'p1',
        reasonCodes: ['same_sku_group_sample_insufficient'],
        reasonLabels: labelsFor(['same_sku_group_sample_insufficient']),
        sameSkuGroupId: group.sameSkuGroupId,
        ...(updatedAt ? { updatedAt } : {}),
      };
    })
    .filter((item): item is LinkRegistryMaintenanceQueueItem => item !== null);

  const riskQueue = overrideRisks.map(overrideRiskQueueItem);
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
