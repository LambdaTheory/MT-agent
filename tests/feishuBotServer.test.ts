import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTextMessage, startFeishuBotServer } from '../src/feishuBot/server.js';
import type { FeishuBotIncomingTextMessage } from '../src/feishuBot/types.js';

const metric = {
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

async function writeLearningContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-learning-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [
      { productName: 'iPhone 15', platformProductId: 'p565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: 'Pocket 3', platformProductId: 'p566', displayProductId: '端内ID 566', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
    ],
    recommendedActions: [
      { identifier: '端内ID 565', action: '补曝光', reason: '曝光不足', priority: 'high' },
      { identifier: '端内ID 566', action: '提转化', reason: '访问多成交少', priority: 'high' },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    agentData: { removedLinks: [] },
    emptySectionNotes: {},
  }));
  return dir;
}

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

  it('returns an updated card for HTTP card action id lookup callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-empty-')),
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
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-id-card' },
            action: { value: { action: 'id_lookup' }, form_value: { lookup_query: '565' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('还没有找到公域日报上下文。');
      expect(JSON.stringify(card)).not.toContain('查询结果');
      expect(JSON.stringify(card)).not.toContain('"tag":"hr"');
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('routes HTTP operations learning feedback callbacks to the next question and persists feedback', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const outputDir = await writeLearningContext();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-start-learning', message_type: 'text', content: JSON.stringify({ text: '运营学习' }) } } }),
      });
      await replySent;

      let resolveFeedbackSent!: () => void;
      const feedbackSent = new Promise<void>((resolve) => {
        resolveFeedbackSent = resolve;
        resolveReplySent = resolveFeedbackSent;
      });
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-card' },
            operator: { open_id: 'ou_http_reviewer' },
            action: { value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'suggested_action', questionIndex: 1 }, form_value: { suggested_action: '继续放量' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await feedbackSent;
      expect(replies).toEqual([]);
      expect(cards).toHaveLength(2);
      expect(JSON.stringify(cards[1].card)).toContain('运营学习 loop 测验 2/2');
      await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('继续放量');
      await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_http_reviewer');
    } finally {
      server.close();
    }
  });

  it('rejects malformed HTTP operations learning feedback callbacks', async () => {
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
            context: { open_message_id: 'mid-http-loop-malformed' },
            action: { value: { action: 'operations_learning_feedback', productId: '565', feedback: 'reasonable' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([{ messageId: 'mid-http-loop-malformed', text: '运营学习反馈回调缺少必要字段。' }]);
    } finally {
      server.close();
    }
  });

  it('routes HTTP card action callbacks when Feishu returns callback value through behaviors', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const outputDir = await writeLearningContext();
    await writeFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), JSON.stringify({
      date: '2026-06-11',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      items: [
        { productId: '565', productName: 'iPhone 15', platformProductId: 'p565', score: 1, sourceModules: ['建议操作'], reasons: ['原因1'], recommendedOperation: '补曝光', metrics: { '1d': metric, '7d': metric, '30d': metric }, feedbackOptions: ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'] },
        { productId: '566', productName: 'Pocket 3', platformProductId: 'p566', score: 1, sourceModules: ['建议操作'], reasons: ['原因2'], recommendedOperation: '提转化', metrics: { '1d': metric, '7d': metric, '30d': metric }, feedbackOptions: ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'] },
      ],
      feedbacks: [],
      learnedSignals: { acceptedReasons: {}, rejectedReasons: {}, rejectedOperations: {}, nonRepresentativeProducts: [] },
    }));
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
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
            context: { open_message_id: 'mid-http-loop-behavior' },
            action: { behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.messageId).toBe('mid-http-loop-behavior');
      expect(JSON.stringify(cards[0]?.card)).toContain('运营学习 loop 测验 2/2');
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
