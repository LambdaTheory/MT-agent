import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../llm/provider.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { createLinkRegistry } from './store.js';
import {
  buildLinkRegistryMaintenanceReport,
  maintenanceReasonLabel,
  type LinkRegistryMaintenanceReasonCode,
} from './maintenance.js';
import {
  loadLinkRegistryReminderState,
  saveLinkRegistryReminderState,
} from './reminderState.js';
import { mutateJsonFileSerialized } from './persistence.js';
import type { LinkRegistryRefreshSummary } from './promptRefresh.js';
import type { LinkRegistryEntry } from './types.js';

export type LinkRegistryMaintenanceSessionStatus = 'open' | 'reviewing' | 'snoozed' | 'ignored' | 'completed';
export type LinkRegistryMaintenanceReviewDecision = 'accept' | 'accept_with_edit' | 'ignore';

export interface LinkRegistryMaintenanceResponse {
  text: string;
  card?: FeishuCardPayload;
}

interface LinkRegistryMaintenanceSuggestion {
  sameSkuGroupId?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
}

interface LinkRegistryMaintenanceLlmSuggestion {
  status: 'available' | 'unavailable';
  action?: string;
  confidence?: string;
  rationale: string;
  sameSkuGroupId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  uncertainties: string[];
}

interface LinkRegistryMaintenanceSessionQueueItem {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  shortName?: string;
  status: LinkRegistryEntry['status'];
  firstSeenDate?: string;
  updatedAt?: string;
  reasonCodes: LinkRegistryMaintenanceReasonCode[];
  reasonLabels: string[];
  suggested: LinkRegistryMaintenanceSuggestion;
  llmSuggestion?: LinkRegistryMaintenanceLlmSuggestion;
  sameSkuGroupOptions: string[];
}

interface LinkRegistryMaintenanceReviewRecord {
  internalProductId: string;
  decision: LinkRegistryMaintenanceReviewDecision;
  reviewerId?: string;
  submittedAt: string;
}

interface LinkRegistryMaintenanceSession {
  date: string;
  createdAt: string;
  updatedAt: string;
  status: LinkRegistryMaintenanceSessionStatus;
  signature: string;
  queue: LinkRegistryMaintenanceSessionQueueItem[];
  categoryOptions: Array<{ value: string; label: string }>;
  productTypeOptions: string[];
  reviewRecords: LinkRegistryMaintenanceReviewRecord[];
  overridesPath: string;
  promptSummary?: LinkRegistryRefreshSummary;
}

export interface OpenLinkRegistryMaintenancePromptInput {
  date: string;
  registry: LinkRegistryEntry[];
  referenceDate?: string;
  overridesPath: string;
  force?: boolean;
  promptSummary?: LinkRegistryRefreshSummary;
  llmProvider?: LlmProvider;
}

export interface LinkRegistryMaintenanceCardActionInput {
  date: string;
  action: 'start' | 'snooze' | 'ignore' | 'submit';
  internalProductId?: string;
  reviewIndex?: number;
  decision?: LinkRegistryMaintenanceReviewDecision;
  sameSkuGroupId?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  reviewerId?: string;
}

interface LinkRegistryOverrideFile {
  version: 1;
  entries?: Array<Record<string, unknown>>;
  shortNameRules?: Array<Record<string, unknown>>;
  sameSkuGroupAliasRules?: Array<Record<string, unknown>>;
}

const SESSION_FILE = 'link-registry-maintenance-session.json';

function sessionPath(outputDir: string, date: string): string {
  return join(outputDir, date, SESSION_FILE);
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function plainText(content: string): { tag: 'plain_text'; content: string } {
  return { tag: 'plain_text', content };
}

function statusCard(
  title: string,
  content: string,
  template: 'blue' | 'green' | 'grey' = 'blue',
): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText(title),
      template,
    },
    body: {
      elements: [markdown(content)],
    },
  };
}

function compactName(item: { shortName?: string; productName?: string; internalProductId: string }): string {
  return item.shortName?.trim() || item.productName?.trim() || item.internalProductId;
}

const LLM_MAINTENANCE_ACTIONS = new Set(['map_platform_id', 'merge_group', 'classify', 'watch', 'ignore']);

const LLM_MAINTENANCE_ACTION_LABELS: Record<string, string> = {
  map_platform_id: '补平台映射',
  merge_group: '归入同款组',
  classify: '补分类',
  watch: '观察',
  ignore: '忽略',
};

