import type { AgentToolDefinition, AgentToolRisk } from './tool.js';

export interface AgentActionProposal {
  toolName: string;
  input?: unknown;
  reason: string;
}

export type AgentPolicyDecision =
  | { decision: 'allow'; toolName: string; risk: AgentToolRisk }
  | { decision: 'confirmation_required'; toolName: string; risk: AgentToolRisk; proposal: AgentActionProposal };

export interface AgentPolicyRequest {
  tool: AgentToolDefinition;
  input?: unknown;
  reason?: string;
}

export function decideAgentPolicy(request: AgentPolicyRequest): AgentPolicyDecision {
  const { tool, input } = request;
  if (!tool.requiresConfirmation) {
    return { decision: 'allow', toolName: tool.name, risk: tool.risk };
  }

  return {
    decision: 'confirmation_required',
    toolName: tool.name,
    risk: tool.risk,
    proposal: {
      toolName: tool.name,
      input,
      reason: request.reason ?? `Tool ${tool.name} requires confirmation before execution.`,
    },
  };
}
