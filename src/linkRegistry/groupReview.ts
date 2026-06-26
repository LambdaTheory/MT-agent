import { normalizeAlias } from './alias.js';
import { buildLinkRegistryAudit, type LinkRegistryAudit, type LinkRegistrySameSkuGroupAudit } from './audit.js';
import type { LinkRegistrySameSkuGroupAliasRule } from './overrides.js';
import type { LinkRegistryEntry } from './types.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusSnapshot, InventoryStatusTopLink } from '../inventoryStatus/types.js';

export type LinkRegistryGroupNamingStatus = 'named' | 'short_name_missing' | 'machine_named';

export interface LinkRegistryGroupReviewItem {
  sameSkuGroupId: string;
  displayName: string;
  namingStatus: LinkRegistryGroupNamingStatus;
  activeLinkCount: number;
  totalLinkCount: number;
  mappedRowCount: number;
  missingMetricLinkCount: number;
  sampleSize: number;
  sampleInsufficient: boolean;
  confidence: LinkRegistrySameSkuGroupAudit['confidence'];
  manual: boolean;
  categoryName?: string;
  productType?: string;
  shortNames: string[];
  aliases: string[];
  internalProductIds: string[];
  platformProductIds: string[];
  statuses: Array<{ internalProductId: string; status: LinkRegistryEntry['status'] }>;
  risks: string[];
}

export interface LinkRegistryDuplicateNameGroup {
  normalizedName: string;
  displayNames: string[];
  groups: LinkRegistryGroupReviewItem[];
}

export interface LinkRegistryUngroupedEntryReviewItem {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  shortName?: string;
  status: LinkRegistryEntry['status'];
  categoryName?: string;
  productType?: string;
}

export interface LinkRegistryGroupReviewReport {
  generatedAt: string;
  snapshotDate?: string;
  sourceReportDate?: string;
  registryBacked: boolean;
  summary: {
    totalGroups: number;
    namedGroups: number;
    shortNameMissingGroups: number;
    machineNamedGroups: number;
    duplicateNameBuckets: number;
    duplicateNamedGroups: number;
    sampleInsufficientGroups: number;
    ungroupedEntries: number;
    totalLinks: number;
    activeLinks: number;
  };
  groups: LinkRegistryGroupReviewItem[];
  duplicateNameGroups: LinkRegistryDuplicateNameGroup[];
  namingReviewGroups: LinkRegistryGroupReviewItem[];
  sampleInsufficientGroups: LinkRegistryGroupReviewItem[];
  ungroupedEntries: LinkRegistryUngroupedEntryReviewItem[];
}

