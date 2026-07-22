import { randomUUID } from 'node:crypto';
import { isSelectedAuditTool } from '../audit/config.js';
import { buildAuditContext } from '../audit/event.js';
import type { AuditChannel, AuditContext } from '../audit/types.js';
import type { AuditWriter } from '../audit/auditLogger.js';
import { parseAgentFirstBotIntent, parseBotIntent } from '../feishuBot/intent.js';
import type { LlmIntentProposalProvider } from '../feishuBot/llmIntentProposal.js';
import type { LlmToolSelectionProvider } from '../feishuBot/llmProvider.js';
import type { RentalPriceSkillClient } from '../feishuBot/rentalPrice.js';
import type { ActivityAutomationSkillClient } from '../feishuBot/activityAutomation.js';
import type { ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { handleBotIntent, type HandleBotIntentOptions } from '../feishuBot/tools.js';
import type { BotIntent, BotResponse } from '../feishuBot/types.js';
import type { AgentPlannerProvider } from './planner.js';
import type { AgentAuditDependencies, AgentRequest, AgentResponse } from './types.js';
import type { LlmProvider } from '../llm/provider.js';

export type AgentIntentResolver = (text: string) => BotIntent;
export type AgentRuntimeHandleIntent = (intent: BotIntent, outputDir: string | undefined, dependencies: AgentAuditDependencies) => Promise<BotResponse>;

export interface AgentRuntimeConfig {
  outputDir?: string;
  resolveIntent?: AgentIntentResolver;
  handleIntent?: AgentRuntimeHandleIntent;
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  agentExploreProvider?: LlmProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  auditLogger?: AuditWriter;
  now?: () => Date;
  makeTraceId?: () => string;
  makeSpanId?: () => string;
}

export interface AgentRuntime {
  handle(request: AgentRequest): Promise<AgentResponse>;
}

interface AuditActivation {
  runSpanId: string;
  agentSpanId: string;
  auditContext: AuditContext;
}

const runtimeToolName = 'agent.runtime';
const safeAuditIdentifierPattern = /^[A-Za-z0-9._-]+$/;
const rawFeishuIdPattern = /\b(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/;

function defaultTraceId(): string {
  return randomUUID();
}

function safeDate(value: unknown): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined;
}

function safeFactoryDate(factory: (() => Date) | undefined): Date {
  try {
    return safeDate(factory?.()) ?? new Date();
  } catch {
    return new Date();
  }
}

function safeAuditIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value || trimmed === '.' || trimmed === '..') return undefined;
  if (!safeAuditIdentifierPattern.test(trimmed) || rawFeishuIdPattern.test(trimmed)) return undefined;
  return trimmed;
}

function safeFactoryIdentifier(factory: (() => string) | undefined): string {
  try {
    return safeAuditIdentifier(factory?.()) ?? defaultTraceId();
  } catch {
    return defaultTraceId();
  }
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return undefined;
  return trimmed;
}

function readSafeMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const trimmed = readMetadataString(metadata, key);
  if (trimmed === undefined || /\b(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/.test(trimmed)) return undefined;
  return trimmed;
}

function readTransportChannel(request: AgentRequest): AuditChannel {
  const transport = readMetadataString(request.metadata, 'transport');
  if (transport === 'sdk' || transport === 'http') return transport;
  if (request.source === 'feishu') return 'feishu';
  return request.source;
}

function buildRuntimeAuditContext(request: AgentRequest, traceId: string, requestStartedAt: string): AuditContext {
  const rawActorId = request.actor?.id?.trim();
  const rawChannelId = request.channel?.id?.trim();
  return buildAuditContext({
    source: request.source,
    actorAvailable: Boolean(rawActorId),
    ...(rawActorId ? { rawActorId } : {}),
    channel: readTransportChannel(request),
    channelType: request.channel?.type ?? 'unknown',
    ...(rawChannelId ? { rawChannelId } : {}),
    ...(readMetadataString(request.metadata, 'messageId') ? { messageId: readMetadataString(request.metadata, 'messageId') } : {}),
    ...(readSafeMetadataString(request.metadata, 'requestRef') ? { requestRef: readSafeMetadataString(request.metadata, 'requestRef') } : {}),
    ...(readSafeMetadataString(request.metadata, 'clarificationRef') ? { clarificationRef: readSafeMetadataString(request.metadata, 'clarificationRef') } : {}),
    ...(readSafeMetadataString(request.metadata, 'runId') ? { runId: readSafeMetadataString(request.metadata, 'runId') } : {}),
    ...(readSafeMetadataString(request.metadata, 'decisionId') ? { decisionId: readSafeMetadataString(request.metadata, 'decisionId') } : {}),
    traceId,
    requestStartedAt,
  });
}

function isWaitingForUser(response: BotResponse): boolean {
  const metadata = response.metadata;
  if (metadata?.needsClarification === true || metadata?.needsMoreInput === true || metadata?.status === 'pending_confirmation') return true;
  return response.card !== undefined && metadata?.cardMode !== 'nonBlocking';
}

