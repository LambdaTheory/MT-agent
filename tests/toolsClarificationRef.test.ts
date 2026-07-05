import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { loadClarificationContext } from '../src/feishuBot/clarificationStore.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

function buttonValue(card: unknown, name: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === name);
  const value = button?.behaviors?.[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} value not found`);
  return value as Record<string, unknown>;
}

describe('tools clarification reference cards', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-tools-clarify-ref-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('persists planner clarification candidates and emits a signed ref card', async () => {
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
          ],
          confidence: 0.4,
          reason: '动作不明确',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理 648' }, outputDir, { agentPlannerProvider: planner });
    const selectValue = buttonValue(response.card, 'agent_clarify_select_1');
    const raw = JSON.stringify(response.card);

    expect(selectValue).toMatchObject({ action: 'agent_clarify_select', candidateIndex: 0, confirmationKey: expect.any(String) });
    expect(selectValue.clarificationRef).toMatch(/^clarify_\d+_[a-f0-9]+$/);
    expect(raw).not.toContain('selectedMessage');
    expect(raw).not.toContain('把 648 下架');

    const loaded = await loadClarificationContext(outputDir, String(selectValue.clarificationRef));
    expect(loaded).toMatchObject({
      originalMessage: '帮我处理 648',
      question: '你想怎么处理 648？',
      depth: 1,
      confidence: 0.4,
      candidates: [
        { toolName: 'product.query', arguments: { keyword: '648' }, label: '查询 648' },
        { toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' },
      ],
    });
  });
});
