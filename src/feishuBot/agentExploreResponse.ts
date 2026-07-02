import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { classifyDecisions } from '../agentRuntime/decisionPolicy.js';
import { resolveLlmProviderFromEnv } from '../agentRuntime/decisionBuilderFactory.js';
import { buildReadOnlyExploreTools } from '../agentRuntime/exploreToolset.js';
import { runAgentExploreLoop } from '../agentRuntime/agentExploreLoop.js';
import { isValidDecisionRecord, type DecisionRecord } from '../agentRuntime/decisionRecord.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { AgentToolExecutionOptions } from './agentToolExecutor.js';
import { agentExploreReason } from './agentExploreAttribution.js';
import type { BotResponse } from './types.js';
import type { LlmProvider } from '../llm/provider.js';

export interface AgentExploreResponseOptions {
  provider?: LlmProvider;
  maxSteps?: number;
  executionOptions?: AgentToolExecutionOptions;
}

function formatSteps(steps: Array<{ tool: string }>): string {
  return steps.length ? `探索步骤：${steps.map((step) => step.tool).join(' -> ')}` : '探索步骤：无';
}

function exploreDecisionToConfirmRequest(decision: DecisionRecord): AgentToolConfirmRequest {
  if (!decision.proposedTool) throw new Error(`Decision ${decision.decisionId} has no proposedTool`);
  return {
    toolName: decision.proposedTool.toolName,
    arguments: decision.proposedTool.arguments,
    reason: agentExploreReason(decision.decisionId, decision.title),
  };
}

function isLedgerCoveredExploreWrite(decision: DecisionRecord): boolean {
  const toolName = decision.proposedTool?.toolName;
  const args = decision.proposedTool?.arguments;
  if (!toolName || !args) return false;
  switch (toolName) {
    case 'rental.copy':
    case 'rental.tenancySet':
    case 'rental.specAddAndRefresh':
    case 'rental.operationConfirmRequest':
    case 'operations.refreshActivityExecute':
      return true;
    case 'rental.delist':
      return args.productIds === undefined;
    default:
      return false;
  }
}

function buildExploreConfirmCard(approvals: DecisionRecord[]): FeishuCardPayload | undefined {
  if (!approvals.length) return undefined;
  const cards = approvals.map((approval) => buildAgentToolConfirmCard(exploreDecisionToConfirmRequest(approval)));
  const elements = cards.flatMap((card, index) => {
    const body = card.body as { elements?: unknown[] } | undefined;
    return [
      ...(index === 0 ? [] : [{ tag: 'hr' }]),
      ...(body?.elements ?? []),
    ];
  });
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'Agent 探索操作确认' }, template: 'orange' },
    body: { elements },
  };
}

function hasInvalidDecisions(decisions: unknown[] | undefined): boolean {
  return decisions !== undefined && !decisions.every(isValidDecisionRecord);
}

export async function agentExploreResponse(
  instruction: string,
  outputDir: string,
  options: AgentExploreResponseOptions = {},
): Promise<BotResponse> {
  const provider = options.provider ?? resolveLlmProviderFromEnv();
  if (!provider) return { text: 'Agent explore 需要配置 LLM provider；本次没有执行任何操作。', metadata: { toolName: 'agentExplore', ok: false } };

  const result = await runAgentExploreLoop({
    provider,
    instruction,
    tools: buildReadOnlyExploreTools(outputDir, options.executionOptions),
    maxSteps: options.maxSteps,
  });
  if (hasInvalidDecisions(result.decisions)) {
    return {
      text: ['探索未形成有效结论。', formatSteps(result.steps)].join('\n'),
      metadata: { toolName: 'agentExplore', ok: false, stopReason: 'invalid', stepCount: result.steps.length },
    };
  }

  const classified = classifyDecisions(result.decisions ?? []);
  const approvals = classified.approvals.filter(isLedgerCoveredExploreWrite);
  const card = buildExploreConfirmCard(approvals);
  const text = [
    result.answer || (result.stopReason === 'max_steps' ? '探索达到最大步数，已停止。' : '探索未形成有效结论。'),
    formatSteps(result.steps),
    ...(approvals.length ? [`待确认执行：${approvals.length} 项`] : []),
  ].join('\n');

  return {
    text,
    ...(card ? { card } : {}),
    metadata: { toolName: 'agentExplore', ok: result.stopReason !== 'invalid', stopReason: result.stopReason, stepCount: result.steps.length },
  };
}
