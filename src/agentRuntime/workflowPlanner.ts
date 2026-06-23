import { schemaAllowsArguments } from './planner.js';
import { findAgentWorkflow } from './workflowRegistry.js';

export interface AgentWorkflowPlannerProposal {
  goal: string;
  selectedWorkflow: string;
  arguments: Record<string, unknown>;
  confidence: number;
  reason: string;
  requiresConfirmation?: boolean;
}

export type AgentWorkflowPlannerValidationResult =
  | { ok: true; proposal: AgentWorkflowPlannerProposal }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unknown_workflow' | 'invalid_arguments' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateAgentWorkflowPlannerProposal(raw: string): AgentWorkflowPlannerValidationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };
  const { goal, selectedWorkflow, arguments: proposalArguments, confidence, reason, requiresConfirmation } = parsed;
  if (
    typeof goal !== 'string' ||
    typeof selectedWorkflow !== 'string' ||
    !isRecord(proposalArguments) ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof reason !== 'string' ||
    (requiresConfirmation !== undefined && typeof requiresConfirmation !== 'boolean')
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const workflow = findAgentWorkflow(selectedWorkflow);
  if (!workflow) return { ok: false, reason: 'unknown_workflow' };
  if (!schemaAllowsArguments(workflow.argumentsSchema, proposalArguments)) return { ok: false, reason: 'invalid_arguments' };

  const proposal: AgentWorkflowPlannerProposal = { goal, selectedWorkflow, arguments: proposalArguments, confidence, reason };
  if (requiresConfirmation !== undefined) proposal.requiresConfirmation = requiresConfirmation;
  return { ok: true, proposal };
}
