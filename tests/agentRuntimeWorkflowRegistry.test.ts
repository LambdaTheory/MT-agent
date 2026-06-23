import { describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { validateAgentWorkflowPlannerProposal } from '../src/agentRuntime/workflowPlanner.js';
import { findAgentWorkflow, listAgentWorkflows } from '../src/agentRuntime/workflowRegistry.js';

describe('agent runtime workflow registry', () => {
  it('describes composite workflows without registering them as executable tools', () => {
    expect(listAgentWorkflows().map((workflow) => workflow.name)).toContain('rental.newLinkBatch');
    expect(findAgentWorkflow('rental.newLinkBatch')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      requiredCapabilities: expect.arrayContaining([
        'llm.intentUnderstanding',
        'linkRegistry.classificationLookup',
        'publicTraffic.performanceRanking',
        'rental.copyProduct',
      ]),
    });
    expect(findAgentTool('rental.newLinkBatch')).toBeUndefined();
    expect(findAgentTool('rental.newLinkBatchPlan')).toBeUndefined();
  });

  it('validates LLM workflow proposals against registered workflow metadata', () => {
    expect(validateAgentWorkflowPlannerProposal(JSON.stringify({
      goal: '铺设新链',
      selectedWorkflow: 'rental.newLinkBatch',
      arguments: { keyword: 'pocket3', count: 10 },
      confidence: 0.94,
      reason: '用户要求铺十条 pocket3 新链',
      requiresConfirmation: true,
    }))).toEqual({
      ok: true,
      proposal: {
        goal: '铺设新链',
        selectedWorkflow: 'rental.newLinkBatch',
        arguments: { keyword: 'pocket3', count: 10 },
        confidence: 0.94,
        reason: '用户要求铺十条 pocket3 新链',
        requiresConfirmation: true,
      },
    });

    expect(validateAgentWorkflowPlannerProposal(JSON.stringify({
      goal: 'bad',
      selectedWorkflow: 'rental.newLinkBatch',
      arguments: { keyword: 'pocket3', count: '10' },
      confidence: 0.94,
      reason: 'bad',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateAgentWorkflowPlannerProposal(JSON.stringify({
      goal: 'bad',
      selectedWorkflow: 'rental.unknownWorkflow',
      arguments: { keyword: 'pocket3', count: 10 },
      confidence: 0.94,
      reason: 'bad',
    }))).toEqual({ ok: false, reason: 'unknown_workflow' });
  });
});
