import { describe, expect, it } from 'vitest';
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
    expect(listAgentTools()).toHaveLength(11);
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

  it('keeps rental operation metadata atomic instead of workflow-specific', () => {
    expect(findAgentTool('rental.operationConfirmRequest')?.inputSchema).toMatchObject({
      properties: {
        action: { type: 'string' },
        productId: { type: 'string' },
      },
      required: ['action', 'productId'],
      additionalProperties: false,
    });
  });
});