export function createAgentRuntime(config: AgentRuntimeConfig = {}): AgentRuntime {
  const resolveIntent = config.resolveIntent ?? (config.agentPlannerProvider ? parseAgentFirstBotIntent : parseBotIntent);
  const handleIntent = config.handleIntent ?? (async (intent: BotIntent, outputDir: string | undefined, dependencies: AgentAuditDependencies) => {
    const options: HandleBotIntentOptions = {
      llmToolSelector: config.llmToolSelector,
      llmIntentProposalProvider: config.llmIntentProposalProvider,
      agentPlannerProvider: config.agentPlannerProvider,
      agentExploreProvider: config.agentExploreProvider,
      rentalPriceClient: config.rentalPriceClient,
      activityAutomationClient: config.activityAutomationClient,
      closedOrderFetchImpl: config.closedOrderFetchImpl,
      closedOrderRegistryPaths: config.closedOrderRegistryPaths,
      auditContext: dependencies?.auditContext,
      auditLogger: dependencies?.auditLogger,
      activateAudit: dependencies?.activateAudit,
    };
    return handleBotIntent(intent, outputDir, options);
  });
  const now = (): Date => safeFactoryDate(config.now);
  const makeTraceId = (): string => safeFactoryIdentifier(config.makeTraceId);
  const makeSpanId = (): string => safeFactoryIdentifier(config.makeSpanId);

  return {
    async handle(request) {
      const entryDate = now();
      const traceId = makeTraceId();
      const auditContext = buildRuntimeAuditContext(request, traceId, entryDate.toISOString());
      let activationPromise: Promise<AuditActivation | undefined> | undefined;

      const recordBestEffort = async (input: Parameters<AuditWriter['record']>[0], occurredAt?: Date): Promise<boolean> => {
        if (!config.auditLogger) return false;
        try {
          const result = occurredAt !== undefined
            ? await config.auditLogger.recordAt(input, occurredAt)
            : await config.auditLogger.record(input);
          return result.ok;
        } catch {
          return false;
        }
      };

      const activateAudit = async (toolName: string): Promise<AuditContext | undefined> => {
        try {
          if (!config.auditLogger || !isSelectedAuditTool(toolName)) return undefined;
          activationPromise ??= (async () => {
            const runSpanId = makeSpanId();
            const agentSpanId = makeSpanId();
            const runStarted = await recordBestEffort({
              traceId,
              spanId: runSpanId,
              event: 'run.start',
              toolName: runtimeToolName,
              status: 'OK',
              resultSummary: 'runtime started',
              context: auditContext,
            }, entryDate);
            if (!runStarted) return undefined;
            const agentStarted = await recordBestEffort({
              traceId,
              spanId: agentSpanId,
              event: 'agent.start',
              toolName: runtimeToolName,
              status: 'OK',
              resultSummary: 'agent started',
              context: auditContext,
              parentSpanId: runSpanId,
            }, entryDate);
            if (!agentStarted) return undefined;
            return { runSpanId, agentSpanId, auditContext: Object.freeze({ ...auditContext, parentSpanId: agentSpanId }) };
          })();
          return (await activationPromise)?.auditContext;
        } catch {
          activationPromise = Promise.resolve(undefined);
          return undefined;
        }
      };

      const dependencies: AgentAuditDependencies = Object.freeze({
        auditContext,
        ...(config.auditLogger ? { auditLogger: config.auditLogger } : {}),
        activateAudit,
      });
      const intent = resolveIntent(request.text);
      try {
        const response = await handleIntent(intent, config.outputDir, dependencies);
        const activation = await activationPromise;
        if (activation !== undefined) {
          await recordBestEffort({
            traceId,
            spanId: activation.agentSpanId,
            event: 'agent.end',
            toolName: runtimeToolName,
            status: 'OK',
            resultSummary: 'agent completed',
            context: auditContext,
            parentSpanId: activation.runSpanId,
          });
          await recordBestEffort({
            traceId,
            spanId: activation.runSpanId,
            event: isWaitingForUser(response) ? 'run.waiting_user' : 'run.final_result',
            toolName: runtimeToolName,
            status: isWaitingForUser(response) ? 'UNKNOWN' : 'OK',
            resultSummary: isWaitingForUser(response) ? 'waiting for user' : 'runtime completed',
            context: auditContext,
          });
        }
        return response;
      } catch (error) {
        const activation = await activationPromise;
        if (activation !== undefined) {
          await recordBestEffort({
            traceId,
            spanId: activation.agentSpanId,
            event: 'agent.error',
            toolName: runtimeToolName,
            status: 'INTERNAL',
            resultSummary: 'agent failed',
            context: auditContext,
            parentSpanId: activation.runSpanId,
            error,
          });
          await recordBestEffort({
            traceId,
            spanId: activation.runSpanId,
            event: 'run.failed',
            toolName: runtimeToolName,
            status: 'INTERNAL',
            resultSummary: 'runtime failed',
            context: auditContext,
            error,
          });
        }
        throw error;
      }
    },
  };
}
