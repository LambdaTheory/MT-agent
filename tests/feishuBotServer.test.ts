import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTextMessage, startFeishuBotServer } from '../src/feishuBot/server.js';
import type { FeishuBotIncomingTextMessage } from '../src/feishuBot/types.js';

describe('extractTextMessage', () => {
  it('extracts Feishu text content', () => {
    expect(extractTextMessage({ event: { message: { message_id: 'mid', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) } } } as any)).toEqual({ messageId: 'mid', text: '今日概况' });
  });

  it('ignores non-text messages', () => {
    expect(extractTextMessage({ event: { message: { message_id: 'mid', message_type: 'image', content: '{}' } } } as any)).toBeNull();
  });
});

describe('startFeishuBotServer', () => {
  it('responds to Feishu URL verification challenge', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url_verification', challenge: 'challenge-value', token: 'token' }),
      });

      await expect(response.json()).resolves.toEqual({ challenge: 'challenge-value' });
    } finally {
      server.close();
    }
  });

  it('does not treat encrypt key as request signature secret for url verification', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', encryptKey: 'encrypt-key' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url_verification', challenge: 'challenge-value', token: 'token' }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ challenge: 'challenge-value' });
    } finally {
      server.close();
    }
  });

  it('routes text event through dispatcher and replies', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const messages: FeishuBotIncomingTextMessage[] = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async (message) => {
        messages.push(message);
        return { text: `handled:${message.text}`, skipped: false };
      },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-route', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) }, sender: { sender_id: { open_id: 'ou_1' } } } }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(messages).toEqual([{ messageId: 'mid-http-route', text: '今日概况', source: 'http', chatId: 'chat', senderOpenId: 'ou_1' }]);
      expect(replies).toEqual([{ messageId: 'mid-http-route', text: 'handled:今日概况' }]);
    } finally {
      server.close();
    }
  });

  it('replies with an interactive card when dispatcher returns a card', async () => {
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const card = { schema: '2.0', body: { elements: [] } };
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: 'card fallback', card, skipped: false }),
      replyCard: async ({ messageId }, payload) => {
        cards.push({ messageId, card: payload });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyText: async () => {
        throw new Error('replyText should not be called for card responses');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-card', message_type: 'text', content: JSON.stringify({ text: '商品ID互查' }) } } }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(cards).toEqual([{ messageId: 'mid-http-card', card }]);
    } finally {
      server.close();
    }
  });

  it('routes HTTP card action id lookup callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-empty-')),
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-id-card' },
            action: { value: { action: 'id_lookup' }, form_value: { lookup_query: '565' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([{ messageId: 'mid-http-id-card', text: '还没有找到公域日报上下文。' }]);
    } finally {
      server.close();
    }
  });

  it('routes HTTP operations learning feedback callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-card' },
            action: { value: { action: 'operations_learning_feedback', productId: '565', feedback: 'good' }, form_value: { suggested_action: '继续放量' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([{ messageId: 'mid-http-loop-card', text: '已收到运营学习反馈：565 good。建议：继续放量' }]);
    } finally {
      server.close();
    }
  });

  it('does not reply when dispatcher skips a duplicate message', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    let resolveDispatchCalled!: () => void;
    const dispatchCalled = new Promise<void>((resolve) => {
      resolveDispatchCalled = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => {
        resolveDispatchCalled();
        return { text: '', skipped: true };
      },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        throw new Error('replyText should not be called for skipped messages');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-skip', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) } } }),
      });

      expect(response.status).toBe(200);
      await dispatchCalled;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });
});
