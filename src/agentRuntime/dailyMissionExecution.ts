import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { decisionToConfirmRequest } from './dailyMissionApproval.js';
import type { DecisionRecord } from './decisionRecord.js';
import { recordOperationEvent } from './operationLedger.js';

export interface ExecuteApprovedDecisionInput {
  decision: DecisionRecord;
  outputDir: string;
  date?: string;
  options?: AgentToolExecutionOptions;
}

export interface DailyMissionExecutionResult {
  runId: string;
  decisionId: string;
  ok: boolean;
  status: 'processing' | 'executed' | 'pending_confirmation' | 'failed';
  text: string;
  card?: FeishuCardPayload;
}

const executionResultLocks = new Map<string, Promise<void>>();

async function withExecutionResultLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const previous = executionResultLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.then(() => current);
  executionResultLocks.set(path, next);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (executionResultLocks.get(path) === next) executionResultLocks.delete(path);
  }
}

export async function executeApprovedDecision(input: ExecuteApprovedDecisionInput): Promise<DailyMissionExecutionResult> {
  const { decision, outputDir } = input;
  if (input.date) {
    const existing = await loadExecutionResult(outputDir, input.date, decision.runId, decision.decisionId);
    if (existing?.ok || existing?.status === 'processing' || existing?.status === 'pending_confirmation') return existing;
    await appendExecutionResult(outputDir, input.date, {
      runId: decision.runId,
      decisionId: decision.decisionId,
      ok: false,
      status: 'processing',
      text: 'Daily Mission approval execution is processing.',
    });
  }
  await recordOperationEvent(outputDir, {
    planId: decision.decisionId,
    at: input.date ? `${input.date}T00:00:00.000Z` : new Date().toISOString(),
    event: 'approval_accepted',
    runId: decision.runId,
    decisionId: decision.decisionId,
    subject: decision.subjects[0],
    ...(input.date ? { metadata: { missionDate: input.date } } : {}),
  });
  const response = await executeAgentToolRequest(decisionToConfirmRequest(decision), outputDir, {
    ...input.options,
    ledgerContext: { outputDir, runId: decision.runId, decisionId: decision.decisionId, ...(input.date ? { missionDate: input.date } : {}) },
  });
  if (response.card) {
    return { runId: decision.runId, decisionId: decision.decisionId, ok: false, status: 'pending_confirmation', text: response.text, card: response.card };
  }
  const ok = response.metadata?.ok !== false;
  return { runId: decision.runId, decisionId: decision.decisionId, ok, status: ok ? 'executed' : 'failed', text: response.text };
}

export async function writeExecutionResults(
  outputDir: string,
  date: string,
  results: DailyMissionExecutionResult[],
): Promise<string> {
  const path = dailyMissionArtifactPath(outputDir, date, 'executionResults');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExecutionResult(value: unknown): value is DailyMissionExecutionResult {
  return isRecord(value)
    && typeof value.runId === 'string'
    && typeof value.decisionId === 'string'
    && typeof value.ok === 'boolean'
    && typeof value.text === 'string'
    && (value.status === 'processing' || value.status === 'executed' || value.status === 'pending_confirmation' || value.status === 'failed');
}

export async function loadExecutionResult(
  outputDir: string,
  date: string,
  runId: string,
  decisionId: string,
): Promise<DailyMissionExecutionResult | null> {
  const results = await loadAllExecutionResults(outputDir, date);
  return results.find((entry) => entry.runId === runId && entry.decisionId === decisionId) ?? null;
}

export async function loadAllExecutionResults(outputDir: string, date: string): Promise<DailyMissionExecutionResult[]> {
  const path = dailyMissionArtifactPath(outputDir, date, 'executionResults');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isExecutionResult);
  } catch {
    return [];
  }
}

export async function appendExecutionResult(
  outputDir: string,
  date: string,
  result: DailyMissionExecutionResult,
): Promise<string> {
  const path = dailyMissionArtifactPath(outputDir, date, 'executionResults');
  return withExecutionResultLock(path, async () => {
    let existing: DailyMissionExecutionResult[] = [];
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (Array.isArray(parsed) && parsed.every(isExecutionResult)) existing = parsed;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }
    const next = existing.filter((entry) => entry.runId !== result.runId || entry.decisionId !== result.decisionId);
    next.push(result);
    return writeExecutionResults(outputDir, date, next);
  });
}
