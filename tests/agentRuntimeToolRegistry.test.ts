import { describe, expect, it } from 'vitest';
import { listAgentPlannerTools } from '../src/agentRuntime/planner.js';
import { findAgentTool, listAgentTools } from '../src/agentRuntime/toolRegistry.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('agent runtime tool registry', () => {
  it('lists stable runtime tool metadata names', () => {
    expect(listAgentTools().map((tool) => tool.name)).toEqual([
      'system.help',
      'publicTraffic.latestSummary',
      'publicTraffic.conversionSummary',
      'publicTraffic.reportQuery',
      'product.query',
      'product.rankBestSameSku',
      'productId.lookup',
      'productId.lookupCard',
      'inventory.statusOverview',
      'inventory.statusQuery',
      'linkRegistry.overview',
      'linkRegistry.maintenancePrompt',
      'linkRegistry.governancePrompt',
      'linkRegistry.maintenanceHub',
      'linkRegistry.resolveProducts',
      'operationsLearning.startQuiz',
      'operationsLearning.summary',
      'operationsLearning.history',
      'agentLearning.summary',
      'activity.differentialPricingCard',
      'activity.cancelDifferentialPricingCard',
      'publicTraffic.newLinkPool',
      'publicTraffic.taskPool',
      'publicTraffic.problemProducts',
      'publicTraffic.inactiveLinks',
      'publicTraffic.removedLinks',
      'publicTraffic.orderSummary',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'operations.refreshActivityPlan',
      'operations.refreshActivityExecute',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.copy',
      'rental.delist',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
      'rental.specRemovePlan',
      'rental.priceChange',
      'rental.pricePreview',
      'rental.priceSnapshot',
      'rental.newLinkBatchPlan',
      'rental.priceRollback',
      'rental.priceApply',
      'rental.operationConfirmRequest',
    ]);
    expect(listAgentTools().map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
    expect(listAgentTools().map((tool) => tool.name)).toContain('rental.pricePreview');
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('publicTraffic.crawlSources');
  });

  it('finds tools by name without exposing mutable registry state', () => {
    expect(findAgentTool('product.query')).toMatchObject({ name: 'product.query', risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('missing.tool')).toBeUndefined();

    const tools = listAgentTools();
    tools.pop();
    expect(listAgentTools()).toHaveLength(48);
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

  it('returns defensive copies of result metadata schema', () => {
    const tool = findAgentTool('rental.copy');
    expect(tool).toBeDefined();
    if (!tool) return;

    const schema = tool.resultMetadataSchema;
    expect(isRecord(schema)).toBe(true);
    if (!isRecord(schema)) return;
    const properties = schema.properties;
    expect(isRecord(properties)).toBe(true);
    if (!isRecord(properties)) return;
    const newProductId = properties.newProductId;
    expect(isRecord(newProductId)).toBe(true);
    if (!isRecord(newProductId)) return;

    newProductId.type = 'number';

    expect(findAgentTool('rental.copy')?.resultMetadataSchema).toMatchObject({
      properties: { newProductId: { type: 'string' } },
    });
  });

  it('makes risk and confirmation metadata explicit', () => {
    expect(findAgentTool('system.help')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.latestSummary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.conversionSummary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.reportQuery')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('product.rankBestSameSku')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('productId.lookupCard')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('inventory.statusOverview')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('inventory.statusQuery')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('linkRegistry.overview')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('linkRegistry.resolveProducts')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operationsLearning.summary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operationsLearning.history')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('agentLearning.summary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('activity.differentialPricingCard')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('activity.cancelDifferentialPricingCard')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.newLinkPool')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.taskPool')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.problemProducts')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.inactiveLinks')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.removedLinks')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.orderSummary')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.runReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.resendLatestReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.pushLatestReportToGroup')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.refreshDashboard')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('operations.refreshActivityPlan')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operations.refreshActivityExecute')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('closedOrder.syncFeedback')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('closedOrder.runObservationReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('rental.copy')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.delist')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.tenancySet')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specDiscover')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specAddAndRefresh')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specRemovePlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceChange')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.pricePreview')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceSnapshot')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.newLinkBatchPlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceRollback')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.operationConfirmRequest')).toMatchObject({ risk: 'high', requiresConfirmation: true });
  });

  it('allows read-only report tools to target an explicit report date', () => {
    expect(findAgentTool('publicTraffic.latestSummary')?.inputSchema).toMatchObject({
      properties: { date: { type: 'string', pattern: expect.any(String) } },
      additionalProperties: false,
    });
    expect(findAgentTool('publicTraffic.conversionSummary')?.inputSchema).toMatchObject({
      properties: { date: { type: 'string', pattern: expect.any(String) } },
      additionalProperties: false,
    });
    expect(findAgentTool('publicTraffic.reportQuery')?.inputSchema).toMatchObject({
      properties: {
        target: { enum: ['summary', 'comparison', 'dateComparison', 'products', 'productDetail', 'productAggregation', 'sourceCoverage', 'section', 'sectionCounts', 'orders', 'orderDerived', 'dataQuality', 'conclusions'] },
        date: { type: 'string', pattern: expect.any(String) },
        period: { enum: ['1d', '7d', '30d'] },
        metrics: { type: 'array' },
        aggregation: { enum: ['count', 'sum', 'avg', 'min', 'max'] },
        source: { enum: ['exposure', 'dashboard', 'all'] },
        coverageStatus: { enum: ['available', 'missing', 'all'] },
        orderDerivedMetric: { enum: ['shipmentRate', 'closeRate', 'closeRateStatus', 'averageOrderValue', 'fulfillmentRates', 'all'] },
        filters: { type: 'array' },
      },
      required: ['target'],
      additionalProperties: false,
    });
    expect(findAgentTool('product.query')?.inputSchema).toMatchObject({
      properties: { keyword: { type: 'string' }, date: { type: 'string' } },
      required: ['keyword'],
      additionalProperties: false,
    });
    expect(findAgentTool('productId.lookup')?.inputSchema).toMatchObject({
      properties: { keyword: { type: 'string' }, date: { type: 'string' } },
      required: ['keyword'],
      additionalProperties: false,
    });
    expect(findAgentTool('inventory.statusQuery')?.inputSchema).toMatchObject({
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
    expect(findAgentTool('publicTraffic.resendLatestReport')?.inputSchema).toMatchObject({
      properties: { sendTo: { type: 'string' }, date: { type: 'string', pattern: expect.any(String) } },
      additionalProperties: false,
    });
    expect(findAgentTool('publicTraffic.pushLatestReportToGroup')?.inputSchema).toMatchObject({
      properties: { date: { type: 'string', pattern: expect.any(String) } },
      additionalProperties: false,
    });
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
      'system.help',
      'publicTraffic.latestSummary',
      'publicTraffic.conversionSummary',
      'publicTraffic.reportQuery',
      'product.query',
      'product.rankBestSameSku',
      'productId.lookup',
      'productId.lookupCard',
      'inventory.statusOverview',
      'inventory.statusQuery',
      'linkRegistry.overview',
      'linkRegistry.maintenancePrompt',
      'linkRegistry.governancePrompt',
      'linkRegistry.maintenanceHub',
      'linkRegistry.resolveProducts',
      'operationsLearning.startQuiz',
      'operationsLearning.summary',
      'operationsLearning.history',
      'agentLearning.summary',
      'activity.differentialPricingCard',
      'activity.cancelDifferentialPricingCard',
      'publicTraffic.newLinkPool',
      'publicTraffic.taskPool',
      'publicTraffic.problemProducts',
      'publicTraffic.inactiveLinks',
      'publicTraffic.removedLinks',
      'publicTraffic.orderSummary',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'operations.refreshActivityPlan',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.copy',
      'rental.delist',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
      'rental.specRemovePlan',
      'rental.priceChange',
      'rental.pricePreview',
      'rental.priceSnapshot',
      'rental.newLinkBatchPlan',
      'rental.priceRollback',
    ]);
    expect(plannerToolNames).not.toContain('rental.operationConfirmRequest');
    expect(plannerToolNames).not.toContain('rental.priceApply');
    expect(plannerToolNames).not.toContain('operations.refreshActivityExecute');
  });

  it('exposes result metadata schema to planner-visible tools only', () => {
    const plannerTools = listAgentPlannerTools();
    expect(plannerTools.find((tool) => tool.name === 'product.rankBestSameSku')?.resultMetadataSchema).toMatchObject({
      properties: {
        bestProductId: { type: 'string' },
        ranking: { type: 'array' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'linkRegistry.resolveProducts')?.resultMetadataSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
        count: { type: 'integer' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'rental.copy')?.resultMetadataSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        newProductId: { type: 'string' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'rental.priceChange')?.resultMetadataSchema).toMatchObject({
      properties: {
        taskId: { type: 'string' },
        rollbackFile: { type: 'string' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'rental.pricePreview')?.resultMetadataSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
        previewCount: { type: 'integer' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'rental.newLinkBatchPlan')?.resultMetadataSchema).toMatchObject({
      properties: {
        newProductIds: { type: 'array' },
        completedCount: { type: 'integer' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'operations.refreshActivityExecute')).toBeUndefined();
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
    expect(findAgentTool('rental.specRemovePlan')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
        keyword: { type: 'string' },
      },
      required: ['query', 'keyword'],
      additionalProperties: false,
    });
    expect(findAgentTool('operations.refreshActivityPlan')?.inputSchema).toMatchObject({
      properties: {
        date: { type: 'string' },
        maxCandidates: { type: 'number' },
      },
      additionalProperties: false,
    });
    expect(findAgentTool('linkRegistry.resolveProducts')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
        includeUnknown: { type: 'boolean' },
        resolutionMode: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    });
    expect(findAgentTool('operations.refreshActivityExecute')?.inputSchema).toMatchObject({
      properties: {
        date: { type: 'string' },
        delistProductIds: { type: 'array' },
        newLinkItems: { type: 'array' },
      },
      required: ['date', 'delistProductIds', 'newLinkItems'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.priceChange')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        fields: { type: 'object' },
        discount: { type: 'number' },
        scope: { type: 'string' },
      },
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.pricePreview')?.inputSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
        discount: { type: ['number', 'string'] },
        scope: { type: 'string' },
      },
      required: ['productIds'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.priceSnapshot')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.newLinkBatchPlan')?.inputSchema).toMatchObject({
      properties: {
        keyword: { type: 'string' },
        sourceProductId: { type: 'string' },
        items: { type: 'array' },
      },
      minProperties: 1,
      additionalProperties: false,
    });
    expect(findAgentTool('rental.priceRollback')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        taskId: { type: 'string' },
        rollbackFile: { type: 'string' },
      },
      minProperties: 1,
      additionalProperties: false,
    });
    expect(findAgentTool('rental.operationConfirmRequest')?.inputSchema).toMatchObject({
      required: ['action', 'productId'],
    });
  });
});