export interface LinkRegistryGroupReviewApprovalRow {
  priority: 'P0' | 'P1' | 'P2';
  reviewReasons: string[];
  sameSkuGroupId: string;
  currentDisplayName: string;
  suggestedShortName: string;
  decision: string;
  finalShortName: string;
  finalSameSkuGroupId: string;
  finalCategoryName: string;
  finalProductType: string;
  note: string;
  activeLinkCount: number;
  totalLinkCount: number;
  categoryName: string;
  productType: string;
  internalProductIds: string[];
  aliases: string[];
  risks: string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function statusCounts(entries: LinkRegistryEntry[]): { total: number; active: number } {
  return {
    total: entries.length,
    active: entries.filter((entry) => entry.status === 'active').length,
  };
}

function topLinkStatus(topLink: InventoryStatusTopLink): LinkRegistryEntry['status'] {
  return topLink.status;
}

function registryCoverage(audit: LinkRegistryAudit, snapshot: InventoryStatusSnapshot | null | undefined): boolean {
  const snapshotGroups = snapshot?.groups.length ?? 0;
  if (snapshotGroups === 0) return audit.sameSkuGroups.length > 0;
  return audit.sameSkuGroups.length >= Math.max(1, Math.floor(snapshotGroups * 0.6));
}

function groupNamingStatus(group: { displayName: string; sameSkuGroupId: string; shortNames: string[] }): LinkRegistryGroupNamingStatus {
  if (group.displayName.trim() === group.sameSkuGroupId.trim()) return 'machine_named';
  if (group.shortNames.length === 0) return 'short_name_missing';
  return 'named';
}

function displayNameOf(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null, sameSkuGroupId: string): string {
  return snapshotGroup?.groupName?.trim()
    || groupAudit?.entries.find((entry) => entry.shortName?.trim())?.shortName?.trim()
    || groupAudit?.entries.find((entry) => entry.productName?.trim())?.productName?.trim()
    || sameSkuGroupId;
}

function mergeRiskTexts(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string[] {
  return uniqueSorted([
    ...(groupAudit?.risks.map((risk) => risk.message) ?? []),
    ...(snapshotGroup?.risks ?? []),
  ]);
}

function overlapCount(groupAudit: LinkRegistrySameSkuGroupAudit, snapshotGroup: InventoryStatusGroupSnapshot): number {
  const internalIds = new Set(groupAudit.entries.map((entry) => entry.internalProductId));
  return snapshotGroup.topLinks.reduce((count, link) => count + Number(internalIds.has(link.internalProductId)), 0);
}

function matchedSnapshotGroup(
  groupAudit: LinkRegistrySameSkuGroupAudit | null,
  sameSkuGroupId: string,
  snapshotGroups: InventoryStatusGroupSnapshot[],
  snapshotGroupById: Map<string, InventoryStatusGroupSnapshot>,
): InventoryStatusGroupSnapshot | null {
  const exact = snapshotGroupById.get(sameSkuGroupId);
  if (exact) return exact;
  if (!groupAudit) return null;

  const ranked = snapshotGroups
    .map((group) => ({ group, overlap: overlapCount(groupAudit, group) }))
    .filter((item) => item.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || right.group.activeLinkCount - left.group.activeLinkCount);
  return ranked[0]?.group ?? null;
}

function reviewSort(left: LinkRegistryGroupReviewItem, right: LinkRegistryGroupReviewItem): number {
  return Number(left.namingStatus === 'named') - Number(right.namingStatus === 'named')
    || Number(left.sampleInsufficient) - Number(right.sampleInsufficient)
    || right.activeLinkCount - left.activeLinkCount
    || right.totalLinkCount - left.totalLinkCount
    || left.sameSkuGroupId.localeCompare(right.sameSkuGroupId);
}

function normalizedDisplayName(displayName: string): string {
  return normalizeAlias(displayName)?.compact || displayName.trim().toLowerCase();
}

function formatNamingStatus(status: LinkRegistryGroupNamingStatus): string {
  if (status === 'machine_named') return '机器名';
  if (status === 'short_name_missing') return '缺短名';
  return '已命名';
}

function groupCategoryName(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string | undefined {
  return snapshotGroup?.categoryName?.trim()
    || groupAudit?.entries.find((entry) => entry.categoryName?.trim())?.categoryName?.trim();
}

function groupProductType(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string | undefined {
  return snapshotGroup?.productType?.trim()
    || groupAudit?.entries.find((entry) => entry.productType?.trim())?.productType?.trim();
}

function groupShortNames(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string[] {
  return uniqueSorted([
    ...(groupAudit?.entries.flatMap((entry) => entry.shortName?.trim() ? [entry.shortName.trim()] : []) ?? []),
    ...(snapshotGroup?.topLinks.flatMap((link) => link.shortName?.trim() ? [link.shortName.trim()] : []) ?? []),
  ]);
}

function groupAliases(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null, aliasRules: string[]): string[] {
  return uniqueSorted([
    ...(groupAudit?.entries.flatMap((entry) => entry.aliases ?? []) ?? []),
    ...aliasRules,
    ...(snapshotGroup?.groupName?.trim() ? [snapshotGroup.groupName.trim()] : []),
  ]);
}

function groupInternalProductIds(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string[] {
  return uniqueSorted([
    ...(groupAudit?.entries.map((entry) => entry.internalProductId) ?? []),
    ...(snapshotGroup?.topLinks.map((link) => link.internalProductId) ?? []),
  ]);
}

function groupPlatformProductIds(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): string[] {
  return uniqueSorted([
    ...(groupAudit?.entries.flatMap((entry) => entry.platformProductId?.trim() ? [entry.platformProductId.trim()] : []) ?? []),
    ...(snapshotGroup?.topLinks.flatMap((link) => link.platformProductId?.trim() ? [link.platformProductId.trim()] : []) ?? []),
  ]);
}

function groupStatuses(groupAudit: LinkRegistrySameSkuGroupAudit | null, snapshotGroup: InventoryStatusGroupSnapshot | null): Array<{ internalProductId: string; status: LinkRegistryEntry['status'] }> {
  const byId = new Map<string, LinkRegistryEntry['status']>();
  for (const entry of groupAudit?.entries ?? []) byId.set(entry.internalProductId, entry.status);
  for (const topLink of snapshotGroup?.topLinks ?? []) {
    if (!byId.has(topLink.internalProductId)) byId.set(topLink.internalProductId, topLinkStatus(topLink));
  }
  return [...byId.entries()]
    .map(([internalProductId, status]) => ({ internalProductId, status }))
    .sort((left, right) => left.internalProductId.localeCompare(right.internalProductId));
}

function reportLineValue(values: string[], fallback = '无'): string {
  return values.length > 0 ? values.join('、') : fallback;
}

function titleCaseWord(word: string): string {
  if (!word) return '';
  if (/^\d+$/.test(word)) return word;
  if (/^[a-z]{1,4}\d+$/i.test(word)) return word.toUpperCase();
  if (/^[a-z]+$/i.test(word)) return `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`;
  return word;
}

function slugSuggestedShortName(group: LinkRegistryGroupReviewItem): string {
  const raw = group.sameSkuGroupId.trim();
  if (!/^[a-z0-9_-]+$/i.test(raw)) return group.displayName;
  const parts = raw
    .split(/[-_]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return group.displayName;

  const removableBrands = new Set(['dji', 'fujifilm', 'insta360', 'canon', 'sony', 'nikon', 'panasonic', 'vivo', 'samsung', 'apple', 'instax']);
  const compact = parts.join('');
  if (compact.includes('pocket3')) return 'Pocket 3';
  if (compact.includes('acepro2')) return 'Ace Pro 2';
  if (compact.includes('wide300')) return 'Wide 300';
  if (compact.includes('wide40')) return 'Wide 40';
  if (compact.includes('x200ultra')) return 'X200 Ultra';
  if (compact.includes('x300ultra')) return 'X300 Ultra';
  if (compact.includes('action5pro')) return 'Action 5 Pro';
  if (compact.includes('osmonano')) return 'Osmo Nano';
  if (compact.includes('mini12')) return 'Mini 12';
  if (compact.includes('mini11')) return 'Mini 11';
  if (compact.includes('mini99')) return 'Mini 99';
  if (compact.includes('minievo')) return 'Mini Evo';
  if (compact.includes('sq1')) return 'SQ1';
  if (compact.includes('sx740')) return 'SX740';
  if (compact.includes('sx70')) return 'SX70';
  if (compact.includes('g7x2')) return 'G7X2';
  if (compact.includes('g7x3')) return 'G7X3';
  if (compact.includes('cp1500')) return 'CP1500';
  if (compact.includes('r50')) return 'R50';

  const trimmedParts = removableBrands.has(parts[0]!.toLowerCase()) ? parts.slice(1) : parts;
  const suggestion = trimmedParts.map(titleCaseWord).join(' ').trim();
  return suggestion || group.displayName;
}

function suggestedShortName(group: LinkRegistryGroupReviewItem): string {
  if (group.shortNames.length > 0) return group.shortNames[0]!;
  if (group.namingStatus === 'machine_named') return slugSuggestedShortName(group);
  if (group.displayName !== group.sameSkuGroupId) return group.displayName;
  return slugSuggestedShortName(group);
}

function reviewReasonsOf(group: LinkRegistryGroupReviewItem): string[] {
  const reasons: string[] = [];
  if (group.namingStatus === 'machine_named') reasons.push('机器名待改');
  if (group.namingStatus === 'short_name_missing') reasons.push('缺短名');
  if (group.sampleInsufficient) reasons.push('样本不足');
  if (group.risks.length > 0) reasons.push('存在风险');
  if (!group.categoryName) reasons.push('缺 category');
  if (!group.productType) reasons.push('缺 productType');
  return reasons;
}

function priorityOf(group: LinkRegistryGroupReviewItem): 'P0' | 'P1' | 'P2' {
  if (group.namingStatus === 'machine_named' && group.activeLinkCount >= 3) return 'P0';
  if (group.sampleInsufficient || group.risks.length > 0 || group.namingStatus !== 'named') return 'P1';
  return 'P2';
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildLinkRegistryGroupReviewApprovalRows(report: LinkRegistryGroupReviewReport): LinkRegistryGroupReviewApprovalRow[] {
  return report.groups.map((group) => ({
    priority: priorityOf(group),
    reviewReasons: reviewReasonsOf(group),
    sameSkuGroupId: group.sameSkuGroupId,
    currentDisplayName: group.displayName,
    suggestedShortName: suggestedShortName(group),
    decision: '',
    finalShortName: '',
    finalSameSkuGroupId: '',
    finalCategoryName: '',
    finalProductType: '',
    note: '',
    activeLinkCount: group.activeLinkCount,
    totalLinkCount: group.totalLinkCount,
    categoryName: group.categoryName ?? '',
    productType: group.productType ?? '',
    internalProductIds: group.internalProductIds,
    aliases: group.aliases,
    risks: group.risks,
  }))
    .sort((left, right) => left.priority.localeCompare(right.priority) || right.activeLinkCount - left.activeLinkCount || left.sameSkuGroupId.localeCompare(right.sameSkuGroupId));
}

export function renderLinkRegistryGroupReviewApprovalCsv(report: LinkRegistryGroupReviewReport): string {
  const rows = buildLinkRegistryGroupReviewApprovalRows(report);
  const header = [
    'priority',
    'reviewReasons',
    'sameSkuGroupId',
    'currentDisplayName',
    'suggestedShortName',
    'decision',
    'finalShortName',
    'finalSameSkuGroupId',
    'finalCategoryName',
    'finalProductType',
    'note',
    'activeLinkCount',
    'totalLinkCount',
    'categoryName',
    'productType',
    'internalProductIds',
    'aliases',
    'risks',
  ];
  const body = rows.map((row) => [
    row.priority,
    row.reviewReasons.join(' / '),
    row.sameSkuGroupId,
    row.currentDisplayName,
    row.suggestedShortName,
    row.decision,
    row.finalShortName,
    row.finalSameSkuGroupId,
    row.finalCategoryName,
    row.finalProductType,
    row.note,
    row.activeLinkCount,
    row.totalLinkCount,
    row.categoryName,
    row.productType,
    row.internalProductIds.join('、'),
    row.aliases.join('、'),
    row.risks.join('；'),
  ].map(csvCell).join(','));
  return `\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}\n`;
}

export function renderLinkRegistryGroupReviewApprovalGuide(report: LinkRegistryGroupReviewReport): string {
  const rows = buildLinkRegistryGroupReviewApprovalRows(report);
  const p0 = rows.filter((row) => row.priority === 'P0').length;
  const p1 = rows.filter((row) => row.priority === 'P1').length;
  const p2 = rows.filter((row) => row.priority === 'P2').length;
  return [
    '# 商品组审批说明',
    '',
    `- 快照日期：${report.snapshotDate ?? '未知'}`,
    `- 本次待审商品组：${rows.length}`,
    `- P0：${p0}（高频机器名组，建议优先定短名）`,
    `- P1：${p1}（样本不足 / 有风险 / 缺分类）`,
    `- P2：${p2}（其余复核项）`,
    '',
    '## 你怎么审',
    '',
    '1. 打开同目录下的 CSV 审批清单。',
    '2. 重点填写这几列：`decision`、`finalShortName`、`finalSameSkuGroupId`、`finalCategoryName`、`finalProductType`、`note`。',
    '3. 常见 decision 建议：`accept`、`rename`、`merge`、`split`、`watch`。',
    '4. 如果机器建议可用，直接把 `suggestedShortName` 复制到 `finalShortName` 即可。',
    '5. 填完后告诉我“已审核完，请读取审批清单”，我就可以继续据此落地。',
    '',
    '## 列说明',
    '',
    '- `currentDisplayName`：当前组展示名。',
    '- `suggestedShortName`：本轮自动给出的短名建议，只供你确认，不会自动写库。',
    '- `reviewReasons`：为什么这组被列入审核。',
    '- `final*`：你确认后的最终结果。',
    '',
  ].join('\n');
}

export function renderLinkRegistryGroupReviewMarkdown(report: LinkRegistryGroupReviewReport): string {
  const lines: string[] = [];
  lines.push('# 商品组审核单');
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  if (report.snapshotDate) lines.push(`- 快照日期：${report.snapshotDate}`);
  if (report.sourceReportDate) lines.push(`- 数据来源日报：${report.sourceReportDate}`);
  lines.push(`- 组成员来源：${report.registryBacked ? '链接档案 + 快照' : '快照主导（成员 ID 可能仅展示主力链接）'}`);
  lines.push(`- 同款组总数：${report.summary.totalGroups}`);
  lines.push(`- 已命名组：${report.summary.namedGroups}`);
  lines.push(`- 缺短名组：${report.summary.shortNameMissingGroups}`);
  lines.push(`- 机器名组：${report.summary.machineNamedGroups}`);
  lines.push(`- 同名冲突桶：${report.summary.duplicateNameBuckets}`);
  lines.push(`- 样本不足组：${report.summary.sampleInsufficientGroups}`);
  lines.push(`- 未归组链接：${report.summary.ungroupedEntries}`);
  lines.push(`- 链接总数：${report.summary.totalLinks}（active ${report.summary.activeLinks}）`);
  lines.push('');

  lines.push('## 1. 命名待审核组');
  lines.push('');
  if (report.namingReviewGroups.length === 0) {
    lines.push('暂无需要补命名的组。');
    lines.push('');
  } else {
    report.namingReviewGroups.forEach((group, index) => {
      lines.push(`### ${index + 1}. ${group.displayName}`);
      lines.push(`- sameSkuGroupId：${group.sameSkuGroupId}`);
      lines.push(`- 命名状态：${formatNamingStatus(group.namingStatus)}`);
      lines.push(`- 链接数：active ${group.activeLinkCount} / total ${group.totalLinkCount}`);
      lines.push(`- 分类：${group.categoryName ?? '未填'} / ${group.productType ?? '未填'}`);
      lines.push(`- 端内 ID：${reportLineValue(group.internalProductIds)}`);
      lines.push(`- 平台 ID：${reportLineValue(group.platformProductIds, '未记录')}`);
      lines.push(`- 短名候选：${reportLineValue(group.shortNames)}`);
      lines.push(`- Alias：${reportLineValue(group.aliases)}`);
      lines.push(`- 风险：${reportLineValue(group.risks)}`);
      lines.push('');
    });
  }

  lines.push('## 2. 同名组');
  lines.push('');
  if (report.duplicateNameGroups.length === 0) {
    lines.push('暂无同名冲突。');
    lines.push('');
  } else {
    report.duplicateNameGroups.forEach((bucket, index) => {
      lines.push(`### ${index + 1}. ${bucket.displayNames[0] ?? bucket.normalizedName}`);
      lines.push(`- 归一名称：${bucket.normalizedName}`);
      bucket.groups.forEach((group) => {
        lines.push(`- ${group.sameSkuGroupId} | ${group.displayName} | active ${group.activeLinkCount}/${group.totalLinkCount} | 端内 ID ${reportLineValue(group.internalProductIds)}`);
      });
      lines.push('');
    });
  }

  lines.push('## 3. 样本不足组');
  lines.push('');
  if (report.sampleInsufficientGroups.length === 0) {
    lines.push('暂无样本不足组。');
    lines.push('');
  } else {
    report.sampleInsufficientGroups.forEach((group, index) => {
      lines.push(`${index + 1}. ${group.displayName} | ${group.sameSkuGroupId} | active ${group.activeLinkCount}/${group.totalLinkCount} | 端内 ID ${reportLineValue(group.internalProductIds)}`);
    });
    lines.push('');
  }

  lines.push('## 4. 未归组链接');
  lines.push('');
  if (report.ungroupedEntries.length === 0) {
    if (report.summary.ungroupedEntries === 0) {
      lines.push('暂无未归组链接。');
    } else {
      lines.push(`当前快照显示有 ${report.summary.ungroupedEntries} 条未归组链接，但由于本地链接档案分组信息未完全回灌，暂不展示逐条明细。`);
    }
    lines.push('');
  } else {
    report.ungroupedEntries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.internalProductId} | ${entry.shortName ?? entry.productName ?? '未命名'} | 状态 ${entry.status} | 分类 ${entry.categoryName ?? '未填'} / ${entry.productType ?? '未填'}`);
    });
    lines.push('');
  }

  lines.push('## 5. 全量商品组');
  lines.push('');
  report.groups.forEach((group, index) => {
    lines.push(`${index + 1}. ${group.displayName} | ${group.sameSkuGroupId} | ${formatNamingStatus(group.namingStatus)} | active ${group.activeLinkCount}/${group.totalLinkCount} | 端内 ID ${reportLineValue(group.internalProductIds)}`);
  });
  lines.push('');

  return lines.join('\n');
}

export function buildLinkRegistryGroupReviewReport(input: {
  entries: LinkRegistryEntry[];
  sameSkuGroupAliasRules?: LinkRegistrySameSkuGroupAliasRule[];
  snapshot?: InventoryStatusSnapshot | null;
  generatedAt?: string;
}): LinkRegistryGroupReviewReport {
  const audit: LinkRegistryAudit = buildLinkRegistryAudit(input.entries);
  const snapshot = input.snapshot ?? null;
  const snapshotGroups = snapshot?.groups ?? [];
  const snapshotGroupById = new Map(snapshotGroups.map((group) => [group.sameSkuGroupId, group]));
  const aliasRulesByGroupId = new Map<string, string[]>();
  for (const rule of input.sameSkuGroupAliasRules ?? []) {
    aliasRulesByGroupId.set(rule.sameSkuGroupId, uniqueSorted(rule.aliases));
  }

  const auditGroupById = new Map(audit.sameSkuGroups.map((group) => [group.sameSkuGroupId, group]));
  const registryBacked = registryCoverage(audit, snapshot);
  const groupIds = registryBacked
    ? uniqueSorted(audit.sameSkuGroups.map((group) => group.sameSkuGroupId))
    : uniqueSorted([
      ...audit.sameSkuGroups.map((group) => group.sameSkuGroupId),
      ...snapshotGroups.map((group) => group.sameSkuGroupId),
    ]);

  const groups = groupIds
    .map((sameSkuGroupId) => {
      const groupAudit = auditGroupById.get(sameSkuGroupId) ?? null;
      const snapshotGroup = matchedSnapshotGroup(groupAudit, sameSkuGroupId, snapshotGroups, snapshotGroupById);
      const displayName = displayNameOf(groupAudit, snapshotGroup, sameSkuGroupId);
      const shortNames = groupShortNames(groupAudit, snapshotGroup);
      const aliases = groupAliases(groupAudit, snapshotGroup, aliasRulesByGroupId.get(sameSkuGroupId) ?? []);
      const internalProductIds = groupInternalProductIds(groupAudit, snapshotGroup);
      const platformProductIds = groupPlatformProductIds(groupAudit, snapshotGroup);
      const statuses = groupStatuses(groupAudit, snapshotGroup);
      const snapshotCounts = snapshotGroup ? { total: snapshotGroup.totalLinkCount, active: snapshotGroup.activeLinkCount } : null;
      const auditCounts = groupAudit ? statusCounts(groupAudit.entries) : null;
      const totalLinkCount = snapshotCounts?.total ?? auditCounts?.total ?? 0;
      const activeLinkCount = snapshotCounts?.active ?? auditCounts?.active ?? 0;

      return {
        sameSkuGroupId,
        displayName,
        namingStatus: groupNamingStatus({ displayName, sameSkuGroupId, shortNames }),
        activeLinkCount,
        totalLinkCount,
        mappedRowCount: snapshotGroup?.mappedRowCount ?? 0,
        missingMetricLinkCount: snapshotGroup?.missingMetricLinkCount ?? 0,
        sampleSize: groupAudit?.sampleSize ?? totalLinkCount,
        sampleInsufficient: groupAudit?.sampleInsufficient ?? totalLinkCount < 3,
        confidence: groupAudit?.confidence ?? (totalLinkCount === 0 ? 'none' : totalLinkCount < 3 ? 'low' : 'sufficient'),
        manual: groupAudit?.manual ?? false,
        ...(groupCategoryName(groupAudit, snapshotGroup) ? { categoryName: groupCategoryName(groupAudit, snapshotGroup) } : {}),
        ...(groupProductType(groupAudit, snapshotGroup) ? { productType: groupProductType(groupAudit, snapshotGroup) } : {}),
        shortNames,
        aliases,
        internalProductIds,
        platformProductIds,
        statuses,
        risks: mergeRiskTexts(groupAudit, snapshotGroup),
      } satisfies LinkRegistryGroupReviewItem;
    })
    .sort(reviewSort);

  const duplicateNameGroups = [...groups.reduce((map, group) => {
    const key = normalizedDisplayName(group.displayName);
    const bucket = map.get(key) ?? [];
    bucket.push(group);
    map.set(key, bucket);
    return map;
  }, new Map<string, LinkRegistryGroupReviewItem[]>()).entries()]
    .filter(([, items]) => items.length > 1)
    .map(([normalizedName, items]) => ({
      normalizedName,
      displayNames: uniqueSorted(items.map((item) => item.displayName)),
      groups: items.slice().sort((left, right) => left.sameSkuGroupId.localeCompare(right.sameSkuGroupId)),
    }))
    .sort((left, right) => right.groups.length - left.groups.length || left.normalizedName.localeCompare(right.normalizedName));

  const namingReviewGroups = groups.filter((group) => group.namingStatus !== 'named');
  const sampleInsufficientGroups = groups.filter((group) => group.sampleInsufficient);
  const ungroupedEntries = (registryBacked ? input.entries.filter((entry) => !entry.sameSkuGroupId?.trim()) : [])
    .map((entry) => ({
      internalProductId: entry.internalProductId,
      ...(entry.platformProductId?.trim() ? { platformProductId: entry.platformProductId.trim() } : {}),
      ...(entry.productName?.trim() ? { productName: entry.productName.trim() } : {}),
      ...(entry.shortName?.trim() ? { shortName: entry.shortName.trim() } : {}),
      status: entry.status,
      ...(entry.categoryName?.trim() ? { categoryName: entry.categoryName.trim() } : {}),
      ...(entry.productType?.trim() ? { productType: entry.productType.trim() } : {}),
    }))
    .sort((left, right) => left.internalProductId.localeCompare(right.internalProductId));

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ...(snapshot?.date ? { snapshotDate: snapshot.date } : {}),
    ...(snapshot?.sourceReportDate ? { sourceReportDate: snapshot.sourceReportDate } : {}),
    registryBacked,
    summary: {
      totalGroups: groups.length,
      namedGroups: groups.filter((group) => group.namingStatus === 'named').length,
      shortNameMissingGroups: groups.filter((group) => group.namingStatus === 'short_name_missing').length,
      machineNamedGroups: groups.filter((group) => group.namingStatus === 'machine_named').length,
      duplicateNameBuckets: duplicateNameGroups.length,
      duplicateNamedGroups: duplicateNameGroups.reduce((sum, bucket) => sum + bucket.groups.length, 0),
      sampleInsufficientGroups: sampleInsufficientGroups.length,
      ungroupedEntries: registryBacked ? ungroupedEntries.length : (snapshot?.coverage.ungroupedLinkCount ?? 0),
      totalLinks: snapshot?.summary.totalLinkCount ?? input.entries.length,
      activeLinks: snapshot?.summary.activeLinkCount ?? input.entries.filter((entry) => entry.status === 'active').length,
    },
    groups,
    duplicateNameGroups,
    namingReviewGroups,
    sampleInsufficientGroups,
    ungroupedEntries,
  };
}
