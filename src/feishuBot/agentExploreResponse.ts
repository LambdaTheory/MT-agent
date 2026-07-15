import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { resolveLlmProviderFromEnv } from '../agentRuntime/decisionBuilderFactory.js';
import { buildReadOnlyExploreTools } from '../agentRuntime/exploreToolset.js';
import { runAgentExploreLoop } from '../agentRuntime/agentExploreLoop.js';
import { isValidDecisionRecord, type DecisionRecord } from '../agentRuntime/decisionRecord.js';
import { schemaAllowsArguments } from '../agentRuntime/planner.js';
import { findAgentTool } from '../agentRuntime/toolRegistry.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { AgentToolExecutionOptions } from './agentToolExecutor.js';
import { agentExploreReason } from './agentExploreAttribution.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
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
  const tool = findAgentTool(toolName);
  if (!tool || tool.requiresConfirmation !== true || tool.risk !== 'high') return false;
  if (!schemaAllowsArguments(tool.inputSchema, args)) return false;
  if (toolName === 'rental.delist') return args.productIds === undefined;
  if (toolName === 'rental.applyCurrent' || toolName === 'rental.submitCurrent') return false;
  return toolName === 'operations.refreshActivityExecute' || toolName.startsWith('rental.');
}

function isConfirmableExploreWrite(decision: DecisionRecord): boolean {
  return decision.recommendation === 'approve_to_execute'
    && decision.evidenceRefs.length > 0
    && decision.uncertainties.length === 0
    && isLedgerCoveredExploreWrite(decision);
}

async function buildExploreConfirmCard(approvals: DecisionRecord[], outputDir: string): Promise<FeishuCardPayload | undefined> {
  if (!approvals.length) return undefined;
  const cards = await Promise.all(approvals.map(async (approval) => {
    const request = exploreDecisionToConfirmRequest(approval);
    const tool = findAgentTool(request.toolName);
    if (tool?.plannerVisible === false) {
      const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
      return buildAgentToolConfirmCard(request, { requestRef });
    }
    return buildAgentToolConfirmCard(request);
  }));
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

function invalidExploreText(reason: string | undefined): string {
  if (reason === 'non_json') return '模型未按要求输出 JSON 动作，请重试或换种说法。';
  if (reason === 'unknown_action') return '模型未按要求输出可执行动作，请重试或换种说法。';
  if (reason === 'unknown_tool') return '模型选择了不可用的探索工具，请重试或换种说法。';
  if (reason === 'bad_args') return '模型给出的探索工具参数不完整，请重试或换种说法。';
  if (reason === 'tool_error') return '探索工具执行失败，请重试或换种说法。';
  if (reason === 'invalid_finish') return '模型完成探索时输出格式无效，请重试或换种说法。';
  return '探索未形成有效结论。';
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
  if (result.stopReason === 'invalid' && (result.invalidReason || result.rawFirstOutput)) {
    console.warn(`Agent explore invalid: ${result.invalidReason ?? 'unknown'}`, result.rawFirstOutput ?? '');
  }

  const approvals = (result.decisions ?? []).filter(isConfirmableExploreWrite);
  const card = await buildExploreConfirmCard(approvals, outputDir);
  const text = [
    result.answer || (result.stopReason === 'max_steps' ? '探索达到最大步数，已停止。' : invalidExploreText(result.invalidReason)),
    formatSteps(result.steps),
    ...(approvals.length ? [`待确认执行：${approvals.length} 项`] : []),
  ].join('\n');

  return {
    text,
    ...(card ? { card } : {}),
    metadata: { toolName: 'agentExplore', ok: result.stopReason !== 'invalid', stopReason: result.stopReason, stepCount: result.steps.length, ...(result.invalidReason ? { invalidReason: result.invalidReason } : {}) },
  };
}
