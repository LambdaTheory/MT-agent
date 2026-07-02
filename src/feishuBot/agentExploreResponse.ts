import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { decisionToConfirmRequest } from '../agentRuntime/dailyMissionApproval.js';
import { classifyDecisions } from '../agentRuntime/decisionPolicy.js';
import { resolveLlmProviderFromEnv } from '../agentRuntime/decisionBuilderFactory.js';
import { buildReadOnlyExploreTools } from '../agentRuntime/exploreToolset.js';
import { runAgentExploreLoop } from '../agentRuntime/agentExploreLoop.js';
import type { AgentToolExecutionOptions } from './agentToolExecutor.js';
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
  const classified = classifyDecisions(result.decisions ?? []);
  const approval = classified.approvals[0];
  const text = [
    result.answer || (result.stopReason === 'max_steps' ? '探索达到最大步数，已停止。' : '探索未形成有效结论。'),
    formatSteps(result.steps),
    ...(classified.approvals.length ? [`待确认执行：${classified.approvals.length} 项`] : []),
  ].join('\n');

  return {
    text,
    ...(approval ? { card: buildAgentToolConfirmCard(decisionToConfirmRequest(approval)) } : {}),
    metadata: { toolName: 'agentExplore', ok: result.stopReason !== 'invalid', stopReason: result.stopReason, stepCount: result.steps.length },
  };
}
