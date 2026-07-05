import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';

describe('intent parser keyword guessing', () => {
  it('does not turn report complaints into latest_summary just because they contain 日报', () => {
    expect(parseBotIntent('日报有问题')).toEqual({ type: 'unknown', text: '日报有问题' });
    expect(parseBotIntent('今天日报怎么这么差')).toEqual({ type: 'unknown', text: '今天日报怎么这么差' });
    expect(parseBotIntent('2026-06-22 日报怎么这么差')).toEqual({ type: 'unknown', text: '2026-06-22 日报怎么这么差' });
    expect(parseBotIntent('6月22日日报有问题')).toEqual({ type: 'unknown', text: '6月22日日报有问题' });
  });

  it('keeps explicit report summary queries deterministic', () => {
    expect(parseBotIntent('日报')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('看日报')).toEqual({ type: 'latest_summary' });
  });
});
