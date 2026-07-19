import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { isInactiveRefreshPlanRef, loadInactiveRefreshPlan, verifyInactiveRefreshPlanKey } from '../operations/inactiveRefresh/planStore.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import type { BotResponse } from './types.js';

interface InactiveRefreshExecuteSelectValue {
  planRef: string;
  confirmationKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseValue(value: unknown): InactiveRefreshExecuteSelectValue | null {
  if (!isRecord(value)) return null;
  if (!isInactiveRefreshPlanRef(value.planRef)) return null;
  if (typeof value.confirmationKey !== 'string') return null;
  return { planRef: value.planRef, confirmationKey: value.confirmationKey };
}

export async function handleInactiveRefreshExecuteSelect(outputDir: string, value: unknown): Promise<BotResponse> {
  const parsed = parseValue(value);
  if (!parsed) return { text: '失活刷新计划已失效，请重新发起。' };
  const plan = await loadInactiveRefreshPlan(outputDir, parsed.planRef);
  if (!plan || !verifyInactiveRefreshPlanKey(plan, parsed.confirmationKey)) return { text: '失活刷新计划已失效，请重新发起。' };
  const request: AgentToolConfirmRequest = {
    toolName: 'operations.inactiveRefreshExecute',
    arguments: { planRef: parsed.planRef, confirmationKey: parsed.confirmationKey },
    reason: '用户确认执行失活刷新计划。',
  };
  const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
  return {
    text: '请确认失活刷新执行内容。',
    card: buildAgentToolConfirmCard(request, { requestRef }),
  };
}
