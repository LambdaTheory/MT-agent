import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { decideAgentPolicy } from '../agentRuntime/policy.js';
import { isPreConfirmationPlanningTool } from '../agentRuntime/planningTools.js';
import type { AgentPlannerStep } from '../agentRuntime/planner.js';
import { validateAgentToolArguments } from '../agentRuntime/planner.js';
import type { AgentStepMetadataStore } from '../agentRuntime/stepResolution.js';
import { rememberStepMetadata, resolvePlannerArguments } from '../agentRuntime/stepResolution.js';
import { findAgentTool } from '../agentRuntime/toolRegistry.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from './agentToolExecutor.js';
import { inferPriceMultiplierFromText } from './priceMultiplier.js';
import type { BotResponse } from './types.js';

interface ContinuePlannerStepsInput {
  goal: string;
  reason: string;
  steps: AgentPlannerStep[];
  baseIndex: number;
  totalSteps: number;
  metadataStore: AgentStepMetadataStore;
  textParts: string[];
  outputDir: string;
  options: AgentToolExecutionOptions;
}

function cloneMetadataStore(store: AgentStepMetadataStore): AgentStepMetadataStore {
  return JSON.parse(JSON.stringify(store)) as AgentStepMetadataStore;
}

function stepIdFor(step: AgentPlannerStep, absoluteIndex: number): string {
  return step.id ?? `step${absoluteIndex + 1}`;
}

function buildContinuation(input: ContinuePlannerStepsInput, stepId: string, absoluteIndex: number, remainingSteps: AgentPlannerStep[]): AgentToolConfirmRequest['continuation'] | undefined {
  if (remainingSteps.length === 0) return undefined;
  return {
    goal: input.goal,
    reason: input.reason,
    steps: remainingSteps,
    nextIndex: absoluteIndex + 1,
    totalSteps: input.totalSteps,
    currentStepId: stepId,
    currentStepIndex: absoluteIndex,
    metadataStore: cloneMetadataStore(input.metadataStore),
  };
}

function shouldStopAfterConfirmedResponse(response: BotResponse): boolean {
  return response.metadata?.ok === false;
}

