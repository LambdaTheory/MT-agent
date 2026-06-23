import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LinkRegistryQuery } from '../linkRegistry/queryRegistry.js';
import { buildClosedOrderConfidenceFeedback } from './feedback.js';
import type {
  ClosedOrderIngestedRecord,
  ClosedOrderObservationGroup,
  ClosedOrderObservationReport,
  ClosedOrderReasonTag,
} from './types.js';

const REASON_TAGS: ClosedOrderReasonTag[] = ['pricing', 'spec', 'inventory', 'service', 'logistics', 'irrelevant', 'unclear'];

const REASON_TAG_LABELS: Record<ClosedOrderReasonTag, string> = {
  pricing: '价格',
  spec: '规格',
  inventory: '库存',
  service: '服务',
  logistics: '物流',
  irrelevant: '噪声',
  unclear: '不明确',
};

const MANUAL_REVIEW_REASON_LABELS: Record<string, string> = {
  same_group_repeated_closed_orders: '同组重复关单',
  pricing_signal: '价格信号',
  inventory_signal: '库存信号',
  missing_link_registry: '缺少链接映射',
  missing_same_sku_group: '缺少同款分组',
  low_confidence: '低置信度',
};

function emptyReasonCounts(): Record<ClosedOrderReasonTag, number> {
  return {
    pricing: 0,
    spec: 0,
    inventory: 0,
    service: 0,
    logistics: 0,
    irrelevant: 0,
    unclear: 0,
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventDate(record: ClosedOrderIngestedRecord): Date | null {
  return parseDate(record.closedAt) ?? parseDate(record.lastIngestedAt);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWithinWindow(record: ClosedOrderIngestedRecord, reportDate: Date, windowDays: number): boolean {
  const occurredAt = eventDate(record);
  if (!occurredAt) return false;
  const end = startOfUtcDay(reportDate).getTime() + 24 * 60 * 60 * 1000;
  const start = end - windowDays * 24 * 60 * 60 * 1000;
  const time = occurredAt.getTime();
  return time >= start && time < end;
}

function normalizeRemark(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function pickTopReason(reasonCounts: Record<ClosedOrderReasonTag, number>): ClosedOrderReasonTag {
  return REASON_TAGS.reduce((best, current) => {
    if (reasonCounts[current] > reasonCounts[best]) return current;
    return best;
  }, 'unclear');
}

function compareGroups(left: ClosedOrderObservationGroup, right: ClosedOrderObservationGroup): number {
  return (
    right.recordCount - left.recordCount ||
    right.totalSeenCount - left.totalSeenCount ||
    (right.latestClosedAt ?? '').localeCompare(left.latestClosedAt ?? '') ||
    left.displayLabel.localeCompare(right.displayLabel)
  );
}

function latestTimestamp(current: string | null, candidate: string | undefined): string | null {
  if (!candidate?.trim()) return current;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

export function closedOrderReasonTagLabel(tag: ClosedOrderReasonTag): string {
  return REASON_TAG_LABELS[tag];
}

export function closedOrderManualReviewReasonLabel(reason: string): string {
  return MANUAL_REVIEW_REASON_LABELS[reason] ?? reason;
}

export function closedOrderManualReviewReasonLabels(reasons: readonly string[]): string[] {
  return reasons.map((reason) => closedOrderManualReviewReasonLabel(reason));
}

export function closedOrderReasonCountsText(reasonCounts: Record<ClosedOrderReasonTag, number>): string {
  return REASON_TAGS
    .filter((tag) => reasonCounts[tag] > 0)
    .map((tag) => `${closedOrderReasonTagLabel(tag)}:${reasonCounts[tag]}`)
    .join(' | ') || '无';
}

export async function buildClosedOrderObservationReport(
  records: readonly ClosedOrderIngestedRecord[],
  linkRegistry: LinkRegistryQuery,
  options: { reportDate?: string; windowDays?: number; generatedAt?: string } = {},
): Promise<ClosedOrderObservationReport> {
  const reportDate = parseDate(options.reportDate ?? new Date().toISOString()) ?? new Date();
  const reportDateText = isoDate(reportDate);
  const windowDays = Math.max(1, Math.trunc(options.windowDays ?? 7));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const filteredRecords = records.filter((record) => isWithinWindow(record, reportDate, windowDays));
  const summaryReasonCounts = emptyReasonCounts();
  const groups = new Map<string, ClosedOrderObservationGroup>();
  let todayRecordCount = 0;
  let linkedRecordCount = 0;
  let groupedRecordCount = 0;

  for (const record of filteredRecords) {
    const feedback = await buildClosedOrderConfidenceFeedback(record, linkRegistry);
    const linkEntry = linkRegistry.byInternalId(record.internalProductId);
    const occurredAt = eventDate(record);
    if (occurredAt && isoDate(occurredAt) === reportDateText) todayRecordCount += 1;
    if (feedback.dataCompleteness.hasLinkRegistryEntry) linkedRecordCount += 1;
    if (feedback.sameSkuGroupId) groupedRecordCount += 1;
    summaryReasonCounts[feedback.inferredReason] += 1;

    const groupKey = feedback.sameSkuGroupId ?? `product:${record.internalProductId}`;
    const displayLabel = linkEntry?.shortName?.trim() || `商品 ${record.internalProductId}`;
    const group = groups.get(groupKey) ?? {
      groupKey,
      displayLabel,
      sameSkuGroupId: feedback.sameSkuGroupId,
      internalProductIds: [],
      recordCount: 0,
      totalSeenCount: 0,
      latestClosedAt: null,
      topReason: 'unclear',
      reasonCounts: emptyReasonCounts(),
      sampleRemarks: [],
      needsManualReview: false,
      manualReviewReasons: [],
      missingLinkRegistryCount: 0,
      missingSameSkuGroupCount: 0,
      lowConfidenceCount: 0,
    };

    if (!group.internalProductIds.includes(record.internalProductId)) group.internalProductIds.push(record.internalProductId);
    group.recordCount += 1;
    group.totalSeenCount += record.seenCount;
    group.latestClosedAt = latestTimestamp(group.latestClosedAt, record.closedAt ?? record.lastIngestedAt);
    group.reasonCounts[feedback.inferredReason] += 1;
    if (!feedback.dataCompleteness.hasLinkRegistryEntry) group.missingLinkRegistryCount += 1;
    if (!feedback.dataCompleteness.hasSameSkuGroupId) group.missingSameSkuGroupCount += 1;
    if (feedback.confidence <= 0.25) group.lowConfidenceCount += 1;

    const normalizedRemark = normalizeRemark(record.rawRemark);
    if (normalizedRemark && !group.sampleRemarks.includes(normalizedRemark) && group.sampleRemarks.length < 3) {
      group.sampleRemarks.push(normalizedRemark);
    }

    groups.set(groupKey, group);
  }

  const finalizedGroups = [...groups.values()].map((group) => {
    const manualReviewReasons = new Set<string>();
    if (group.recordCount >= 2) manualReviewReasons.add('same_group_repeated_closed_orders');
    if (group.reasonCounts.pricing > 0) manualReviewReasons.add('pricing_signal');
    if (group.reasonCounts.inventory > 0) manualReviewReasons.add('inventory_signal');
    if (group.missingLinkRegistryCount > 0) manualReviewReasons.add('missing_link_registry');
    if (group.missingSameSkuGroupCount > 0) manualReviewReasons.add('missing_same_sku_group');
    if (group.lowConfidenceCount > 0) manualReviewReasons.add('low_confidence');
    group.topReason = pickTopReason(group.reasonCounts);
    group.needsManualReview = manualReviewReasons.size > 0;
    group.manualReviewReasons = [...manualReviewReasons];
    group.internalProductIds.sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
    return group;
  }).sort(compareGroups);

  return {
    date: reportDateText,
    windowDays,
    generatedAt,
    summary: {
      recordCount: filteredRecords.length,
      totalSeenCount: filteredRecords.reduce((sum, record) => sum + record.seenCount, 0),
      todayRecordCount,
      groupCount: finalizedGroups.length,
      manualReviewGroupCount: finalizedGroups.filter((group) => group.needsManualReview).length,
      linkedRecordCount,
      groupedRecordCount,
      reasonCounts: summaryReasonCounts,
    },
    groups: finalizedGroups,
  };
}

export function buildClosedOrderObservationMarkdown(report: ClosedOrderObservationReport): string {
  const lines = [
    `# 关单观察 ${report.date}`,
    '',
    `窗口：近 ${report.windowDays} 天`,
    `记录数：${report.summary.recordCount} | 今日条数：${report.summary.todayRecordCount} | 去重累计出现次数：${report.summary.totalSeenCount}`,
    `分组数：${report.summary.groupCount} | 需人工复核：${report.summary.manualReviewGroupCount} | 已命中 link registry：${report.summary.linkedRecordCount}`,
    `原因分布：${closedOrderReasonCountsText(report.summary.reasonCounts)}`,
    '',
    '## 重点分组',
    '',
  ];

  for (const [index, group] of report.groups.slice(0, 10).entries()) {
    lines.push(`### ${index + 1}. ${group.displayLabel}`);
    lines.push(`分组键：${group.groupKey}`);
    lines.push(`商品：${group.internalProductIds.join(', ')} | 记录数：${group.recordCount} | 累计出现次数：${group.totalSeenCount}`);
    lines.push(`主因：${closedOrderReasonTagLabel(group.topReason)} | 原因分布：${closedOrderReasonCountsText(group.reasonCounts)}`);
    lines.push(`同款组：${group.sameSkuGroupId ?? '未识别'} | 最近时间：${group.latestClosedAt ?? '未知'}`);
    if (group.sampleRemarks.length > 0) lines.push(`备注样本：${group.sampleRemarks.join(' / ')}`);
    if (group.needsManualReview) lines.push(`人工复核：${closedOrderManualReviewReasonLabels(group.manualReviewReasons).join('、')}`);
    lines.push('');
  }

  if (report.groups.every((group) => !group.needsManualReview)) {
    lines.push('## 人工复核');
    lines.push('');
    lines.push('当前窗口内没有新增人工复核分组。');
    return lines.join('\n');
  }

  lines.push('## 人工复核');
  lines.push('');
  for (const group of report.groups.filter((item) => item.needsManualReview).slice(0, 10)) {
    lines.push(`- ${group.displayLabel} (${group.internalProductIds.join(', ')})：${closedOrderManualReviewReasonLabels(group.manualReviewReasons).join('、')}`);
  }
  return lines.join('\n');
}

export async function writeClosedOrderObservationReportArtifacts(
  jsonPath: string,
  markdownPath: string,
  report: ClosedOrderObservationReport,
): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${buildClosedOrderObservationMarkdown(report)}\n`, 'utf8');
}
