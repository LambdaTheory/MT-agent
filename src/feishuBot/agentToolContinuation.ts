import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { buildAgentClarificationCard } from '../agentRuntime/clarificationCard.js';
import type { AgentClarificationRequest } from '../agentRuntime/clarificationCard.js';
import { isClarifyDepthExceeded, type ClarificationContext, type ResolutionCandidate } from '../agentRuntime/intentResolution.js';
import { decideAgentPolicy } from '../agentRuntime/policy.js';
import { isPreConfirmationPlanningTool } from '../agentRuntime/planningTools.js';
import type { AgentPlannerStep } from '../agentRuntime/planner.js';
import { validateAgentToolArguments } from '../agentRuntime/planner.js';
import type { AgentStepMetadataStore } from '../agentRuntime/stepResolution.js';
import { rememberStepMetadata, resolvePlannerArguments } from '../agentRuntime/stepResolution.js';
import { findAgentTool } from '../agentRuntime/toolRegistry.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from './agentToolExecutor.js';
import { inferPriceAdjustmentAmountFromText, readPriceAdjustmentAmountArgument } from './priceAdjustment.js';
import {
  hasPriceAdjustmentConflict,
  INVALID_DISCOUNT_ARGUMENT_MESSAGE,
  PRICE_ADJUSTMENT_CONFLICT_MESSAGE,
} from './priceChangeContract.js';
import { inferPriceMultiplierFromText, readPriceMultiplierArgument } from './priceMultiplier.js';
import { parseRentPriceFieldsFromText } from './rentalPrice.js';
import { mentionsSpecKeywordPriceTarget } from './rentalPriceProgress.js';
import type { BotResponse } from './types.js';
import { clarificationConfirmationKey, saveClarificationContext } from './clarificationStore.js';

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
  sourceText?: string;
  clarificationDepth?: number;
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
    ...(input.clarificationDepth !== undefined ? { clarificationDepth: input.clarificationDepth } : {}),
  };
}

function shouldStopAfterConfirmedResponse(response: BotResponse): boolean {
  return response.metadata?.ok === false;
}

function isBlockingCardResponse(response: BotResponse): boolean {
  return response.metadata?.cardMode !== 'nonBlocking';
}

