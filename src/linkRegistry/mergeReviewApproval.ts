import { readFile } from 'node:fs/promises';
import type { LinkRegistryEntryOverride, LinkRegistryOverrides } from './overrides.js';
import { writeJsonAtomic } from './persistence.js';

export interface LinkRegistryMergeReviewApprovalRow {
  priority: string;
  shortName: string;
  suggestedTargetGroupId: string;
  candidateGroupId: string;
  activeLinkCount: string;
  totalLinkCount: string;
  internalProductIds: string;
  productNames: string;
  decision: string;
  finalTargetGroupId: string;
  note: string;
}

export interface LinkRegistryMergeReviewApprovalItem {
  shortName: string;
  candidateGroupId: string;
  suggestedTargetGroupId: string;
  finalTargetGroupId: string;
  decision?: string;
  note?: string;
  internalProductIds: string[];
  status: 'applied' | 'anchor' | 'rejected' | 'skipped';
  skipReason?: string;
}

export interface LinkRegistryMergeReviewApprovalResult {
  sourceCsvPath: string;
  generatedAt: string;
  summary: {
    reviewedRows: number;
    changedRows: number;
    appliedRows: number;
    anchorRows: number;
    rejectedRows: number;
    skippedRows: number;
    entryOverrideCount: number;
  };
  items: LinkRegistryMergeReviewApprovalItem[];
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

function parseCsv(text: string): LinkRegistryMergeReviewApprovalRow[] {
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
      shortName: record.shortName ?? '',
      suggestedTargetGroupId: record.suggestedTargetGroupId ?? '',
      candidateGroupId: record.candidateGroupId ?? '',
      activeLinkCount: record.activeLinkCount ?? '',
      totalLinkCount: record.totalLinkCount ?? '',
      internalProductIds: record.internalProductIds ?? '',
      productNames: record.productNames ?? '',
      decision: record.decision ?? '',
      finalTargetGroupId: record.finalTargetGroupId ?? '',
      note: record.note ?? '',
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

function changedRow(row: LinkRegistryMergeReviewApprovalRow): boolean {
  return Boolean(normalizeCell(row.decision) || normalizeCell(row.finalTargetGroupId) || normalizeCell(row.note));
}

function internalProductIdsOf(raw: string): string[] {
  return [...new Set((raw.match(/\d+/g) ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeDecision(raw: string): 'accept' | 'target' | 'reject' | '' {
  const value = normalizeCell(raw).toLowerCase();
  if (!value) return '';
  if (['accept', 'merge', 'yes', '同意', '并入', '合并'].includes(value)) return 'accept';
  if (['target', 'keep', 'master', '主组', '保留主组'].includes(value)) return 'target';
  if (['reject', 'skip', 'no', '拒绝', '保留原组', '暂不合并'].includes(value)) return 'reject';
  return '';
}

function approvalItem(row: LinkRegistryMergeReviewApprovalRow): LinkRegistryMergeReviewApprovalItem {
  const internalProductIds = internalProductIdsOf(row.internalProductIds);
  const decision = normalizeDecision(row.decision);
  const candidateGroupId = normalizeCell(row.candidateGroupId);
  const suggestedTargetGroupId = normalizeCell(row.suggestedTargetGroupId);
  const finalTargetGroupId = normalizeCell(row.finalTargetGroupId) || suggestedTargetGroupId;
  const note = normalizeCell(row.note);

  if (!decision && !normalizeCell(row.finalTargetGroupId) && !note) {
    return {
      shortName: normalizeCell(row.shortName),
      candidateGroupId,
      suggestedTargetGroupId,
      finalTargetGroupId,
      internalProductIds,
      status: 'skipped',
      skipReason: 'unchanged_row',
    };
  }

  if (decision === 'reject') {
    return {
      shortName: normalizeCell(row.shortName),
      candidateGroupId,
      suggestedTargetGroupId,
      finalTargetGroupId,
      decision,
      ...(note ? { note } : {}),
      internalProductIds,
      status: 'rejected',
    };
  }

  if (!internalProductIds.length) {
    return {
      shortName: normalizeCell(row.shortName),
      candidateGroupId,
      suggestedTargetGroupId,
      finalTargetGroupId,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      internalProductIds,
      status: 'skipped',
      skipReason: 'missing_internal_product_ids',
    };
  }

  if (!finalTargetGroupId) {
    return {
      shortName: normalizeCell(row.shortName),
      candidateGroupId,
      suggestedTargetGroupId,
      finalTargetGroupId,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      internalProductIds,
      status: 'skipped',
      skipReason: 'missing_final_target_group_id',
    };
  }

  if (decision === 'target' || candidateGroupId === finalTargetGroupId) {
    return {
      shortName: normalizeCell(row.shortName),
      candidateGroupId,
      suggestedTargetGroupId,
      finalTargetGroupId,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      internalProductIds,
      status: 'anchor',
    };
  }

  return {
    shortName: normalizeCell(row.shortName),
    candidateGroupId,
    suggestedTargetGroupId,
    finalTargetGroupId,
    ...(decision ? { decision } : {}),
    ...(note ? { note } : {}),
    internalProductIds,
    status: 'applied',
  };
}

function buildEntryOverrides(items: LinkRegistryMergeReviewApprovalItem[], reviewedDate: string): LinkRegistryEntryOverride[] {
  const byInternalProductId = new Map<string, LinkRegistryEntryOverride>();

  for (const item of items) {
    if (item.status !== 'applied') continue;
    for (const internalProductId of item.internalProductIds) {
      const current = byInternalProductId.get(internalProductId) ?? { internalProductId };
      byInternalProductId.set(internalProductId, {
        ...current,
        sameSkuGroupId: item.finalTargetGroupId,
        confidence: 0.95,
        updatedAt: reviewedDate,
        reason: 'link_registry_merge_review_approval',
        maintainer: 'merge_review_csv',
      });
    }
  }

  return [...byInternalProductId.values()].sort((left, right) => left.internalProductId.localeCompare(right.internalProductId));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
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

export async function readLinkRegistryMergeReviewApprovalCsv(path: string): Promise<LinkRegistryMergeReviewApprovalRow[]> {
  return parseCsv(decodeCsvBuffer(await readFile(path)));
}

export function buildLinkRegistryMergeReviewApprovalResult(
  sourceCsvPath: string,
  rows: LinkRegistryMergeReviewApprovalRow[],
  generatedAt = new Date().toISOString(),
): LinkRegistryMergeReviewApprovalResult {
  const reviewedDateMatch = sourceCsvPath.match(/(\d{4}-\d{2}-\d{2})/);
  const reviewedDate = reviewedDateMatch?.[1] ?? generatedAt.slice(0, 10);
  const items = rows.map(approvalItem);
  const entryOverrides = buildEntryOverrides(items, reviewedDate);

  return {
    sourceCsvPath,
    generatedAt,
    summary: {
      reviewedRows: rows.length,
      changedRows: rows.filter(changedRow).length,
      appliedRows: items.filter((item) => item.status === 'applied').length,
      anchorRows: items.filter((item) => item.status === 'anchor').length,
      rejectedRows: items.filter((item) => item.status === 'rejected').length,
      skippedRows: items.filter((item) => item.status === 'skipped').length,
      entryOverrideCount: entryOverrides.length,
    },
    items,
    overrides: {
      version: 1,
      entries: entryOverrides,
    },
  };
}

export function renderLinkRegistryMergeReviewApprovalResultMarkdown(result: LinkRegistryMergeReviewApprovalResult): string {
  const lines: string[] = [];
  lines.push('# 建议合并组落地结果');
  lines.push('');
  lines.push(`- 生成时间：${result.generatedAt}`);
  lines.push(`- 审批清单：${result.sourceCsvPath}`);
  lines.push(`- 已读取变更行：${result.summary.changedRows}`);
  lines.push(`- 实际写入合并：${result.summary.appliedRows}`);
  lines.push(`- 主组确认行：${result.summary.anchorRows}`);
  lines.push(`- 明确拒绝行：${result.summary.rejectedRows}`);
  lines.push(`- 跳过行：${result.summary.skippedRows}`);
  lines.push(`- 写入 entry override 条数：${result.summary.entryOverrideCount}`);
  lines.push('');

  lines.push('## 1. 已执行合并');
  lines.push('');
  const applied = result.items.filter((item) => item.status === 'applied');
  if (applied.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    applied.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.candidateGroupId} -> ${item.finalTargetGroupId} | 端内 ID ${item.internalProductIds.join('、')}`);
    });
    lines.push('');
  }

  lines.push('## 2. 主组确认');
  lines.push('');
  const anchors = result.items.filter((item) => item.status === 'anchor');
  if (anchors.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    anchors.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.candidateGroupId} 作为主组保留`);
    });
    lines.push('');
  }

  lines.push('## 3. 未落地项');
  lines.push('');
  const unresolved = result.items.filter((item) => item.status === 'rejected' || item.status === 'skipped');
  if (unresolved.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    unresolved.forEach((item, index) => {
      const reason = item.status === 'rejected' ? '人工拒绝' : (item.skipReason ?? 'unknown');
      lines.push(`${index + 1}. ${item.candidateGroupId} | ${reason}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeLinkRegistryOverrides(path: string, overrides: LinkRegistryOverrides): Promise<void> {
  await writeJsonAtomic(path, overrides);
}