const LLM_MAINTENANCE_SYSTEM_PROMPT = [
  '你是链接维护助手。只给人工维护卡片生成参考建议。',
  '不得写入 override，不得生成执行命令，不得要求调用 shell、文件系统、飞书或外部接口。',
  '只输出 JSON，形如 {"suggestions":[{"internalProductId":"1032","action":"merge_group","confidence":0.82,"rationale":"...","sameSkuGroupId":"canon-r50","categoryName":"相机","productType":"mirrorless-camera","shortName":"佳能 R50","uncertainties":[]}]}。',
  'action 只能取 map_platform_id|merge_group|classify|watch|ignore。',
].join('\n');

function singleLineText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[\r\n]+/g, ' / ') : '';
}

function safeMarkdownText(value: string | undefined): string {
  return (value ?? '').replace(/[<>[\]()`|*_]/g, (char) => ({
    '<': '‹',
    '>': '›',
    '[': '［',
    ']': '］',
    '(': '（',
    ')': '）',
    '`': '\'',
    '|': '｜',
    '*': '＊',
    '_': '＿',
  }[char] ?? char));
}

function unavailableLlmMaintenanceSuggestion(rationale: string): LinkRegistryMaintenanceLlmSuggestion {
  return { status: 'unavailable', rationale, uncertainties: [] };
}

function parseLlmMaintenanceSuggestion(value: unknown): LinkRegistryMaintenanceLlmSuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableLlmMaintenanceSuggestion('LLM 建议未通过数据契约校验');
  const record = value as Record<string, unknown>;
  const action = singleLineText(record.action);
  const confidence = record.confidence;
  const rationale = singleLineText(record.rationale);
  if (!LLM_MAINTENANCE_ACTIONS.has(action) || typeof confidence !== 'number' || confidence < 0 || confidence > 1 || !rationale) {
    return unavailableLlmMaintenanceSuggestion('LLM 建议未通过数据契约校验');
  }
  return {
    status: 'available',
    action,
    confidence: confidence.toFixed(2),
    rationale,
    sameSkuGroupId: singleLineText(record.sameSkuGroupId) || undefined,
    categoryName: singleLineText(record.categoryName) || undefined,
    productType: singleLineText(record.productType) || undefined,
    shortName: singleLineText(record.shortName) || undefined,
    uncertainties: Array.isArray(record.uncertainties) ? record.uncertainties.map(singleLineText).filter(Boolean) : [],
  };
}

function llmMaintenanceContext(item: LinkRegistryMaintenanceSessionQueueItem): Record<string, unknown> {
  return {
    internalProductId: item.internalProductId,
    platformProductId: item.platformProductId ?? '',
    productName: item.productName ?? '',
    shortName: item.shortName ?? '',
    status: item.status,
    reasonCodes: item.reasonCodes,
    reasonLabels: item.reasonLabels,
    deterministicSuggestion: item.suggested,
    sameSkuGroupOptions: item.sameSkuGroupOptions,
  };
}

async function enrichMaintenanceQueueWithLlmSuggestions(
  queue: LinkRegistryMaintenanceSessionQueueItem[],
  provider: LlmProvider | undefined,
): Promise<LinkRegistryMaintenanceSessionQueueItem[]> {
  if (!provider || queue.length === 0) return queue;
  try {
    const result = await provider.generateJson({
      messages: [
        { role: 'system', content: LLM_MAINTENANCE_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ rows: queue.slice(0, 20).map(llmMaintenanceContext) }) },
      ],
      temperature: 0,
    });
    const suggestions = Array.isArray(result.json.suggestions) ? result.json.suggestions : [];
    const suggestionByProductId = new Map<string, unknown>();
    for (const suggestion of suggestions) {
      if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) continue;
      const productId = singleLineText((suggestion as Record<string, unknown>).internalProductId);
      if (productId) suggestionByProductId.set(productId, suggestion);
    }
    return queue.map((item) => ({
      ...item,
      llmSuggestion: suggestionByProductId.has(item.internalProductId)
        ? parseLlmMaintenanceSuggestion(suggestionByProductId.get(item.internalProductId))
        : unavailableLlmMaintenanceSuggestion('LLM 未返回该链接建议'),
    }));
  } catch {
    return queue.map((item) => ({ ...item, llmSuggestion: unavailableLlmMaintenanceSuggestion('LLM 建议生成失败') }));
  }
}

function llmActionLabel(action: string | undefined): string {
  if (!action) return '无';
  const label = LLM_MAINTENANCE_ACTION_LABELS[action];
  return label ? `${label} (${safeMarkdownText(action)})` : safeMarkdownText(action);
}

