import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';

describe('feishu bot closed-order intents', () => {
  it('parses explicit sync and observation commands', () => {
    expect(parseBotIntent('同步关单')).toEqual({ type: 'sync_closed_order_feedback' });
    expect(parseBotIntent('跑关单观察')).toEqual({ type: 'run_closed_order_observation_report' });
  });

  it('parses natural-language aliases for closed-order workflow', () => {
    expect(parseBotIntent('同步一下关单')).toEqual({ type: 'sync_closed_order_feedback' });
    expect(parseBotIntent('发个关单观察')).toEqual({ type: 'run_closed_order_observation_report' });
  });
});
