import { createHash } from 'node:crypto';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findAgentTool } from './toolRegistry.js';
import { schemaAllowsArguments, validateAgentToolArguments, type AgentPlannerStep } from './planner.js';
import type { AgentToolDefinition } from './tool.js';

export interface AgentToolConfirmRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
  continuation?: AgentToolConfirmContinuation;
}

export interface AgentToolConfirmContinuation {
  goal: string;
  reason: string;
  steps: AgentPlannerStep[];
  nextIndex: number;
  totalSteps: number;
  currentStepId: string;
  currentStepIndex: number;
  metadataStore: Record<string, unknown>;
}

export interface AgentToolConfirmCardOptions {
  requestRef?: string;
}

export interface AgentToolConfirmReference {
  requestRef: string;
  confirmationKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStepId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === 'last' || trimmed === 'steps') return null;
  return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(trimmed) ? trimmed : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseContinuationStep(value: unknown): AgentPlannerStep | null {
  if (!isRecord(value)) return null;
  const toolName = readString(value.toolName);
  const reason = readString(value.reason);
  const args = value.arguments;
  const id = value.id === undefined ? undefined : readStepId(value.id);
  if (!toolName || !reason || !isRecord(args) || id === null) return null;
  const tool = findAgentTool(toolName);
  if (!tool || tool.plannerVisible === false || !schemaAllowsArguments(tool.inputSchema, args, { allowPlaceholders: true })) return null;
  return { ...(id ? { id } : {}), toolName, arguments: args, reason };
}

export function parseAgentToolConfirmContinuation(value: unknown): AgentToolConfirmContinuation | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const goal = readString(value.goal);
  const reason = readString(value.reason);
  const nextIndex = readNonNegativeInteger(value.nextIndex);
  const totalSteps = readNonNegativeInteger(value.totalSteps);
  const currentStepId = readStepId(value.currentStepId);
  const currentStepIndex = readNonNegativeInteger(value.currentStepIndex);
  const metadataStore = value.metadataStore;
  if (
    !goal ||
    !reason ||
    nextIndex === null ||
    totalSteps === null ||
    !currentStepId ||
    currentStepIndex === null ||
    !isRecord(metadataStore) ||
    !Array.isArray(value.steps) ||
    totalSteps < 2 ||
    totalSteps > 8 ||
    currentStepIndex >= totalSteps ||
    nextIndex !== currentStepIndex + 1 ||
    value.steps.length > totalSteps - nextIndex
  ) {
    return null;
  }
  const steps: AgentPlannerStep[] = [];
  const stepIds = new Set<string>();
  for (const step of value.steps) {
    const parsed = parseContinuationStep(step);
    if (!parsed) return null;
    if (parsed.id) {
      if (stepIds.has(parsed.id)) return null;
      stepIds.add(parsed.id);
    }
    steps.push(parsed);
  }
  return { goal, reason, steps, nextIndex, totalSteps, currentStepId, currentStepIndex, metadataStore };
}

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function confirmationKey(request: AgentToolConfirmRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 24);
}

function readConfirmationKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readRequestRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{12,96}$/.test(trimmed) ? trimmed : null;
}

function hasValidConfirmationKey(value: Record<string, unknown>, request: AgentToolConfirmRequest): boolean {
  const suppliedKey = readConfirmationKey(value.confirmationKey);
  if (!suppliedKey) return false;
  return suppliedKey === confirmationKey(request);
}

function requiresConfirmationKey(tool: AgentToolDefinition): boolean {
  return tool.plannerVisible === false;
}

export function buildAgentToolConfirmCard(request: AgentToolConfirmRequest, options: AgentToolConfirmCardOptions = {}): FeishuCardPayload {
  const tool = findAgentTool(request.toolName);
  const title = tool?.description ?? request.toolName;
  const key = confirmationKey(request);
  const confirmValue = options.requestRef
    ? { action: 'agent_tool_confirm', requestRef: options.requestRef, confirmationKey: key }
    : { action: 'agent_tool_confirm', request, confirmationKey: key };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'Agent 操作确认' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**是否要执行：${title}？**`,
            '',
            `工具：${request.toolName}`,
            `参数：${compactJson(request.arguments)}`,
            `LLM 理解原因：${request.reason}`,
          ].join('\n'),
        },
        {
          tag: 'form',
          name: 'agent_tool_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认执行' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'agent_tool_confirm_submit',
              behaviors: [{ type: 'callback', value: confirmValue }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'agent_tool_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', toolName: request.toolName, confirmationKey: key } }],
            },
          ],
        },
      ],
    },
  };
}

export function parseAgentToolConfirmReference(value: unknown): AgentToolConfirmReference | null {
  if (!isRecord(value)) return null;
  const requestRef = readRequestRef(value.requestRef);
  const key = readConfirmationKey(value.confirmationKey);
  if (!requestRef || !key) return null;
  return { requestRef, confirmationKey: key };
}

export function parseAgentToolConfirmRequest(value: unknown): AgentToolConfirmRequest | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  const toolName = readString(request.toolName);
  const reason = readString(request.reason);
  const args = request.arguments;
  if (!toolName || !reason || !isRecord(args)) return null;
  const tool = findAgentTool(toolName);
  if (!tool || !validateAgentToolArguments(toolName, args)) return null;
  const continuation = parseAgentToolConfirmContinuation(request.continuation);
  if (request.continuation !== undefined && !continuation) return null;
  const parsedRequest = { toolName, arguments: args, reason, ...(continuation ? { continuation } : {}) };
  if (value.confirmationKey !== undefined && !hasValidConfirmationKey(value, parsedRequest)) return null;
  if (continuation && !hasValidConfirmationKey(value, parsedRequest)) return null;
  if (requiresConfirmationKey(tool) && !hasValidConfirmationKey(value, parsedRequest)) return null;
  return parsedRequest;
}
