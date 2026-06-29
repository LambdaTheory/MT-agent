import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentLearningEventType =
  | 'clarification_selected'
  | 'clarification_cancelled'
  | 'tool_confirmed'
  | 'tool_cancelled'
  | 'tool_completed'
  | 'tool_failed'
  | 'workflow_confirmed'
  | 'workflow_cancelled'
  | 'workflow_completed'
  | 'workflow_failed';

export interface AgentLearningEvent {
  eventId: string;
  type: AgentLearningEventType;
  createdAt: string;
  messageId?: string;
  actorId?: string;
  originalMessage?: string;
  selectedMessage?: string;
  label?: string;
  toolName?: string;
  workflowName?: string;
  reason?: string;
  resultSummary?: string;
  arguments?: Record<string, unknown>;
}

export interface AgentLearningEventInput {
  type: AgentLearningEventType;
  messageId?: string;
  actorId?: string;
  originalMessage?: string;
  selectedMessage?: string;
  label?: string;
  toolName?: string;
  workflowName?: string;
  reason?: string;
  resultSummary?: string;
  arguments?: Record<string, unknown>;
  createdAt?: string;
}

export interface AgentLearningStore {
  version: 1;
  updatedAt: string;
  events: AgentLearningEvent[];
}

export interface AgentLearningPlannerHint {
  originalMessage: string;
  selectedMessage: string;
  label: string;
  count: number;
  confidence: number;
  lastSelectedAt: string;
}

const STORE_FILE = 'agent-learning.json';
const MAX_EVENTS = 500;
const storeLocks = new Map<string, Promise<void>>();