export function completePricePreviewArguments(
  toolName: string,
  args: Record<string, unknown>,
  contextText: string,
): Record<string, unknown> {
  if (toolName !== 'rental.pricePreview' || args.fields !== undefined) return args;
  const fields = parseRentPriceFieldsFromText(contextText);
  if (Object.keys(fields).length > 0) {
    return {
      ...args,
      fields,
    };
  }
  if (args.discount !== undefined) {
    const normalized = readPriceMultiplierArgument(args.discount);
    const inferred = normalized ?? inferPriceMultiplierFromText(contextText);
    if (inferred !== null) {
      return {
        ...args,
        discount: inferred,
        scope: 'rent_fields',
      };
    }
    return args;
  }
  if (args.adjustmentAmount !== undefined) {
    const normalized = readPriceAdjustmentAmountArgument(args.adjustmentAmount);
    if (normalized !== null) {
      return {
        ...args,
        adjustmentAmount: normalized,
        scope: 'rent_fields',
      };
    }
    return args;
  }
  const adjustmentAmount = inferPriceAdjustmentAmountFromText(contextText);
  if (adjustmentAmount !== null) {
    return {
      ...args,
      adjustmentAmount,
      scope: 'rent_fields',
    };
  }
  const inferred = inferPriceMultiplierFromText(contextText);
  if (inferred === null) return args;
  return {
    ...args,
    discount: inferred,
    scope: 'rent_fields',
  };
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function extractDirectionalPriceNumber(text: string): { direction: 'decrease' | 'increase'; value: number; hasPercent: boolean; hasAmountUnit: boolean } | null {
  const compact = text.replace(/\s+/g, '');
  const decrease = /(下调|下降|降低|降价|减少|调低)(\d+(?:\.\d+)?)([%％元块]?)/.exec(compact);
  if (decrease?.[2]) {
    return {
      direction: 'decrease',
      value: Number(decrease[2]),
      hasPercent: decrease[3] === '%' || decrease[3] === '％',
      hasAmountUnit: decrease[3] === '元' || decrease[3] === '块' || /金额|按金额/.test(compact),
    };
  }
  const increase = /(上调|上涨|提高|升高|加价|增加|调高)(\d+(?:\.\d+)?)([%％元块]?)/.exec(compact);
  if (increase?.[2]) {
    return {
      direction: 'increase',
      value: Number(increase[2]),
      hasPercent: increase[3] === '%' || increase[3] === '％',
      hasAmountUnit: increase[3] === '元' || increase[3] === '块' || /金额|按金额/.test(compact),
    };
  }
  return null;
}

async function buildSavedClarificationCard(
  outputDir: string,
  request: AgentClarificationRequest,
  candidates: ResolutionCandidate[],
  confidence: number,
  priorDepth: number,
): Promise<BotResponse['card']> {
  const depth = priorDepth + 1;
  const context: ClarificationContext = {
    originalMessage: request.originalMessage,
    question: request.question,
    reason: request.reason,
    candidates,
    depth,
    confidence,
  };
  const clarificationRef = await saveClarificationContext(outputDir, context);
  return buildAgentClarificationCard({
    ...request,
    options: candidates.map((candidate) => ({
      label: candidate.label,
      message: request.originalMessage,
      ...(candidate.description ? { description: candidate.description } : {}),
    })),
  }, {
    clarificationRef,
    confirmationKey: clarificationConfirmationKey(context),
  });
}

function declineClarificationLoop(depth: number): BotResponse {
  return {
    text: '我还是没法确定你的意图，请直接说明要操作的商品、动作、数量、金额或日期；本次没有执行任何操作。',
    metadata: { ok: false, declined: true, clarificationDepth: depth },
  };
}

async function buildPriceSemanticsClarification(
  sourceText: string,
  reason: string,
  parsed: { direction: 'decrease' | 'increase'; value: number },
  outputDir: string,
  priorDepth: number,
  inferredMultiplier?: number,
): Promise<BotResponse> {
  if (isClarifyDepthExceeded(priorDepth)) return declineClarificationLoop(priorDepth);
  const action = parsed.direction === 'decrease' ? '下调' : '上调';
  const amountAction = parsed.direction === 'decrease' ? '减少' : '增加';
  const multiplier = inferredMultiplier ?? (parsed.direction === 'decrease' ? 1 - parsed.value / 100 : 1 + parsed.value / 100);
  const question = `价格调整语义需要确认：${action}${parsed.value} 是按比例还是按金额？`;
  const request = {
    originalMessage: sourceText,
    question,
    reason,
    options: [
      {
        label: '按比例',
        message: `${sourceText}；按比例${action}${parsed.value}%，即租金乘以 ${multiplier.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '')}`,
        description: `租金字段整体乘以 ${multiplier.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '')}`,
      },
      {
        label: '按金额',
        message: `${sourceText}；按金额${amountAction}${parsed.value}元`,
        description: `每个租金字段${amountAction} ${parsed.value} 元`,
      },
    ],
  };
  const candidates = [
    { toolName: 'agent.clarifiedMessage', arguments: { message: request.options[0].message }, label: request.options[0].label, description: request.options[0].description },
    { toolName: 'agent.clarifiedMessage', arguments: { message: request.options[1].message }, label: request.options[1].label, description: request.options[1].description },
  ];
  return {
    text: question,
    card: await buildSavedClarificationCard(outputDir, request, candidates, 0.4, priorDepth),
    metadata: { toolName: 'rental.pricePreview', ok: false, needsClarification: true },
  };
}

async function buildSpecKeywordPriceClarification(
  sourceText: string,
  outputDir: string,
  priorDepth: number,
): Promise<BotResponse> {
  if (isClarifyDepthExceeded(priorDepth)) return declineClarificationLoop(priorDepth);
  const request = {
    originalMessage: sourceText,
    question: '这个改价条件命中了“规格名称关键词”，不能按整链接所有租期直接改价。请补充精确规格或改用整链接改价。',
    reason: '当前只支持整链接租金字段批量改价，或已知 productId/specId/绝对价格的按规格改价；不支持“规格名称包含某词 + 相对加减金额”的自动执行。为了避免误改全部租期，已阻断本次操作。',
    options: [
      {
        label: '补充规格明细',
        message: `${sourceText}\n补充说明：请提供端内ID、具体 specId 或规格名称，以及每个租期要改成的绝对价格。`,
        description: '用于按规格精确改价',
      },
      {
        label: '改整链接租期',
        message: `${sourceText}\n补充说明：我确认不是按规格筛选，而是这些链接的所有租期字段统一改价。`,
        description: '仅在确认要改全部租期时使用',
      },
    ],
  };
  const candidates = request.options.map((option) => ({
    toolName: 'agent.clarifiedMessage',
    arguments: { message: option.message },
    label: option.label,
    description: option.description,
  }));
  return {
    text: request.question,
    card: await buildSavedClarificationCard(outputDir, request, candidates, 0.35, priorDepth),
    metadata: { toolName: 'rental.pricePreview', ok: false, needsClarification: true },
  };
}

export async function pricePreviewSemanticClarification(
  toolName: string,
  args: Record<string, unknown>,
  contextText: string,
  sourceText: string,
  outputDir: string,
  priorDepth = 0,
): Promise<BotResponse | null> {
  if (toolName !== 'rental.pricePreview' || args.fields !== undefined) return null;
  if (mentionsSpecKeywordPriceTarget([contextText, sourceText].join('\n'))) {
    return buildSpecKeywordPriceClarification(sourceText, outputDir, priorDepth);
  }
  const directional = extractDirectionalPriceNumber(contextText);
  if (!directional) return null;

  const inferredMultiplier = inferPriceMultiplierFromText(contextText);
  const parsedDiscount = args.discount !== undefined ? readPriceMultiplierArgument(args.discount) : null;
  const parsedAdjustment = args.adjustmentAmount !== undefined ? readPriceAdjustmentAmountArgument(args.adjustmentAmount) : null;

  if (!directional.hasPercent && !directional.hasAmountUnit && args.discount === undefined && args.adjustmentAmount === undefined) {
    return buildPriceSemanticsClarification(sourceText, '价格调整数值缺少“%”或“元”等单位，无法安全判断是比例还是金额。', directional, outputDir, priorDepth);
  }

  if (directional.hasPercent && inferredMultiplier !== null) {
    if (parsedAdjustment !== null) {
        return buildPriceSemanticsClarification(sourceText, '原始语义包含百分比，但工具参数被规划成金额调整；需要你确认后再继续。', directional, outputDir, priorDepth, inferredMultiplier);
    }
    if (parsedDiscount !== null && !nearlyEqual(parsedDiscount, inferredMultiplier)) {
        return buildPriceSemanticsClarification(sourceText, `原始语义推导的倍率是 ${inferredMultiplier}，但工具参数给的是 ${parsedDiscount}；需要你确认后再继续。`, directional, outputDir, priorDepth, inferredMultiplier);
    }
  }

  return null;
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

function describeArgumentValue(value: unknown): string {
  if (value === undefined) return '未提供';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `数组 ${value.length} 项`;
  if (isRecord(value)) return `对象 ${Object.keys(value).length} 项`;
  return String(value);
}

async function buildGenericArgumentClarification(input: {
  toolName: string;
  args: Record<string, unknown>;
  sourceText: string;
  reason: string;
  outputDir: string;
  priorDepth: number;
}): Promise<BotResponse> {
  if (isClarifyDepthExceeded(input.priorDepth)) return declineClarificationLoop(input.priorDepth);
  const tool = findAgentTool(input.toolName);
  const required = isRecord(tool?.inputSchema) && Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const provided = Object.entries(input.args)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${describeArgumentValue(value)}`)
    .join('；') || '无';
  const requirementText = required.length ? `必填参数：${required.join('、')}` : '该工具需要结构化参数。';
  const question = `我已识别到工具 ${input.toolName}，但参数未通过安全校验。请补充或改写后再继续。`;
  const request = {
    originalMessage: input.sourceText,
    question,
    reason: `${input.reason}；${requirementText}；当前参数：${provided}`,
    options: [
      {
        label: '补充参数',
        message: `${input.sourceText}\n补充说明：请明确 ${input.toolName} 的缺失参数`,
        description: requirementText,
      },
      {
        label: '重新描述',
        message: input.sourceText,
        description: '用更完整的一句话重新发起，让 Agent 重新规划',
      },
    ],
  };
  const candidates = request.options.map((option) => ({
    toolName: 'agent.clarifiedMessage',
    arguments: { message: option.message },
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
  }));
  return {
    text: question,
    card: await buildSavedClarificationCard(input.outputDir, request, candidates, 0.3, input.priorDepth),
    metadata: { toolName: input.toolName, ok: false, needsClarification: true },
  };
}

function pricePreviewContractViolation(toolName: string, args: Record<string, unknown>): BotResponse | null {
  if (toolName !== 'rental.pricePreview') return null;
  if (hasPriceAdjustmentConflict(args)) {
    return {
      text: PRICE_ADJUSTMENT_CONFLICT_MESSAGE,
      metadata: { toolName, ok: false },
    };
  }
  if (args.fields === undefined && args.discount !== undefined && readPriceMultiplierArgument(args.discount) === null) {
    return {
      text: INVALID_DISCOUNT_ARGUMENT_MESSAGE,
      metadata: { toolName, ok: false },
    };
  }
  return null;
}

export async function reviewAgentToolArguments(input: {
  toolName: string;
  args: Record<string, unknown>;
  metadataStore?: AgentStepMetadataStore;
  contextText: string;
  sourceText: string;
  reason: string;
  outputDir: string;
  clarificationDepth?: number;
}): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; response: BotResponse }> {
  const priorDepth = input.clarificationDepth ?? 0;
  const contractViolation = pricePreviewContractViolation(input.toolName, input.args);
  if (contractViolation) return { ok: false, response: contractViolation };

  const semanticClarification = await pricePreviewSemanticClarification(
    input.toolName,
    input.args,
    input.contextText,
    input.sourceText,
    input.outputDir,
    priorDepth,
  );
  if (semanticClarification) return { ok: false, response: semanticClarification };

  const priceCompleted = completePricePreviewArguments(input.toolName, input.args, input.contextText);
  const completed = completeNewLinkBatchArguments(
    input.toolName,
    priceCompleted,
    input.metadataStore ?? {},
    input.contextText,
  );

  if (!validateAgentToolArguments(input.toolName, completed)) {
    return {
      ok: false,
      response: await buildGenericArgumentClarification({
        toolName: input.toolName,
        args: completed,
        sourceText: input.sourceText,
        reason: input.reason,
        outputDir: input.outputDir,
        priorDepth,
      }),
    };
  }

  return { ok: true, args: completed };
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
    const contextText = [input.sourceText, input.goal, input.reason, step.reason].filter(Boolean).join('\n');
    const reviewed = await reviewAgentToolArguments({
      toolName: step.toolName,
      args: resolvedArguments.value,
      metadataStore: input.metadataStore,
      contextText,
      sourceText: input.sourceText ?? input.goal,
      reason: step.reason || input.reason,
      outputDir: input.outputDir,
      clarificationDepth: input.clarificationDepth ?? 0,
    });
    if (!reviewed.ok) {
      input.textParts.push('');
      input.textParts.push(reviewed.response.text);
      return {
        text: input.textParts.join('\n'),
        ...(reviewed.response.card ? { card: reviewed.response.card } : {}),
        ...(reviewed.response.metadata ? { metadata: reviewed.response.metadata } : {}),
      };
    }
    const finalArguments = reviewed.args;

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
    rememberStepMetadata(input.metadataStore, stepId, response, tool.resultMetadataSchema);
    if (shouldStopAfterConfirmedResponse(response)) {
      input.textParts.push('');
      input.textParts.push('当前步骤执行未成功，已停止后续步骤。');
      return {
        text: input.textParts.join('\n'),
        ...(response.card ? { card: response.card } : {}),
        ...(response.metadata ? { metadata: response.metadata } : {}),
      };
    }
    if (response.card && isBlockingCardResponse(response)) {
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
  const currentTool = findAgentTool(request.toolName);
  rememberStepMetadata(metadataStore, continuation.currentStepId, response, currentTool?.resultMetadataSchema);

  if (shouldStopAfterConfirmedResponse(response)) {
    textParts.push('');
    textParts.push('当前步骤执行未成功，已停止后续步骤。');
    return {
      text: textParts.join('\n'),
      ...(response.card ? { card: response.card } : {}),
      ...(response.metadata ? { metadata: response.metadata } : {}),
    };
  }

  if (response.card && isBlockingCardResponse(response)) {
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
    clarificationDepth: continuation.clarificationDepth,
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
