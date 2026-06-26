import { canonicalProductShortName } from '../publicTraffic/productDisplayName.js';
import type { LinkRegistryAudit, LinkRegistrySameSkuGroupAudit } from './audit.js';
import { isLinkRegistryMaintenanceIgnoredEntry, isMqOfflineLinkText } from './maintenance.js';
import type { LinkRegistryMaintenanceQueueItem, LinkRegistryMaintenanceReport } from './maintenance.js';
import type { LinkRegistryEntry } from './types.js';

export interface LinkRegistryAuditReviewRow {
  priority: 'P0' | 'P1' | 'P2';
  kind: 'entry' | 'same_sku_group' | 'override_risk';
  reviewReasons: string[];
  internalProductId: string;
  internalProductIds: string[];
  platformProductId: string;
  sameSkuGroupId: string;
  originalProductName: string;
  productName: string;
  shortName: string;
  categoryName: string;
  productType: string;
  status: string;
  activeLinkCount: number;
  totalLinkCount: number;
  sampleSize: number;
  confidence: string;
  message: string;
  firstSeenDate: string;
  updatedAt: string;
  suggestedShortName: string;
  decision: string;
  finalSameSkuGroupId: string;
  finalCategoryName: string;
  finalProductType: string;
  finalShortName: string;
  note: string;
}

export interface LinkRegistryAuditReviewReport {
  generatedAt: string;
  summary: {
    totalRows: number;
    p0Rows: number;
    p1Rows: number;
    p2Rows: number;
    entryRows: number;
    sameSkuGroupRows: number;
    overrideRiskRows: number;
  };
  rows: LinkRegistryAuditReviewRow[];
}

function reviewKeyOf(row: LinkRegistryAuditReviewRow): string {
  if (row.kind === 'entry') return `entry:${row.internalProductId}`;
  if (row.kind === 'same_sku_group') return `same_sku_group:${row.sameSkuGroupId}`;
  return `override_risk:${row.internalProductId || row.sameSkuGroupId || row.platformProductId || row.shortName || 'unknown'}`;
}

function reviewSubjectOf(row: LinkRegistryAuditReviewRow): string {
  return row.internalProductId || row.sameSkuGroupId || row.shortName || row.productName || row.platformProductId || '未命名项';
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function priorityOf(value: LinkRegistryMaintenanceQueueItem['priority']): 'P0' | 'P1' | 'P2' {
  if (value === 'p0') return 'P0';
  if (value === 'p1') return 'P1';
  return 'P2';
}

function compactCompareValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function originalNameCandidates(values: Array<string | undefined>, excluded: string[]): string[] {
  const excludedSet = new Set(excluded.map(compactCompareValue).filter(Boolean));
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    if (isMqOfflineLinkText(trimmed)) continue;
    const compact = compactCompareValue(trimmed);
    if (!compact || excludedSet.has(compact)) continue;
    if (!unique.has(compact)) unique.set(compact, trimmed);
  }
  return [...unique.values()];
}

function originalProductNameOf(entry: Pick<LinkRegistryEntry, 'productName' | 'aliases' | 'shortName' | 'sameSkuGroupId' | 'internalProductId' | 'platformProductId'>): string {
  const candidates = originalNameCandidates(
    [entry.productName, ...(entry.aliases ?? [])],
    [entry.shortName ?? '', entry.sameSkuGroupId ?? '', entry.internalProductId, entry.platformProductId ?? ''],
  );
  return candidates.sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? '';
}

function originalProductNamesOfGroup(group: LinkRegistrySameSkuGroupAudit): string[] {
  const candidates = originalNameCandidates(
    group.entries.flatMap((entry) => [entry.productName, ...(entry.aliases ?? [])]),
    group.entries.flatMap((entry) => [
      entry.shortName ?? '',
      entry.sameSkuGroupId ?? '',
      entry.internalProductId,
      entry.platformProductId ?? '',
    ]),
  );
  return candidates.sort((left, right) => right.length - left.length || left.localeCompare(right)).slice(0, 5);
}

function suggestedShortNameOf(values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const canonical = canonicalProductShortName(trimmed).trim();
    if (canonical) return canonical;
  }
  return '';
}

function groupContextMap(audit: LinkRegistryAudit): Map<string, LinkRegistrySameSkuGroupAudit> {
  return new Map(audit.sameSkuGroups.map((group) => [group.sameSkuGroupId, group]));
}

function representativeEntry(group: LinkRegistrySameSkuGroupAudit): LinkRegistryEntry | null {
  return group.entries.find((entry) => entry.status === 'active')
    ?? group.entries.find((entry) => entry.shortName?.trim() || entry.productName?.trim())
    ?? group.entries[0]
    ?? null;
}

