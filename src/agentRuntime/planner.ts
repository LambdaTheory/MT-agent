import { decideAgentPolicy, type AgentPolicyDecision } from './policy.js';
import { findAgentTool } from './toolRegistry.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaAllowsArguments(schema: unknown, value: Record<string, unknown>): boolean {
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
  }

  return true;
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
