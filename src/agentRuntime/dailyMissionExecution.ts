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
  decisionId: string;
  ok: boolean;
  status: 'executed' | 'pending_confirmation' | 'failed';
  text: string;
  card?: FeishuCardPayload;
}

export async function executeApprovedDecision(input: ExecuteApprovedDecisionInput): Promise<DailyMissionExecutionResult> {
  const { decision, outputDir } = input;
  if (input.date) {
    const existing = await loadExecutionResult(outputDir, input.date, decision.decisionId);
    if (existing?.ok) return existing;
  }
  await recordOperationEvent(outputDir, {
    planId: decision.decisionId,
    at: new Date().toISOString(),
    event: 'approval_accepted',
    runId: decision.runId,
    decisionId: decision.decisionId,
    subject: decision.subjects[0],
  });
  const response = await executeAgentToolRequest(decisionToConfirmRequest(decision), outputDir, {
    ...input.options,
    ledgerContext: { outputDir, runId: decision.runId, decisionId: decision.decisionId },
  });
  if (response.card) {
    return { decisionId: decision.decisionId, ok: false, status: 'pending_confirmation', text: response.text, card: response.card };
  }
  const ok = response.metadata?.ok !== false;
  return { decisionId: decision.decisionId, ok, status: ok ? 'executed' : 'failed', text: response.text };
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
    && typeof value.decisionId === 'string'
    && typeof value.ok === 'boolean'
    && typeof value.text === 'string'
    && (value.status === undefined || value.status === 'executed' || value.status === 'pending_confirmation' || value.status === 'failed');
}

export async function loadExecutionResult(
  outputDir: string,
  date: string,
  decisionId: string,
): Promise<DailyMissionExecutionResult | null> {
  const results = await loadAllExecutionResults(outputDir, date);
  return results.find((entry) => entry.decisionId === decisionId) ?? null;
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
  let existing: DailyMissionExecutionResult[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (Array.isArray(parsed) && parsed.every(isExecutionResult)) existing = parsed;
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }
  const next = existing.filter((entry) => entry.decisionId !== result.decisionId);
  next.push(result);
  return writeExecutionResults(outputDir, date, next);
}
