import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { clarificationConfirmationKey, loadClarificationContext } from '../src/feishuBot/clarificationStore.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { startFeishuBotServer } from '../src/feishuBot/server.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

function buttonValue(card: unknown, name: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === name);
  const value = button?.behaviors?.[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} value not found`);
  return value as Record<string, unknown>;
}

function blockedRentalClient(): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy() { throw new Error('copy should not run'); },
    async delist() { throw new Error('delist should not run before confirmation'); },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
  };
}

describe('tool-bound clarification E2E', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-clarify-toolbound-e2e-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('persists tool-bound LLM clarification candidates and resumes a selected write tool into confirmation', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        return JSON.stringify({
          goal: '澄清 648 操作',
          needsClarification: true,
          originalMessage: request.message,
          question: '你想怎么处理 648？',
          options: [
            {
              label: '查询 648',
              message: '查询 648 的表现',
              description: '只读查询',
              toolName: 'product.query',
              arguments: { keyword: '648' },
            },
            {
              label: '下架 648',
              message: '把 648 下架',
              description: '需要确认',
              toolName: 'rental.delist',
              arguments: { productId: '648' },
            },
            {
              label: '补充说明',
              message: '我想补充怎么处理 648',
              description: '文本兜底',
            },
          ],
          confidence: 0.4,
          reason: '动作不明确',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理编号六四八' }, outputDir, { agentPlannerProvider: planner });
    const selectValue = buttonValue(response.card, 'agent_clarify_select_2');
    const clarificationRef = String(selectValue.clarificationRef);
    const context = await loadClarificationContext(outputDir, clarificationRef);

    expect(context).toMatchObject({
      originalMessage: '帮我处理编号六四八',
      candidates: [
        { toolName: 'product.query', arguments: { keyword: '648' }, label: '查询 648' },
        { toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' },
        { toolName: 'agent.clarifiedMessage', arguments: { message: '我想补充怎么处理 648' }, label: '补充说明' },
      ],
    });
    expect(context?.candidates[1]?.toolName).not.toBe('agent.clarifiedMessage');

    const cards: Array<{ messageId: string; card: unknown }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => { throw new Error('tool-bound clarification must not replay text'); },
      replyText: async () => { throw new Error('write tool selection should return a confirmation card'); },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
      rentalPriceClient: blockedRentalClient(),
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string' || !context) throw new Error('Expected TCP server address and clarification context');

      const click = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-toolbound-clarify-e2e' },
            action: {
              name: 'agent_clarify_select_2',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'agent_clarify_select',
                  clarificationRef,
                  candidateIndex: 1,
                  confirmationKey: clarificationConfirmationKey(context),
                },
              }],
            },
          },
        }),
      });

      expect(click.status).toBe(200);
      const cardJson = JSON.stringify(cards[0]?.card);
      expect(cardJson).toContain('agent_tool_confirm');
      expect(cardJson).toContain('rental.delist');
      expect(cardJson).toContain('confirmationKey');
      expect(cards).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
