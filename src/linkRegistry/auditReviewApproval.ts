import { readFile } from 'node:fs/promises';
import { createLinkRegistry } from './store.js';
import type { LinkRegistryEntry } from './types.js';
import type { LinkRegistryEntryOverride, LinkRegistryOverrides } from './overrides.js';
import { writeJsonAtomic } from './persistence.js';

export interface LinkRegistryAuditReviewApprovalRow {
  reviewKey: string;
  kind: 'entry' | 'same_sku_group' | 'override_risk';
  priority: string;
  reviewReasons: string;
  internalProductId: string;
  internalProductIds: string;
  platformProductId: string;
  sameSkuGroupId: string;
  originalProductName: string;
  productName: string;
  shortName: string;
  categoryName: string;
  productType: string;
  status: string;
  activeLinkCount: string;
  totalLinkCount: string;
  sampleSize: string;
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

export interface LinkRegistryAuditReviewApprovalItem {
  reviewKey: string;
  kind: 'entry' | 'same_sku_group' | 'override_risk';
  internalProductIds: string[];
  suggestedShortName: string;
  finalShortName: string;
  finalSameSkuGroupId?: string;
  finalCategoryName?: string;
  finalProductType?: string;
  finalStatus?: LinkRegistryEntry['status'];
  inferredFromRegistry: boolean;
  decision?: string;
  note?: string;
  status: 'applied' | 'ignored' | 'skipped';
  skipReason?: string;
}

export interface LinkRegistryAuditReviewApprovalResult {
  sourceMarkdownPath: string;
  generatedAt: string;
  summary: {
    reviewedRows: number;
    changedRows: number;
    appliedRows: number;
    ignoredRows: number;
    skippedRows: number;
    entryOverrideCount: number;
  };
  items: LinkRegistryAuditReviewApprovalItem[];
  overrides: LinkRegistryOverrides;
}

function normalizeCell(value: string | undefined): string {
  return (value ?? '').replace(/^\uFEFF/, '').trim();
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

function parseHeader(line: string): { priority: string; kind: LinkRegistryAuditReviewApprovalRow['kind'] } {
  const match = line.match(/^##\s+\d+\.\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+/);
  if (!match) throw new Error(`Invalid review header: ${line}`);
  const kind = normalizeCell(match[2]) as LinkRegistryAuditReviewApprovalRow['kind'];
  if (kind !== 'entry' && kind !== 'same_sku_group' && kind !== 'override_risk') {
    throw new Error(`Unsupported review kind: ${kind}`);
  }
  return { priority: normalizeCell(match[1]), kind };
}

function parseMarkdown(text: string): LinkRegistryAuditReviewApprovalRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows: LinkRegistryAuditReviewApprovalRow[] = [];
  let current: LinkRegistryAuditReviewApprovalRow | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('## ')) {
      if (current) rows.push(current);
      const { priority, kind } = parseHeader(line);
      current = {
        reviewKey: '',
        kind,
        priority,
        reviewReasons: '',
        internalProductId: '',
        internalProductIds: '',
        platformProductId: '',
        sameSkuGroupId: '',
        originalProductName: '',
        productName: '',
        shortName: '',
        categoryName: '',
        productType: '',
        status: '',
        activeLinkCount: '',
        totalLinkCount: '',
        sampleSize: '',
        confidence: '',
        message: '',
        firstSeenDate: '',
        updatedAt: '',
        suggestedShortName: '',
        decision: '',
        finalSameSkuGroupId: '',
        finalCategoryName: '',
        finalProductType: '',
        finalShortName: '',
        note: '',
      };
      continue;
    }

    if (!current) continue;
    const match = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1] as keyof LinkRegistryAuditReviewApprovalRow;
    const value = match[2] ?? '';
    if (key in current) current[key] = value as never;
  }

  if (current) rows.push(current);
  return rows.filter((row) => normalizeCell(row.reviewKey).length > 0);
}

function normalizeDecision(raw: string): 'accept' | 'watch' | 'ignore' | '' {
  const value = normalizeCell(raw).toLowerCase();
  if (!value) return '';
  if (['accept', 'yes', '同意', '采用'].includes(value)) return 'accept';
  if (['watch', 'observe', '观察'].includes(value)) return 'watch';
  if (['ignore', 'skip', '忽略', '跳过'].includes(value)) return 'ignore';
  return '';
}

function shortNameChanged(row: LinkRegistryAuditReviewApprovalRow): boolean {
  const finalShortName = normalizeCell(row.finalShortName);
  if (!finalShortName) return false;
  return finalShortName !== normalizeCell(row.suggestedShortName);
}

