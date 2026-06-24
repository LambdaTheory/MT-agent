import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import type { ActivityAutomationSkillClient } from '../src/feishuBot/activityAutomation.js';

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

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<unknown>>) {
  class FakeClient {
    im = { v1: { message: { reply: async (request: unknown) => sent.push({ kind: 'reply', request }), patch: async (request: unknown) => sent.push({ kind: 'patch', request }) } } };
  }
  class FakeWSClient {
    start() {
      return undefined;
    }
  }
  class FakeEventDispatcher {
    register(handlers: Record<string, (data: unknown) => Promise<unknown>>) {
      Object.assign(registered, handlers);
      return this;
    }
  }
  return { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher };
}

function fakeActivityAutomationClient() {
  const client: ActivityAutomationSkillClient & { executions: unknown[] } = {
    executions: [],
    async execute(request) {
      client.executions.push(request);
      return {
        ok: true,
        request,
        selectedCount: 7,
        pagesVisited: 3,
        dateFilledCount: 7,
        discountFilledCount: 28,
        mappedCount: 7,
        unmappedCount: 0,
        productPickSessionPath: 'output/latest/activity-automation/activity-product-pick-session.json',
        submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
        callbackProductIds: ['770', '800', '801'],
        lines: ['自动选品: 7', '活动时间填写: 7', '折扣填写: 28', '已映射端内ID: 7'],
      };
    },
  };
  return client;
}

async function writeContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-card-action-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [{ productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
  }));
  return dir;
}

async function writeLearningContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-card-action-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  const rows = [629, 630].map((id) => ({ productName: `商品${id}`, platformProductId: `p${id}`, displayProductId: `端内ID ${id}`, custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }));
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows,
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [
      { identifier: '端内ID 629', action: '检查价格', reason: '建议操作池', priority: 'high' },
      { identifier: '端内ID 630', action: '继续放量', reason: '建议操作池', priority: 'medium' },
    ],
    emptySectionNotes: {},
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
  }));
  return dir;
}

async function seedLearningSession(outputDir: string): Promise<void> {
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
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
}

