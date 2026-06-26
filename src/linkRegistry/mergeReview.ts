import { normalizeAlias } from './alias.js';
import type { LinkRegistryEntry } from './types.js';

export interface LinkRegistryMergeReviewGroup {
  sameSkuGroupId: string;
  shortName: string;
  activeLinkCount: number;
  totalLinkCount: number;
  internalProductIds: string[];
  productNames: string[];
}

export interface LinkRegistryMergeReviewCandidate {
  shortName: string;
  normalizedShortName: string;
  priority: 'P0' | 'P1' | 'P2';
  suggestedTargetGroupId: string;
  suggestedAction: 'merge_into_target';
  reason: string;
  groups: LinkRegistryMergeReviewGroup[];
}

export interface LinkRegistryMergeReviewReport {
  generatedAt: string;
  summary: {
    candidateBuckets: number;
    p0Buckets: number;
    p1Buckets: number;
    p2Buckets: number;
  };
  candidates: LinkRegistryMergeReviewCandidate[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function compareGroup(left: LinkRegistryMergeReviewGroup, right: LinkRegistryMergeReviewGroup): number {
  return right.activeLinkCount - left.activeLinkCount
    || right.totalLinkCount - left.totalLinkCount
    || left.sameSkuGroupId.localeCompare(right.sameSkuGroupId);
}

function priorityOf(groups: LinkRegistryMergeReviewGroup[]): 'P0' | 'P1' | 'P2' {
  const totalActive = groups.reduce((sum, group) => sum + group.activeLinkCount, 0);
  if (groups.length >= 3 || totalActive >= 6) return 'P0';
  if (groups.length === 2 && totalActive >= 2) return 'P1';
  return 'P2';
}

function reasonOf(shortName: string, target: LinkRegistryMergeReviewGroup, groups: LinkRegistryMergeReviewGroup[]): string {
  return `短名“${shortName}”当前命中 ${groups.length} 个同款组；建议先以 active 数最高的 ${target.sameSkuGroupId} 作为主组，减少 Agent 查询时的多候选返回。`;
}

export function buildLinkRegistryMergeReviewReport(entries: LinkRegistryEntry[], generatedAt = new Date().toISOString()): LinkRegistryMergeReviewReport {
  const groupMap = new Map<string, LinkRegistryMergeReviewGroup>();
  for (const entry of entries) {
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    const shortName = entry.shortName?.trim();
    if (!sameSkuGroupId || !shortName) continue;
    const current = groupMap.get(sameSkuGroupId) ?? {
      sameSkuGroupId,
      shortName,
      activeLinkCount: 0,
      totalLinkCount: 0,
      internalProductIds: [],
      productNames: [],
    };
    current.totalLinkCount += 1;
    if (entry.status === 'active') current.activeLinkCount += 1;
    current.internalProductIds.push(entry.internalProductId);
    if (entry.productName?.trim()) current.productNames.push(entry.productName.trim());
    groupMap.set(sameSkuGroupId, current);
  }

  const shortNameBuckets = new Map<string, LinkRegistryMergeReviewGroup[]>();
  for (const group of groupMap.values()) {
    const key = group.shortName.trim();
    const bucket = shortNameBuckets.get(key) ?? [];
    bucket.push({
      ...group,
      internalProductIds: uniqueSorted(group.internalProductIds),
      productNames: uniqueSorted(group.productNames).slice(0, 3),
    });
    shortNameBuckets.set(key, bucket);
  }

  const candidates = [...shortNameBuckets.entries()]
    .filter(([, groups]) => groups.length > 1)
    .map(([shortName, groups]) => {
      const sortedGroups = groups.slice().sort(compareGroup);
      const target = sortedGroups[0]!;
      return {
        shortName,
        normalizedShortName: normalizeAlias(shortName)?.compact ?? shortName.toLowerCase(),
        priority: priorityOf(sortedGroups),
        suggestedTargetGroupId: target.sameSkuGroupId,
        suggestedAction: 'merge_into_target' as const,
        reason: reasonOf(shortName, target, sortedGroups),
        groups: sortedGroups,
      };
    })
    .sort((left, right) => left.priority.localeCompare(right.priority) || right.groups.length - left.groups.length || left.shortName.localeCompare(right.shortName));

  return {
    generatedAt,
    summary: {
      candidateBuckets: candidates.length,
      p0Buckets: candidates.filter((item) => item.priority === 'P0').length,
      p1Buckets: candidates.filter((item) => item.priority === 'P1').length,
      p2Buckets: candidates.filter((item) => item.priority === 'P2').length,
    },
    candidates,
  };
}

export function renderLinkRegistryMergeReviewMarkdown(report: LinkRegistryMergeReviewReport): string {
  const lines: string[] = [];
  lines.push('# 建议合并组清单');
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- 候选短名桶：${report.summary.candidateBuckets}`);
  lines.push(`- P0：${report.summary.p0Buckets}`);
  lines.push(`- P1：${report.summary.p1Buckets}`);
  lines.push(`- P2：${report.summary.p2Buckets}`);
  lines.push('');

  report.candidates.forEach((candidate, index) => {
    lines.push(`## ${index + 1}. ${candidate.shortName}`);
    lines.push('');
    lines.push(`- 优先级：${candidate.priority}`);
    lines.push(`- 建议动作：合并到 ${candidate.suggestedTargetGroupId}`);
    lines.push(`- 理由：${candidate.reason}`);
    lines.push('');
    candidate.groups.forEach((group) => {
      lines.push(`- ${group.sameSkuGroupId} | active ${group.activeLinkCount}/${group.totalLinkCount} | 端内 ID ${group.internalProductIds.join('、')}`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

export function renderLinkRegistryMergeReviewCsv(report: LinkRegistryMergeReviewReport): string {
  const header = [
    'priority',
    'shortName',
    'suggestedTargetGroupId',
    'candidateGroupId',
    'activeLinkCount',
    'totalLinkCount',
    'internalProductIds',
    'productNames',
    'decision',
    'finalTargetGroupId',
    'note',
  ];
  const rows = report.candidates.flatMap((candidate) => candidate.groups.map((group) => [
    candidate.priority,
    candidate.shortName,
    candidate.suggestedTargetGroupId,
    group.sameSkuGroupId,
    String(group.activeLinkCount),
    String(group.totalLinkCount),
    group.internalProductIds.join('、'),
    group.productNames.join('；'),
    '',
    '',
    '',
  ]));
  const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function renderLinkRegistryMergeReviewGuide(): string {
  return [
    '# 建议合并组审批说明',
    '',
    '请编辑同目录下的 CSV 审批清单。',
    '',
    '可填写列说明：',
    '- `decision`：推荐填写 `accept`、`target`、`reject`。',
    '- `finalTargetGroupId`：如果你不同意建议主组，可手动指定最终要并入的组。',
    '- `note`：补充原因、特殊说明或后续处理建议。',
    '',
    '建议填写方式：',
    '- 主组所在行可填 `target`，表示这行是最终保留的组。',
    '- 需要并入主组的行填 `accept`；若留空但填写了 `finalTargetGroupId`，系统也会按接受处理。',
    '- 暂时不想动的行填 `reject`。',
    '',
    '落地规则：',
    '- `accept` 行会把该行全部端内 ID 的 `sameSkuGroupId` 改成目标组。',
    '- `target` 行不会改自己的端内 ID，只作为确认主组使用。',
    '- `reject` 行不会写入 override。',
    '',
    '注意：',
    '- 同一个短名桶内，最好只保留一个最终目标组。',
    '- 如果需要拆成多个组，请在 `note` 里说明，后续再走单独治理。',
  ].join('\n');
}
