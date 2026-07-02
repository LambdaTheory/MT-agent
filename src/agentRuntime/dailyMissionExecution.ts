import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { decisionToConfirmRequest } from './dailyMissionApproval.js';
import type { DecisionRecord } from './decisionRecord.js';
import { recordOperationEvent } from './operationLedger.js';

export interface ExecuteApprovedDecisionInput {
  decision: DecisionRecord;
  outputDir: string;
  options?: AgentToolExecutionOptions;
}

export interface DailyMissionExecutionResult {
  decisionId: string;
  ok: boolean;
  text: string;
}

export async function executeApprovedDecision(input: ExecuteApprovedDecisionInput): Promise<DailyMissionExecutionResult> {
  const { decision, outputDir } = input;
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
  return { decisionId: decision.decisionId, ok: response.metadata?.ok !== false, text: response.text };
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
  return isRecord(value) && typeof value.decisionId === 'string' && typeof value.ok === 'boolean' && typeof value.text === 'string';
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
