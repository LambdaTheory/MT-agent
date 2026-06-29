import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { buildLinkRegistryMaintenanceReport } from './maintenance.js';
import type { LinkRegistryOverrideRisk } from './overrides.js';
import {
  loadLinkRegistryReminderState,
  saveLinkRegistryReminderState,
} from './reminderState.js';
import type { LinkRegistryEntry } from './types.js';

type LinkRegistryGovernanceStatus = 'open' | 'reviewing' | 'snoozed' | 'ignored' | 'completed';
export type LinkRegistryGovernanceDecision = 'resolved' | 'watch' | 'ignored';

interface LinkRegistryGovernanceQueueItem {
  kind: 'same_sku_group' | 'override_risk';
  title: string;
  summary: string;
  sameSkuGroupId?: string;
  internalProductId?: string;
  updatedAt?: string;
}

interface LinkRegistryGovernanceReviewRecord {
  reviewIndex: number;
  kind: LinkRegistryGovernanceQueueItem['kind'];
  title: string;
  decision: LinkRegistryGovernanceDecision;
  note?: string;
  sameSkuGroupId?: string;
  internalProductId?: string;
  reviewerId?: string;
  submittedAt: string;
}

interface LinkRegistryGovernanceSession {
  date: string;
  createdAt: string;
  updatedAt: string;
  status: LinkRegistryGovernanceStatus;
  signature: string;
  queue: LinkRegistryGovernanceQueueItem[];
  reviewRecords: LinkRegistryGovernanceReviewRecord[];
}

export interface OpenLinkRegistryGovernancePromptInput {
  date: string;
  registry: LinkRegistryEntry[];
  overrideRisks?: LinkRegistryOverrideRisk[];
  referenceDate?: string;
  force?: boolean;
}

export interface LinkRegistryGovernanceCardActionInput {
  date: string;
  action: 'start' | 'advance' | 'submit' | 'snooze' | 'ignore';
  reviewIndex?: number;
  decision?: LinkRegistryGovernanceDecision;
  note?: string;
  reviewerId?: string;
}

export interface LinkRegistryGovernanceResponse {
  text: string;
  card?: FeishuCardPayload;
}

const SESSION_FILE = 'link-registry-governance-session.json';

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

function selectOption(label: string, value: string): Record<string, unknown> {
  return { text: plainText(label), value };
}

async function readOptionalJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveSession(path: string, session: LinkRegistryGovernanceSession): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

async function loadSession(outputDir: string, date: string): Promise<LinkRegistryGovernanceSession | null> {
  return readOptionalJson<LinkRegistryGovernanceSession | null>(sessionPath(outputDir, date), null);
}