describe('createFeishuSdkBot card.action.trigger', () => {
  it('returns a replacement status card when cancelling an Agent clarification and suppresses duplicate text replies', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const event = {
      event: {
        context: { open_message_id: 'om-agent-clarify-cancel' },
        operator: { open_id: 'ou_cancel' },
        action: {
          tag: 'button',
          name: 'agent_clarify_cancel',
          behaviors: [{ type: 'callback', value: { action: 'agent_clarify_cancel', originalMessage: '抓取访问页数据' } }],
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-agent-clarify-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('returns a replacement status card when cancelling an Agent tool confirmation and suppresses duplicate text replies', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const event = {
      event: {
        context: { open_message_id: 'om-agent-tool-cancel' },
        operator: { open_id: 'ou_cancel' },
        action: {
          tag: 'button',
          name: 'agent_tool_cancel_submit',
          behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', toolName: 'publicTraffic.runReport' } }],
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-agent-tool-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('patches a price callback confirmation card after differential pricing automation completes', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation' },
        action: {
          tag: 'button',
          value: { action: 'activity_automation_confirm' },
          form_value: {
            starts_at: '2026-06-23',
            ends_at: '2026-06-30',
            discount_ss: '8.5',
            discount_s: '9.0',
            discount_a: '9.5',
            discount_b: '9.8',
          },
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-23',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation' } } });
    expect(JSON.stringify(sent[0])).toContain('处理中');
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
    expect(JSON.stringify(sent[1])).toContain('activity-submit-session.json');
    expect(JSON.stringify(sent[1])).toContain('770');
  });

  it('accepts date picker objects and omitted default discounts for differential pricing automation', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-defaults' },
        action: {
          tag: 'button',
          value: { action: 'activity_automation_confirm' },
          form_value: {
            starts_at: { date: '2026-06-24' },
            ends_at: { value: '2026-06-30' },
          },
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-defaults' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
  });

  it('accepts nested differential_pricing_form values from differential pricing callbacks', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-nested' },
        action: {
          tag: 'button',
          value: { action: 'activity_automation_confirm' },
          form_value: {
            differential_pricing_form: {
              starts_at: '2026-06-24',
              ends_at: '2026-06-30',
            },
          },
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-nested' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
  });

  it('replaces the differential pricing card when the user cancels', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-cancel' },
        action: {
          tag: 'button',
          value: { action: 'activity_automation_cancel' },
        },
      },
    });

    expect(activityAutomationClient.executions).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-cancel' } } });
    expect(JSON.stringify(sent[0])).toContain('已取消');
  });

  it('returns replacement cards for price callback cancellation and duplicate clicks', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const event = {
      event: {
        context: { open_message_id: 'om-activity-price-callback-cancel' },
        action: {
          tag: 'button',
          value: {
            action: 'activity_price_callback_cancel',
            request: {
              submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
              productIds: ['770', '800'],
              mappedCount: 2,
              startsAt: '2026-06-24',
              endsAt: '2026-06-30',
            },
          },
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-price-callback-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('handles id_lookup form submit by returning the updated card', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-id-lookup' },
        action: { tag: 'button', value: { action: 'id_lookup' }, form_value: { lookup_query: '565' } },
      },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('端内ID');
    expect(JSON.stringify((result as any).card.data)).toContain('平台商品ID');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
    expect(JSON.stringify((result as any).card.data)).not.toContain('"tag":"hr"');
  });

  it('handles id_lookup submit when Feishu returns the callback value through behaviors', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-id-lookup-behavior' },
        action: { tag: 'button', name: 'id_lookup_submit', behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }], form_value: { lookup_query: '565' } },
      },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
  });

  it('handles id_lookup form submit when SDK returns flattened card action data', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      context: { open_message_id: 'om-id-lookup-flat' },
      action: { tag: 'button', name: 'id_lookup_submit', behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }], form_value: { lookup_query: '565' } },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
  });

  it('persists operations learning feedback and replies with the next card', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback' },
        operator: { open_id: 'ou_sdk_reviewer' },
        action: { tag: 'button', input_value: '建议先看库存', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'suggested_action', questionIndex: 1 } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback' }, data: { msg_type: 'interactive' } } });
    expect(JSON.parse((sent[0] as { request: { data: { content: string } } }).request.data.content).header.title.content).toBe('运营学习 loop 测验 2/2');
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('建议先看库存');
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_sdk_reviewer');
  });

  it('rejects malformed operations learning feedback callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-empty-learning-'));
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-malformed' },
        action: { tag: 'button', value: { action: 'operations_learning_feedback', productId: '565', feedback: 'reasonable' } },
      },
    });

    expect(sent).toEqual([
      { kind: 'reply', request: { path: { message_id: 'om-feedback-malformed' }, data: { content: JSON.stringify({ text: '运营学习反馈回调缺少必要字段。' }), msg_type: 'text' } } },
    ]);
  });

  it('replies with the next operations learning question after feedback', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-next' },
        action: { tag: 'button', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-next' }, data: { msg_type: 'interactive' } } });
    expect(JSON.stringify(sent[0])).toContain('运营学习 loop 测验 2/2');
    expect(JSON.stringify(sent[0])).toContain('端内ID 566');
  });

  it('persists operations learning feedback when callback value is returned through behaviors', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-behavior' },
        action: { tag: 'button', behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-behavior' }, data: { msg_type: 'interactive' } } });
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('reasonable');
  });

  it('persists operations learning feedback when SDK returns flattened card action data', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      context: { open_message_id: 'om-feedback-flat' },
      action: { tag: 'button', behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-flat' }, data: { msg_type: 'interactive' } } });
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('reasonable');
  });
});
