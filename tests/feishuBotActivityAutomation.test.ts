import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { ActivityAutomationSkillClient } from '../src/feishuBot/activityAutomation.js';

function fakeClient(): ActivityAutomationSkillClient & { executions: unknown[] } {
  return {
    executions: [],
    async execute(request) {
      this.executions.push(request);
      return {
        ok: true,
        request,
        selectedCount: 7,
        pagesVisited: 3,
        dateFilledCount: 7,
        discountFilledCount: 28,
        mappedCount: 7,
        unmappedCount: 0,
        productPickSessionPath: 'output/latest/activity-automation/activity-product-pick-session.json',
        lines: ['鑷姩閫夊搧: 7', '娲诲姩鏃堕棿濉啓: 7', '鎶樻墸濉啓: 28', '宸叉槧灏勭鍐匢D: 7'],
      };
    },
  };
}

describe('differential pricing Feishu integration', () => {
  it('parses differential pricing card commands', () => {
    expect(parseBotIntent('\u5dee\u5f02\u5316\u5b9a\u4ef7')).toEqual({ type: 'differential_pricing_card' });
    expect(parseBotIntent('\u914d\u7f6e\u5dee\u5f02\u5316\u5b9a\u4ef7')).toEqual({ type: 'differential_pricing_card' });
  });

  it('returns a configuration card without executing the automation', async () => {
    const client = fakeClient();
    const response = await handleBotIntent({ type: 'differential_pricing_card' }, 'output', { activityAutomationClient: client });
    const cardJson = JSON.stringify(response.card);

    expect(client.executions).toHaveLength(0);
    expect(response.text).toContain('\u5dee\u5f02\u5316\u5b9a\u4ef7');
    expect(response.card).toBeDefined();
    expect(cardJson).toContain('differential_pricing_form');
    expect(cardJson).toContain('starts_at');
    expect(cardJson).toContain('ends_at');
    expect(cardJson).toContain('discount_ss');
    expect(cardJson).toContain('activity_automation_confirm');
    expect(cardJson).toContain('"tag":"date_picker"');
    expect(cardJson).toContain('"name":"starts_at"');
    expect(cardJson).toContain('"name":"ends_at"');
  });
});
