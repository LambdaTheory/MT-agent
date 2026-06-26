import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeishuSdkBot, extractSdkTextMessage } from '../src/feishuBot/sdkClient.js';
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

    expect(JSON.stringify(sent)).toContain('端内ID 565 iPhone 15');
  });

  it('routes legacy exact SDK text commands through the Agent planner when configured', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const plannerMessages: string[] = [];
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerMessages.push(request.message);
        expect(request.workflows).toEqual([]);
        if (request.message === '跑日报') {
          return JSON.stringify({
            goal: '生成公域日报',
            selectedTool: 'publicTraffic.runReport',
            arguments: {},
            confidence: 0.95,
            reason: '用户要求跑日报，写操作必须确认',
          });
        }
        if (request.message === '运营学习') {
          return JSON.stringify({
            goal: '开始运营学习测验',
            selectedTool: 'operationsLearning.startQuiz',
            arguments: {},
            confidence: 0.93,
            reason: '用户要求开始运营学习',
          });
        }
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
    for (const [index, text] of ['跑日报', '运营学习', '复制商品 761'].entries()) {
      await registered['im.message.receive_v1']({
        message: { message_id: `mid-sdk-planner-first-${index}`, message_type: 'text', content: JSON.stringify({ text }) },
      });
    }

    const contents = sent.map((item) => JSON.parse((item as { data: { content: string } }).data.content));
    expect(plannerMessages).toEqual(['跑日报', '运营学习', '复制商品 761']);
    expect(sent.map((item) => (item as { data: { msg_type: string } }).data.msg_type)).toEqual(['interactive', 'interactive', 'interactive']);
    expect(JSON.stringify(contents[0])).toContain('publicTraffic.runReport');
    expect(JSON.stringify(contents[0])).toContain('agent_tool_confirm');
    expect(JSON.stringify(contents[0])).not.toContain('公域日报已生成');
    expect(JSON.stringify(contents[1])).toContain('运营学习 loop 测验');
    expect(JSON.stringify(contents[2])).toContain('rental.copy');
    expect(JSON.stringify(contents[2])).toContain('agent_tool_confirm');
  });
});
