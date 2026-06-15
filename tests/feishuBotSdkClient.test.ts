import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot, extractSdkTextMessage } from '../src/feishuBot/sdkClient.js';
import type { FeishuBotIncomingTextMessage } from '../src/feishuBot/types.js';

describe('extractSdkTextMessage', () => {
  it('extracts text messages from SDK event data', () => {
    expect(
      extractSdkTextMessage({
        message: { message_id: 'mid-sdk-extract', chat_id: 'chat', chat_type: 'group', message_type: 'text', content: JSON.stringify({ text: '@_user_1 帮助' }), mentions: [{ key: '@_user_1' }] },
        sender: { sender_id: { open_id: 'ou_1' } },
      }),
    ).toEqual({
      messageId: 'mid-sdk-extract',
      text: '@_user_1 帮助',
      source: 'sdk',
      chatId: 'chat',
      chatType: 'group',
      senderOpenId: 'ou_1',
      mentions: [{ key: '@_user_1' }],
    });
  });

  it('ignores non-text SDK messages', () => {
    expect(extractSdkTextMessage({ message: { message_id: 'mid-sdk-image', message_type: 'image', content: '{}' } })).toBeNull();
  });
});

describe('createFeishuSdkBot', () => {
  it('registers receive message handler and replies through SDK API', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const starts: unknown[] = [];
    const sent: unknown[] = [];
    const dispatched: FeishuBotIncomingTextMessage[] = [];

    class FakeClient {
      im = { v1: { message: { reply: async (request: unknown) => sent.push(request) } } };
    }

    class FakeWSClient {
      start(config: unknown) {
        starts.push(config);
      }
    }

    class FakeEventDispatcher {
      register(handlers: Record<string, (data: unknown) => Promise<void>>) {
        Object.assign(registered, handlers);
        return this;
      }
    }

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async (message) => {
        dispatched.push(message);
        return { text: `reply:${message.text}`, skipped: false };
      },
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    expect(starts).toHaveLength(1);
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-reply', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(dispatched).toEqual([{ messageId: 'mid-sdk-reply', text: '帮助', source: 'sdk', chatId: 'chat', senderOpenId: undefined }]);
    expect(sent).toEqual([
      { path: { message_id: 'mid-sdk-reply' }, data: { content: JSON.stringify({ text: 'reply:帮助' }), msg_type: 'text' } },
    ]);
  });

  it('does not reply when dispatcher skips a duplicate SDK message', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];

    class FakeClient {
      im = { v1: { message: { reply: async (request: unknown) => sent.push(request) } } };
    }

    class FakeWSClient {
      start() {
        return undefined;
      }
    }

    class FakeEventDispatcher {
      register(handlers: Record<string, (data: unknown) => Promise<void>>) {
        Object.assign(registered, handlers);
        return this;
      }
    }

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: '', skipped: true }),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-skip', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(sent).toEqual([]);
  });

  it('logs rejected SDK replies without rejecting the event handler', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const replyError = new Error('reply failed');
    const logged: unknown[] = [];

    class FakeClient {
      im = { v1: { message: { reply: async () => Promise.reject(replyError) } } };
    }

    class FakeWSClient {
      start() {
        return undefined;
      }
    }

    class FakeEventDispatcher {
      register(handlers: Record<string, (data: unknown) => Promise<void>>) {
        Object.assign(registered, handlers);
        return this;
      }
    }

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: 'reply', skipped: false }),
      logError: (error, context) => logged.push({ error, context }),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await expect(
      registered['im.message.receive_v1']({
        message: { message_id: 'mid-sdk-reply-fails', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
      }),
    ).resolves.toBeUndefined();

    expect(logged).toEqual([{ error: replyError, context: { messageId: 'mid-sdk-reply-fails', phase: 'reply' } }]);
  });
});
