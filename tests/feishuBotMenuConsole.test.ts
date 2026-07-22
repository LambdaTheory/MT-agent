import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import { extractFeishuBotMenuEvent } from '../src/feishuBot/menuConsole.js';
import { startFeishuBotServer } from '../src/feishuBot/server.js';

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<unknown>>) {
  class FakeClient {
    im: { v1: { message: { reply: (request: unknown) => Promise<number>; patch: (request: unknown) => Promise<number>; create: (request: unknown) => Promise<number> } } };

    constructor() {
      this.im = { v1: { message: {
        reply: async (request: unknown) => sent.push({ kind: 'reply', request }),
        patch: async (request: unknown) => sent.push({ kind: 'patch', request }),
        create: async (request: unknown) => sent.push({ kind: 'create', request }),
      } } };
    }
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

async function createOutputDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mt-menu-health-'));
  const outputDir = join(root, 'output');
  await mkdir(join(outputDir, '2026-07-22'), { recursive: true });
  await writeFile(join(outputDir, '2026-07-22', '公域数据上下文_2026-07-22.json'), JSON.stringify({ date: '2026-07-22' }), 'utf8');
  return outputDir;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Feishu bot menu console', () => {
  it('extracts application.bot.menu_v6 event key and single-chat recipient', () => {
    const event = extractFeishuBotMenuEvent({
      header: { event_type: 'application.bot.menu_v6' },
      event: { event_key: 'health.overview', operator: { operator_id: { open_id: 'ou_health' } } },
    });

    expect(event).toEqual({ eventType: 'application.bot.menu_v6', eventKey: 'health.overview', openId: 'ou_health' });
  });

  it('handles SDK health menu events by sending a health card to the operator open_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', pong: true }), { status: 200 })));
    const outputDir = await createOutputDir();
    const sent: unknown[] = [];
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });
    await bot.start();

    await registered['application.bot.menu_v6']({
      header: { event_type: 'application.bot.menu_v6' },
      event: { event_key: 'health.overview', operator: { operator_id: { open_id: 'ou_health' } } },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'create',
      request: { params: { receive_id_type: 'open_id' }, data: { receive_id: 'ou_health', msg_type: 'interactive' } },
    });
    expect(JSON.stringify(sent[0])).toContain('/health 系统健康检查');
  });

  it('handles HTTP health menu events by acking and sending a card without dispatching text planner', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', pong: true }), { status: 200 })));
    const outputDir = await createOutputDir();
    const sent: unknown[] = [];
    const dispatchMessage = vi.fn();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage,
      sendCard: async (config, card) => {
        sent.push({ config, card });
        return { sent: true, channel: 'app' };
      },
    });
    const port = (server.address() as AddressInfo).port;

    const response = await realFetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header: { event_type: 'application.bot.menu_v6' },
        event: { event_key: '/health', operator: { operator_id: { open_id: 'ou_http_health' } } },
      }),
    });

    expect(await response.json()).toEqual({ ok: true });
    await waitFor(() => sent.length === 1);
    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ config: { receiveIdType: 'open_id', receiveId: 'ou_http_health' } });
    expect(JSON.stringify(sent[0])).toContain('/health 系统健康检查');
    server.close();
  });

  it('exposes GET /health as shallow readiness without invoking the text planner', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', pong: true }), { status: 200 })));
    const outputDir = await createOutputDir();
    const dispatchMessage = vi.fn();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage,
    });
    const port = (server.address() as AddressInfo).port;

    const response = await realFetch(`http://127.0.0.1:${port}/health`);
    const report = await response.json() as { status?: string; checks?: Array<{ name?: string; status?: string }> };

    expect(response.status).toBe(200);
    expect(report.status).toBe('warn');
    expect(report.checks?.some((check) => check.name === 'process' && check.status === 'ok')).toBe(true);
    expect(report.checks?.some((check) => check.name === 'latest_report' && check.status === 'ok')).toBe(true);
    expect(dispatchMessage).not.toHaveBeenCalled();
    server.close();
  });
});
