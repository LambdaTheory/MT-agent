import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { MAX_CLARIFY_DEPTH } from '../src/agentRuntime/intentResolution.js';
import { loadClarificationContext } from '../src/feishuBot/clarificationStore.js';
import { executeOrConfirmAgentToolRequest, handleBotIntent } from '../src/feishuBot/tools.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function buttonValue(card: unknown, name: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === name);
  const value = button?.behaviors?.[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} value not found`);
  return value as Record<string, unknown>;
}

describe('tools confidence gate', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-tools-confidence-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('turns a low-confidence single-tool planner proposal into a clarification card', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.delist',
          arguments: { productId: '648' },
          confidence: 0.4,
          reason: '可能是下架，但用户表达不够明确',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run before clarification'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理 648' }, outputDir, { agentPlannerProvider: planner, rentalPriceClient });
    const selectValue = buttonValue(response.card, 'agent_clarify_select_1');

    expect(response.text).toContain('需要你确认');
    expect(JSON.stringify(response.card)).toContain('agent_clarify_select');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
    const loaded = await loadClarificationContext(outputDir, String(selectValue.clarificationRef));
    expect(loaded).toMatchObject({
      originalMessage: '帮我处理 648',
      confidence: 0.4,
      candidates: [{ toolName: 'rental.delist', arguments: { productId: '648' }, label: '执行 rental.delist' }],
    });
  });

  it('uses an injected confidence threshold when gating single-tool planner proposals', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.delist',
          arguments: { productId: '648' },
          confidence: 0.75,
          reason: '配置要求更高置信度才执行',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run before clarification'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理 648' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      confidenceExecuteThreshold: 0.8,
    });

    expect(response.text).toContain('需要你确认');
    expect(JSON.stringify(response.card)).toContain('agent_clarify_select');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
  });

  it('declines instead of issuing another clarification after the max clarification depth', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.delist',
          arguments: { productId: '648' },
          confidence: 0.4,
          reason: '补充后仍然不确定',
          requiresConfirmation: true,
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '补充说明：还是帮我处理 648' }, outputDir, {
      agentPlannerProvider: planner,
      clarificationDepth: MAX_CLARIFY_DEPTH,
    });

    expect(response.text).toContain('我还是没法确定你的意图');
    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ ok: false, declined: true, clarificationDepth: MAX_CLARIFY_DEPTH });
  });

  it('keeps invalid-argument clarification fallback buttons aligned with stored candidates', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.delist',
          arguments: {},
          confidence: 0.8,
          reason: '缺少商品 ID',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我下架' }, outputDir, { agentPlannerProvider: planner });
    const supplementValue = buttonValue(response.card, 'agent_clarify_select_1');
    const replanValue = buttonValue(response.card, 'agent_clarify_select_2');
    const loaded = await loadClarificationContext(outputDir, String(supplementValue.clarificationRef));

    expect(replanValue.candidateIndex).toBe(1);
    expect(loaded?.candidates).toMatchObject([
      { toolName: 'rental.delist', label: '补充参数' },
      { toolName: 'agent.clarifiedMessage', arguments: { message: '帮我下架' }, label: '重新规划' },
    ]);
  });

  it('propagates prior clarification depth into argument-review clarification cards', async () => {
    const response = await executeOrConfirmAgentToolRequest({
      toolName: 'rental.pricePreview',
      arguments: { productIds: ['648'] },
      reason: '商品 648 下调 10',
    }, outputDir, { clarificationDepth: MAX_CLARIFY_DEPTH - 1 });
    const selectValue = buttonValue(response.card, 'agent_clarify_select_1');
    const loaded = await loadClarificationContext(outputDir, String(selectValue.clarificationRef));

    expect(response.text).toContain('价格调整语义需要确认');
    expect(loaded?.depth).toBe(MAX_CLARIFY_DEPTH);
  });

  it('declines argument-review clarification after the max clarification depth', async () => {
    const response = await executeOrConfirmAgentToolRequest({
      toolName: 'rental.pricePreview',
      arguments: { productIds: ['648'] },
      reason: '商品 648 下调 10',
    }, outputDir, { clarificationDepth: MAX_CLARIFY_DEPTH });

    expect(response.text).toContain('我还是没法确定你的意图');
    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ ok: false, declined: true, clarificationDepth: MAX_CLARIFY_DEPTH });
  });
});
