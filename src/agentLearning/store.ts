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

export interface AgentLearningClarificationPlannerHint {
  kind?: 'clarification';
  originalMessage: string;
  selectedMessage: string;
  label: string;
  count: number;
  confidence: number;
  lastSelectedAt: string;
}

export type AgentLearningOutcome = 'completed' | 'failed' | 'cancelled';

export interface AgentLearningToolOutcomePlannerHint {
  kind: 'tool_outcome';
  toolName: string;
  outcome: AgentLearningOutcome;
  arguments: Record<string, unknown>;
  count: number;
  confidence: number;
  lastOccurredAt: string;
}

export interface AgentLearningWorkflowOutcomePlannerHint {
  kind: 'workflow_outcome';
  workflowName: string;
  outcome: AgentLearningOutcome;
  arguments: Record<string, unknown>;
  count: number;
  confidence: number;
  lastOccurredAt: string;
}

export type AgentLearningPlannerHint =
  | AgentLearningClarificationPlannerHint
  | AgentLearningToolOutcomePlannerHint
  | AgentLearningWorkflowOutcomePlannerHint;

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

interface OutcomeGroup {
  kind: 'tool_outcome' | 'workflow_outcome';
  toolName?: string;
  workflowName?: string;
  outcome: AgentLearningOutcome;
  arguments: Record<string, unknown>;
  count: number;
  relevance: number;
  lastOccurredAt: string;
  reason?: string;
  resultSummary?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function eventOutcome(type: AgentLearningEventType): AgentLearningOutcome | null {
  if (type === 'tool_completed' || type === 'workflow_completed') return 'completed';
  if (type === 'tool_failed' || type === 'workflow_failed') return 'failed';
  if (type === 'tool_cancelled' || type === 'workflow_cancelled') return 'cancelled';
  return null;
}

function outcomeSearchText(event: AgentLearningEvent): string {
  return [
    event.originalMessage,
    event.selectedMessage,
    event.reason,
    event.resultSummary,
    event.toolName,
    event.workflowName,
    event.arguments ? stableJson(event.arguments) : undefined,
  ].filter((part): part is string => Boolean(part)).join(' ');
}

function scalarArgumentTokens(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(scalarArgumentTokens);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(scalarArgumentTokens);
  return [];
}

const SENSITIVE_HINT_KEY_PATTERN = /(?:token|secret|password|cookie|authorization|auth|signature|confirmation|confirm|file|path|url|uri|audit|artifact|state|planref|requestref|rollback|html|payload|raw)/i;
const URL_OR_PATH_PATTERN = /(?:https?:\/\/|[A-Za-z]:\\|\\\\|\/[\w.-]+\/)/;

function sanitizeHintString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (URL_OR_PATH_PATTERN.test(trimmed)) return '[redacted]';
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function sanitizeHintValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[redacted]';
  if (typeof value === 'string') return sanitizeHintString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitizeHintValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = SENSITIVE_HINT_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeHintValue(entry, depth + 1);
    }
    return sanitized;
  }
  return String(value);
}

function sanitizeHintArguments(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeHintValue(args) as Record<string, unknown>;
}

function outcomeRelevance(event: AgentLearningEvent, message?: string): number {
  if (!message) return 1;
  const base = similarity(message, outcomeSearchText(event));
  const compactMessage = compactText(message);
  const operationMatch = (event.toolName ?? event.workflowName ?? '')
    .split(/[.\-_]/)
    .map((token) => compactText(token))
    .filter((token) => token.length >= 3)
    .some((token) => compactMessage.includes(token));
  const argumentMatch = scalarArgumentTokens(event.arguments)
    .map((token) => compactText(token))
    .filter((token) => token.length >= 2)
    .some((token) => compactMessage.includes(token));
  return Math.max(base, operationMatch ? 0.98 : 0, argumentMatch ? 0.72 : 0);
}

function outcomeGroups(store: AgentLearningStore, message?: string): OutcomeGroup[] {
  const groups = new Map<string, OutcomeGroup>();
  for (const event of store.events) {
    const outcome = eventOutcome(event.type);
    if (!outcome) continue;
    const kind = event.toolName ? 'tool_outcome' : event.workflowName ? 'workflow_outcome' : null;
    if (!kind) continue;

    const relevance = outcomeRelevance(event, message);
    if (message && relevance < 0.35) continue;
    const args = event.arguments ? structuredClone(event.arguments) : {};
    const name = kind === 'tool_outcome' ? event.toolName! : event.workflowName!;
    const key = `${kind}\n${name}\n${outcome}\n${stableJson(args)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.relevance = Math.max(existing.relevance, relevance);
      if (event.createdAt > existing.lastOccurredAt) {
        existing.lastOccurredAt = event.createdAt;
        existing.reason = event.reason;
        existing.resultSummary = event.resultSummary;
      }
    } else {
      groups.set(key, {
        kind,
        ...(kind === 'tool_outcome' ? { toolName: name } : { workflowName: name }),
        outcome,
        arguments: args,
        count: 1,
        relevance,
        lastOccurredAt: event.createdAt,
        ...(event.reason ? { reason: event.reason } : {}),
        ...(event.resultSummary ? { resultSummary: event.resultSummary } : {}),
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.relevance - a.relevance || b.count - a.count || b.lastOccurredAt.localeCompare(a.lastOccurredAt));
}

function outcomeConfidence(group: OutcomeGroup): number {
  const cap = group.outcome === 'completed' ? 0.9 : 0.84;
  const base = group.outcome === 'completed' ? 0.42 : 0.36;
  return Math.min(cap, base + group.relevance * 0.34 + Math.min(group.count, 5) * 0.035);
}

function hintTime(hint: AgentLearningPlannerHint): string {
  return 'lastSelectedAt' in hint ? hint.lastSelectedAt : hint.lastOccurredAt;
}

export async function buildAgentLearningPlannerHints(outputDir: string, message: string, limit = 5): Promise<AgentLearningPlannerHint[]> {
  const store = await loadAgentLearningStore(outputDir);
  const clarificationHints: AgentLearningPlannerHint[] = clarificationGroups(store, message).map((group) => ({
    originalMessage: group.originalMessage,
    selectedMessage: group.selectedMessage,
    label: group.label,
    count: group.count,
    confidence: Math.min(0.95, 0.45 + group.relevance * 0.35 + Math.min(group.count, 5) * 0.04),
    lastSelectedAt: group.lastSelectedAt,
  }));
  const outcomeHints: AgentLearningPlannerHint[] = outcomeGroups(store, message).map((group) => {
    const common = {
      outcome: group.outcome,
      arguments: sanitizeHintArguments(group.arguments),
      count: group.count,
      confidence: outcomeConfidence(group),
      lastOccurredAt: group.lastOccurredAt,
    };
    return group.kind === 'tool_outcome'
      ? { kind: 'tool_outcome', toolName: group.toolName!, ...common }
      : { kind: 'workflow_outcome', workflowName: group.workflowName!, ...common };
  });
  return [...clarificationHints, ...outcomeHints]
    .sort((a, b) => b.confidence - a.confidence || b.count - a.count || hintTime(b).localeCompare(hintTime(a)))
    .slice(0, limit);
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