function llmFieldSummary(suggestion: LinkRegistryMaintenanceLlmSuggestion): string {
  const fields = [
    suggestion.sameSkuGroupId ? `同款组 ${safeMarkdownText(suggestion.sameSkuGroupId)}` : '',
    suggestion.categoryName ? `品类 ${safeMarkdownText(suggestion.categoryName)}` : '',
    suggestion.productType ? `类型 ${safeMarkdownText(suggestion.productType)}` : '',
    suggestion.shortName ? `短名 ${safeMarkdownText(suggestion.shortName)}` : '',
  ].filter(Boolean);
  return fields.join('；') || '无结构化字段建议';
}

function llmPreviewLine(item: LinkRegistryMaintenanceSessionQueueItem): string {
  const suggestion = item.llmSuggestion;
  if (!suggestion) return '';
  if (suggestion.status !== 'available') return `\nLLM参考：不可用｜${safeMarkdownText(suggestion.rationale)}`;
  return `\nLLM参考：${llmActionLabel(suggestion.action)}｜置信度 ${suggestion.confidence}｜${llmFieldSummary(suggestion)}`;
}

function llmReviewBlock(item: LinkRegistryMaintenanceSessionQueueItem): string | null {
  const suggestion = item.llmSuggestion;
  if (!suggestion) return null;
  if (suggestion.status !== 'available') return `**LLM参考建议（仅供人工参考，不自动生效）**\n不可用：${safeMarkdownText(suggestion.rationale)}`;
  return [
    '**LLM参考建议（仅供人工参考，不自动生效）**',
    `建议动作：${llmActionLabel(suggestion.action)}｜置信度：${suggestion.confidence}`,
    `建议字段：${llmFieldSummary(suggestion)}`,
    `判断依据：${safeMarkdownText(suggestion.rationale)}`,
    `不确定点：${suggestion.uncertainties.map(safeMarkdownText).join('；') || '无'}`,
  ].join('\n');
}

function reasonPriority(reasonCodes: LinkRegistryMaintenanceReasonCode[]): number {
  if (reasonCodes.includes('recent_new_link')) return 0;
  if (reasonCodes.includes('same_sku_group_missing')) return 1;
  if (reasonCodes.includes('classification_missing')) return 2;
  return 3;
}

function actionableReason(reason: LinkRegistryMaintenanceReasonCode): boolean {
  return reason === 'same_sku_group_missing'
    || reason === 'classification_missing'
    || reason === 'platform_mapping_missing'
    || reason === 'recent_new_link';
}

function reviewableQueueItemCodes(reasonCodes: LinkRegistryMaintenanceReasonCode[]): boolean {
  return reasonCodes.some(actionableReason);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function categoryOptions(registry: LinkRegistryEntry[]): Array<{ value: string; label: string }> {
  const labels = new Map<string, string>();
  for (const entry of registry) {
    const categoryId = entry.categoryId?.trim();
    if (!categoryId || labels.has(categoryId)) continue;
    labels.set(categoryId, entry.categoryName?.trim() || categoryId);
  }
  return [...labels.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, label]) => ({ value, label }));
}

function productTypeOptions(registry: LinkRegistryEntry[]): string[] {
  return sortedUnique(registry.flatMap((entry) => entry.productType?.trim() ? [entry.productType.trim()] : []));
}

async function readOptionalJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function mutateSession(path: string, fallback: LinkRegistryMaintenanceSession, mutator: (current: LinkRegistryMaintenanceSession) => LinkRegistryMaintenanceSession | Promise<LinkRegistryMaintenanceSession>): Promise<LinkRegistryMaintenanceSession> {
  return mutateJsonFileSerialized<LinkRegistryMaintenanceSession>(path, fallback, mutator);
}

async function mutateOptionalSession(path: string, mutator: (current: LinkRegistryMaintenanceSession | null) => LinkRegistryMaintenanceSession | null): Promise<LinkRegistryMaintenanceSession | null> {
  return mutateJsonFileSerialized<LinkRegistryMaintenanceSession | null>(path, null, mutator);
}

async function loadSession(outputDir: string, date: string): Promise<LinkRegistryMaintenanceSession | null> {
  return readOptionalJson<LinkRegistryMaintenanceSession | null>(sessionPath(outputDir, date), null);
}

