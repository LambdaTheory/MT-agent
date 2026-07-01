import { describe, expect, it } from 'vitest';
import { decideAgentPolicy } from '../src/agentRuntime/policy.js';
import type { AgentToolDefinition } from '../src/agentRuntime/tool.js';

function tool(overrides: Partial<AgentToolDefinition>): AgentToolDefinition {
  return {
    name: 'test.tool',
    description: 'test tool',
    risk: 'read',
    requiresConfirmation: false,
    ...overrides,
  };
}

describe('agent runtime policy', () => {
  it('allows read tools that do not require confirmation', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'publicTraffic.latestSummary', risk: 'read', requiresConfirmation: false }) })).toEqual({
      decision: 'allow',
      toolName: 'publicTraffic.latestSummary',
      risk: 'read',
    });
  });

  it('allows non-product write tools that do not require confirmation', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'publicTraffic.resendLatestReport', risk: 'write', requiresConfirmation: false }), input: { sendTo: 'group' } })).toEqual({
      decision: 'allow',
      toolName: 'publicTraffic.resendLatestReport',
      risk: 'write',
    });
  });

  it('requires confirmation when tool metadata marks the action as confirmable', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'rental.copy', risk: 'high', requiresConfirmation: true }), input: { productId: '761' } })).toEqual({
      decision: 'confirmation_required',
      toolName: 'rental.copy',
      risk: 'high',
      proposal: { toolName: 'rental.copy', input: { productId: '761' }, reason: 'Tool rental.copy requires confirmation before execution.' },
    });
  });

  it('allows high-risk tools when metadata explicitly opts out of confirmation', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'test.highRiskOperation', risk: 'high', requiresConfirmation: false }), input: { productId: '761' }, reason: 'high risk operation' })).toEqual({
      decision: 'allow',
      toolName: 'test.highRiskOperation',
      risk: 'high',
    });
  });
});
