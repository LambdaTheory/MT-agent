import { readFile } from 'node:fs/promises';
import type { LinkRegistryEntryOverride, LinkRegistryOverrides } from './overrides.js';
import { writeJsonAtomic } from './persistence.js';

export interface LinkRegistryGroupReviewApprovalRow {
  priority: string;
  reviewReasons: string;
  sameSkuGroupId: string;
  currentDisplayName: string;
  suggestedShortName: string;
  decision: string;
  finalShortName: string;
  finalSameSkuGroupId: string;
  finalCategoryName: string;
  finalProductType: string;
  note: string;
  activeLinkCount: string;
  totalLinkCount: string;
  categoryName: string;
  productType: string;
  internalProductIds: string;
  aliases: string;
  risks: string;
}

export interface LinkRegistryGroupReviewApprovalItem {
  sameSkuGroupId: string;
  currentDisplayName: string;
  finalShortName: string;
  approvedFromSuggested: boolean;
  decision?: string;
  note?: string;
  internalProductIds: string[];
  finalSameSkuGroupId?: string;
  finalCategoryName?: string;
  finalProductType?: string;
  status: 'applied' | 'skipped';
  skipReason?: string;
}

export interface LinkRegistryGroupReviewApprovalResult {
  sourceCsvPath: string;
  generatedAt: string;
  summary: {
    reviewedRows: number;
    changedRows: number;
    appliedRows: number;
    skippedRows: number;
    entryOverrideCount: number;
    duplicateShortNameBuckets: number;
  };
  duplicateShortNameGroups: Array<{
    finalShortName: string;
    groups: string[];
  }>;
  items: LinkRegistryGroupReviewApprovalItem[];
  overrides: LinkRegistryOverrides;
}

function normalizeCell(value: string | undefined): string {
  return (value ?? '').replace(/^\uFEFF/, '').trim();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text: string): LinkRegistryGroupReviewApprovalRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]!).map(normalizeCell);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record = Object.fromEntries(header.map((key, index) => [key, normalizeCell(values[index])])) as Record<string, string>;
    return {
      priority: record.priority ?? '',
      reviewReasons: record.reviewReasons ?? '',
      sameSkuGroupId: record.sameSkuGroupId ?? '',
      currentDisplayName: record.currentDisplayName ?? '',
      suggestedShortName: record.suggestedShortName ?? '',
      decision: record.decision ?? '',
      finalShortName: record.finalShortName ?? '',
      finalSameSkuGroupId: record.finalSameSkuGroupId ?? '',
      finalCategoryName: record.finalCategoryName ?? '',
      finalProductType: record.finalProductType ?? '',
      note: record.note ?? '',
      activeLinkCount: record.activeLinkCount ?? '',
      totalLinkCount: record.totalLinkCount ?? '',
      categoryName: record.categoryName ?? '',
      productType: record.productType ?? '',
      internalProductIds: record.internalProductIds ?? '',
      aliases: record.aliases ?? '',
      risks: record.risks ?? '',
    };
  });
}

function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }
}

function changedRow(row: LinkRegistryGroupReviewApprovalRow): boolean {
  return Boolean(
    normalizeCell(row.finalShortName)
    || normalizeCell(row.decision)
    || normalizeCell(row.note)
    || normalizeCell(row.finalSameSkuGroupId)
    || normalizeCell(row.finalCategoryName)
    || normalizeCell(row.finalProductType),
  );
}

function effectiveShortName(row: LinkRegistryGroupReviewApprovalRow): { value: string; approvedFromSuggested: boolean } {
  const finalShortName = normalizeCell(row.finalShortName);
  if (finalShortName) return { value: finalShortName, approvedFromSuggested: false };
  const suggested = normalizeCell(row.suggestedShortName);
  const current = normalizeCell(row.currentDisplayName);
  if (suggested && suggested !== current) return { value: suggested, approvedFromSuggested: true };
  return { value: '', approvedFromSuggested: false };
}

