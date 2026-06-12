import { describe, expect, it, vi } from 'vitest';
import { createFeishuMessageDispatcher } from '../src/feishuBot/dispatcher.js';
import type { BotIntent } from '../src/feishuBot/types.js';

describe('createFeishuMessageDispatcher', () => {
  it('resolves intent and handles a text message', async () => {
    const intents: BotIntent[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: (text) => ({ type: text === '帮助' ? 'help' : 'unknown', text }),
      handleIntent: async (intent) => {
        intents.push(intent);
        return { text: `handled:${intent.type}` };
      },
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-1', text: '帮助', source: 'sdk' })).resolves.toEqual({ text: 'handled:help', skipped: false });
    expect(intents).toEqual([{ type: 'help' }]);
  });

  it('skips duplicate message ids in the current process', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-1', text: '今日概况', source: 'http' })).resolves.toEqual({ text: 'handled', skipped: false });
    await expect(dispatcher.dispatch({ messageId: 'mid-1', text: '今日概况', source: 'http' })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('returns a user-visible failure response when handling throws', async () => {
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent: async () => {
        throw new Error('report context missing');
      },
      logError: () => undefined,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-2', text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: '处理失败：report context missing', skipped: false });
  });

  it('supports the default rule resolver when no resolver is injected', async () => {
    const dispatcher = createFeishuMessageDispatcher({
      handleIntent: async (intent) => ({ text: intent.type }),
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-3', text: '查询 565', source: 'sdk' })).resolves.toEqual({ text: 'query_product', skipped: false });
  });
});
