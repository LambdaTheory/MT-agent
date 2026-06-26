import { decideAgentPolicy, type AgentPolicyDecision } from './policy.js';
import type { AgentToolDefinition } from './tool.js';
import { findAgentTool, listAgentTools } from './toolRegistry.js';
import type { AgentWorkflowDefinition } from './workflowRegistry.js';
import type { AgentClarificationOption, AgentClarificationRequest } from './clarificationCard.js';
import type { AgentLearningPlannerHint } from '../agentLearning/store.js';

export type AgentPlannerToolMetadata = Pick<AgentToolDefinition, 'name' | 'description' | 'risk' | 'requiresConfirmation' | 'inputSchema'>;

export interface AgentPlannerRequest {
  message: string;
  tools: AgentPlannerToolMetadata[];
  workflows: AgentWorkflowDefinition[];
  learningHints?: AgentLearningPlannerHint[];
}

export interface AgentPlannerProvider {
  proposePlan(request: AgentPlannerRequest): Promise<string>;
}

export interface AgentPlannerProposal {
  goal: string;
  selectedTool: string;
  arguments: Record<string, unknown>;
  confidence: number;
  reason: string;
  requiresConfirmation?: boolean;
}

export type AgentPlannerValidationResult =
  | { ok: true; proposal: AgentPlannerProposal; policy: AgentPolicyDecision }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unknown_tool' | 'invalid_arguments' };

export interface AgentPlannerClarificationProposal extends AgentClarificationRequest {
  goal: string;
  confidence: number;
}

export type AgentPlannerClarificationValidationResult =
  | { ok: true; proposal: AgentPlannerClarificationProposal }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'invalid_options' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function schemaAllowsArguments(schema: unknown, value: Record<string, unknown>): boolean {
  if (!isRecord(schema)) return true;
  if (schema.type !== undefined && schema.type !== 'object') return false;

  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.every((key): key is string => typeof key === 'string' && Object.hasOwn(value, key))) return false;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) return false;
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    if (isRecord(propertySchema) && propertySchema.type === 'string' && typeof value[key] !== 'string') return false;
    if (isRecord(propertySchema) && propertySchema.type === 'number' && typeof value[key] !== 'number') return false;
    if (isRecord(propertySchema) && propertySchema.type === 'integer' && (!Number.isInteger(value[key]) || typeof value[key] !== 'number')) return false;
    if (isRecord(propertySchema) && propertySchema.type === 'object' && !isRecord(value[key])) return false;
    if (isRecord(propertySchema) && Array.isArray(propertySchema.enum) && !propertySchema.enum.includes(value[key])) return false;
  }

  return true;
}

export function listAgentPlannerTools(): AgentPlannerToolMetadata[] {
  return listAgentTools()
    .filter((tool) => tool.plannerVisible !== false)
    .map(({ name, description, risk, requiresConfirmation, inputSchema }) => ({
      name,
      description,
      risk,
      requiresConfirmation,
      inputSchema,
    }));
}

export function validateAgentToolArguments(toolName: string, value: Record<string, unknown>): boolean {
  const tool = findAgentTool(toolName);
  return Boolean(tool && schemaAllowsArguments(tool.inputSchema, value));
}

export function validateAgentPlannerProposal(raw: string): AgentPlannerValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };

  const { goal, selectedTool, arguments: proposalArguments, confidence, reason, requiresConfirmation } = parsed;
  if (
    typeof goal !== 'string' ||
    typeof selectedTool !== 'string' ||
    !isRecord(proposalArguments) ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof reason !== 'string' ||
    (requiresConfirmation !== undefined && typeof requiresConfirmation !== 'boolean')
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const tool = findAgentTool(selectedTool);
  if (!tool) return { ok: false, reason: 'unknown_tool' };
  if (!schemaAllowsArguments(tool.inputSchema, proposalArguments)) return { ok: false, reason: 'invalid_arguments' };

  const proposal: AgentPlannerProposal = { goal, selectedTool, arguments: proposalArguments, confidence, reason };
  if (requiresConfirmation !== undefined) proposal.requiresConfirmation = requiresConfirmation;

  return {
    ok: true,
    proposal,
    policy: decideAgentPolicy({ tool, input: proposalArguments, reason }),
  };
}

export function validateAgentPlannerClarificationProposal(raw: string): AgentPlannerClarificationValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };
  const { goal, needsClarification, question, options, confidence, reason, originalMessage } = parsed;
  if (
    needsClarification !== true ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const normalizedGoal = readNonEmptyString(goal, 120);
  const normalizedQuestion = readNonEmptyString(question, 160);
  const normalizedReason = readNonEmptyString(reason, 240);
  const normalizedOriginalMessage = readNonEmptyString(originalMessage, 300);
  if (!normalizedGoal || !normalizedQuestion || !normalizedReason || !normalizedOriginalMessage || !Array.isArray(options)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const normalizedOptions: AgentClarificationOption[] = [];
  for (const option of options.slice(0, 4)) {
    if (!isRecord(option)) return { ok: false, reason: 'invalid_options' };
    const label = readNonEmptyString(option.label, 40);
    const message = readNonEmptyString(option.message, 300);
    const description = option.description === undefined ? undefined : readNonEmptyString(option.description, 120);
    if (!label || !message || (option.description !== undefined && !description)) return { ok: false, reason: 'invalid_options' };
    normalizedOptions.push({ label, message, ...(description ? { description } : {}) });
  }

  if (normalizedOptions.length < 2) return { ok: false, reason: 'invalid_options' };

  return {
    ok: true,
    proposal: {
      goal: normalizedGoal,
      originalMessage: normalizedOriginalMessage,
      question: normalizedQuestion,
      options: normalizedOptions,
      confidence,
      reason: normalizedReason,
    },
  };
}