function internalProductIdsOf(raw: string): string[] {
  return [...new Set((raw.match(/\d+/g) ?? []).map((value) => value.trim()).filter(Boolean))];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function aliasSeeds(finalShortName: string): string[] {
  const trimmed = normalizeCell(finalShortName);
  if (!trimmed) return [];
  const seeds = new Set<string>([trimmed]);
  if (/[a-z]/i.test(trimmed) && /\d/.test(trimmed)) {
    seeds.add(trimmed.replace(/\s+/g, ''));
    seeds.add(trimmed.replace(/([a-zA-Z])(\d)/g, '$1 $2'));
    seeds.add(trimmed.replace(/(\d)([a-zA-Z])/g, '$1 $2'));
  }
  return uniqueSorted([...seeds]);
}

function approvalItem(row: LinkRegistryGroupReviewApprovalRow): LinkRegistryGroupReviewApprovalItem {
  const internalProductIds = internalProductIdsOf(row.internalProductIds);
  const shortName = effectiveShortName(row);
  return {
    sameSkuGroupId: normalizeCell(row.sameSkuGroupId),
    currentDisplayName: normalizeCell(row.currentDisplayName),
    finalShortName: shortName.value,
    approvedFromSuggested: shortName.approvedFromSuggested,
    ...(normalizeCell(row.decision) ? { decision: normalizeCell(row.decision) } : {}),
    ...(normalizeCell(row.note) ? { note: normalizeCell(row.note) } : {}),
    internalProductIds,
    ...(normalizeCell(row.finalSameSkuGroupId) ? { finalSameSkuGroupId: normalizeCell(row.finalSameSkuGroupId) } : {}),
    ...(normalizeCell(row.finalCategoryName) ? { finalCategoryName: normalizeCell(row.finalCategoryName) } : {}),
    ...(normalizeCell(row.finalProductType) ? { finalProductType: normalizeCell(row.finalProductType) } : {}),
    status: internalProductIds.length > 0 && shortName.value ? 'applied' : 'skipped',
    ...(internalProductIds.length === 0 ? { skipReason: 'missing_internal_product_ids' } : {}),
    ...(internalProductIds.length > 0 && !shortName.value ? { skipReason: 'no_effective_short_name' } : {}),
  };
}

function buildEntryOverrides(items: LinkRegistryGroupReviewApprovalItem[], reviewedDate: string): LinkRegistryEntryOverride[] {
  const byInternalProductId = new Map<string, LinkRegistryEntryOverride>();

  for (const item of items) {
    if (item.status !== 'applied' || !item.finalShortName) continue;
    for (const internalProductId of item.internalProductIds) {
      const current = byInternalProductId.get(internalProductId) ?? { internalProductId };
      byInternalProductId.set(internalProductId, {
        ...current,
        shortName: item.finalShortName,
        aliases: uniqueSorted([...(current.aliases ?? []), ...aliasSeeds(item.finalShortName)]),
        ...(item.finalSameSkuGroupId ? { sameSkuGroupId: item.finalSameSkuGroupId } : {}),
        ...(item.finalCategoryName ? { categoryName: item.finalCategoryName } : {}),
        ...(item.finalProductType ? { productType: item.finalProductType } : {}),
        confidence: 0.95,
        updatedAt: reviewedDate,
        reason: 'link_registry_group_review_approval',
        maintainer: 'group_review_csv',
      });
    }
  }

  return [...byInternalProductId.values()].sort((left, right) => left.internalProductId.localeCompare(right.internalProductId));
}

function duplicateShortNameGroups(items: LinkRegistryGroupReviewApprovalItem[]): Array<{ finalShortName: string; groups: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    if (!item.finalShortName) continue;
    const current = buckets.get(item.finalShortName) ?? [];
    current.push(item.sameSkuGroupId);
    buckets.set(item.finalShortName, current);
  }
  return [...buckets.entries()]
    .filter(([, groups]) => new Set(groups).size > 1)
    .map(([finalShortName, groups]) => ({ finalShortName, groups: uniqueSorted(groups) }))
    .sort((left, right) => right.groups.length - left.groups.length || left.finalShortName.localeCompare(right.finalShortName));
}

export async function readLinkRegistryGroupReviewApprovalCsv(path: string): Promise<LinkRegistryGroupReviewApprovalRow[]> {
  return parseCsv(decodeCsvBuffer(await readFile(path)));
}

