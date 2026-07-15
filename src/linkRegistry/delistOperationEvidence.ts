import type { OperationPlanJournalEntry } from '../agentRuntime/operationPlan.js';

export interface AgentDelistEvent {
  internalProductId: string;
  at: string;
  toolName: string;
  runId?: string;
  decisionId?: string;
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isSuccessfulDelist(entry: OperationPlanJournalEntry): boolean {
  if (entry.event !== 'execution_succeeded') return false;
  if (entry.toolName === 'rental.delist' || entry.toolName === 'rental.delistBatch') return true;
  return entry.toolName === 'rental.operationConfirmRequest'
    && entry.metadata?.rentalAction === 'delist';
}

function hasRecordedExecutionTimestamp(entry: OperationPlanJournalEntry): boolean {
  return entry.metadata?.executionTimestampRecorded === true;
}

export function collectAgentDelistEvents(entries: OperationPlanJournalEntry[]): AgentDelistEvent[] {
  return entries
    .filter((entry) => isSuccessfulDelist(entry)
      && hasRecordedExecutionTimestamp(entry)
      && entry.subject?.kind === 'product'
      && /^\d+$/.test(entry.subject.id)
      && isValidTimestamp(entry.at))
    .map((entry) => ({
      internalProductId: entry.subject!.id,
      at: entry.at,
      toolName: entry.toolName!,
      ...(entry.runId ? { runId: entry.runId } : {}),
      ...(entry.decisionId ? { decisionId: entry.decisionId } : {}),
    }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.internalProductId.localeCompare(right.internalProductId));
}
