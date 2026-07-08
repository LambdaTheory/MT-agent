import { describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

describe('tools unknown decline', () => {
  it('declines when planner-first routing cannot resolve an executable or clarifiable intent', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({ goal: '无法理解', selectedTool: 'missing.tool', arguments: {}, confidence: 0.1, reason: '没有匹配工具' });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '这个情况你看着办吧' }, 'output', { agentPlannerProvider: planner });

    expect(response.text).toContain('我没理解你的意图');
    expect(response.metadata).toMatchObject({ ok: false, declined: true });
    expect(response.card).toBeUndefined();
  });

  it('declines unresolved text without guessing a read-only fallback', async () => {
    const response = await handleBotIntent({ type: 'unknown', text: '这个情况你看着办吧' }, 'output');

    expect(response.text).toContain('我没理解你的意图');
    expect(response.metadata).toMatchObject({ ok: false, declined: true });
    expect(response.card).toBeUndefined();
  });

  it('declines ambiguous read-only and write-like text instead of using broad keyword guesses', async () => {
    await expect(handleBotIntent({ type: 'unknown', text: '今天怎么样' }, 'output')).resolves.toMatchObject({ metadata: { ok: false, declined: true } });
    await expect(handleBotIntent({ type: 'unknown', text: '帮我下架' }, 'output')).resolves.toMatchObject({ metadata: { ok: false, declined: true } });
    await expect(handleBotIntent({ type: 'unknown', text: '订单有问题' }, 'output')).resolves.toMatchObject({ metadata: { ok: false, declined: true } });
  });
});