export function buildLinkRegistryGroupReviewApprovalResult(
  sourceCsvPath: string,
  rows: LinkRegistryGroupReviewApprovalRow[],
  generatedAt = new Date().toISOString(),
): LinkRegistryGroupReviewApprovalResult {
  const changedRows = rows.filter(changedRow);
  const reviewedDateMatch = sourceCsvPath.match(/(\d{4}-\d{2}-\d{2})/);
  const reviewedDate = reviewedDateMatch?.[1] ?? generatedAt.slice(0, 10);
  const items = rows
    .map(approvalItem)
    .filter((item) => item.finalShortName || item.decision || item.note || item.finalSameSkuGroupId || item.finalCategoryName || item.finalProductType);
  const entryOverrides = buildEntryOverrides(items, reviewedDate);
  const duplicateGroups = duplicateShortNameGroups(items);

  return {
    sourceCsvPath,
    generatedAt,
    summary: {
      reviewedRows: rows.length,
      changedRows: changedRows.length,
      appliedRows: items.filter((item) => item.status === 'applied').length,
      skippedRows: items.filter((item) => item.status === 'skipped').length,
      entryOverrideCount: entryOverrides.length,
      duplicateShortNameBuckets: duplicateGroups.length,
    },
    duplicateShortNameGroups: duplicateGroups,
    items,
    overrides: {
      version: 1,
      entries: entryOverrides,
    },
  };
}

export function mergeLinkRegistryOverrides(base: LinkRegistryOverrides | null | undefined, patch: LinkRegistryOverrides): LinkRegistryOverrides {
  const entryMap = new Map<string, LinkRegistryEntryOverride>();
  for (const entry of base?.entries ?? []) {
    entryMap.set(entry.internalProductId, { ...entry, ...(entry.aliases ? { aliases: [...entry.aliases] } : {}) });
  }
  for (const entry of patch.entries ?? []) {
    const current = entryMap.get(entry.internalProductId);
    entryMap.set(entry.internalProductId, {
      ...current,
      ...entry,
      ...(current?.aliases || entry.aliases ? { aliases: uniqueSorted([...(current?.aliases ?? []), ...(entry.aliases ?? [])]) } : {}),
    });
  }

  return {
    version: 1,
    ...(entryMap.size > 0 ? { entries: [...entryMap.values()].sort((left, right) => left.internalProductId.localeCompare(right.internalProductId)) } : {}),
    ...(base?.shortNameRules ? { shortNameRules: base.shortNameRules } : {}),
    ...(base?.sameSkuGroupAliasRules ? { sameSkuGroupAliasRules: base.sameSkuGroupAliasRules } : {}),
  };
}

export function renderLinkRegistryGroupReviewApprovalResultMarkdown(result: LinkRegistryGroupReviewApprovalResult): string {
  const lines: string[] = [];
  lines.push('# 商品组审批落地结果');
  lines.push('');
  lines.push(`- 生成时间：${result.generatedAt}`);
  lines.push(`- 审批清单：${result.sourceCsvPath}`);
  lines.push(`- 已读取变更行：${result.summary.changedRows}`);
  lines.push(`- 已落地到 override 的组：${result.summary.appliedRows}`);
  lines.push(`- 因缺少端内 ID 暂未落地的组：${result.summary.skippedRows}`);
  lines.push(`- 写入 entry override 条数：${result.summary.entryOverrideCount}`);
  lines.push(`- 重名短名桶：${result.summary.duplicateShortNameBuckets}`);
  lines.push('');

  lines.push('## 1. 已落地');
  lines.push('');
  const applied = result.items.filter((item) => item.status === 'applied');
  if (applied.length === 0) {
    lines.push('暂无可直接落地项。');
    lines.push('');
  } else {
    applied.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.sameSkuGroupId} -> ${item.finalShortName}${item.approvedFromSuggested ? '（接受建议）' : ''} | 端内 ID ${item.internalProductIds.join('、')}`);
    });
    lines.push('');
  }

  lines.push('## 2. 暂未落地');
  lines.push('');
  const skipped = result.items.filter((item) => item.status === 'skipped');
  if (skipped.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    skipped.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.sameSkuGroupId} -> ${item.finalShortName || '未填'} | 原因 ${item.skipReason ?? 'unknown'}`);
    });
    lines.push('');
  }

  lines.push('## 3. 重名短名桶');
  lines.push('');
  if (result.duplicateShortNameGroups.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    result.duplicateShortNameGroups.forEach((bucket, index) => {
      lines.push(`${index + 1}. ${bucket.finalShortName} | ${bucket.groups.join('、')}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeLinkRegistryOverrides(path: string, overrides: LinkRegistryOverrides): Promise<void> {
  await writeJsonAtomic(path, overrides);
}
