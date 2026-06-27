import { describe, expect, it } from 'vitest';
import { validateAgentMultiStepPlannerProposal, validateAgentPlannerClarificationProposal, validateAgentPlannerProposal, validateAgentToolArguments } from '../src/agentRuntime/planner.js';
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

  it('rejects malformed JSON and unknown tools', () => {
    expect(validateAgentPlannerProposal('不是 JSON')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(validateAgentPlannerProposal('{"goal":"删除全部","selectedTool":"danger.deleteAll","arguments":{},"confidence":0.99,"reason":"bad"}')).toEqual({ ok: false, reason: 'unknown_tool' });
  });

  it('rejects all planner-hidden tools even when they exist in the internal registry', () => {
    const hiddenTools = listAgentTools().filter((tool) => tool.plannerVisible === false);
    expect(hiddenTools.map((tool) => tool.name)).toEqual(['operations.refreshActivityExecute', 'rental.priceApply', 'rental.operationConfirmRequest']);

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
      goal: 'bad item shape',
      selectedTool: 'rental.newLinkBatchPlan',
      arguments: { items: [{ count: 5, sourceProductId: '900' }] },
      confidence: 0.9,
      reason: 'missing keyword',
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

  it('gates dashboard refresh write proposals behind confirmation and does not execute tools', () => {
    expect(validateAgentPlannerProposal('{"goal":"补抓访问页数据","selectedTool":"publicTraffic.refreshDashboard","arguments":{},"confidence":0.91,"reason":"用户要求抓取访问页数据","requiresConfirmation":false}')).toEqual({
      ok: true,
      proposal: {
        goal: '补抓访问页数据',
        selectedTool: 'publicTraffic.refreshDashboard',
        arguments: {},
        confidence: 0.91,
        reason: '用户要求抓取访问页数据',
        requiresConfirmation: false,
      },
      policy: {
        decision: 'confirmation_required',
        toolName: 'publicTraffic.refreshDashboard',
        risk: 'write',
        proposal: { toolName: 'publicTraffic.refreshDashboard', input: {}, reason: '用户要求抓取访问页数据' },
      },
    });
  });

  it('validates multi-step plans and keeps write steps gated by policy', () => {
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
        {
          decision: 'confirmation_required',
          toolName: 'publicTraffic.pushLatestReportToGroup',
          risk: 'write',
          proposal: { toolName: 'publicTraffic.pushLatestReportToGroup', input: {}, reason: '再推送日报到群' },
        },
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