function rowForEntry(queueItem: LinkRegistryMaintenanceQueueItem, entry: LinkRegistryEntry): LinkRegistryAuditReviewRow {
  const suggestedShortName = suggestedShortNameOf([entry.shortName, entry.productName]);
  const originalProductName = originalProductNameOf(entry);
  return {
    priority: priorityOf(queueItem.priority),
    kind: 'entry',
    reviewReasons: queueItem.reasonLabels,
    internalProductId: entry.internalProductId,
    internalProductIds: [entry.internalProductId],
    platformProductId: entry.platformProductId?.trim() ?? '',
    sameSkuGroupId: entry.sameSkuGroupId?.trim() ?? '',
    originalProductName,
    productName: entry.productName?.trim() ?? '',
    shortName: entry.shortName?.trim() ?? '',
    categoryName: entry.categoryName?.trim() ?? '',
    productType: entry.productType?.trim() ?? '',
    status: entry.status,
    activeLinkCount: entry.status === 'active' ? 1 : 0,
    totalLinkCount: 1,
    sampleSize: entry.sameSkuGroupId?.trim() ? 1 : 0,
    confidence: entry.confidence?.toFixed(2) ?? '',
    message: queueItem.message ?? '',
    firstSeenDate: entry.firstSeenDate?.trim() ?? '',
    updatedAt: entry.updatedAt?.trim() ?? '',
    suggestedShortName,
    decision: '',
    finalSameSkuGroupId: '',
    finalCategoryName: '',
    finalProductType: '',
    finalShortName: suggestedShortName,
    note: '',
  };
}

function rowForGroup(queueItem: LinkRegistryMaintenanceQueueItem, group: LinkRegistrySameSkuGroupAudit): LinkRegistryAuditReviewRow {
  const visibleEntries = group.entries.filter((item) => !isLinkRegistryMaintenanceIgnoredEntry(item));
  const entries = visibleEntries.length > 0 ? visibleEntries : group.entries;
  const visibleGroup = { ...group, entries };
  const entry = representativeEntry(visibleGroup);
  const originalProductNames = originalProductNamesOfGroup(visibleGroup);
  const suggestedShortName = suggestedShortNameOf([
    entry?.shortName,
    entry?.productName,
    ...entries.map((item) => item.shortName),
    ...entries.map((item) => item.productName),
  ]);
  return {
    priority: priorityOf(queueItem.priority),
    kind: 'same_sku_group',
    reviewReasons: queueItem.reasonLabels,
    internalProductId: '',
    internalProductIds: uniqueSorted(entries.map((item) => item.internalProductId)),
    platformProductId: '',
    sameSkuGroupId: group.sameSkuGroupId,
    originalProductName: originalProductNames.join('；'),
    productName: entry?.productName?.trim() ?? '',
    shortName: entry?.shortName?.trim() ?? '',
    categoryName: entry?.categoryName?.trim() ?? '',
    productType: entry?.productType?.trim() ?? '',
    status: '',
    activeLinkCount: entries.filter((item) => item.status === 'active').length,
    totalLinkCount: entries.length,
    sampleSize: entries.length,
    confidence: entries.length >= 3 ? 'sufficient' : entries.length > 0 ? 'low' : 'none',
    message: uniqueSorted(group.risks.map((risk) => risk.message)).join('；'),
    firstSeenDate: '',
    updatedAt: entry?.updatedAt?.trim() ?? '',
    suggestedShortName,
    decision: '',
    finalSameSkuGroupId: '',
    finalCategoryName: '',
    finalProductType: '',
    finalShortName: suggestedShortName,
    note: '',
  };
}

function rowForRisk(queueItem: LinkRegistryMaintenanceQueueItem): LinkRegistryAuditReviewRow {
  const suggestedShortName = suggestedShortNameOf([queueItem.shortName, queueItem.productName]);
  return {
    priority: priorityOf(queueItem.priority),
    kind: 'override_risk',
    reviewReasons: queueItem.reasonLabels,
    internalProductId: queueItem.internalProductId ?? '',
    internalProductIds: queueItem.internalProductId ? [queueItem.internalProductId] : [],
    platformProductId: queueItem.platformProductId ?? '',
    sameSkuGroupId: queueItem.sameSkuGroupId ?? '',
    originalProductName: queueItem.productName ?? '',
    productName: queueItem.productName ?? '',
    shortName: queueItem.shortName ?? '',
    categoryName: '',
    productType: '',
    status: queueItem.status ?? '',
    activeLinkCount: 0,
    totalLinkCount: 0,
    sampleSize: 0,
    confidence: '',
    message: queueItem.message ?? '',
    firstSeenDate: queueItem.firstSeenDate ?? '',
    updatedAt: queueItem.updatedAt ?? '',
    suggestedShortName,
    decision: '',
    finalSameSkuGroupId: '',
    finalCategoryName: '',
    finalProductType: '',
    finalShortName: suggestedShortName,
    note: '',
  };
}

