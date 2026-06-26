import { describe, expect, it } from 'vitest';
import { listAgentPlannerTools } from '../src/agentRuntime/planner.js';
import { findAgentTool, listAgentTools } from '../src/agentRuntime/toolRegistry.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('agent runtime tool registry', () => {
  it('lists stable runtime tool metadata names', () => {
    expect(listAgentTools().map((tool) => tool.name)).toEqual([
      'publicTraffic.latestSummary',
      'product.query',
      'productId.lookup',
      'operationsLearning.startQuiz',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.copy',
      'rental.delist',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
      'rental.operationConfirmRequest',
    ]);
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('rental.newLinkBatchPlan');
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('rental.pricePreview');
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('publicTraffic.crawlSources');
  });

  it('finds tools by name without exposing mutable registry state', () => {
    expect(findAgentTool('product.query')).toMatchObject({ name: 'product.query', risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('missing.tool')).toBeUndefined();

    const tools = listAgentTools();
    tools.pop();
    expect(listAgentTools()).toHaveLength(16);
  });

  it('returns defensive copies of tool metadata', () => {
    const tool = findAgentTool('product.query');
    expect(tool).toBeDefined();
    if (!tool) return;

    tool.name = 'mutated.tool';
    tool.requiresConfirmation = true;

    expect(findAgentTool('product.query')).toMatchObject({
      name: 'product.query',
      requiresConfirmation: false,
    });
  });

  it('returns defensive copies of nested schema metadata', () => {
    const tool = findAgentTool('product.query');
    expect(tool).toBeDefined();
    if (!tool) return;

    const schema = tool.inputSchema;
    expect(isRecord(schema)).toBe(true);
    if (!isRecord(schema)) return;
    const properties = schema.properties;
    expect(isRecord(properties)).toBe(true);
    if (!isRecord(properties)) return;
    const keyword = properties.keyword;
    expect(isRecord(keyword)).toBe(true);
    if (!isRecord(keyword)) return;

    keyword.type = 'number';

    expect(findAgentTool('product.query')?.inputSchema).toMatchObject({
      properties: { keyword: { type: 'string' } },
    });
  });

  it('makes risk and confirmation metadata explicit', () => {
    expect(findAgentTool('publicTraffic.latestSummary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.runReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.resendLatestReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.pushLatestReportToGroup')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.refreshDashboard')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('closedOrder.syncFeedback')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('closedOrder.runObservationReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('rental.copy')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.delist')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.tenancySet')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specDiscover')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specAddAndRefresh')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.operationConfirmRequest')).toMatchObject({ risk: 'high', requiresConfirmation: true });
  });

  it('describes dashboard refresh as a parameter-light write tool', () => {
    expect(findAgentTool('publicTraffic.refreshDashboard')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        date: { type: 'string' },
        sendTo: { type: 'string' },
      },
      additionalProperties: false,
    });
  });

  it('exposes fine-grained rental operation tools to the planner', () => {
    const plannerToolNames = listAgentPlannerTools().map((tool) => tool.name);

    expect(plannerToolNames).toEqual([
      'publicTraffic.latestSummary',
      'product.query',
      'productId.lookup',
      'operationsLearning.startQuiz',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.copy',
      'rental.delist',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
    ]);
    expect(plannerToolNames).not.toContain('rental.operationConfirmRequest');
  });

  it('describes rental operation metadata per executable action', () => {
    expect(findAgentTool('rental.copy')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
      },
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.tenancySet')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        days: { type: 'string' },
      },
      required: ['productId', 'days'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.specAddAndRefresh')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        itemTitle: { type: 'string' },
      },
      required: ['productId', 'itemTitle'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.operationConfirmRequest')?.inputSchema).toMatchObject({
      required: ['action', 'productId'],
    });
  });
});
