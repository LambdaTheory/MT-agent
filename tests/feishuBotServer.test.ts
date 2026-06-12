import { describe, expect, it } from 'vitest';
import { extractTextMessage, startFeishuBotServer } from '../src/feishuBot/server.js';

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

  it('routes text event through intent handler and replies', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      handleIntent: async (intent) => ({ text: `handled:${intent.type}` }),
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
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
        body: JSON.stringify({ event: { message: { message_id: 'mid', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) } } }),
      });

      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(replies).toEqual([{ messageId: 'mid', text: 'handled:latest_summary' }]);
    } finally {
      server.close();
    }
  });
});