async function loadLatestSession(outputDir: string): Promise<{ path: string; session: LinkRegistryGovernanceSession } | null> {
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

async function resolveSessionForAction(outputDir: string, date: string): Promise<{ path: string; session: LinkRegistryGovernanceSession } | null> {
  const trimmedDate = date.trim();
  if (trimmedDate) {
    const session = await loadSession(outputDir, trimmedDate);
    return session ? { path: sessionPath(outputDir, trimmedDate), session } : null;
  }
  return loadLatestSession(outputDir);
}

function nextReviewIndex(session: LinkRegistryGovernanceSession): number {
  const reviewed = new Set(session.reviewRecords.map((record) => record.reviewIndex));
  const index = session.queue.findIndex((_, itemIndex) => !reviewed.has(itemIndex + 1));
  return index === -1 ? session.queue.length + 1 : index + 1;
}

function buildQueue(
  registry: LinkRegistryEntry[],
  overrideRisks: LinkRegistryOverrideRisk[],
  referenceDate: string,
): LinkRegistryGovernanceQueueItem[] {
  const report = buildLinkRegistryMaintenanceReport(registry, overrideRisks, { referenceDate });
  return report.queue
    .filter((item) => item.kind === 'same_sku_group' || item.kind === 'override_risk')
    .map((item) => {
      if (item.kind === 'same_sku_group') {
        return {
          kind: 'same_sku_group' as const,
          title: item.sameSkuGroupId ?? '未命名同款组',
          summary: '同款组样本不足，需要补齐这个组下的链接样本与归档信息。',
          sameSkuGroupId: item.sameSkuGroupId,
          updatedAt: item.updatedAt,
        };
      }
      return {
        kind: 'override_risk' as const,
        title: item.internalProductId ? `人工覆盖风险 ${item.internalProductId}` : '人工覆盖风险',
        summary: item.message ?? '人工覆盖规则存在风险，请检查 override 配置。',
        internalProductId: item.internalProductId,
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'same_sku_group' ? -1 : 1;
      return (left.sameSkuGroupId ?? left.title).localeCompare(right.sameSkuGroupId ?? right.title);
    });
}

function buildSessionSignature(queue: LinkRegistryGovernanceQueueItem[]): string {
  const payload = queue.map((item) => ({
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    sameSkuGroupId: item.sameSkuGroupId ?? '',
    internalProductId: item.internalProductId ?? '',
    updatedAt: item.updatedAt ?? '',
  }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildPromptCard(session: LinkRegistryGovernanceSession): FeishuCardPayload {
  const previewLines = session.queue
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}\n${item.summary}`);
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText('链接档案治理提醒'),
      template: 'orange',
    },
    body: {
      elements: [
        markdown(`**发现 ${session.queue.length} 个组级治理问题。**\n这些问题不一定要马上改库，但值得尽快梳理清楚。`),
        markdown(`**本轮重点**\n${previewLines.join('\n')}`),
        {
          tag: 'form',
          name: 'link_registry_governance_start_form',
          elements: [{
            tag: 'button',
            text: plainText('开始治理'),
            type: 'primary',
            form_action_type: 'submit',
            name: 'link_registry_governance_start_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_governance_start', date: session.date } }],
          }],
        },
        {
          tag: 'form',
          name: 'link_registry_governance_snooze_form',
          elements: [{
            tag: 'button',
            text: plainText('稍后提醒'),
            type: 'default',
            form_action_type: 'submit',
            name: 'link_registry_governance_snooze_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_governance_snooze', date: session.date } }],
          }],
        },
        {
          tag: 'form',
          name: 'link_registry_governance_ignore_form',
          elements: [{
            tag: 'button',
            text: plainText('本次忽略'),
            type: 'default',
            form_action_type: 'submit',
            name: 'link_registry_governance_ignore_submit',
            behaviors: [{ type: 'callback', value: { action: 'link_registry_governance_ignore', date: session.date } }],
          }],
        },
      ],
    },
  };
}

function buildReviewCard(
  session: LinkRegistryGovernanceSession,
  item: LinkRegistryGovernanceQueueItem,
  reviewIndex: number,
): FeishuCardPayload {
  const isLast = reviewIndex >= session.queue.length;
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: plainText(`组级治理 ${reviewIndex}/${session.queue.length}`),
      template: item.kind === 'override_risk' ? 'red' : 'orange',
    },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'link_registry_governance_form',
          elements: [
            markdown(`**治理对象**\n${item.title}`),
            markdown(`**问题说明**\n${item.summary}`),
            ...(item.sameSkuGroupId ? [markdown(`**同款组 ID**\n${item.sameSkuGroupId}`)] : []),
            ...(item.internalProductId ? [markdown(`**端内 ID**\n${item.internalProductId}`)] : []),
            ...(item.updatedAt ? [markdown(`**最近时间**\n${item.updatedAt}`)] : []),
            {
              tag: 'select_static',
              name: 'decision',
              placeholder: plainText('选择处理结论'),
              options: [
                selectOption('已处理', 'resolved'),
                selectOption('继续观察', 'watch'),
                selectOption('本次忽略', 'ignored'),
              ],
              value: 'watch',
            },
            {
              tag: 'input',
              name: 'note',
              label: plainText('处理备注'),
              label_position: 'top',
              placeholder: plainText('例如：已确认归组方案，等下一轮补齐链接'),
              input_type: 'text',
            },
            {
              tag: 'button',
              text: plainText(isLast ? '提交并完成' : '提交并继续'),
              type: 'primary',
              form_action_type: 'submit',
              name: 'link_registry_governance_submit',
              behaviors: [{
                type: 'callback',
                value: { action: 'link_registry_governance_submit', date: session.date, reviewIndex },
              }],
            },
          ],
        },
      ],
    },
  };
}

function currentReviewResponse(
  session: LinkRegistryGovernanceSession,
  reviewIndex: number,
): LinkRegistryGovernanceResponse {
  const item = session.queue[reviewIndex - 1];
  if (!item) {
    return {
      text: `组级治理已处理完成 ${session.date}\n已处理 ${session.reviewRecords.length}/${session.queue.length}`,
      card: statusCard('组级治理已处理完成', `日期 ${session.date}
已处理 ${session.reviewRecords.length}/${session.queue.length} 条治理事项。`, 'green'),
    };
  }
  return {
    text: `组级治理 ${reviewIndex}/${session.queue.length}，${item.title}`,
    card: buildReviewCard(session, item, reviewIndex),
  };
}

async function saveReminderStatus(
  outputDir: string,
  session: LinkRegistryGovernanceSession,
  status: LinkRegistryGovernanceStatus,
): Promise<void> {
  await saveLinkRegistryReminderState(outputDir, 'governance', {
    signature: session.signature,
    status: status === 'open' ? 'prompted' : status,
    sessionDate: session.date,
    updatedAt: session.updatedAt,
  });
}

export async function openLinkRegistryGovernancePrompt(
  outputDir: string,
  input: OpenLinkRegistryGovernancePromptInput,
): Promise<LinkRegistryGovernanceResponse | null> {
  const queue = buildQueue(input.registry, input.overrideRisks ?? [], input.referenceDate ?? input.date);
  if (queue.length === 0) return null;

  const signature = buildSessionSignature(queue);
  const existing = await loadSession(outputDir, input.date);
  if (existing?.signature === signature) {
    if (!input.force) return null;
    if (existing.status === 'reviewing' || existing.status === 'completed') return currentReviewResponse(existing, nextReviewIndex(existing));
    existing.status = 'open';
    existing.updatedAt = new Date().toISOString();
    await saveSession(sessionPath(outputDir, input.date), existing);
    await saveReminderStatus(outputDir, existing, existing.status);
    return {
      text: `发现 ${existing.queue.length} 个组级治理问题，建议抽空看一下。`,
      card: buildPromptCard(existing),
    };
  }
  if (!input.force && existing && (existing.status === 'open' || existing.status === 'reviewing')) return null;

  const reminderState = await loadLinkRegistryReminderState(outputDir, 'governance');
  if (!input.force && reminderState?.signature === signature) return null;

  const now = new Date().toISOString();
  const session: LinkRegistryGovernanceSession = {
    date: input.date,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    signature,
    queue,
    reviewRecords: [],
  };
  await saveSession(sessionPath(outputDir, input.date), session);
  await saveReminderStatus(outputDir, session, session.status);
  return {
    text: `发现 ${queue.length} 个组级治理问题，建议抽空看一下。`,
    card: buildPromptCard(session),
  };
}

export async function handleLinkRegistryGovernanceCardAction(
  outputDir: string,
  input: LinkRegistryGovernanceCardActionInput,
): Promise<LinkRegistryGovernanceResponse> {
  const resolved = await resolveSessionForAction(outputDir, input.date);
  if (!resolved) return { text: '还没有可用的组级治理会话，请等待下一次提醒。' };
  const { path, session } = resolved;

  if (input.action === 'snooze') {
    session.status = 'snoozed';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return {
      text: `组级治理已暂缓 ${session.date}`,
      card: statusCard('组级治理已暂缓', `已暂缓本次组级治理提醒，日期 ${session.date}。`, 'grey'),
    };
  }

  if (input.action === 'ignore') {
    session.status = 'ignored';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return {
      text: `组级治理已忽略 ${session.date}`,
      card: statusCard('组级治理本次忽略', `已忽略本次组级治理提醒，日期 ${session.date}。`, 'grey'),
    };
  }

  if (input.action === 'start') {
    session.status = 'reviewing';
    session.updatedAt = new Date().toISOString();
    await saveSession(path, session);
    await saveReminderStatus(outputDir, session, session.status);
    return currentReviewResponse(session, nextReviewIndex(session));
  }

  const reviewIndex = input.reviewIndex && input.reviewIndex > 0 ? input.reviewIndex : nextReviewIndex(session);
  const item = session.queue[reviewIndex - 1];
  if (!item) return { text: '没有找到对应的治理条目，请从最新卡片继续。' };

  session.reviewRecords.push({
    reviewIndex,
    kind: item.kind,
    title: item.title,
    decision: input.action === 'advance' ? 'watch' : (input.decision ?? 'watch'),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(item.sameSkuGroupId ? { sameSkuGroupId: item.sameSkuGroupId } : {}),
    ...(item.internalProductId ? { internalProductId: item.internalProductId } : {}),
    ...(input.reviewerId ? { reviewerId: input.reviewerId } : {}),
    submittedAt: new Date().toISOString(),
  });

  const nextIndex = reviewIndex + 1;
  session.status = nextIndex > session.queue.length ? 'completed' : 'reviewing';
  session.updatedAt = new Date().toISOString();
  await saveSession(path, session);
  await saveReminderStatus(outputDir, session, session.status);
  return currentReviewResponse(session, nextIndex);
}
