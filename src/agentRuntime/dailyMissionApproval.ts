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

function decisionScope(decision: DecisionRecord): string {
  return decision.subjects.map((subject) => `${subject.kind}:${subject.id}`).join('、');
}

function addDailyMissionCardMetadata(card: FeishuCardPayload, decision: DecisionRecord): FeishuCardPayload {
  const body = card.body as { elements?: unknown[] } | undefined;
  const elements = body?.elements ?? [];
  return {
    ...card,
    body: {
      ...(card.body as Record<string, unknown>),
      elements: [
        {
          tag: 'markdown',
          content: [
            '**Daily Mission 审批语义**',
            '来源：Daily Mission',
            'Phase：waiting_approval',
            `Run：${decision.runId}`,
            `Decision：${decision.decisionId}`,
            `作用范围：${decisionScope(decision)}`,
            `预期后果：${decision.title}`,
          ].join('\n'),
        },
        ...elements,
      ],
    },
  };
}

export function buildDailyMissionApprovalCards(decisions: DecisionRecord[]): FeishuCardPayload[] {
  return decisions
    .filter((decision) => decision.proposedTool)
    .map((decision) => addDailyMissionCardMetadata(buildAgentToolConfirmCard(decisionToConfirmRequest(decision)), decision));
}