function storePath(outputDir: string): string {
  return join(outputDir, 'state', STORE_FILE);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

async function withStoreLock<T>(outputDir: string, run: () => Promise<T>): Promise<T> {
  const key = storePath(outputDir);
  const previous = storeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  storeLocks.set(key, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (storeLocks.get(key) === current) storeLocks.delete(key);
  }
}

function emptyStore(now = new Date().toISOString()): AgentLearningStore {
  return { version: 1, updatedAt: now, events: [] };
}

export async function loadAgentLearningStore(outputDir: string): Promise<AgentLearningStore> {
  try {
    return JSON.parse(await readFile(storePath(outputDir), 'utf8')) as AgentLearningStore;
  } catch (error) {
    if (isEnoent(error)) return emptyStore();
    if (isJsonParseError(error)) return emptyStore();
    throw error;
  }
}

async function saveAgentLearningStore(outputDir: string, store: AgentLearningStore): Promise<void> {
  const target = storePath(outputDir);
  await mkdir(join(outputDir, 'state'), { recursive: true });
  await writeFile(target, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function trimmed(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function makeEventId(event: Omit<AgentLearningEvent, 'eventId'>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 20);
}

function normalizeEvent(input: AgentLearningEventInput): AgentLearningEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventWithoutId: Omit<AgentLearningEvent, 'eventId'> = {
    type: input.type,
    createdAt,
    ...(trimmed(input.messageId, 160) ? { messageId: trimmed(input.messageId, 160) } : {}),
    ...(trimmed(input.actorId, 120) ? { actorId: trimmed(input.actorId, 120) } : {}),
    ...(trimmed(input.originalMessage, 300) ? { originalMessage: trimmed(input.originalMessage, 300) } : {}),
    ...(trimmed(input.selectedMessage, 300) ? { selectedMessage: trimmed(input.selectedMessage, 300) } : {}),
    ...(trimmed(input.label, 60) ? { label: trimmed(input.label, 60) } : {}),
    ...(trimmed(input.toolName, 120) ? { toolName: trimmed(input.toolName, 120) } : {}),
    ...(trimmed(input.workflowName, 120) ? { workflowName: trimmed(input.workflowName, 120) } : {}),
    ...(trimmed(input.reason, 240) ? { reason: trimmed(input.reason, 240) } : {}),
    ...(trimmed(input.resultSummary, 500) ? { resultSummary: trimmed(input.resultSummary, 500) } : {}),
    ...(input.arguments ? { arguments: structuredClone(input.arguments) } : {}),
  };
  return { eventId: makeEventId(eventWithoutId), ...eventWithoutId };
}

export async function recordAgentLearningEvent(outputDir: string, input: AgentLearningEventInput): Promise<AgentLearningEvent> {
  return withStoreLock(outputDir, async () => {
    const event = normalizeEvent(input);
    const store = await loadAgentLearningStore(outputDir);
    store.events.push(event);
    store.events = store.events.slice(-MAX_EVENTS);
    store.updatedAt = event.createdAt;
    await saveAgentLearningStore(outputDir, store);
    return event;
  });
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?;；:："'`~（）()\[\]{}<>《》【】]/g, '');
}

function similarity(left: string, right: string): number {
  const a = compactText(left);
  const b = compactText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const aChars = new Set([...a]);
  const bChars = new Set([...b]);
  const union = new Set([...aChars, ...bChars]);
  let intersection = 0;
  for (const char of aChars) {
    if (bChars.has(char)) intersection += 1;
  }
  return union.size ? intersection / union.size : 0;
}

interface ClarificationGroup {
  originalMessage: string;
  selectedMessage: string;
  label: string;
  count: number;
  relevance: number;
  lastSelectedAt: string;
}

function clarificationGroups(store: AgentLearningStore, message?: string): ClarificationGroup[] {
  const groups = new Map<string, ClarificationGroup>();
  for (const event of store.events) {
    if (event.type !== 'clarification_selected' || !event.originalMessage || !event.selectedMessage || !event.label) continue;
    const relevance = message ? similarity(message, event.originalMessage) : 1;
    if (message && relevance < 0.35) continue;
    const key = `${event.originalMessage}\n${event.label}\n${event.selectedMessage}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.relevance = Math.max(existing.relevance, relevance);
      if (event.createdAt > existing.lastSelectedAt) existing.lastSelectedAt = event.createdAt;
    } else {
      groups.set(key, {
        originalMessage: event.originalMessage,
        selectedMessage: event.selectedMessage,
        label: event.label,
        count: 1,
        relevance,
        lastSelectedAt: event.createdAt,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.relevance - a.relevance || b.count - a.count || b.lastSelectedAt.localeCompare(a.lastSelectedAt));
}

export async function buildAgentLearningPlannerHints(outputDir: string, message: string, limit = 5): Promise<AgentLearningPlannerHint[]> {
  const store = await loadAgentLearningStore(outputDir);
  return clarificationGroups(store, message).slice(0, limit).map((group) => ({
    originalMessage: group.originalMessage,
    selectedMessage: group.selectedMessage,
    label: group.label,
    count: group.count,
    confidence: Math.min(0.95, 0.45 + group.relevance * 0.35 + Math.min(group.count, 5) * 0.04),
    lastSelectedAt: group.lastSelectedAt,
  }));
}

export async function summarizeAgentLearning(outputDir: string): Promise<string> {
  const store = await loadAgentLearningStore(outputDir);
  if (store.events.length === 0) return '还没有 Agent 学习记录。';

  const counts = store.events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});
  const topClarifications = clarificationGroups(store).slice(0, 5);
  const lines = [
    'Agent 学习汇总',
    `记录 ${store.events.length} 条`,
    `澄清选择 ${counts.clarification_selected ?? 0}，澄清取消 ${counts.clarification_cancelled ?? 0}`,
    `工具确认 ${counts.tool_confirmed ?? 0}，完成 ${counts.tool_completed ?? 0}，失败 ${counts.tool_failed ?? 0}，取消 ${counts.tool_cancelled ?? 0}`,
    `工作流确认 ${counts.workflow_confirmed ?? 0}，完成 ${counts.workflow_completed ?? 0}，失败 ${counts.workflow_failed ?? 0}，取消 ${counts.workflow_cancelled ?? 0}`,
  ];

  if (topClarifications.length > 0) {
    lines.push('高频澄清选择：');
    for (const group of topClarifications) {
      lines.push(`- ${group.originalMessage} -> ${group.label}：${group.selectedMessage}（${group.count} 次）`);
    }
  }

  return lines.join('\n');
}