function changedRow(row: LinkRegistryAuditReviewApprovalRow): boolean {
  return Boolean(
    normalizeDecision(row.decision)
    || normalizeCell(row.note)
    || shortNameChanged(row)
    || normalizeCell(row.finalSameSkuGroupId)
    || normalizeCell(row.finalCategoryName)
    || normalizeCell(row.finalProductType),
  );
}

function inferredStatusFromNote(note: string): LinkRegistryEntry['status'] | undefined {
  if (!note) return undefined;
  if (/(不存在|已不存在|下架|已下架|移除|removed)/i.test(note)) return 'removed';
  return undefined;
}

function inferFromRegistry(
  entries: LinkRegistryEntry[],
  finalShortName: string,
): { sameSkuGroupId?: string; categoryName?: string; productType?: string; inferredFromRegistry: boolean } {
  const resolution = createLinkRegistry(entries).resolveAlias(finalShortName);
  if (resolution.status !== 'unique' || resolution.entries.length === 0) return { inferredFromRegistry: false };
  const sample = resolution.entries[0]!;
  return {
    ...(resolution.sameSkuGroupId ? { sameSkuGroupId: resolution.sameSkuGroupId } : {}),
    ...(sample.categoryName?.trim() ? { categoryName: sample.categoryName.trim() } : {}),
    ...(sample.productType?.trim() ? { productType: sample.productType.trim() } : {}),
    inferredFromRegistry: true,
  };
}

function approvalItem(
  row: LinkRegistryAuditReviewApprovalRow,
  entries: LinkRegistryEntry[],
): LinkRegistryAuditReviewApprovalItem {
  const internalProductIds = internalProductIdsOf(row.internalProductIds || row.internalProductId);
  const decision = normalizeDecision(row.decision);
  const finalShortName = normalizeCell(row.finalShortName);
  const explicitSameSkuGroupId = normalizeCell(row.finalSameSkuGroupId);
  const explicitCategoryName = normalizeCell(row.finalCategoryName);
  const explicitProductType = normalizeCell(row.finalProductType);
  const note = normalizeCell(row.note);
  const finalStatus = inferredStatusFromNote(note);
  const changed = changedRow(row);

  if (!changed) {
    return {
      reviewKey: normalizeCell(row.reviewKey),
      kind: row.kind,
      internalProductIds,
      suggestedShortName: normalizeCell(row.suggestedShortName),
      finalShortName,
      inferredFromRegistry: false,
      status: 'skipped',
      skipReason: 'unchanged_row',
    };
  }

  if (decision === 'ignore') {
    return {
      reviewKey: normalizeCell(row.reviewKey),
      kind: row.kind,
      internalProductIds,
      suggestedShortName: normalizeCell(row.suggestedShortName),
      finalShortName,
      inferredFromRegistry: false,
      decision,
      ...(note ? { note } : {}),
      status: 'ignored',
    };
  }

  if (internalProductIds.length === 0) {
    return {
      reviewKey: normalizeCell(row.reviewKey),
      kind: row.kind,
      internalProductIds,
      suggestedShortName: normalizeCell(row.suggestedShortName),
      finalShortName,
      inferredFromRegistry: false,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      status: 'skipped',
      skipReason: 'missing_internal_product_ids',
    };
  }

  const inferred = finalShortName ? inferFromRegistry(entries, finalShortName) : { inferredFromRegistry: false };
  const finalSameSkuGroupId = explicitSameSkuGroupId || inferred.sameSkuGroupId;
  const finalCategoryName = explicitCategoryName || inferred.categoryName;
  const finalProductType = explicitProductType || inferred.productType;

  if (!finalShortName && !finalSameSkuGroupId && !finalCategoryName && !finalProductType && !finalStatus) {
    return {
      reviewKey: normalizeCell(row.reviewKey),
      kind: row.kind,
      internalProductIds,
      suggestedShortName: normalizeCell(row.suggestedShortName),
      finalShortName,
      inferredFromRegistry: false,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      status: 'skipped',
      skipReason: 'note_only_without_structured_change',
    };
  }

  return {
    reviewKey: normalizeCell(row.reviewKey),
    kind: row.kind,
    internalProductIds,
    suggestedShortName: normalizeCell(row.suggestedShortName),
    finalShortName,
    ...(finalSameSkuGroupId ? { finalSameSkuGroupId } : {}),
    ...(finalCategoryName ? { finalCategoryName } : {}),
    ...(finalProductType ? { finalProductType } : {}),
    ...(finalStatus ? { finalStatus } : {}),
    inferredFromRegistry: Boolean(inferred.inferredFromRegistry),
    ...(decision ? { decision } : {}),
    ...(note ? { note } : {}),
    status: 'applied',
  };
}

