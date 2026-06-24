import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import {
  buildActivityPriceCallbackConfirmCard,
  parseActivityPriceCallbackConfirmRequest,
  type ActivityAutomationSkillClient,
} from '../src/feishuBot/activityAutomation.js';

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
        submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
        callbackProductIds: ['770', '800', '801'],
        lines: ['自动选品: 7', '活动时间填写: 7', '折扣填写: 28', '已映射端内ID: 7'],
      };
    },
  };
}

describe('differential pricing Feishu integration', () => {
  it('parses differential pricing card commands', () => {
    expect(parseBotIntent('差异化定价')).toEqual({ type: 'differential_pricing_card' });
    expect(parseBotIntent('配置差异化定价')).toEqual({ type: 'differential_pricing_card' });
  });

  it('returns a configuration card without executing the automation', async () => {
    const client = fakeClient();
    const response = await handleBotIntent({ type: 'differential_pricing_card' }, 'output', { activityAutomationClient: client });

    expect(client.executions).toHaveLength(0);
    expect(response.text).toContain('差异化定价');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('differential_pricing_form');
    expect(JSON.stringify(response.card)).toContain('starts_at');
    expect(JSON.stringify(response.card)).toContain('ends_at');
    expect(JSON.stringify(response.card)).toContain('discount_ss');
    expect(JSON.stringify(response.card)).toContain('activity_automation_confirm');
  });

  it('builds a callback confirmation card from the submit session summary', () => {
    const card = buildActivityPriceCallbackConfirmCard({
      submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
      productIds: ['770', '800', '801'],
      mappedCount: 3,
      startsAt: '2026-06-24',
      endsAt: '2026-06-30',
    });

    expect(JSON.stringify(card)).toContain('activity_price_callback_confirm');
    expect(JSON.stringify(card)).toContain('770');
    expect(JSON.stringify(card)).toContain('activity-submit-session.json');
  });

  it('parses the callback confirmation request from card action values', () => {
    expect(parseActivityPriceCallbackConfirmRequest({
      request: {
        submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
        productIds: ['770', '800'],
        mappedCount: 2,
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
      },
    })).toEqual({
      submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
      productIds: ['770', '800'],
      mappedCount: 2,
      startsAt: '2026-06-24',
      endsAt: '2026-06-30',
    });
  });
});
