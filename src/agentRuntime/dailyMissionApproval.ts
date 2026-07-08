import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from './approvalCard.js';
import type { DecisionRecord } from './decisionRecord.js';

const REASON_PATTERN = /^\[\[dailyMission:runId=([^;]+);decisionId=([^\]]+)\]\]/;

export function decisionToConfirmRequest(decision: DecisionRecord): AgentToolConfirmRequest {
  if (!decision.proposedTool) throw new Error(`Decision ${decision.decisionId} has no proposedTool`);
  return {
    toolName: decision.proposedTool.toolName,
    arguments: decision.proposedTool.arguments,
    reason: `[[dailyMission:runId=${decision.runId};decisionId=${decision.decisionId}]] ${decision.title}`,
  };
}

export function parseDailyMissionReason(reason: string): { runId: string; decisionId: string } | null {
  const match = REASON_PATTERN.exec(reason);
  if (!match) return null;
  return { runId: match[1], decisionId: match[2] };
}

export function buildDailyMissionApprovalCards(decisions: DecisionRecord[]): FeishuCardPayload[] {
  return decisions
    .filter((decision) => decision.proposedTool)
    .map((decision) => buildAgentToolConfirmCard(decisionToConfirmRequest(decision)));
}
