import { describe, expect, it } from 'vitest';
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
