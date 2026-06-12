import { describe, expect, it, vi } from 'vitest';
import { createFeishuMessageDispatcher, MAX_SEEN_MESSAGE_IDS } from '../src/feishuBot/dispatcher.js';
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

    await expect(dispatcher.dispatch({ messageId: 'mid-help', text: '帮助', source: 'sdk' })).resolves.toEqual({ text: 'handled:help', skipped: false });
    expect(intents).toEqual([{ type: 'help' }]);
  });

  it('skips duplicate message ids in the current process', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-duplicate-single-instance', text: '今日概况', source: 'http' })).resolves.toEqual({ text: 'handled', skipped: false });
    await expect(dispatcher.dispatch({ messageId: 'mid-duplicate-single-instance', text: '今日概况', source: 'http' })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate message ids across dispatcher instances in the current process', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const firstDispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });
    const secondDispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(firstDispatcher.dispatch({ messageId: 'mid-duplicate-process', text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: 'handled', skipped: false });
    await expect(secondDispatcher.dispatch({ messageId: 'mid-duplicate-process', text: '今日概况', source: 'http' })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('evicts old message ids after the process-local dedupe window is full', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-evict-oldest', text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: 'handled', skipped: false });
    for (let index = 0; index < MAX_SEEN_MESSAGE_IDS; index += 1) {
      await expect(dispatcher.dispatch({ messageId: `mid-evict-filler-${index}`, text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: 'handled', skipped: false });
    }
    await expect(dispatcher.dispatch({ messageId: 'mid-evict-oldest', text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: 'handled', skipped: false });
    expect(handleIntent).toHaveBeenCalledTimes(MAX_SEEN_MESSAGE_IDS + 2);
  });

  it('returns a user-visible failure response when handling throws', async () => {
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent: async () => {
        throw new Error('report context missing');
      },
      logError: () => undefined,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-error', text: '今日概况', source: 'sdk' })).resolves.toEqual({ text: '处理失败：report context missing', skipped: false });
  });

  it('supports the default rule resolver when no resolver is injected', async () => {
    const dispatcher = createFeishuMessageDispatcher({
      handleIntent: async (intent) => ({ text: intent.type }),
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-default-resolver', text: '查询 565', source: 'sdk' })).resolves.toEqual({ text: 'query_product', skipped: false });
  });
});
