import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { continueAgentPlannerSteps } from '../src/feishuBot/agentToolContinuation.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { inferPriceAdjustmentAmountFromText } from '../src/feishuBot/priceAdjustment.js';
import { inferPriceMultiplierFromText } from '../src/feishuBot/priceMultiplier.js';
import type { RentalPriceChangeRequest, RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('agent price percent decrease handling', () => {
  it('treats relative percent decrease as a multiplier, not an amount delta', () => {
    expect(inferPriceAdjustmentAmountFromText('acepro2这个组整体价格下调20%')).toBeNull();
    expect(inferPriceMultiplierFromText('acepro2这个组整体价格下调20%')).toBe(0.8);
    expect(inferPriceMultiplierFromText('acepro2这个组整体价格上调20%')).toBe(1.2);
    expect(inferPriceMultiplierFromText('acepro2这个组整体价格80%')).toBe(0.8);
  });

  it('fills missing discount for a 19-product group percent decrease before validation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-price-percent-decrease-'));
    const productIds = ['626', '627', '628', '629', '630', '808', '809', '810', '811', '812', '864', '865', '866', '867', '868', '869', '870', '871', '872'];
    const preview = vi.fn(async (request: RentalPriceChangeRequest) => ({
      productId: request.productId,
      fields: { rent1day: '80.00' },
      lines: ['preview ok'],
      warnings: [],
      audit: { taskId: `task_${request.productId}`, rollbackFile: `rollback_${request.productId}.json`, hasErrors: false },
    }));
    const rentalPriceClient = {
      preview,
      async execute() { throw new Error('execute should not run before confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    } as unknown as RentalPriceSkillClient;

    const response = await continueAgentPlannerSteps({
      goal: '对 acepro2 同款组执行整体下调20%的租金改价预览',
      reason: '用户明确指向同款组名称且为整体降价20%',
      steps: [
        {
          toolName: 'rental.pricePreview',
          arguments: { productIds },
          reason: '对解析出的 Ace Pro 2 商品生成批量租金字段改价预览',
        },
      ],
      baseIndex: 0,
      totalSteps: 1,
      metadataStore: {},
      textParts: ['Agent 多步骤计划：对 acepro2 同款组执行整体下调20%的租金改价预览'],
      sourceText: 'acepro2这个组整体价格下调20%',
      outputDir,
      options: { rentalPriceClient },
    });

    expect(preview).toHaveBeenCalledTimes(19);
    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '626', discount: 0.8, scope: 'rent_fields' });
    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '872', discount: 0.8, scope: 'rent_fields' });
    expect(response?.text).toContain('步骤 1/1：rental.pricePreview');
    expect(response?.text).toContain('折扣：80%');
    expect(response?.card).toBeDefined();
    expect(JSON.stringify(response?.card)).toContain('rental.priceApply');
  });

  it('asks for clarification when percent wording is wrongly mapped to an amount adjustment', async () => {
    const productIds = ['626', '627'];
    const preview = vi.fn();

    const response = await continueAgentPlannerSteps({
      goal: '对 acepro2 同款组执行整体下调20%的租金改价预览',
      reason: '用户明确要求按比例下调20%',
      steps: [
        {
          toolName: 'rental.pricePreview',
          arguments: { productIds, adjustmentAmount: -20 },
          reason: '对解析出的商品生成改价预览',
        },
      ],
      baseIndex: 0,
      totalSteps: 1,
      metadataStore: {},
      textParts: ['Agent 多步骤计划：对 acepro2 同款组执行整体下调20%的租金改价预览'],
      sourceText: 'acepro2这个组整体价格下调20%',
      outputDir: 'output',
      options: { rentalPriceClient: { preview } as unknown as RentalPriceSkillClient },
    });

    expect(preview).not.toHaveBeenCalled();
    expect(response?.text).toContain('价格调整语义需要确认');
    expect(JSON.stringify(response?.card)).toContain('agent_clarification_form');
    expect(JSON.stringify(response?.card)).toContain('按比例');
    expect(JSON.stringify(response?.card)).toContain('按金额');
  });

  it('asks for clarification when planned discount conflicts with percent wording', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-direct-price-percent-conflict-'));
    const preview = vi.fn();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '对 626 执行下调20%的改价预览',
          selectedTool: 'rental.pricePreview',
          arguments: { productIds: ['626'], discount: 0.2, scope: 'rent_fields' },
          confidence: 0.9,
          reason: '用户要求下调20%',
          requiresConfirmation: true,
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '626整体价格下调20%' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient: { preview } as unknown as RentalPriceSkillClient,
    });

    expect(preview).not.toHaveBeenCalled();
    expect(response.text).toContain('价格调整语义需要确认');
    expect(JSON.stringify(response.card)).toContain('agent_clarification_form');
  });

  it('asks for clarification when a directional price number has no unit', async () => {
    const preview = vi.fn();

    const response = await continueAgentPlannerSteps({
      goal: '对 acepro2 同款组执行整体下调20的租金改价预览',
      reason: '用户只说下调20，单位不清楚',
      steps: [
        {
          toolName: 'rental.pricePreview',
          arguments: { productIds: ['626', '627'] },
          reason: '对解析出的商品生成改价预览',
        },
      ],
      baseIndex: 0,
      totalSteps: 1,
      metadataStore: {},
      textParts: ['Agent 多步骤计划：对 acepro2 同款组执行整体下调20的租金改价预览'],
      sourceText: 'acepro2这个组整体价格下调20',
      outputDir: 'output',
      options: { rentalPriceClient: { preview } as unknown as RentalPriceSkillClient },
    });

    expect(preview).not.toHaveBeenCalled();
    expect(response?.text).toContain('价格调整语义需要确认');
    expect(JSON.stringify(response?.card)).toContain('按比例');
    expect(JSON.stringify(response?.card)).toContain('按金额');
  });

  it('turns invalid single-tool planner arguments into a clarification card', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '查询日报数据',
          selectedTool: 'publicTraffic.reportQuery',
          arguments: {},
          confidence: 0.86,
          reason: '缺少 target 等必填参数',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我查一下日报里的情况' }, 'output', {
      agentPlannerProvider: planner,
    });

    expect(response.text).toContain('工具参数不完整或格式不安全');
    expect(JSON.stringify(response.card)).toContain('agent_clarification_form');
    expect(JSON.stringify(response.card)).toContain('publicTraffic.reportQuery');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
  });

  it('turns invalid multi-step planner arguments into a clarification card', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '铺设新链',
          steps: [
            { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'sx70' }, reason: '先找最佳链接' },
            { toolName: 'rental.newLinkBatchPlan', arguments: {}, reason: '缺少 keyword/count/sourceProductId' },
          ],
          confidence: 0.88,
          reason: '第二步缺少工具必填参数',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我补 sx70 新链' }, 'output', {
      agentPlannerProvider: planner,
    });

    expect(response.text).toContain('参数不完整或格式不安全');
    expect(JSON.stringify(response.card)).toContain('agent_clarification_form');
    expect(JSON.stringify(response.card)).toContain('rental.newLinkBatchPlan');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
  });
});
