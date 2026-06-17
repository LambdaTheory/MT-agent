import { describe, expect, it } from 'vitest';
import { parseLlmIntentProposal } from '../src/feishuBot/llmIntentProposal.js';
import { parseLlmToolSelection } from '../src/feishuBot/llmProvider.js';

describe('parseLlmToolSelection', () => {
  it('parses valid JSON tool selection', () => {
    expect(parseLlmToolSelection('{"intent":"query_latest_summary","tool":"get_latest_summary","arguments":{},"confidence":0.9,"reason":"概况"}')).toEqual({
      ok: true,
      selection: { intent: 'query_latest_summary', tool: 'get_latest_summary', arguments: {}, confidence: 0.9, reason: '概况' },
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseLlmToolSelection('不是 JSON')).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects missing required fields', () => {
    expect(parseLlmToolSelection('{"tool":"get_latest_summary"}')).toEqual({ ok: false, reason: 'invalid_shape' });
  });

  it('rejects side-effect tools', () => {
    expect(parseLlmToolSelection('{"intent":"run_report","tool":"run_report","arguments":{},"confidence":0.99,"reason":"用户要求跑日报"}')).toEqual({ ok: false, reason: 'unsafe_tool' });
  });
});

describe('parseLlmIntentProposal', () => {
  it('parses valid rental delist proposals into a BotIntent', () => {
    expect(parseLlmIntentProposal('{"intent":"rental_delist","arguments":{"productId":"761"},"confidence":0.92,"reason":"用户要求下架"}')).toEqual({
      ok: true,
      proposal: { intent: { type: 'rental_delist', productId: '761' }, confidence: 0.92, reason: '用户要求下架' },
    });
  });

  it('normalizes rental price proposal fields', () => {
    expect(parseLlmIntentProposal('{"intent":"rental_price_change","arguments":{"productId":761,"fields":{"rent1day":22,"rent10day":"55","script":"evil"}},"confidence":0.96,"reason":"改租金"}')).toEqual({
      ok: true,
      proposal: {
        intent: { type: 'rental_price_change', productId: '761', request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00', rent10day: '55.00' } } },
        confidence: 0.96,
        reason: '改租金',
      },
    });
  });

  it('normalizes tenancy days from Chinese units and separators', () => {
    expect(parseLlmIntentProposal('{"intent":"rental_tenancy_set","arguments":{"productId":"761","days":"1天、10天、30天"},"confidence":0.91,"reason":"设置租期"}')).toEqual({
      ok: true,
      proposal: { intent: { type: 'rental_tenancy_set', productId: '761', days: '1,10,30' }, confidence: 0.91, reason: '设置租期' },
    });
  });

  it('rejects unsafe intent names and invalid arguments', () => {
    expect(parseLlmIntentProposal('{"intent":"delete_everything","arguments":{"productId":"761"},"confidence":0.99,"reason":"bad"}')).toEqual({ ok: false, reason: 'unsafe_intent' });
    expect(parseLlmIntentProposal('{"intent":"rental_delist","arguments":{"productId":"abc"},"confidence":0.99,"reason":"bad"}')).toEqual({ ok: false, reason: 'invalid_arguments' });
    expect(parseLlmIntentProposal('{"intent":"rental_price_change","arguments":{"productId":"761","fields":{"script":"evil"}},"confidence":0.99,"reason":"bad"}')).toEqual({ ok: false, reason: 'invalid_arguments' });
  });
});
