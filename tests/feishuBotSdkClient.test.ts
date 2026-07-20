import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeishuSdkBot, extractSdkTextMessage } from '../src/feishuBot/sdkClient.js';
import { createFeishuMessageDispatcher } from '../src/feishuBot/dispatcher.js';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';
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

async function writeContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-agent-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [{ productName: 'iPhone 15', platformProductId: 'p565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [{ identifier: '端内ID 565', action: '补曝光', reason: '曝光不足', priority: 'high' }],
    newProductPoolItems: [],
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
    emptySectionNotes: {},
  }));
  return dir;
}

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
    const logs: string[] = [];

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
      logInfo: (message) => logs.push(message),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    expect(starts).toHaveLength(1);
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-reply', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(dispatched).toEqual([{ messageId: 'mid-sdk-reply', text: '帮助', source: 'sdk', chatId: 'chat', senderOpenId: undefined, metadata: { messageIdClaimed: true } }]);
    expect(sent).toEqual([
      { path: { message_id: 'mid-sdk-reply' }, data: { content: JSON.stringify({ text: 'reply:帮助' }), msg_type: 'text' } },
    ]);
    expect(logs.map((item) => JSON.parse(item))).toEqual([
      expect.objectContaining({ level: 'info', component: 'feishu-bot', event: 'message.received', messageId: 'mid-sdk-reply', chatType: 'unknown', textPreview: '帮助', textLength: 2 }),
      expect.objectContaining({ level: 'info', component: 'feishu-bot', event: 'message.dispatch.completed', messageId: 'mid-sdk-reply', skipped: false, hasCard: false, elapsedMs: expect.any(Number) }),
      expect.objectContaining({ level: 'info', component: 'feishu-bot', event: 'message.reply.completed', messageId: 'mid-sdk-reply', replyType: 'text', elapsedMs: expect.any(Number) }),
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

  it('passes a pre-claimed SDK message through a custom dispatcher delegate', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const delegate = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'help' }),
      handleIntent: async () => ({ text: 'delegated reply' }),
    });

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
      dispatchMessage: (message) => delegate.dispatch(message),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-custom-delegate', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(JSON.stringify(sent)).toContain('delegated reply');
  });

  it('does not send a second rental price progress card for a repeated SDK message id', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const dispatched: FeishuBotIncomingTextMessage[] = [];

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
      dispatchMessage: async (message) => {
        dispatched.push(message);
        return { text: 'final', skipped: false };
      },
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    const event = {
      message: { message_id: 'mid-sdk-rental-progress-duplicate', message_type: 'text', content: JSON.stringify({ text: '761改价-15元' }) },
    };
    await registered['im.message.receive_v1'](event);
    const sentAfterFirstDelivery = sent.length;
    await registered['im.message.receive_v1'](event);

    expect(dispatched).toHaveLength(1);
    expect(sentAfterFirstDelivery).toBeGreaterThan(0);
    expect(sent).toHaveLength(sentAfterFirstDelivery);
    expect(JSON.stringify(sent)).toContain('租赁改价预览处理中');
  });

  it('patches rental price progress card to a failed final result when preview blocks without a card', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];

    class FakeClient {
      im = { v1: { message: {
        reply: async (request: unknown) => {
          sent.push({ kind: 'reply', request });
          return JSON.stringify(request).includes('租赁改价预览处理中') ? { data: { message_id: 'om-progress-card' } } : { data: { message_id: 'om-final-reply' } };
        },
        patch: async (request: unknown) => sent.push({ kind: 'patch', request }),
      } } };
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
      dispatchMessage: async () => ({
        text: '价格选择改价预览：ipod touch 6商品组\n\n阻断项：\n商品 653：读取失败，请检查本地租赁价服务日志。',
        skipped: false,
        metadata: { toolName: 'rental.priceSelectionPlan', ok: false },
      }),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-rental-progress-blocked', message_type: 'text', content: JSON.stringify({ text: '761改价-15元' }) },
    });

    expect(sent[0]).toMatchObject({ kind: 'reply' });
    expect(JSON.stringify(sent[0])).toContain('租赁改价预览处理中');
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-progress-card' } } });
    expect(JSON.stringify(sent[1])).toContain('Agent 操作失败');
    expect(JSON.stringify(sent[1])).toContain('商品 653：读取失败');
    expect(JSON.stringify(sent)).not.toContain('om-final-reply');
  });

  it('does not send rental price progress before spec-keyword clarification', async () => {
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
      dispatchMessage: async () => ({
        text: '需要澄清',
        skipped: false,
        card: { schema: '2.0', header: { title: { tag: 'plain_text', content: 'Agent 需要确认你的意图' }, template: 'blue' }, body: { elements: [] } },
      }),
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-spec-keyword-clarify', message_type: 'text', content: JSON.stringify({ text: '改价,sx70商品组的所有含有平日字样的规格,所有租期-5元' }) },
    });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).toContain('Agent 需要确认你的意图');
    expect(JSON.stringify(sent)).not.toContain('租赁改价预览处理中');
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

  it('redacts default SDK reply error logs', async () => {
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const replyError = new Error('Request failed with status code 400') as Error & {
      response: { status: number; data: unknown };
      config: { method: string; url: string; headers: unknown; data: string };
    };
    replyError.response = { status: 400, data: { code: 230099, msg: 'bad card' } };
    replyError.config = {
      method: 'post',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages/mid-sdk-redact/reply',
      headers: { Authorization: 'Bearer secret-token' },
      data: '{"content":"large card payload"}',
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

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

    try {
      const bot = createFeishuSdkBot({
        appId: 'app',
        appSecret: 'secret',
        dispatchMessage: async () => ({ text: 'fallback text', skipped: false }),
        sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
      });

      bot.start();
      await registered['im.message.receive_v1']({
        message: { message_id: 'mid-sdk-redact', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
      });

      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines.length).toBeGreaterThan(0);
      expect(JSON.parse(lines[0])).toMatchObject({
        level: 'error',
        component: 'feishu-bot',
        event: 'message.error',
        messageId: 'mid-sdk-redact',
        phase: 'reply',
        error: {
          name: 'Error',
          message: 'Request failed with status code 400',
          httpStatus: 400,
          method: 'post',
        },
      });
      expect(lines.join('\n')).not.toContain('secret-token');
      expect(lines.join('\n')).not.toContain('large card payload');
      expect(lines.join('\n')).not.toContain('Authorization');
    } finally {
      logged.mockRestore();
    }
  });

  it('uses configured LLM selector through the default SDK dispatcher for read-only replies', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const selector: LlmToolSelectionProvider = {
      async selectTool(request) {
        expect(request.message).toBe('帮我看看苹果手机');
        return '{"intent":"product_lookup","tool":"query_product_performance","arguments":{"keyword":"iPhone"},"confidence":0.93,"reason":"product name"}';
      },
    };

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
      outputDir,
      llmToolSelector: selector,
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-sdk-llm-agent', message_type: 'text', content: JSON.stringify({ text: '帮我看看苹果手机' }) },
    });

    expect(JSON.stringify(sent)).toContain('端内ID 565｜商品ID p565');
    expect(JSON.stringify(sent)).toContain('iPhone 15');
  });

  it('keeps product-modifying exact SDK text commands planner-first but opens operations learning locally', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const plannerMessages: string[] = [];
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerMessages.push(request.message);
        expect(request.workflows).toEqual([]);
        if (request.message === '复制商品 761') {
          return JSON.stringify({
            goal: '复制商品 761',
            selectedTool: 'rental.copy',
            arguments: { productId: '761' },
            confidence: 0.96,
            reason: '用户要求复制商品，必须确认',
          });
        }
        throw new Error(`unexpected planner message: ${request.message}`);
      },
    };

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
      outputDir,
      agentPlannerProvider: planner,
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    for (const [index, text] of ['运营学习', '复制商品 761'].entries()) {
      await registered['im.message.receive_v1']({
        message: { message_id: `mid-sdk-planner-first-${index}`, message_type: 'text', content: JSON.stringify({ text }) },
      });
    }

    const contents = sent.map((item) => JSON.parse((item as { data: { content: string } }).data.content));
    expect(plannerMessages).toEqual(['复制商品 761']);
    expect(sent.map((item) => (item as { data: { msg_type: string } }).data.msg_type)).toEqual(['interactive', 'interactive']);
    expect(JSON.stringify(contents[0])).toContain('运营学习 loop 测验');
    expect(JSON.stringify(contents[1])).toContain('rental.copy');
    expect(JSON.stringify(contents[1])).toContain('agent_tool_confirm');
  });
});