function completePricePreviewArguments(
  toolName: string,
  args: Record<string, unknown>,
  contextText: string,
): Record<string, unknown> {
  if (toolName !== 'rental.pricePreview' || args.discount !== undefined || args.fields !== undefined) return args;
  const inferred = inferPriceMultiplierFromText(contextText);
  if (inferred === null) return args;
  return {
    ...args,
    discount: inferred,
    scope: 'rent_fields',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function inferPositiveCountFromText(text: string): number | undefined {
  const digit = /(?:复制|铺|新增|新建|生成)\s*(\d+)\s*(?:条|个|款|份)?\s*(?:新链|链接)?/.exec(text)
    ?? /(\d+)\s*(?:条|个|款|份)\s*(?:新链|链接)?/.exec(text);
  if (digit?.[1]) {
    const value = Number(digit[1]);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  const chineseNumbers: Record<string, number> = {
    一: 1,
    壹: 1,
    两: 2,
    二: 2,
    贰: 2,
    俩: 2,
    三: 3,
    叁: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const chinese = /(?:复制|铺|新增|新建|生成)\s*([一壹两二贰俩三叁四五六七八九十])\s*(?:条|个|款|份)?\s*(?:新链|链接)?/.exec(text);
  return chinese?.[1] ? chineseNumbers[chinese[1]] : undefined;
}

function rankMetadataFromStore(store: AgentStepMetadataStore): Record<string, unknown> | null {
  const candidates = Object.values(store)
    .filter(isRecord)
    .reverse();
  for (const candidate of candidates) {
    if (
      readString(candidate.toolName) === 'product.rankBestSameSku'
      && readString(candidate.bestProductId)
      && readString(candidate.query)
    ) {
      return candidate;
    }
  }
  return null;
}

function completeNewLinkBatchArguments(
  toolName: string,
  args: Record<string, unknown>,
  metadataStore: AgentStepMetadataStore,
  contextText: string,
): Record<string, unknown> {
  if (toolName !== 'rental.newLinkBatchPlan' || Array.isArray(args.items)) return args;

  const rank = rankMetadataFromStore(metadataStore);
  if (!rank) return args;

  const keyword = readString(args.keyword) ?? readString(rank.query);
  const sourceProductId = readString(args.sourceProductId) ?? readString(rank.bestProductId);
  const count = args.count ?? inferPositiveCountFromText(contextText);
  if (!keyword || !sourceProductId || count === undefined) return args;
  const fallbackSourceProductIds = Array.isArray(rank.ranking)
    ? rank.ranking
      .map((item) => isRecord(item) ? readString(item.internalProductId) : null)
      .filter((item): item is string => Boolean(item && item !== sourceProductId))
      .slice(0, 8)
    : [];

  return {
    ...args,
    keyword,
    count,
    sourceProductId,
    ...(fallbackSourceProductIds.length ? { fallbackSourceProductIds } : {}),
  };
}

export async function continueAgentPlannerSteps(input: ContinuePlannerStepsInput): Promise<BotResponse | null> {
  for (const [localIndex, step] of input.steps.entries()) {
    const absoluteIndex = input.baseIndex + localIndex;
    const stepId = stepIdFor(step, absoluteIndex);
    const resolvedArguments = resolvePlannerArguments(step.arguments, input.metadataStore);
    if (!resolvedArguments.ok) {
      input.textParts.push('');
      input.textParts.push(`步骤 ${absoluteIndex + 1}/${input.totalSteps} 引用解析失败：${resolvedArguments.reference}`);
      input.textParts.push('已停止执行后续步骤，未触发任何未确认的写操作。');
      return { text: input.textParts.join('\n') };
    }
    const completedArguments = completePricePreviewArguments(
      step.toolName,
      resolvedArguments.value,
      [input.goal, input.reason, step.reason].filter(Boolean).join('\n'),
    );
    const finalArguments = completeNewLinkBatchArguments(
      step.toolName,
      completedArguments,
      input.metadataStore,
      [input.goal, input.reason, step.reason].filter(Boolean).join('\n'),
    );
    if (!validateAgentToolArguments(step.toolName, finalArguments)) {
      input.textParts.push('');
      input.textParts.push(`步骤 ${absoluteIndex + 1}/${input.totalSteps} 参数校验失败：${step.toolName}`);
      input.textParts.push('已停止执行后续步骤，未触发任何未确认的写操作。');
      return { text: input.textParts.join('\n') };
    }

    const tool = findAgentTool(step.toolName);
    if (!tool) return null;

    const request: AgentToolConfirmRequest = {
      toolName: step.toolName,
      arguments: finalArguments,
      reason: step.reason || input.reason,
    };
    const policy = decideAgentPolicy({ tool, input: finalArguments, reason: request.reason });
    const remainingSteps = input.steps.slice(localIndex + 1);
    if (policy?.decision === 'confirmation_required' || isPreConfirmationPlanningTool(step.toolName)) {
      request.continuation = buildContinuation(input, stepId, absoluteIndex, remainingSteps);
    }
    if (policy?.decision === 'confirmation_required' && !isPreConfirmationPlanningTool(step.toolName)) {
      input.textParts.push('');
      input.textParts.push(`步骤 ${absoluteIndex + 1}/${input.totalSteps} 需要确认：${step.toolName}`);
      input.textParts.push(`原因：${request.reason}`);
      return {
        text: input.textParts.join('\n'),
        card: buildAgentToolConfirmCard(request),
      };
    }

    const response = await executeAgentToolRequest(request, input.outputDir, input.options);
    input.textParts.push('');
    input.textParts.push(`步骤 ${absoluteIndex + 1}/${input.totalSteps}：${step.toolName}`);
    input.textParts.push(response.text);
    rememberStepMetadata(input.metadataStore, stepId, response);
    if (shouldStopAfterConfirmedResponse(response)) {
      input.textParts.push('');
      input.textParts.push('当前步骤执行未成功，已停止后续步骤。');
      return {
        text: input.textParts.join('\n'),
        ...(response.card ? { card: response.card } : {}),
        ...(response.metadata ? { metadata: response.metadata } : {}),
      };
    }
    if (response.card) {
      if (remainingSteps.length > 0) {
        input.textParts.push('');
        input.textParts.push('当前步骤返回了卡片，后续步骤已暂停，避免覆盖卡片结果。');
      }
      return { text: input.textParts.join('\n'), card: response.card };
    }
  }

  return { text: input.textParts.join('\n') };
}

export async function continueAgentPlannerStepsAfterResponse(
  request: AgentToolConfirmRequest,
  response: BotResponse,
  outputDir = 'output',
  options: AgentToolExecutionOptions = {},
): Promise<BotResponse> {
  const continuation = request.continuation;
  if (!continuation) return response;

  const metadataStore = cloneMetadataStore(continuation.metadataStore);
  const textParts = [
    `Agent 多步骤计划继续执行：${continuation.goal}`,
    `判断原因：${continuation.reason}`,
    '',
    `步骤 ${continuation.currentStepIndex + 1}/${continuation.totalSteps}：${request.toolName}`,
    response.text,
  ];
  rememberStepMetadata(metadataStore, continuation.currentStepId, response);

  if (shouldStopAfterConfirmedResponse(response)) {
    textParts.push('');
    textParts.push('当前步骤执行未成功，已停止后续步骤。');
    return {
      text: textParts.join('\n'),
      ...(response.card ? { card: response.card } : {}),
      ...(response.metadata ? { metadata: response.metadata } : {}),
    };
  }

  if (response.card) {
    textParts.push('');
    textParts.push('当前步骤返回了卡片，后续步骤已暂停，避免覆盖卡片结果。');
    return { text: textParts.join('\n'), card: response.card };
  }

  const continued = await continueAgentPlannerSteps({
    goal: continuation.goal,
    reason: continuation.reason,
    steps: continuation.steps,
    baseIndex: continuation.nextIndex,
    totalSteps: continuation.totalSteps,
    metadataStore,
    textParts,
    outputDir,
    options,
  });
  return continued ?? { text: textParts.join('\n') };
}

export async function executeAgentToolRequestWithContinuation(
  request: AgentToolConfirmRequest,
  outputDir = 'output',
  options: AgentToolExecutionOptions = {},
): Promise<BotResponse> {
  const response = await executeAgentToolRequest(
    { toolName: request.toolName, arguments: request.arguments, reason: request.reason },
    outputDir,
    options,
  );
  return continueAgentPlannerStepsAfterResponse(request, response, outputDir, options);
}
