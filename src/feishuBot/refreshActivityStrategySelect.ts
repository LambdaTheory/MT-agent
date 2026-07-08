import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import { buildRefreshActivityExecuteConfirmCard } from './refreshActivityCard.js';
import { loadRefreshActivityPlan, verifyRefreshActivityPlanKey, type RefreshActivityPlan } from './refreshActivityPlanStore.js';
import type { BotResponse } from './types.js';

type RefreshActivityStrategy = 'delist_only' | 'delist_and_refill';

interface RefreshActivityStrategySelectValue {
  planRef: string;
  strategy: RefreshActivityStrategy;
  confirmationKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStrategySelectValue(value: unknown): RefreshActivityStrategySelectValue | null {
  if (!isRecord(value)) return null;
  if (typeof value.planRef !== 'string') return null;
  if (value.strategy !== 'delist_only' && value.strategy !== 'delist_and_refill') return null;
  if (typeof value.confirmationKey !== 'string') return null;
  return { planRef: value.planRef, strategy: value.strategy, confirmationKey: value.confirmationKey };
}

function buildExecuteRequest(plan: RefreshActivityPlan, strategy: RefreshActivityStrategy): AgentToolConfirmRequest {
  const delistProductIds = strategy === 'delist_and_refill'
    ? plan.delistProductIdsForRefill ?? plan.delistProductIds
    : plan.delistProductIds;
  const argumentsValue = strategy === 'delist_only'
    ? { date: plan.date, delistProductIds, strategy }
    : { date: plan.date, delistProductIds, newLinkItems: plan.newLinkItemsForRefill, strategy };
  return {
    toolName: 'operations.refreshActivityExecute',
    arguments: argumentsValue,
    reason: strategy === 'delist_only'
      ? '用户选择活跃度刷新策略：只下架候选链接，不补链。'
      : '用户选择活跃度刷新策略：下架候选链接并按同款组补链。',
    ...(plan.continuation ? { continuation: plan.continuation } : {}),
  };
}

function newLinkSummary(plan: RefreshActivityPlan, strategy: RefreshActivityStrategy): string {
  if (strategy === 'delist_only') return '';
  return plan.newLinkItemsForRefill
    .map((item) => `${item.sameSkuGroupId ?? item.keyword} 补 ${item.count} 条，源 ${item.sourceProductId} ${item.sourceProductName}`)
    .join('；');
}

export async function handleRefreshActivityStrategySelect(outputDir: string, value: unknown): Promise<BotResponse> {
  const parsed = parseStrategySelectValue(value);
  if (!parsed) return { text: '策略选择已失效，请重新发起。' };
  const plan = await loadRefreshActivityPlan(outputDir, parsed.planRef);
  if (!plan || !verifyRefreshActivityPlanKey(plan, parsed.strategy, parsed.confirmationKey)) {
    return { text: '策略选择已失效，请重新发起。' };
  }
  if (parsed.strategy === 'delist_and_refill' && !plan.canRefill) {
    return { text: '策略选择已失效，请重新发起。' };
  }

  const request = buildExecuteRequest(plan, parsed.strategy);
  const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
  const delistProductIds = Array.isArray(request.arguments.delistProductIds) && request.arguments.delistProductIds.every((item) => typeof item === 'string')
    ? request.arguments.delistProductIds
    : plan.delistProductIds;
  return {
    text: '请确认活跃度刷新执行内容。',
    card: buildRefreshActivityExecuteConfirmCard(request, requestRef, {
      delistProductIds,
      newLinkSummary: newLinkSummary(plan, parsed.strategy),
      skippedGroups: plan.skippedGroups,
    }),
  };
}
