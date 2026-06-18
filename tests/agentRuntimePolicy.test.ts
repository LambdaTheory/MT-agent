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

  it('requires confirmation for write tools', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'publicTraffic.runReport', risk: 'write', requiresConfirmation: true }), input: { sendTo: 'group' } })).toEqual({
      decision: 'confirmation_required',
      toolName: 'publicTraffic.runReport',
      risk: 'write',
      proposal: { toolName: 'publicTraffic.runReport', input: { sendTo: 'group' }, reason: 'Tool publicTraffic.runReport requires confirmation before execution.' },
    });
  });

  it('requires confirmation for high-risk tools even when metadata is misconfigured', () => {
    expect(decideAgentPolicy({ tool: tool({ name: 'rental.pricePreview', risk: 'high', requiresConfirmation: false }), input: { productId: '761' }, reason: 'rental operation' })).toEqual({
      decision: 'confirmation_required',
      toolName: 'rental.pricePreview',
      risk: 'high',
      proposal: { toolName: 'rental.pricePreview', input: { productId: '761' }, reason: 'rental operation' },
    });
  });
});
