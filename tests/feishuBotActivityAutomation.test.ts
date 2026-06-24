import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import {
  buildActivityAutomationCard,
  buildActivityPriceCallbackConfirmCard,
  parseActivityAutomationConfirmRequest,
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
    const cardJson = JSON.stringify(response.card);

    expect(client.executions).toHaveLength(0);
    expect(response.text).toContain('差异化定价');
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

  it('builds date picker fields without unsupported label properties', () => {
    const card = buildActivityAutomationCard();
    const form = (card.body as { elements: Array<{ tag?: string; elements?: Array<Record<string, unknown>> }> }).elements
      .find((element) => element.tag === 'form');
    const datePickers = form?.elements?.filter((element) => element.tag === 'date_picker') ?? [];

    expect(datePickers).toHaveLength(2);
    for (const picker of datePickers) {
      expect(picker).not.toHaveProperty('label');
      expect(picker).not.toHaveProperty('label_position');
    }
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

  it('parses date picker objects and falls back to default discounts when unchanged', () => {
    expect(parseActivityAutomationConfirmRequest({
      starts_at: { date: '2026-06-24' },
      ends_at: { date: '2026-06-30' },
    })).toEqual({
      startsAt: '2026-06-24',
      endsAt: '2026-06-30',
      discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
    });
  });

  it('parses explicit discounts alongside object-shaped date picker values', () => {
    expect(parseActivityAutomationConfirmRequest({
      starts_at: { value: '2026-06-24' },
      ends_at: { date: '2026-06-30' },
      discount_ss: '8.1',
      discount_s: '8.8',
      discount_a: '9.1',
      discount_b: '9.6',
    })).toEqual({
      startsAt: '2026-06-24',
      endsAt: '2026-06-30',
      discounts: { SS: '8.1', S: '8.8', A: '9.1', B: '9.6' },
    });
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