export function buildLinkRegistryAuditReviewReport(
  input: {
    audit: LinkRegistryAudit;
    maintenance: LinkRegistryMaintenanceReport;
    entries: LinkRegistryEntry[];
    generatedAt?: string;
  },
): LinkRegistryAuditReviewReport {
  const entryById = new Map(input.entries.map((entry) => [entry.internalProductId, entry]));
  const groupById = groupContextMap(input.audit);

  const rows = input.maintenance.queue.map((queueItem) => {
    if (queueItem.kind === 'entry' && queueItem.internalProductId) {
      const entry = entryById.get(queueItem.internalProductId);
      if (entry) return rowForEntry(queueItem, entry);
    }
    if (queueItem.kind === 'same_sku_group' && queueItem.sameSkuGroupId) {
      const group = groupById.get(queueItem.sameSkuGroupId);
      if (group) return rowForGroup(queueItem, group);
    }
    return rowForRisk(queueItem);
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      totalRows: rows.length,
      p0Rows: rows.filter((row) => row.priority === 'P0').length,
      p1Rows: rows.filter((row) => row.priority === 'P1').length,
      p2Rows: rows.filter((row) => row.priority === 'P2').length,
      entryRows: rows.filter((row) => row.kind === 'entry').length,
      sameSkuGroupRows: rows.filter((row) => row.kind === 'same_sku_group').length,
      overrideRiskRows: rows.filter((row) => row.kind === 'override_risk').length,
    },
    rows,
  };
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderLinkRegistryAuditReviewCsv(report: LinkRegistryAuditReviewReport): string {
  const header = [
    'priority',
    'kind',
    'reviewReasons',
    'internalProductId',
    'internalProductIds',
    'platformProductId',
    'sameSkuGroupId',
    'originalProductName',
    'productName',
    'shortName',
    'categoryName',
    'productType',
    'status',
    'activeLinkCount',
    'totalLinkCount',
    'sampleSize',
    'confidence',
    'message',
    'firstSeenDate',
    'updatedAt',
    'suggestedShortName',
    'decision',
    'finalSameSkuGroupId',
    'finalCategoryName',
    'finalProductType',
    'finalShortName',
    'note',
  ];
  const body = report.rows.map((row) => [
    row.priority,
    row.kind,
    row.reviewReasons.join(' / '),
    row.internalProductId,
    row.internalProductIds.join('、'),
    row.platformProductId,
    row.sameSkuGroupId,
    row.originalProductName,
    row.productName,
    row.shortName,
    row.categoryName,
    row.productType,
    row.status,
    row.activeLinkCount,
    row.totalLinkCount,
    row.sampleSize,
    row.confidence,
    row.message,
    row.firstSeenDate,
    row.updatedAt,
    row.suggestedShortName,
    row.decision,
    row.finalSameSkuGroupId,
    row.finalCategoryName,
    row.finalProductType,
    row.finalShortName,
    row.note,
  ].map(csvCell).join(','));
  return `\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}\n`;
}

export function renderLinkRegistryAuditReviewGuide(report: LinkRegistryAuditReviewReport): string {
  return [
    '# 链接档案审计审批说明',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 待审总行数：${report.summary.totalRows}`,
    `- P0：${report.summary.p0Rows}，P1：${report.summary.p1Rows}，P2：${report.summary.p2Rows}`,
    `- 明细类型：entry ${report.summary.entryRows} / same_sku_group ${report.summary.sameSkuGroupRows} / override_risk ${report.summary.overrideRiskRows}`,
    '',
    '本轮建议优先填写 Markdown 审批单；CSV 仅保留作备份。',
    '',
    '建议你主要填写这几列：',
    '- `suggestedShortName`：系统已按“去广告语，只留品牌+型号+代数”给出的建议短名。',
    '- `decision`：建议使用 `accept`、`watch`、`ignore`。',
    '- `finalSameSkuGroupId`：如果你想手动指定该条或该组最终归到哪个 sameSkuGroupId，就填这里。',
    '- `finalCategoryName` / `finalProductType`：如果你确认分类，就直接填最终值。',
    '- `finalShortName`：默认已预填建议短名；如果你想改，就直接覆盖。',
    '- `note`：补充原因、判断依据或后续动作。',
    '',
    '常见填写方式：',
    '- 单条新链接缺归组：填 `finalSameSkuGroupId`，必要时补 `finalCategoryName` / `finalProductType` / `finalShortName`。',
    '- 某个样本不足组但你确认没问题：`decision=watch`，并在 `note` 里写清原因。',
    '- 明显脏数据或暂不处理：`decision=ignore`。',
    '',
    '你填完后告诉我“已审核完，请读取审计 Markdown”，我就继续按这份单子落地。',
  ].join('\n');
}

export function renderLinkRegistryAuditReviewMarkdown(report: LinkRegistryAuditReviewReport): string {
  const lines: string[] = [];
  lines.push('# 链接档案审计审批单');
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 待审总行数：${report.summary.totalRows}`);
  lines.push(`- P0：${report.summary.p0Rows}`);
  lines.push(`- P1：${report.summary.p1Rows}`);
  lines.push(`- P2：${report.summary.p2Rows}`);
  lines.push(`- Entry：${report.summary.entryRows}`);
  lines.push(`- SameSkuGroup：${report.summary.sameSkuGroupRows}`);
  lines.push(`- OverrideRisk：${report.summary.overrideRiskRows}`);
  lines.push('');
  lines.push('## Top Rows');
  lines.push('');
  report.rows.slice(0, 30).forEach((row, index) => {
    const subject = row.internalProductId || row.sameSkuGroupId || row.shortName || row.message || `row-${index + 1}`;
    lines.push(`${index + 1}. [${row.priority}] ${subject} | ${row.reviewReasons.join('、')}`);
  });
  lines.push('');
  return lines.join('\n');
}

function pushEditableField(lines: string[], name: string, value: string): void {
  lines.push(`${name}: ${value}`);
}

export function renderLinkRegistryAuditReviewApprovalMarkdown(report: LinkRegistryAuditReviewReport): string {
  const lines: string[] = [];
  lines.push('# 链接档案审计审批单（Markdown 填写版）');
  lines.push('');
  lines.push('填写说明：');
  lines.push('- 直接修改每条下面的 `decision` / `finalSameSkuGroupId` / `finalCategoryName` / `finalProductType` / `finalShortName` / `note`。');
  lines.push('- 建议 `decision` 只填 `accept`、`watch`、`ignore`。');
  lines.push('- 没意见就可以留空；如果你认可建议短名，也可以直接把 `finalShortName` 留成系统建议值。');
  lines.push('- 填完后告诉我“已审核完，请读取审计 Markdown”。');
  lines.push('');
  lines.push(`生成时间: ${report.generatedAt}`);
  lines.push(`待审总行数: ${report.summary.totalRows}`);
  lines.push(`P0: ${report.summary.p0Rows}`);
  lines.push(`P1: ${report.summary.p1Rows}`);
  lines.push(`P2: ${report.summary.p2Rows}`);
  lines.push('');

  report.rows.forEach((row, index) => {
    lines.push(`## ${index + 1}. [${row.priority}] [${row.kind}] ${reviewSubjectOf(row)}`);
    pushEditableField(lines, 'reviewKey', reviewKeyOf(row));
    pushEditableField(lines, 'reviewReasons', row.reviewReasons.join('、'));
    pushEditableField(lines, 'internalProductId', row.internalProductId);
    pushEditableField(lines, 'internalProductIds', row.internalProductIds.join('、'));
    pushEditableField(lines, 'platformProductId', row.platformProductId);
    pushEditableField(lines, 'sameSkuGroupId', row.sameSkuGroupId);
    pushEditableField(lines, 'originalProductName', row.originalProductName || '未抓到（上游快照原名为空）');
    pushEditableField(lines, 'productName', row.productName);
    pushEditableField(lines, 'shortName', row.shortName);
    pushEditableField(lines, 'categoryName', row.categoryName);
    pushEditableField(lines, 'productType', row.productType);
    pushEditableField(lines, 'status', row.status);
    pushEditableField(lines, 'activeLinkCount', String(row.activeLinkCount));
    pushEditableField(lines, 'totalLinkCount', String(row.totalLinkCount));
    pushEditableField(lines, 'sampleSize', String(row.sampleSize));
    pushEditableField(lines, 'confidence', row.confidence);
    pushEditableField(lines, 'message', row.message);
    pushEditableField(lines, 'firstSeenDate', row.firstSeenDate);
    pushEditableField(lines, 'updatedAt', row.updatedAt);
    pushEditableField(lines, 'suggestedShortName', row.suggestedShortName);
    lines.push('');
    pushEditableField(lines, 'decision', row.decision);
    pushEditableField(lines, 'finalSameSkuGroupId', row.finalSameSkuGroupId);
    pushEditableField(lines, 'finalCategoryName', row.finalCategoryName);
    pushEditableField(lines, 'finalProductType', row.finalProductType);
    pushEditableField(lines, 'finalShortName', row.finalShortName);
    pushEditableField(lines, 'note', row.note);
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}
