import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';

describe('createFeishuSdkBot card reply', () => {
  function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<void>>) {
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
    return { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher };
  }

  it('replies with an interactive card when the dispatch result carries a card payload', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const card = { config: { wide_screen_mode: true }, elements: [{ tag: 'div', text: { tag: 'plain_text', content: 'hi' } }] };

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: 'fallback', card, skipped: false }),
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-card', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '运营学习' }) },
    });

    expect(sent).toEqual([
      { path: { message_id: 'mid-card' }, data: { content: JSON.stringify(card), msg_type: 'interactive' } },
    ]);
  });

  it('still replies with text when no card is present', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: 'plain reply', skipped: false }),
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-text', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(sent).toEqual([
      { path: { message_id: 'mid-text' }, data: { content: JSON.stringify({ text: 'plain reply' }), msg_type: 'text' } },
    ]);
  });
});