function nextQueueIndex(session: LinkRegistryMaintenanceSession): number {
  const reviewed = new Set(session.reviewRecords.map((record) => record.internalProductId));
  const index = session.queue.findIndex((item) => !reviewed.has(item.internalProductId));
  return index === -1 ? session.queue.length + 1 : index + 1;
}

async function loadLatestSession(outputDir: string): Promise<{ path: string; session: LinkRegistryMaintenanceSession } | null> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  for (const date of dates) {
    const session = await loadSession(outputDir, date);
    if (session) return { path: sessionPath(outputDir, date), session };
  }
  return null;
}

async function resolveSessionForAction(outputDir: string, date: string): Promise<{ path: string; session: LinkRegistryMaintenanceSession } | null> {
  const trimmedDate = date.trim();
  if (trimmedDate) {
    const session = await loadSession(outputDir, trimmedDate);
    return session ? { path: sessionPath(outputDir, trimmedDate), session } : null;
  }
  return loadLatestSession(outputDir);
}

function sameSkuGroupCandidates(
  entry: LinkRegistryEntry,
  registry: LinkRegistryEntry[],
): { options: string[]; suggested: LinkRegistryMaintenanceSuggestion } {
  const store = createLinkRegistry(registry);
  const query = entry.shortName?.trim() || entry.productName?.trim() || '';
  const resolution = query ? store.resolveAlias(query) : { status: 'not_found' as const };
  if (resolution.status === 'unique') {
    const candidate = resolution.entries[0];
    return {
      options: sortedUnique([resolution.sameSkuGroupId ?? '', entry.sameSkuGroupId ?? '']),
      suggested: {
        sameSkuGroupId: resolution.sameSkuGroupId ?? entry.sameSkuGroupId,
        categoryId: candidate?.categoryId?.trim() || entry.categoryId?.trim(),
        categoryName: candidate?.categoryName?.trim() || entry.categoryName?.trim(),
        productType: candidate?.productType?.trim() || entry.productType?.trim(),
        shortName: candidate?.shortName?.trim() || entry.shortName?.trim(),
      },
    };
  }
  if (resolution.status === 'multiple') {
    return {
      options: sortedUnique(resolution.candidates.flatMap((candidate) => candidate.sameSkuGroupId ? [candidate.sameSkuGroupId] : [])),
      suggested: {
        categoryId: entry.categoryId?.trim(),
        categoryName: entry.categoryName?.trim(),
        productType: entry.productType?.trim(),
        shortName: entry.shortName?.trim(),
      },
    };
  }
  return {
    options: sortedUnique([entry.sameSkuGroupId ?? '']),
    suggested: {
      sameSkuGroupId: entry.sameSkuGroupId?.trim(),
      categoryId: entry.categoryId?.trim(),
      categoryName: entry.categoryName?.trim(),
      productType: entry.productType?.trim(),
      shortName: entry.shortName?.trim(),
    },
  };
}

function buildSessionQueue(registry: LinkRegistryEntry[], referenceDate: string): LinkRegistryMaintenanceSessionQueueItem[] {
  const report = buildLinkRegistryMaintenanceReport(registry, [], { referenceDate });
  const entryById = new Map(registry.map((entry) => [entry.internalProductId, entry]));
  return report.queue
    .filter((item) => item.kind === 'entry' && item.internalProductId && reviewableQueueItemCodes(item.reasonCodes))
    .map((item) => {
      const entry = entryById.get(item.internalProductId!);
      if (!entry) return null;
      const candidates = sameSkuGroupCandidates(entry, registry);
      return {
        internalProductId: entry.internalProductId,
        ...(entry.platformProductId ? { platformProductId: entry.platformProductId } : {}),
        ...(entry.productName ? { productName: entry.productName } : {}),
        ...(entry.shortName ? { shortName: entry.shortName } : {}),
        status: entry.status,
        ...(entry.firstSeenDate ? { firstSeenDate: entry.firstSeenDate } : {}),
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
        reasonCodes: item.reasonCodes,
        reasonLabels: item.reasonLabels,
        suggested: candidates.suggested,
        sameSkuGroupOptions: candidates.options,
      };
    })
    .filter((item): item is LinkRegistryMaintenanceSessionQueueItem => Boolean(item))
    .sort((left, right) => reasonPriority(left.reasonCodes) - reasonPriority(right.reasonCodes) || left.internalProductId.localeCompare(right.internalProductId));
}

