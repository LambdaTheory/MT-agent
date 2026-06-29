import { describe, expect, it, vi } from 'vitest';
import type { AgentRequest } from '../src/agentRuntime/types.js';
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

  it('maps a Feishu message to a runtime request', async () => {
    const requests: AgentRequest[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      runtime: {
        async handle(request) {
          requests.push(request);
          return { text: `runtime:${request.text}` };
        },
      },
    });

    await expect(dispatcher.dispatch({
      messageId: 'mid-runtime-request',
      text: '@_user_1 @_user_2 今日概况',
      source: 'sdk',
      chatId: 'oc_group',
      chatType: 'group',
      senderOpenId: 'ou_sender',
      mentions: [
        { key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事' },
        { key: '@_user_2', id: { open_id: 'ou_bot' }, name: 'MT Agent' },
      ],
    })).resolves.toEqual({ text: 'runtime:@_user_1 今日概况', skipped: false });
    expect(requests).toEqual([{ source: 'feishu', text: '@_user_1 今日概况', actor: { id: 'ou_sender' }, channel: { id: 'oc_group', type: 'group' }, metadata: { messageId: 'mid-runtime-request', transport: 'sdk' } }]);
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

  it('uses Agent-first resolving when a planner is configured', async () => {
    const intents: BotIntent[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      agentPlannerProvider: { async proposePlan() { return '{}'; } },
      handleIntent: async (intent) => {
        intents.push(intent);
        return { text: intent.type };
      },
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-agent-first-resolver', text: '查询 565', source: 'sdk' })).resolves.toEqual({ text: 'unknown', skipped: false });
    expect(intents).toEqual([{ type: 'unknown', text: '查询 565' }]);
  });

  it('keeps exact management commands deterministic even when a planner is configured', async () => {
    const intents: BotIntent[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      agentPlannerProvider: { async proposePlan() { return '{}'; } },
      handleIntent: async (intent) => {
        intents.push(intent);
        return { text: intent.type };
      },
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-agent-first-exact-link-maintenance', text: '链接维护', source: 'sdk' })).resolves.toEqual({ text: 'link_registry_maintenance_prompt', skipped: false });
    expect(intents).toEqual([{ type: 'link_registry_maintenance_prompt' }]);
  });

  it('skips group messages that do not mention the bot', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-group-no-mention', text: '今日概况', source: 'sdk', chatType: 'group', mentions: [] })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('skips group messages with mentions when the bot identity is not configured', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-group-mention-without-bot-identity', text: '@_user_1 今日概况', source: 'sdk', chatType: 'group', mentions: [{ key: '@_user_1' }] })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('handles group messages that include the configured bot mention', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionName: 'MT Agent',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent,
    });

    await expect(dispatcher.dispatch({ messageId: 'mid-group-with-mention', text: '@_user_1 今日概况', source: 'sdk', chatType: 'group', mentions: [{ key: '@_user_1', name: 'MT Agent' }] })).resolves.toEqual({ text: 'handled', skipped: false });
    expect(texts).toEqual(['今日概况']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('strips visible bot mention names when Feishu does not provide a mention key', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionName: '公域数据日报',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'unknown', text };
      },
      handleIntent,
    });

    await expect(dispatcher.dispatch({
      messageId: 'mid-group-visible-bot-name',
      text: '@公域数据日报 acepro2有多少条链接',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ name: '公域数据日报' }],
    })).resolves.toEqual({ text: 'handled', skipped: false });
    expect(texts).toEqual(['acepro2有多少条链接']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('skips group messages that mention someone other than the configured bot', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    await expect(dispatcher.dispatch({
      messageId: 'mid-group-mentions-human',
      text: '@_user_1 今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事' }],
    })).resolves.toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('handles group messages that mention the configured bot and strips only bot mention keys', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent,
    });

    await expect(dispatcher.dispatch({
      messageId: 'mid-group-mentions-bot',
      text: '@_user_1 @_user_2 今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [
        { key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事' },
        { key: '@_user_2', id: { open_id: 'ou_bot' }, name: 'MT Agent' },
      ],
    })).resolves.toEqual({ text: 'handled', skipped: false });
    expect(texts).toEqual(['@_user_1 今日概况']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });
});
