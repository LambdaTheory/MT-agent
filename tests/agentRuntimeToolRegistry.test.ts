import { describe, expect, it } from 'vitest';
import { listAgentPlannerTools, validateAgentToolArguments } from '../src/agentRuntime/planner.js';
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
      'productLink.query',
      'product.query',
      'product.rankBestSameSku',
      'product.rankByCategory',
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
      'publicTraffic.windowedFindings',
      'publicTraffic.windowAggregate',
      'publicTraffic.windowQuery',
      'system.dataHealth',
      'strategy.safeSourceResolve',
      'strategy.metricThresholdExplain',
      'strategy.refreshCandidateExplain',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'operations.refreshActivityPlan',
      'operations.refreshActivityExecute',
      'operations.inactiveRefreshPlan',
      'operations.inactiveRefreshExecute',
      'operations.operationReview',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.daemonStatus',
      'rental.platformSearch',
      'rental.platformSearchAll',
      'rental.batchRead',
      'rental.batchPreview',
      'rental.batchExecute',
      'rental.batchStatus',
      'rental.batchResume',
      'rental.batchReport',
      'rental.batchRollback',
      'rental.batchDelayedVerify',
      'rental.mirrorSearch',
      'rental.mirrorWritebackState',
      'rental.mirrorBatchSpec',
      'rental.specDiscoverFull',
      'rental.readRaw',
      'rental.imageRead',
      'rental.imageUpload',
      'rental.imagePick',
      'rental.imageOrder',
      'rental.whiteImageSet',
      'rental.imageVerify',
      'rental.vasRead',
      'rental.vasCatalogRead',
      'rental.vasApply',
      'rental.vasVerify',
      'rental.copy',
      'rental.delist',
      'rental.delistBatch',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
      'rental.specAddItem',
      'rental.specRefresh',
      'rental.specRemovePlan',
      'rental.priceChange',
      'rental.pricePreview',
      'rental.priceSnapshot',
      'rental.specKeywordPricePlan',
      'rental.priceSelectionPlan',
      'rental.bulkPricePlan',
      'rental.bulkPriceApply',
      'rental.newLinkBatchPlan',
      'rental.priceRollback',
      'rental.priceRollbackBatch',
      'rental.priceApply',
      'rental.operationConfirmRequest',
      'rental.perSpecPricePlan',
      'rental.perSpecPriceApply',
      'rental.specDimPlan',
      'rental.specDimApply',
    ]);
    expect(listAgentTools().map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
    expect(listAgentTools().map((tool) => tool.name)).toContain('rental.pricePreview');
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('publicTraffic.crawlSources');
  });

  it('finds tools by name without exposing mutable registry state', () => {
    expect(findAgentTool('product.query')).toMatchObject({ name: 'product.query', risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('missing.tool')).toBeUndefined();

    const tools = listAgentTools();
    const toolCount = tools.length;
    tools.pop();
    expect(listAgentTools()).toHaveLength(toolCount);
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
    expect(findAgentTool('productLink.query')).toMatchObject({ risk: 'read', requiresConfirmation: false });
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
    expect(findAgentTool('publicTraffic.windowAggregate')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.windowQuery')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('system.dataHealth')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('strategy.safeSourceResolve')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('strategy.metricThresholdExplain')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('strategy.refreshCandidateExplain')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.runReport')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('publicTraffic.resendLatestReport')).toMatchObject({ risk: 'write', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.pushLatestReportToGroup')).toMatchObject({ risk: 'write', requiresConfirmation: false });
    expect(findAgentTool('publicTraffic.refreshDashboard')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('operations.refreshActivityPlan')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operations.refreshActivityExecute')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('closedOrder.syncFeedback')).toMatchObject({ risk: 'write', requiresConfirmation: false });
    expect(findAgentTool('closedOrder.runObservationReport')).toMatchObject({ risk: 'write', requiresConfirmation: false });
    expect(findAgentTool('rental.daemonStatus')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.platformSearch')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.batchRead')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.imageRead')).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    expect(findAgentTool('rental.imageUpload')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.imagePick')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.imageOrder')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.whiteImageSet')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.imageVerify')).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    expect(findAgentTool('rental.vasRead')).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    expect(findAgentTool('rental.vasCatalogRead')).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    expect(findAgentTool('rental.vasApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.vasVerify')).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    expect(findAgentTool('rental.copy')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.delist')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.delistBatch')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.tenancySet')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specDiscover')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.specAddAndRefresh')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specRemovePlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceChange')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.pricePreview')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceSnapshot')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.newLinkBatchPlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceRollback')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.priceApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.operationConfirmRequest')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.perSpecPricePlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.perSpecPriceApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    expect(findAgentTool('rental.specDimPlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.specDimApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
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
        target: { enum: ['summary', 'comparison', 'dateComparison', 'productAggregation', 'orders', 'orderDerived', 'dataQuality', 'conclusions'] },
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
    expect(findAgentTool('productLink.query')?.inputSchema).toMatchObject({
      properties: {
        queryType: { enum: ['productDetail', 'productList', 'problemPool', 'problemPoolCounts', 'sourceCoverage', 'linkStatus'] },
        productQuery: { type: 'string' },
        section: { enum: expect.arrayContaining(['custodyAbnormal', 'recommendedActions', 'removedLinks']) },
        filters: { type: 'array' },
        sortBy: { type: 'string' },
        limit: { type: ['integer', 'string'] },
      },
      required: ['queryType'],
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

  it('describes dashboard refresh as a confirmed business-date write tool', () => {
    const tool = findAgentTool('publicTraffic.refreshDashboard');
    expect(tool?.description).toBe('补抓指定业务数据日的访问页 1日、7日、30日数据；页面日期经回读确认后保存 raw，必要时修复并最多重发一次对应日报。未传 date 时默认昨天。');
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        date: { type: 'string', description: '业务数据截止日；默认昨天，不是日报目录日期' },
        sendTo: { type: 'string' },
      },
      additionalProperties: false,
    });
  });

  it('accepts explicit YYYY-MM-DD dates for inactive refresh planning', () => {
    expect(validateAgentToolArguments('operations.inactiveRefreshPlan', { date: '2026-07-17' })).toBe(true);
  });

  it('exposes fine-grained rental operation tools to the planner', () => {
    const plannerToolNames = listAgentPlannerTools().map((tool) => tool.name);

    expect(plannerToolNames).toEqual([
      'system.help',
      'publicTraffic.latestSummary',
      'publicTraffic.conversionSummary',
      'publicTraffic.reportQuery',
      'productLink.query',
      'product.query',
      'product.rankBestSameSku',
      'product.rankByCategory',
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
      'publicTraffic.windowedFindings',
      'publicTraffic.windowAggregate',
      'publicTraffic.windowQuery',
      'system.dataHealth',
      'strategy.safeSourceResolve',
      'strategy.metricThresholdExplain',
      'strategy.refreshCandidateExplain',
      'publicTraffic.runReport',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.refreshDashboard',
      'operations.refreshActivityPlan',
      'operations.inactiveRefreshPlan',
      'operations.operationReview',
      'closedOrder.syncFeedback',
      'closedOrder.runObservationReport',
      'rental.daemonStatus',
      'rental.platformSearch',
      'rental.platformSearchAll',
      'rental.batchRead',
      'rental.batchPreview',
      'rental.batchExecute',
      'rental.batchStatus',
      'rental.batchResume',
      'rental.batchReport',
      'rental.batchRollback',
      'rental.batchDelayedVerify',
      'rental.mirrorSearch',
      'rental.mirrorBatchSpec',
      'rental.specDiscoverFull',
      'rental.readRaw',
      'rental.copy',
      'rental.delist',
      'rental.delistBatch',
      'rental.tenancySet',
      'rental.specDiscover',
      'rental.specAddAndRefresh',
      'rental.specAddItem',
      'rental.specRefresh',
      'rental.specRemovePlan',
      'rental.priceChange',
      'rental.pricePreview',
      'rental.priceSnapshot',
      'rental.specKeywordPricePlan',
      'rental.priceSelectionPlan',
      'rental.bulkPricePlan',
      'rental.newLinkBatchPlan',
      'rental.priceRollback',
      'rental.perSpecPricePlan',
      'rental.specDimPlan',
    ]);
    expect(plannerToolNames).not.toContain('rental.operationConfirmRequest');
    expect(plannerToolNames).not.toContain('rental.priceApply');
    expect(plannerToolNames).not.toContain('rental.bulkPriceApply');
    expect(plannerToolNames).not.toContain('rental.mirrorWritebackState');
    expect(plannerToolNames.some((name) => /image/i.test(name))).toBe(false);
    expect(plannerToolNames.some((name) => /vas/i.test(name))).toBe(false);
    expect(plannerToolNames).not.toContain('rental.perSpecPriceApply');
    expect(plannerToolNames).not.toContain('rental.specDimApply');
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
    expect(plannerTools.find((tool) => tool.name === 'productLink.query')?.resultMetadataSchema).toMatchObject({
      properties: {
        queryType: { type: 'string' },
        productIds: { type: 'array' },
        queryRef: { type: 'string' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'linkRegistry.resolveProducts')?.resultMetadataSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
        count: { type: 'integer' },
      },
    });
    expect(plannerTools.find((tool) => tool.name === 'publicTraffic.windowQuery')?.resultMetadataSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
        items: { type: 'array' },
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

  it('locks high-risk rental schemas to current runtime guardrails', () => {
    expect(validateAgentToolArguments('rental.priceRollback', { productId: '648' })).toBe(false);
    expect(validateAgentToolArguments('rental.priceRollback', { taskId: 'task_123_abcd' })).toBe(true);
    expect(validateAgentToolArguments('rental.priceRollback', { rollbackFile: 'output/rental/rollback.json' })).toBe(false);
    expect(validateAgentToolArguments('rental.priceRollback', { taskId: 'task_123_abcd', rollbackFile: 'output/rental/rollback.json' })).toBe(false);

    expect(validateAgentToolArguments('rental.pricePreview', { productIds: ['648'], discount: 0.8, adjustmentAmount: -1 })).toBe(false);
    expect(validateAgentToolArguments('rental.priceChange', { productId: '648', discount: 0.8, adjustmentAmount: -1 })).toBe(false);

    expect(validateAgentToolArguments('rental.pricePreview', { productIds: ['abc'], discount: 0.8 })).toBe(false);
    expect(validateAgentToolArguments('rental.delistBatch', { productIds: ['abc'] })).toBe(false);

    expect(findAgentTool('rental.priceSnapshot')?.inputSchema).toMatchObject({
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
    expect(validateAgentToolArguments('rental.priceSnapshot', { query: 'x200u', periodDays: 7 })).toBe(false);
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
        specDimId: { type: 'string' },
        itemTitle: { type: 'string' },
      },
      required: ['productId', 'specDimId', 'itemTitle'],
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
        query: { type: 'string' },
        sameSkuGroupId: { type: 'string' },
        conditions: { type: 'array', minItems: 1, maxItems: 6 },
        windowDays: { type: ['integer', 'string'] },
      },
      required: ['conditions', 'windowDays'],
      additionalProperties: false,
    });
    expect(findAgentTool('publicTraffic.windowAggregate')?.description).toContain('不筛选、不排序');
    expect(findAgentTool('publicTraffic.windowQuery')?.description).toContain('全指标');
    expect(findAgentTool('publicTraffic.windowQuery')?.description).toContain('筛选');
    expect(findAgentTool('publicTraffic.windowQuery')?.description).toContain('排序');
    expect(findAgentTool('publicTraffic.windowQuery')?.inputSchema).toMatchObject({
      properties: {
        metrics: { type: 'array' },
        filters: { type: 'array' },
        sortBy: { type: 'string' },
        aggregation: { enum: ['count', 'sum', 'avg', 'min', 'max'] },
      },
      required: ['windowDays'],
      additionalProperties: false,
    });
    expect(findAgentTool('product.rankBestSameSku')?.description).toContain('全指标');
    expect(findAgentTool('product.rankBestSameSku')?.description).toContain('1..90');
    expect(findAgentTool('product.rankBestSameSku')?.description).not.toContain('shippedOrders/amount/exposure');
    expect(findAgentTool('product.rankByCategory')?.description).toContain('全指标');
    expect(findAgentTool('product.rankByCategory')?.description).toContain('1..90');
    expect(findAgentTool('product.rankByCategory')?.description).not.toContain('1/7/30');
    expect(findAgentTool('operations.refreshActivityPlan')?.description).toContain('query');
    expect(findAgentTool('operations.refreshActivityPlan')?.description).toContain('conditions[]/windowDays');
    expect(findAgentTool('operations.refreshActivityPlan')?.resultMetadataSchema).toMatchObject({
      properties: {
        scope: { type: ['string', 'null'] },
        metric: { type: 'string' },
        operator: { type: 'string' },
        value: { type: 'number' },
        windowDays: { type: 'integer' },
        strategyRequests: { type: 'object' },
        skippedGroups: { type: 'array' },
      },
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
        strategy: { type: 'string' },
      },
      required: ['date', 'delistProductIds'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.daemonStatus')?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(findAgentTool('rental.platformSearch')?.inputSchema).toMatchObject({
      properties: {
        keyword: { type: 'string' },
      },
      required: ['keyword'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.platformSearchAll')?.inputSchema).toMatchObject({
      properties: {
        limit: { type: ['integer', 'string'], minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    });
    expect(findAgentTool('rental.batchRead')?.inputSchema).toMatchObject({
      properties: {
        productIds: {
          type: 'array',
          minItems: 1,
          maxItems: 60,
          items: { type: 'string' },
        },
      },
      required: ['productIds'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.specDiscoverFull')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
      },
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.readRaw')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        fields: { type: 'array', maxItems: 32, items: { type: 'string' } },
      },
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.priceChange')?.inputSchema).toMatchObject({
      not: { required: ['discount', 'adjustmentAmount'] },
      properties: {
        productId: { type: 'string', pattern: '^\\d+$' },
        fields: { type: 'object' },
        discount: { type: ['number', 'string'] },
        scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'] },
      },
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.pricePreview')?.inputSchema).toMatchObject({
      not: { required: ['discount', 'adjustmentAmount'] },
      properties: {
        productIds: { type: 'array', minItems: 1, maxItems: 60 },
        discount: { type: ['number', 'string'] },
        scope: { type: 'string', enum: ['rent_fields', 'all_price_fields'] },
      },
      required: ['productIds'],
      additionalProperties: false,
    });
    const productIds = Array.from({ length: 28 }, (_, index) => String(900 + index));
    expect(validateAgentToolArguments('rental.pricePreview', { productIds, adjustmentAmount: -10, scope: 'rent_fields' })).toBe(true);
    expect(validateAgentToolArguments('rental.priceApply', { items: productIds.map((productId) => ({ productId, fields: { rent1day: '88.00' } })) })).toBe(true);
    expect(findAgentTool('rental.priceSnapshot')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.specKeywordPricePlan')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('rental.specKeywordPricePlan')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
        keyword: { type: 'string' },
        fields: { type: 'object' },
        resolutionMode: { type: 'string', enum: ['single', 'sameSkuGroup'] },
      },
      required: ['query', 'keyword', 'fields'],
      additionalProperties: false,
    });
    expect(validateAgentToolArguments('rental.specKeywordPricePlan', { query: 'ipod touch 6', keyword: '128g', fields: { rent1day: '99.00' }, resolutionMode: 'sameSkuGroup' })).toBe(true);
    expect(validateAgentToolArguments('rental.specKeywordPricePlan', { query: 'ipod touch 6', keyword: '128g', fields: { rent1day: '99.00' }, extra: true })).toBe(false);
    expect(findAgentTool('rental.priceSelectionPlan')).toMatchObject({ risk: 'write', requiresConfirmation: true });
    expect(findAgentTool('rental.priceSelectionPlan')?.inputSchema).toMatchObject({
      properties: {
        query: { type: 'string' },
        filters: { type: 'array', minItems: 1 },
        fields: { oneOf: expect.any(Array) },
        transform: { type: 'object' },
        resolutionMode: { type: 'string', enum: ['single', 'sameSkuGroup'] },
      },
      required: ['query', 'filters', 'fields', 'transform'],
      additionalProperties: false,
    });
    expect(validateAgentToolArguments('rental.priceSelectionPlan', {
      query: 'ipod touch 6',
      filters: [{ type: 'specTitleContains', value: '金色' }],
      fields: 'rent_fields',
      transform: { type: 'multiply', value: 1.1 },
      resolutionMode: 'sameSkuGroup',
    })).toBe(true);
    expect(validateAgentToolArguments('rental.priceSelectionPlan', {
      query: 'ipod touch 6',
      filters: [{ type: 'priceEquals', field: 'rent1day', value: '88.00' }],
      fields: ['rent1day'],
      transform: { type: 'set', value: '66.00' },
      resolutionMode: 'sameSkuGroup',
    })).toBe(true);
    expect(validateAgentToolArguments('rental.priceSelectionPlan', {
      query: 'ipod touch 6',
      filters: [{ type: 'priceEquals', value: '88.00' }],
      fields: ['rent1day'],
      transform: { type: 'set', value: '66.00' },
    })).toBe(false);
    expect(validateAgentToolArguments('rental.priceSelectionPlan', {
      query: 'ipod touch 6',
      filters: [{ type: 'specTitleContains', field: 'rent1day', value: '金色' }],
      fields: 'rent_fields',
      transform: { type: 'multiply', value: 1.1 },
    })).toBe(false);
    expect(validateAgentToolArguments('rental.priceSelectionPlan', {
      query: 'ipod touch 6',
      filters: [{ type: 'specTitleContains', value: '金色' }],
      fields: 'rent_fields',
      transform: { type: 'multiply', value: 1.1 },
      extra: true,
    })).toBe(false);
    expect(findAgentTool('rental.delistBatch')?.inputSchema).toMatchObject({
      properties: {
        productIds: { type: 'array' },
      },
      required: ['productIds'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.batchDelayedVerify')?.inputSchema).toMatchObject({
      properties: { stateFile: { type: 'string' } },
      required: ['stateFile'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.mirrorWritebackState')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      plannerVisible: false,
      inputSchema: {
        properties: { stateFile: { type: 'string' }, confirm: { type: 'boolean' } },
        required: ['stateFile', 'confirm'],
        additionalProperties: false,
      },
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
      required: ['taskId'],
      properties: {
        productId: { type: 'string', pattern: '^\\d+$' },
        taskId: { type: 'string', pattern: '^task_\\d+_[a-fA-F0-9]+$' },
      },
      additionalProperties: false,
    });
    expect(findAgentTool('rental.operationConfirmRequest')?.inputSchema).toMatchObject({
      required: ['action', 'productId'],
    });
    expect(findAgentTool('rental.perSpecPricePlan')?.inputSchema).toMatchObject({
      required: ['productId', 'specPrices'],
    });
    expect(findAgentTool('rental.perSpecPriceApply')?.inputSchema).toMatchObject({
      description: expect.stringContaining('Disabled execution placeholder'),
      required: ['productId'],
      additionalProperties: false,
    });
    expect(findAgentTool('rental.specDimPlan')?.inputSchema).toMatchObject({
      required: ['productId', 'action'],
    });
    expect(findAgentTool('rental.specDimApply')?.inputSchema).toMatchObject({
      required: ['productId', 'action'],
    });
  });
});