function buildEntryOverrides(items: LinkRegistryAuditReviewApprovalItem[], reviewedDate: string): LinkRegistryEntryOverride[] {
  const byInternalProductId = new Map<string, LinkRegistryEntryOverride>();

  for (const item of items) {
    if (item.status !== 'applied') continue;
    for (const internalProductId of item.internalProductIds) {
      const current = byInternalProductId.get(internalProductId) ?? { internalProductId };
      byInternalProductId.set(internalProductId, {
        ...current,
        ...(item.finalShortName ? { shortName: item.finalShortName } : {}),
        ...(item.finalShortName ? { aliases: uniqueSorted([...(current.aliases ?? []), ...aliasSeeds(item.finalShortName)]) } : {}),
        ...(item.finalSameSkuGroupId ? { sameSkuGroupId: item.finalSameSkuGroupId } : {}),
        ...(item.finalCategoryName ? { categoryName: item.finalCategoryName } : {}),
        ...(item.finalProductType ? { productType: item.finalProductType } : {}),
        ...(item.finalStatus ? { status: item.finalStatus } : {}),
        confidence: 0.95,
        updatedAt: reviewedDate,
        reason: 'link_registry_audit_review_approval',
        maintainer: 'audit_review_markdown',
      });
    }
  }

  return [...byInternalProductId.values()].sort((left, right) => left.internalProductId.localeCompare(right.internalProductId));
}

export async function readLinkRegistryAuditReviewApprovalMarkdown(path: string): Promise<LinkRegistryAuditReviewApprovalRow[]> {
  return parseMarkdown(await readFile(path, 'utf8'));
}

export function buildLinkRegistryAuditReviewApprovalResult(
  sourceMarkdownPath: string,
  rows: LinkRegistryAuditReviewApprovalRow[],
  entries: LinkRegistryEntry[],
  generatedAt = new Date().toISOString(),
): LinkRegistryAuditReviewApprovalResult {
  const reviewedDateMatch = sourceMarkdownPath.match(/(\d{4}-\d{2}-\d{2})/);
  const reviewedDate = reviewedDateMatch?.[1] ?? generatedAt.slice(0, 10);
  const changedRows = rows.filter(changedRow);
  const items = changedRows.map((row) => approvalItem(row, entries));
  const entryOverrides = buildEntryOverrides(items, reviewedDate);

  return {
    sourceMarkdownPath,
    generatedAt,
    summary: {
      reviewedRows: rows.length,
      changedRows: changedRows.length,
      appliedRows: items.filter((item) => item.status === 'applied').length,
      ignoredRows: items.filter((item) => item.status === 'ignored').length,
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

export function renderLinkRegistryAuditReviewApprovalResultMarkdown(result: LinkRegistryAuditReviewApprovalResult): string {
  const lines: string[] = [];
  lines.push('# 链接档案审计审批落地结果');
  lines.push('');
  lines.push(`- 生成时间：${result.generatedAt}`);
  lines.push(`- 审批清单：${result.sourceMarkdownPath}`);
  lines.push(`- 已读取变更行：${result.summary.changedRows}`);
  lines.push(`- 已落地行：${result.summary.appliedRows}`);
  lines.push(`- 已忽略行：${result.summary.ignoredRows}`);
  lines.push(`- 跳过行：${result.summary.skippedRows}`);
  lines.push(`- 写入 entry override 条数：${result.summary.entryOverrideCount}`);
  lines.push('');

  lines.push('## 1. 已落地');
  lines.push('');
  const applied = result.items.filter((item) => item.status === 'applied');
  if (applied.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    applied.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.reviewKey} -> ${item.finalShortName || '未改短名'} | 端内 ID ${item.internalProductIds.join('、')}${item.finalSameSkuGroupId ? ` | sameSkuGroupId ${item.finalSameSkuGroupId}` : ''}${item.inferredFromRegistry ? ' | 已自动归到现有组' : ''}`);
    });
    lines.push('');
  }

  lines.push('## 2. 已忽略');
  lines.push('');
  const ignored = result.items.filter((item) => item.status === 'ignored');
  if (ignored.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    ignored.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.reviewKey}${item.note ? ` | ${item.note}` : ''}`);
    });
    lines.push('');
  }

  lines.push('## 3. 未落地');
  lines.push('');
  const skipped = result.items.filter((item) => item.status === 'skipped');
  if (skipped.length === 0) {
    lines.push('暂无。');
    lines.push('');
  } else {
    skipped.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.reviewKey} | ${item.skipReason ?? 'unknown'}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export async function writeLinkRegistryOverrides(path: string, overrides: LinkRegistryOverrides): Promise<void> {
  await writeJsonAtomic(path, overrides);
}
