import { readFile } from 'node:fs/promises';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import type { ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function loadApprovalRequest(outputDir: string, date: string): Promise<ClassifiedDecisions | null> {
  try {
    const parsed = JSON.parse(await readFile(dailyMissionArtifactPath(outputDir, date, 'approvalRequest'), 'utf8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.approvals) || !Array.isArray(parsed.observations)) return null;
    return { approvals: parsed.approvals as DecisionRecord[], observations: parsed.observations as DecisionRecord[] };
  } catch {
    return null;
  }
}

export function findApprovedDecision(approval: ClassifiedDecisions, decisionId: string): DecisionRecord | null {
  return approval.approvals.find((decision) => decision.decisionId === decisionId) ?? null;
}

export function decisionMatchesRequest(decision: DecisionRecord, toolName: string, args: Record<string, unknown>): boolean {
  if (!decision.proposedTool) return false;
  if (decision.proposedTool.toolName !== toolName) return false;
  return canonical(decision.proposedTool.arguments) === canonical(args);
}
