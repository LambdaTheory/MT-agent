import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
}

export interface OpenLinkRegistryMaintenancePromptInput {
  date: string;
  registry: LinkRegistryEntry[];
  referenceDate?: string;
  overridesPath: string;
  force?: boolean;
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

async function saveSession(path: string, session: LinkRegistryMaintenanceSession): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
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

function buildPromptCard(session: LinkRegistryMaintenanceSession): FeishuCardPayload {
  const previewLines = session.queue
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${compactName(item)}（${item.internalProductId}）\n${item.reasonLabels.join('、')}`);
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText('链接维护提醒'),
      template: session.queue.some((item) => item.reasonCodes.includes('recent_new_link')) ? 'orange' : 'blue',
    },
    body: {
      elements: [
        markdown(`**${metricSummary(session)}**\n我已经把问题链接排好优先级了，你可以现在开始逐条维护。`),
        markdown(`**优先处理**\n${previewLines.join('\n')}`),
        {
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
        },
        {
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
        },
        {
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
        },
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
            markdown(`**待补字段**\n${item.reasonLabels.join('、')}`),
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
  const existing = await readOptionalJson<LinkRegistryOverrideFile>(overridesPath, { version: 1 });
  const entries = [...(existing.entries ?? [])];
  const index = entries.findIndex((item) => item.internalProductId === payload.internalProductId);
  if (index >= 0) entries[index] = { ...entries[index], ...payload };
  else entries.push(payload);
  entries.sort((left, right) => String(left.internalProductId ?? '').localeCompare(String(right.internalProductId ?? '')));
  await mkdir(dirname(overridesPath), { recursive: true });
  await writeFile(overridesPath, `${JSON.stringify({ ...existing, version: 1, entries }, null, 2)}\n`, 'utf8');
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
  const queue = buildSessionQueue(input.registry, input.referenceDate ?? input.date);
  if (queue.length === 0) return null;

  const signature = buildSessionSignature(queue);
  const existing = await loadSession(outputDir, input.date);
  if (existing?.signature === signature) {
    if (!input.force) return null;
    if (existing.status === 'reviewing' || existing.status === 'completed') return currentReviewResponse(existing);
    existing.status = 'open';
    existing.updatedAt = new Date().toISOString();
    await saveSession(sessionPath(outputDir, input.date), existing);
    await saveReminderStatus(outputDir, existing, existing.status);
    return {
      text: `发现 ${existing.queue.length} 条待维护链接，请确认是否开始维护。`,
      card: buildPromptCard(existing),
    };
  }
  if (!input.force && existing && (existing.status === 'open' || existing.status === 'reviewing')) return null;

  const reminderState = await loadLinkRegistryReminderState(outputDir, 'maintenance');
  if (!input.force && reminderState?.signature === signature) return null;

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
  };
  await saveSession(sessionPath(outputDir, input.date), session);
  await saveReminderStatus(outputDir, session, session.status);
  return {
    text: `发现 ${queue.length} 条待维护链接，请确认是否开始维护。`,
    card: buildPromptCard(session),
  };
}

export async function handleLinkRegistryMaintenanceCardAction(
  outputDir: string,
  input: LinkRegistryMaintenanceCardActionInput,
): Promise<LinkRegistryMaintenanceResponse> {
  const resolved = await resolveSessionForAction(outputDir, input.date);
  if (!resolved) return { text: '还没有可用的链接维护会话，请等待下一次提醒。' };
  const { path, session } = resolved;

  if (input.action === 'start') {
    session.status = 'reviewing';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return currentReviewResponse(session);
  }

  if (input.action === 'snooze') {
    session.status = 'snoozed';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return {
      text: `链接维护已暂缓 ${session.date}`,
      card: statusCard('链接维护已暂缓', `已暂缓本次链接维护提醒，日期 ${session.date}。`, 'grey'),
    };
  }

  if (input.action === 'ignore') {
    session.status = 'ignored';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return {
      text: `链接维护已忽略 ${session.date}`,
      card: statusCard('链接维护本次忽略', `已忽略本次链接维护提醒，日期 ${session.date}。`, 'grey'),
    };
  }

  const reviewIndex = input.reviewIndex && input.reviewIndex > 0 ? input.reviewIndex : nextQueueIndex(session);
  const item = session.queue[reviewIndex - 1];
  const internalProductId = input.internalProductId ?? item?.internalProductId;
  if (!item || item.internalProductId !== internalProductId) {
    return { text: '没有找到对应的链接维护条目，请从最新卡片继续。' };
  }

  const decision = input.decision ?? 'accept_with_edit';
  if (decision !== 'ignore') {
    await writeOverrideEntry(session.overridesPath, overrideEntryPayload({ session, item, action: input }));
  }
  session.reviewRecords.push({
    internalProductId: item.internalProductId,
    decision,
    ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
    submittedAt: new Date().toISOString(),
  });
  session.status = nextQueueIndex(session) > session.queue.length ? 'completed' : 'reviewing';
  session.updatedAt = new Date().toISOString();
  await saveSession(path, session);
  await saveReminderStatus(outputDir, session, session.status);
  return currentReviewResponse(session);
}

export function formatReasonLabels(reasonCodes: LinkRegistryMaintenanceReasonCode[]): string[] {
  return reasonCodes.map((reason) => maintenanceReasonLabel(reason));
}