function buildSessionSignature(queue: LinkRegistryMaintenanceSessionQueueItem[]): string {
  const payload = queue.map((item) => ({
    internalProductId: item.internalProductId,
    reasonCodes: [...item.reasonCodes].sort(),
    status: item.status,
    firstSeenDate: item.firstSeenDate ?? '',
    updatedAt: item.updatedAt ?? '',
  }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function metricSummary(session: LinkRegistryMaintenanceSession): string {
  const p0Count = session.queue.filter((item) => item.reasonCodes.includes('recent_new_link')).length;
  return `今日发现 ${session.queue.length} 条待维护链接，其中 P0 ${p0Count} 条。`;
}

function refreshHeadline(summary: LinkRegistryRefreshSummary | undefined, fallbackMetric: string): string {
  if (!summary) return `**${fallbackMetric}**\n我已经把问题链接排好优先级了，你可以现在开始逐条维护。`;
  const sourceBits = [
    `商品总表 ${summary.goodsExportRefreshed ? '已刷新' : '沿用旧快照'}`,
    `daemon ${summary.daemonRefreshed ? '已刷新' : '沿用旧快照'}`,
  ];
  if (summary.refreshMode === 'daemon_only') {
    sourceBits[0] = '商品总表 已跳过（daemon-only）';
  }
  const warningLine = summary.warnings.length > 0 ? `\n${summary.warnings.map((warning) => `- ${warning}`).join('\n')}` : '';
  return [
    `**本次刷新结果**`,
    `${sourceBits.join('｜')}`,
    `新增链接 ${summary.newLinkCount} 条｜已自动归档 ${summary.autoReadyCount} 条｜待人工维护 ${summary.pendingCount} 条`,
    warningLine,
  ].join('\n').trim();
}

function refreshGroupSummary(summary: LinkRegistryRefreshSummary | undefined): string | null {
  if (!summary || summary.grouped.length === 0) return null;
  const lines = summary.grouped.map((group) => {
    const tail = [
      group.pendingCount > 0 ? `待人工 ${group.pendingCount}` : '',
      group.autoReadyCount > 0 ? `已归档 ${group.autoReadyCount}` : '',
    ].filter(Boolean).join('，');
    return `${group.label} ${group.totalCount} 条${tail ? `（${tail}）` : ''}`;
  });
  return `**本次新增概览**\n${lines.join('\n')}`;
}

function buildPromptCard(session: LinkRegistryMaintenanceSession): FeishuCardPayload {
  const previewLines = session.queue
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${compactName(item)}（${item.internalProductId}）\n规则原因：${item.reasonLabels.join('、')}${llmPreviewLine(item)}`);
  const headline = refreshHeadline(session.promptSummary, metricSummary(session));
  const groupSummary = refreshGroupSummary(session.promptSummary);
  const hasPendingQueue = session.queue.length > 0;
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText('链接维护提醒'),
      template: hasPendingQueue
        ? (session.queue.some((item) => item.reasonCodes.includes('recent_new_link')) ? 'orange' : 'blue')
        : 'green',
    },
    body: {
      elements: [
        markdown(headline),
        ...(groupSummary ? [markdown(groupSummary)] : []),
        ...(hasPendingQueue ? [markdown(`**优先处理**\n${previewLines.join('\n')}`)] : [markdown('**人工维护**\n这次新增链接都已经自动纳入档案，本轮不需要人工补录。')]),
        ...(hasPendingQueue ? [{
          tag: 'form',
          name: 'link_registry_maintenance_start_form',
          elements: [{
            tag: 'button',
            text: plainText('开始维护'),
            type: 'primary',
            form_action_type: 'submit',
            name: 'link_registry_maintenance_start_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_maintenance_start', date: session.date } }],
          }],
        }] : []),
        ...(hasPendingQueue ? [{
          tag: 'form',
          name: 'link_registry_maintenance_snooze_form',
          elements: [{
            tag: 'button',
            text: plainText('稍后提醒'),
            type: 'default',
            form_action_type: 'submit',
            name: 'link_registry_maintenance_snooze_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_maintenance_snooze', date: session.date } }],
          }],
        }] : []),
        ...(hasPendingQueue ? [{
          tag: 'form',
          name: 'link_registry_maintenance_ignore_form',
          elements: [{
            tag: 'button',
            text: plainText('本次忽略'),
            type: 'default',
            form_action_type: 'submit',
            name: 'link_registry_maintenance_ignore_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_maintenance_ignore', date: session.date } }],
          }],
        }] : []),
      ],
    },
  };
}

function selectOption(label: string, value: string): Record<string, unknown> {
  return { text: plainText(label), value };
}

function buildReviewCard(
  session: LinkRegistryMaintenanceSession,
  item: LinkRegistryMaintenanceSessionQueueItem,
  reviewIndex: number,
): FeishuCardPayload {
  const decisionOptions = [
    selectOption('接受自动结果', 'accept'),
    selectOption('接受但修改', 'accept_with_edit'),
    selectOption('忽略本条', 'ignore'),
  ];
  const sameSkuGroupOptions = item.sameSkuGroupOptions.map((value) => selectOption(value, value));
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText(`链接维护 ${reviewIndex}/${session.queue.length}`),
      template: item.reasonCodes.includes('recent_new_link') ? 'orange' : 'blue',
    },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'link_registry_maintenance_form',
          elements: [
            markdown(`**商品**\n${compactName(item)}\n<text_tag color='grey'>端内 ID ${item.internalProductId}${item.platformProductId ? ` · 平台 ID ${item.platformProductId}` : ''}</text_tag>`),
            markdown(`**规则原因**\n${item.reasonLabels.join('、')}`),
            ...(llmReviewBlock(item) ? [markdown(llmReviewBlock(item)!)] : []),
            markdown(`**机器建议**\n同款组：${item.suggested.sameSkuGroupId ?? '待定'}\n分类：${item.suggested.categoryId ?? '待定'}${item.suggested.productType ? ` / ${item.suggested.productType}` : ''}\n短名：${item.suggested.shortName ?? compactName(item)}`),
            {
              tag: 'select_static',
              name: 'decision',
              placeholder: plainText('选择处理结论'),
              options: decisionOptions,
              value: 'accept_with_edit',
            },
            ...(sameSkuGroupOptions.length > 0 ? [{
              tag: 'select_static',
              name: 'same_sku_group_id',
              placeholder: plainText('选择同款组候选'),
              options: sameSkuGroupOptions,
              ...(item.suggested.sameSkuGroupId ? { value: item.suggested.sameSkuGroupId } : {}),
            }] : []),
            {
              tag: 'input',
              name: 'same_sku_group_id_custom',
              label: plainText('同款组（可手填）'),
              label_position: 'top',
              placeholder: plainText('没有合适候选时手填 sameSkuGroupId'),
              input_type: 'text',
              ...(item.suggested.sameSkuGroupId ? { value: item.suggested.sameSkuGroupId } : {}),
            },
            {
              tag: 'select_static',
              name: 'category_id',
              placeholder: plainText('选择品类'),
              options: session.categoryOptions.map((option) => selectOption(option.label, option.value)),
              ...(item.suggested.categoryId ? { value: item.suggested.categoryId } : {}),
            },
            {
              tag: 'select_static',
              name: 'product_type',
              placeholder: plainText('选择 productType'),
              options: session.productTypeOptions.map((value) => selectOption(value, value)),
              ...(item.suggested.productType ? { value: item.suggested.productType } : {}),
            },
            {
              tag: 'input',
              name: 'short_name',
              label: plainText('短名'),
              label_position: 'top',
              placeholder: plainText('例如 DJI Pocket 3'),
              input_type: 'text',
              value: item.suggested.shortName ?? compactName(item),
            },
            {
              tag: 'button',
              text: plainText('提交并继续'),
              type: 'primary',
              form_action_type: 'submit',
              name: 'link_registry_maintenance_submit',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'link_registry_maintenance_submit',
                  date: session.date,
                  internalProductId: item.internalProductId,
                  reviewIndex,
                },
              }],
            },
            {
              tag: 'button',
              text: plainText('退出维护'),
              type: 'default',
              form_action_type: 'submit',
              name: 'link_registry_maintenance_exit_submit',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'link_registry_maintenance_snooze',
                  date: session.date,
                },
              }],
            },
          ],
        },
      ],
    },
  };
}

function completionText(session: LinkRegistryMaintenanceSession): string {
  return `链接维护已处理完成 ${session.date}\n已处理 ${session.reviewRecords.length}/${session.queue.length}`;
}

function completionCard(session: LinkRegistryMaintenanceSession): FeishuCardPayload {
  return statusCard(
    '链接维护已处理完成',
    `日期 ${session.date}
已处理 ${session.reviewRecords.length}/${session.queue.length} 条待维护链接。`,
    'green',
  );
}

function currentReviewResponse(session: LinkRegistryMaintenanceSession): LinkRegistryMaintenanceResponse {
  const reviewIndex = nextQueueIndex(session);
  const item = session.queue[reviewIndex - 1];
  if (!item) {
    return {
      text: completionText(session),
      card: completionCard(session),
    };
  }
  return {
    text: `链接维护 ${reviewIndex}/${session.queue.length}，${compactName(item)}`,
    card: buildReviewCard(session, item, reviewIndex),
  };
}

function overrideEntryPayload(input: {
  session: LinkRegistryMaintenanceSession;
  item: LinkRegistryMaintenanceSessionQueueItem;
  action: LinkRegistryMaintenanceCardActionInput;
}): Record<string, unknown> {
  const categoryId = input.action.categoryId?.trim() || input.item.suggested.categoryId || undefined;
  const categoryName = input.action.categoryName?.trim()
    || input.session.categoryOptions.find((option) => option.value === categoryId)?.label
    || input.item.suggested.categoryName
    || undefined;
  const sameSkuGroupId = input.action.sameSkuGroupId?.trim() || input.item.suggested.sameSkuGroupId || undefined;
  const productType = input.action.productType?.trim() || input.item.suggested.productType || undefined;
  const shortName = input.action.shortName?.trim() || input.item.suggested.shortName || input.item.shortName?.trim() || undefined;
  return {
    internalProductId: input.item.internalProductId,
    ...(sameSkuGroupId ? { sameSkuGroupId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(categoryName ? { categoryName } : {}),
    ...(productType ? { productType } : {}),
    ...(shortName ? { shortName } : {}),
    confidence: 0.95,
    updatedAt: input.session.date,
    reason: 'link_registry_maintenance_review',
    ...(input.action.reviewerId ? { maintainer: input.action.reviewerId } : {}),
  };
}

async function writeOverrideEntry(overridesPath: string, payload: Record<string, unknown>): Promise<void> {
  await mutateJsonFileSerialized<LinkRegistryOverrideFile>(overridesPath, { version: 1 }, (existing) => {
    const entries = [...(existing.entries ?? [])];
    const index = entries.findIndex((item) => item.internalProductId === payload.internalProductId);
    if (index >= 0) entries[index] = { ...entries[index], ...payload };
    else entries.push(payload);
    entries.sort((left, right) => String(left.internalProductId ?? '').localeCompare(String(right.internalProductId ?? '')));
    return { ...existing, version: 1, entries };
  });
}

async function saveReminderStatus(
  outputDir: string,
  session: LinkRegistryMaintenanceSession,
  status: LinkRegistryMaintenanceSessionStatus,
): Promise<void> {
  await saveLinkRegistryReminderState(outputDir, 'maintenance', {
    signature: session.signature,
    status: status === 'open' ? 'prompted' : status,
    sessionDate: session.date,
    updatedAt: session.updatedAt,
  });
}

export async function openLinkRegistryMaintenancePrompt(
  outputDir: string,
  input: OpenLinkRegistryMaintenancePromptInput,
): Promise<LinkRegistryMaintenanceResponse | null> {
  const queue = await enrichMaintenanceQueueWithLlmSuggestions(
    buildSessionQueue(input.registry, input.referenceDate ?? input.date),
    input.llmProvider,
  );
  if (queue.length === 0 && !input.promptSummary?.newLinkCount) return null;

  const signature = buildSessionSignature(queue);
  const reminderState = await loadLinkRegistryReminderState(outputDir, 'maintenance');
  if (!input.force && reminderState?.signature === signature) return null;

  let response: LinkRegistryMaintenanceResponse | null = null;
  let reminderSession: LinkRegistryMaintenanceSession | null = null;
  await mutateOptionalSession(sessionPath(outputDir, input.date), (existing) => {
    if (existing && (existing.status === 'reviewing' || existing.status === 'completed')) {
      response = currentReviewResponse(existing);
      return existing;
    }
    if (existing?.signature === signature) {
      if (!input.force) return existing;
      const updated: LinkRegistryMaintenanceSession = {
        ...existing,
        status: 'open',
        updatedAt: new Date().toISOString(),
        queue,
        categoryOptions: categoryOptions(input.registry),
        productTypeOptions: productTypeOptions(input.registry),
        overridesPath: input.overridesPath,
        ...(input.promptSummary ? { promptSummary: input.promptSummary } : {}),
      };
      reminderSession = updated;
      response = {
        text: updated.queue.length > 0
          ? `发现 ${updated.queue.length} 条待维护链接，请确认是否开始维护。`
          : `本次新增 ${updated.promptSummary?.newLinkCount ?? 0} 条链接，已自动归档，无需人工维护。`,
        card: buildPromptCard(updated),
      };
      return updated;
    }
    if (!input.force && existing && (existing.status === 'open' || existing.status === 'reviewing')) return existing;

    const now = new Date().toISOString();
    const session: LinkRegistryMaintenanceSession = {
      date: input.date,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      signature,
      queue,
      categoryOptions: categoryOptions(input.registry),
      productTypeOptions: productTypeOptions(input.registry),
      reviewRecords: [],
      overridesPath: input.overridesPath,
      ...(input.promptSummary ? { promptSummary: input.promptSummary } : {}),
    };
    reminderSession = session;
    response = {
      text: queue.length > 0
        ? `发现 ${queue.length} 条待维护链接，请确认是否开始维护。`
        : `本次新增 ${input.promptSummary?.newLinkCount ?? 0} 条链接，已自动归档，无需人工维护。`,
      card: buildPromptCard(session),
    };
    return session;
  });
  const sessionForReminder = reminderSession as LinkRegistryMaintenanceSession | null;
  if (sessionForReminder) await saveReminderStatus(outputDir, sessionForReminder, sessionForReminder.status);
  return response;
}

export async function handleLinkRegistryMaintenanceCardAction(
  outputDir: string,
  input: LinkRegistryMaintenanceCardActionInput,
): Promise<LinkRegistryMaintenanceResponse> {
  const resolved = await resolveSessionForAction(outputDir, input.date);
  if (!resolved) return { text: '还没有可用的链接维护会话，请等待下一次提醒。' };
  const { path, session } = resolved;

  if (input.action === 'start') {
    const updated = await mutateSession(path, session, (current) => ({
      ...current,
      status: 'reviewing',
      updatedAt: new Date().toISOString(),
    }));
    await saveReminderStatus(outputDir, updated, updated.status);
    return currentReviewResponse(updated);
  }

  if (input.action === 'snooze') {
    const updated = await mutateSession(path, session, (current) => ({
      ...current,
      status: 'snoozed',
      updatedAt: new Date().toISOString(),
    }));
    await saveReminderStatus(outputDir, updated, updated.status);
    return {
      text: `链接维护已暂缓 ${updated.date}`,
      card: statusCard('链接维护已暂缓', `已暂缓本次链接维护提醒，日期 ${updated.date}。`, 'grey'),
    };
  }

  if (input.action === 'ignore') {
    const updated = await mutateSession(path, session, (current) => ({
      ...current,
      status: 'ignored',
      updatedAt: new Date().toISOString(),
    }));
    await saveReminderStatus(outputDir, updated, updated.status);
    return {
      text: `链接维护已忽略 ${updated.date}`,
      card: statusCard('链接维护本次忽略', `已忽略本次链接维护提醒，日期 ${updated.date}。`, 'grey'),
    };
  }

  let invalidResponse: LinkRegistryMaintenanceResponse | null = null;
  const updated = await mutateSession(path, session, async (current) => {
    const reviewIndex = input.reviewIndex && input.reviewIndex > 0 ? input.reviewIndex : nextQueueIndex(current);
    const item = current.queue[reviewIndex - 1];
    const internalProductId = input.internalProductId ?? item?.internalProductId;
    if (!item || item.internalProductId !== internalProductId) {
      invalidResponse = { text: '没有找到对应的链接维护条目，请从最新卡片继续。' };
      return current;
    }
    if (current.reviewRecords.some((record) => record.internalProductId === item.internalProductId)) {
      return current;
    }

    const decision = input.decision ?? 'accept_with_edit';
    if (decision !== 'ignore') {
      await writeOverrideEntry(current.overridesPath, overrideEntryPayload({ session: current, item, action: input }));
    }
    const nextSession: LinkRegistryMaintenanceSession = {
      ...current,
      reviewRecords: [
        ...current.reviewRecords,
        {
          internalProductId: item.internalProductId,
          decision,
          ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
          submittedAt: new Date().toISOString(),
        },
      ],
      status: 'reviewing',
      updatedAt: new Date().toISOString(),
    };
    nextSession.status = nextQueueIndex(nextSession) > nextSession.queue.length ? 'completed' : 'reviewing';
    return nextSession;
  });
  if (invalidResponse) return invalidResponse;
  await saveReminderStatus(outputDir, updated, updated.status);
  return currentReviewResponse(updated);
}

export function formatReasonLabels(reasonCodes: LinkRegistryMaintenanceReasonCode[]): string[] {
  return reasonCodes.map((reason) => maintenanceReasonLabel(reason));
}
