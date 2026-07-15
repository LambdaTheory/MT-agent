import { describe, expect, it } from 'vitest';
import { schemaAllowsArguments, validateAgentMultiStepPlannerProposal, validateAgentPlannerClarificationProposal, validateAgentPlannerProposal, validateAgentToolArguments } from '../src/agentRuntime/planner.js';
import { listAgentTools } from '../src/agentRuntime/toolRegistry.js';

describe('agent runtime planner proposal validation', () => {
  it('validates a read-tool proposal and applies allow policy', () => {
    expect(validateAgentPlannerProposal('{"goal":"查询商品表现","selectedTool":"product.query","arguments":{"keyword":"565"},"confidence":0.88,"reason":"用户询问商品 565"}')).toEqual({
      ok: true,
      proposal: {
        goal: '查询商品表现',
        selectedTool: 'product.query',
        arguments: { keyword: '565' },
        confidence: 0.88,
        reason: '用户询问商品 565',
      },
      policy: { decision: 'allow', toolName: 'product.query', risk: 'read' },
    });
  });

  it('validates explicit report date arguments for read tools', () => {
    expect(validateAgentPlannerProposal('{"goal":"查询指定日期商品表现","selectedTool":"product.query","arguments":{"keyword":"733","date":"2026-06-10"},"confidence":0.91,"reason":"用户指定日期和商品"}')).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'product.query',
        arguments: { keyword: '733', date: '2026-06-10' },
      },
      policy: { decision: 'allow', toolName: 'product.query', risk: 'read' },
    });
  });

  it('validates generic report query arguments for read-only report questions', () => {
    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '查询指定日期访问最高商品',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'products',
        date: '2026-06-22',
        period: '7d',
        metrics: ['publicVisits', 'amount'],
        sortBy: 'publicVisits',
        limit: 20,
      },
      confidence: 0.92,
      reason: '用户在问日报明细排序',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'products', date: '2026-06-22', period: '7d' },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad report query metric',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: { target: 'products', metrics: ['unknownMetric'] },
      confidence: 0.8,
      reason: 'invalid metric should be rejected',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'compare weekly conversion rate',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'dateComparison',
        period: '7d',
        compareWith: 'previousPeriod',
        metrics: ['exposureVisitRate', 'visitCreatedOrderRate', 'visitShipmentRate'],
      },
      confidence: 0.9,
      reason: 'user asks to compare this week with last week',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'dateComparison', period: '7d', compareWith: 'previousPeriod' },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '查询商品全量日报数据',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: { target: 'productDetail', productQuery: '733' },
      confidence: 0.9,
      reason: '用户要指定商品的完整日报指标',
    }))).toMatchObject({ ok: true, policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' } });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '统计7日访问总和',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'productAggregation',
        period: '7d',
        metrics: ['publicVisits'],
        aggregation: 'sum',
      },
      confidence: 0.9,
      reason: '用户要对日报商品明细做聚合统计',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'productAggregation', period: '7d', aggregation: 'sum' },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '查询短日期访问量',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'summary',
        date: '26.6.18',
        metrics: ['publicVisits'],
      },
      confidence: 0.9,
      reason: '用户用短日期询问指定日报访问量',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'summary', date: '26.6.18', metrics: ['publicVisits'] },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad aggregation',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: { target: 'productAggregation', aggregation: 'median' },
      confidence: 0.8,
      reason: 'invalid aggregation should be rejected',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '查询访问页缺失商品',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'sourceCoverage',
        period: '7d',
        source: 'dashboard',
        coverageStatus: 'missing',
      },
      confidence: 0.9,
      reason: '用户要查看日报商品行的数据源覆盖状态',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'sourceCoverage', period: '7d', source: 'dashboard', coverageStatus: 'missing' },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad source',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: { target: 'sourceCoverage', source: 'visitPage' },
      confidence: 0.8,
      reason: 'invalid source should be rejected',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: '查询关单率是否达标',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: {
        target: 'orderDerived',
        orderDerivedMetric: 'closeRateStatus',
      },
      confidence: 0.9,
      reason: '用户要查看订单分析衍生经营指标',
    }))).toMatchObject({
      ok: true,
      proposal: {
        selectedTool: 'publicTraffic.reportQuery',
        arguments: { target: 'orderDerived', orderDerivedMetric: 'closeRateStatus' },
      },
      policy: { decision: 'allow', toolName: 'publicTraffic.reportQuery', risk: 'read' },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad derived metric',
      selectedTool: 'publicTraffic.reportQuery',
      arguments: { target: 'orderDerived', orderDerivedMetric: 'gmv' },
      confidence: 0.8,
      reason: 'invalid derived metric should be rejected',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('rejects malformed JSON and unknown tools', () => {
    expect(validateAgentPlannerProposal('不是 JSON')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(validateAgentPlannerProposal('{"goal":"删除全部","selectedTool":"danger.deleteAll","arguments":{},"confidence":0.99,"reason":"bad"}')).toEqual({ ok: false, reason: 'unknown_tool' });
  });

  it('rejects all planner-hidden tools even when they exist in the internal registry', () => {
    const hiddenTools = listAgentTools().filter((tool) => tool.plannerVisible === false);
    expect(hiddenTools.map((tool) => tool.name)).toEqual(['operations.refreshActivityExecute', 'rental.mirrorWritebackState', 'rental.imageRead', 'rental.imageUpload', 'rental.imagePick', 'rental.imageOrder', 'rental.whiteImageSet', 'rental.imageVerify', 'rental.vasRead', 'rental.vasCatalogRead', 'rental.vasApply', 'rental.vasVerify', 'rental.bulkPriceApply', 'rental.priceApply', 'rental.operationConfirmRequest', 'rental.perSpecPriceApply', 'rental.specDimApply']);
    expect(listAgentTools().filter((tool) => /image/i.test(tool.name) && tool.plannerVisible !== false)).toEqual([]);

    for (const tool of hiddenTools) {
      expect(validateAgentPlannerProposal(JSON.stringify({
        goal: `direct ${tool.name}`,
        selectedTool: tool.name,
        arguments: {},
        confidence: 0.9,
        reason: 'planner must not call hidden tools directly',
      }))).toEqual({ ok: false, reason: 'unknown_tool' });

      expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
        goal: `multi-step ${tool.name}`,
        steps: [
          { toolName: 'system.help', arguments: {}, reason: 'read first' },
          { toolName: tool.name, arguments: {}, reason: 'hidden tool step' },
        ],
        confidence: 0.9,
        reason: 'planner must not call hidden tools through multi-step plans',
      }))).toEqual({ ok: false, reason: 'unknown_tool' });
    }
  });

  it('rejects arguments that do not satisfy tool metadata schema', () => {
    expect(validateAgentPlannerProposal('{"goal":"查询商品表现","selectedTool":"product.query","arguments":{},"confidence":0.88,"reason":"缺少 keyword"}')).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateAgentPlannerProposal('{"goal":"查询商品表现","selectedTool":"product.query","arguments":{"keyword":"565","extra":true},"confidence":0.88,"reason":"多余字段"}')).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('enforces oneOf and not keywords in local tool schema validation', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { required: ['taskId'] },
        { required: ['rollbackFile'] },
      ],
      not: { required: ['discount', 'adjustmentAmount'] },
      properties: {
        taskId: { type: 'string' },
        rollbackFile: { type: 'string' },
        discount: { type: 'number' },
        adjustmentAmount: { type: 'number' },
      },
      additionalProperties: false,
    };

    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd' })).toBe(true);
    expect(schemaAllowsArguments(schema, { rollbackFile: 'output/rental/rollback.json' })).toBe(true);
    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd', rollbackFile: 'output/rental/rollback.json' })).toBe(false);
    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd', discount: 0.8, adjustmentAmount: -1 })).toBe(false);
  });

  it('recursively validates planner array item schemas for multi-product tools', () => {
    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'multi source new links',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: {
        items: [
          { keyword: 'wide 300', count: 5, sourceProductId: '900' },
          { keyword: 'wide 400', count: '5', sourceProductId: '901' },
        ],
      },
      confidence: 0.9,
      reason: 'valid structured items',
    }))).toMatchObject({ ok: true });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad item array',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { items: ['wide 300'] },
      confidence: 0.9,
      reason: 'array item is not an object',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'source id item shape',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { items: [{ count: 5, sourceProductId: '900' }] },
      confidence: 0.9,
      reason: 'explicit source id is enough for new-link copy planning',
    }))).toMatchObject({ ok: true });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad item shape',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { items: [{ count: 5 }] },
      confidence: 0.9,
      reason: 'missing keyword and sourceProductId',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad top-level count shape',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { keyword: 'wide 300', count: ['5'] },
      confidence: 0.9,
      reason: 'count must be a positive integer or numeric string',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad item count shape',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { items: [{ keyword: 'wide 300', count: 0, sourceProductId: '900' }] },
      confidence: 0.9,
      reason: 'count must be positive',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'batch delist explicit ids',
      selectedTool: 'rental.delistBatch',
      arguments: { productIds: ['251', '467', '252'] },
      confidence: 0.9,
      reason: 'user provided explicit internal ids to delist',
      requiresConfirmation: true,
    }))).toMatchObject({ ok: true });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'batch delist missing ids',
      selectedTool: 'rental.delistBatch',
      arguments: {},
      confidence: 0.9,
      reason: 'missing productIds',
      requiresConfirmation: true,
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('recursively validates hidden execution tool arguments before confirmation execution', () => {
    expect(validateAgentToolArguments('operations.refreshActivityExecute', {
      date: '2026-06-27',
      delistProductIds: ['433'],
      newLinkItems: [
        { keyword: 'wide 300', count: 1, sourceProductId: '900', sourceProductName: 'Wide 300' },
      ],
    })).toBe(true);

    expect(validateAgentToolArguments('operations.refreshActivityExecute', {
      date: '2026-06-27',
      delistProductIds: ['433'],
      newLinkItems: [{ keyword: 'wide 300', count: 1, sourceProductId: '900' }],
    })).toBe(false);

    expect(validateAgentToolArguments('operations.refreshActivityExecute', {
      date: '2026-06-27',
      delistProductIds: ['433'],
      newLinkItems: ['bad'],
    })).toBe(false);

    expect(validateAgentToolArguments('operations.refreshActivityExecute', {
      date: '2026-06-27',
      delistProductIds: ['433'],
      newLinkItems: [
        { keyword: 'wide 300', count: 1.5, sourceProductId: '900', sourceProductName: 'Wide 300' },
      ],
    })).toBe(false);
  });

  it('requires confirmation for dashboard refresh', () => {
    expect(validateAgentPlannerProposal('{"goal":"补抓访问页数据","selectedTool":"publicTraffic.refreshDashboard","arguments":{},"confidence":0.91,"reason":"用户要求抓取访问页数据","requiresConfirmation":true}')).toEqual({
      ok: true,
      proposal: {
        goal: '补抓访问页数据',
        selectedTool: 'publicTraffic.refreshDashboard',
        arguments: {},
        confidence: 0.91,
        reason: '用户要求抓取访问页数据',
        requiresConfirmation: true,
      },
      policy: {
        decision: 'confirmation_required',
        toolName: 'publicTraffic.refreshDashboard',
        risk: 'write',
        proposal: {
          toolName: 'publicTraffic.refreshDashboard',
          input: {},
          reason: '用户要求抓取访问页数据',
        },
      },
    });
  });

  it('validates multi-step plans and allows non-product write steps', () => {
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: '先看日报再推送到群',
      steps: [
        { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先读取最新日报概况' },
        { toolName: 'publicTraffic.pushLatestReportToGroup', arguments: {}, reason: '再推送日报到群' },
      ],
      confidence: 0.86,
      reason: '用户要求先查询再执行推送',
    }))).toEqual({
      ok: true,
      proposal: {
        goal: '先看日报再推送到群',
        steps: [
          { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先读取最新日报概况' },
          { toolName: 'publicTraffic.pushLatestReportToGroup', arguments: {}, reason: '再推送日报到群' },
        ],
        confidence: 0.86,
        reason: '用户要求先查询再执行推送',
      },
      policies: [
        { decision: 'allow', toolName: 'publicTraffic.latestSummary', risk: 'read' },
        { decision: 'allow', toolName: 'publicTraffic.pushLatestReportToGroup', risk: 'write' },
      ],
    });
  });

  it('validates multi-step plans with step ids and placeholder arguments', () => {
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: 'rank then plan new links',
      steps: [
        { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: 'rank same sku links' },
        { toolName: 'rental.newLinkBatchPlan', arguments: { keyword: 'SQ1', count: 5, sourceProductId: '${rank.bestProductId}' }, reason: 'plan copy from ranked source' },
      ],
      confidence: 0.9,
      reason: 'the second step safely uses metadata from the first step',
    }))).toMatchObject({
      ok: true,
      proposal: {
        steps: [
          { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' } },
          { toolName: 'rental.newLinkBatchPlan', arguments: { sourceProductId: '${rank.bestProductId}' } },
        ],
      },
      policies: [
        { decision: 'allow', toolName: 'product.rankBestSameSku', risk: 'read' },
        { decision: 'confirmation_required', toolName: 'rental.newLinkBatchPlan', risk: 'high' },
      ],
    });
  });

  it('rejects multi-step placeholders that do not reference prior steps', () => {
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: 'unknown reference',
      steps: [
        { id: 'summary', toolName: 'publicTraffic.latestSummary', arguments: {}, reason: 'read summary' },
        { toolName: 'rental.copy', arguments: { productId: '${rank.bestProductId}' }, reason: 'unknown step id' },
      ],
      confidence: 0.8,
      reason: 'bad reference',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: 'future reference',
      steps: [
        { toolName: 'rental.copy', arguments: { productId: '${rank.bestProductId}' }, reason: 'future step id' },
        { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: 'rank too late' },
      ],
      confidence: 0.8,
      reason: 'bad reference',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });

    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: 'self reference',
      steps: [
        { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: '${rank.query}' }, reason: 'self reference' },
        { toolName: 'system.help', arguments: {}, reason: 'second step' },
      ],
      confidence: 0.8,
      reason: 'bad reference',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('allows placeholders in non-string fields only for multi-step pre-validation', () => {
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({
      goal: 'rank then price preview',
      steps: [
        { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: 'rank source' },
        { toolName: 'rental.priceChange', arguments: { productId: '${rank.bestProductId}', fields: '${rank.priceFields}' }, reason: 'preview price fields from prior metadata' },
      ],
      confidence: 0.8,
      reason: 'object field is resolved later by the executor',
    }))).toMatchObject({
      ok: true,
      proposal: {
        steps: [
          { id: 'rank', toolName: 'product.rankBestSameSku' },
          { toolName: 'rental.priceChange', arguments: { fields: '${rank.priceFields}' } },
        ],
      },
    });

    expect(validateAgentPlannerProposal(JSON.stringify({
      goal: 'bad atomic placeholder',
      selectedTool: 'rental.priceChange',
      arguments: { productId: '761', fields: '${rank.priceFields}' },
      confidence: 0.8,
      reason: 'atomic plans cannot use unresolved placeholders',
    }))).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('rejects invalid multi-step plans', () => {
    expect(validateAgentMultiStepPlannerProposal('{"goal":"bad","steps":[{"toolName":"product.query","arguments":{},"reason":"missing keyword"},{"toolName":"system.help","arguments":{},"reason":"help"}],"confidence":0.7,"reason":"bad"}')).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(validateAgentMultiStepPlannerProposal('{"goal":"bad","steps":[{"toolName":"missing.tool","arguments":{},"reason":"bad"},{"toolName":"system.help","arguments":{},"reason":"help"}],"confidence":0.7,"reason":"bad"}')).toEqual({ ok: false, reason: 'unknown_tool' });
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({ goal: 'bad', steps: [{ id: '1bad', toolName: 'system.help', arguments: {}, reason: 'bad id' }, { toolName: 'system.help', arguments: {}, reason: 'help' }], confidence: 0.7, reason: 'bad' }))).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({ goal: 'bad', steps: [{ id: 'last', toolName: 'system.help', arguments: {}, reason: 'reserved id' }, { toolName: 'system.help', arguments: {}, reason: 'help' }], confidence: 0.7, reason: 'bad' }))).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({ goal: 'bad', steps: [{ id: 'steps', toolName: 'system.help', arguments: {}, reason: 'reserved id' }, { toolName: 'system.help', arguments: {}, reason: 'help' }], confidence: 0.7, reason: 'bad' }))).toEqual({ ok: false, reason: 'invalid_shape' });
    expect(validateAgentMultiStepPlannerProposal(JSON.stringify({ goal: 'bad', steps: [{ id: 'dup', toolName: 'system.help', arguments: {}, reason: 'first' }, { id: 'dup', toolName: 'system.help', arguments: {}, reason: 'second' }], confidence: 0.7, reason: 'bad' }))).toEqual({ ok: false, reason: 'invalid_shape' });
  });

  it('validates clarification proposals for ambiguous goals', () => {
    expect(validateAgentPlannerClarificationProposal(JSON.stringify({
      goal: '澄清 pocket3 操作',
      needsClarification: true,
      originalMessage: '帮我处理一下 pocket3',
      question: '你想怎么处理 pocket3？',
      options: [
        { label: '查询数据', message: '查询 pocket3 的公域数据', description: '只读查询' },
        { label: '铺新链', message: '帮我铺十条 pocket3 的新链', description: '需要确认后复制' },
      ],
      confidence: 0.42,
      reason: '处理动作不明确',
    }))).toEqual({
      ok: true,
      proposal: {
        goal: '澄清 pocket3 操作',
        originalMessage: '帮我处理一下 pocket3',
        question: '你想怎么处理 pocket3？',
        options: [
          { label: '查询数据', message: '查询 pocket3 的公域数据', description: '只读查询' },
          { label: '铺新链', message: '帮我铺十条 pocket3 的新链', description: '需要确认后复制' },
        ],
        candidates: [
          { toolName: 'agent.clarifiedMessage', arguments: { message: '查询 pocket3 的公域数据' }, label: '查询数据', description: '只读查询' },
          { toolName: 'agent.clarifiedMessage', arguments: { message: '帮我铺十条 pocket3 的新链' }, label: '铺新链', description: '需要确认后复制' },
        ],
        confidence: 0.42,
        reason: '处理动作不明确',
      },
    });
  });

  it('rejects malformed clarification proposals', () => {
    expect(validateAgentPlannerClarificationProposal('{"goal":"bad","needsClarification":true,"originalMessage":"x","question":"q","options":[{"label":"only","message":"x"}],"confidence":0.5,"reason":"bad"}')).toEqual({ ok: false, reason: 'invalid_options' });
    expect(validateAgentPlannerClarificationProposal('{"goal":"bad","needsClarification":false,"originalMessage":"x","question":"q","options":[],"confidence":0.5,"reason":"bad"}')).toEqual({ ok: false, reason: 'invalid_shape' });
  });
});
