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

export interface AgentPlannerStep {
  id?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface AgentMultiStepPlannerProposal {
  goal: string;
  steps: AgentPlannerStep[];
  confidence: number;
  reason: string;
}

export type AgentPlannerValidationResult =
  | { ok: true; proposal: AgentPlannerProposal; policy: AgentPolicyDecision }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unknown_tool' | 'invalid_arguments' };

export type AgentMultiStepPlannerValidationResult =
  | { ok: true; proposal: AgentMultiStepPlannerProposal; policies: AgentPolicyDecision[] }
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

function readStepId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(trimmed) ? trimmed : null;
}

function isPlannerPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /^\$\{[^}]+\}$/.test(value.trim());
}

function collectPlannerReferences(value: unknown, references: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
      const reference = match[1]?.trim();
      if (reference) references.push(reference);
    }
    return references;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPlannerReferences(item, references);
    return references;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) collectPlannerReferences(item, references);
  }

  return references;
}

function isReferenceToPriorStep(reference: string, priorStepIds: Set<string>, hasPriorStep: boolean): boolean {
  const normalized = reference.startsWith('steps.') ? reference.slice('steps.'.length) : reference;
  const root = normalized.split('.')[0]?.trim();
  if (!root) return false;
  if (root === 'last') return hasPriorStep;
  return priorStepIds.has(root);
}

export function schemaAllowsArguments(schema: unknown, value: Record<string, unknown>, options: { allowPlaceholders?: boolean } = {}): boolean {
  if (!isRecord(schema)) return true;
  if (schema.type !== undefined && schema.type !== 'object') return false;

  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!required.every((key): key is string => typeof key === 'string' && Object.hasOwn(value, key))) return false;
  if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) return false;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) return false;
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    if (options.allowPlaceholders && isPlannerPlaceholder(value[key])) continue;
    if (isRecord(propertySchema) && propertySchema.type === 'string' && typeof value[key] !== 'string') return false;
    if (isRecord(propertySchema) && propertySchema.type === 'number' && typeof value[key] !== 'number') return false;
    if (isRecord(propertySchema) && propertySchema.type === 'integer' && (!Number.isInteger(value[key]) || typeof value[key] !== 'number')) return false;
    if (isRecord(propertySchema) && propertySchema.type === 'object' && !isRecord(value[key])) return false;
    if (isRecord(propertySchema) && propertySchema.type === 'array' && !Array.isArray(value[key])) return false;
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

export function validateAgentMultiStepPlannerProposal(raw: string): AgentMultiStepPlannerValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };
  const { goal, steps, confidence, reason } = parsed;
  if (
    typeof goal !== 'string' ||
    !Array.isArray(steps) ||
    steps.length < 2 ||
    steps.length > 8 ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof reason !== 'string'
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const normalizedSteps: AgentPlannerStep[] = [];
  const policies: AgentPolicyDecision[] = [];
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (!isRecord(step)) return { ok: false, reason: 'invalid_shape' };
    const { id, toolName, arguments: stepArguments, reason: stepReason } = step;
    if (typeof toolName !== 'string' || !isRecord(stepArguments) || typeof stepReason !== 'string') {
      return { ok: false, reason: 'invalid_shape' };
    }
    const normalizedId = readStepId(id);
    if (normalizedId === null) return { ok: false, reason: 'invalid_shape' };
    if (normalizedId && stepIds.has(normalizedId)) return { ok: false, reason: 'invalid_shape' };
    const tool = findAgentTool(toolName);
    if (!tool) return { ok: false, reason: 'unknown_tool' };
    if (!schemaAllowsArguments(tool.inputSchema, stepArguments, { allowPlaceholders: true })) return { ok: false, reason: 'invalid_arguments' };
    const references = collectPlannerReferences(stepArguments);
    if (!references.every((reference) => isReferenceToPriorStep(reference, stepIds, normalizedSteps.length > 0))) {
      return { ok: false, reason: 'invalid_arguments' };
    }
    normalizedSteps.push({ ...(normalizedId ? { id: normalizedId } : {}), toolName, arguments: stepArguments, reason: stepReason });
    policies.push(decideAgentPolicy({ tool, input: stepArguments, reason: stepReason || reason }));
    if (normalizedId) stepIds.add(normalizedId);
  }

  return {
    ok: true,
    proposal: { goal, steps: normalizedSteps, confidence, reason },
    policies,
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
