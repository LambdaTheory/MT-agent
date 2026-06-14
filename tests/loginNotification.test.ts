import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLoginRequired, resetLoginNotificationDedupeForTests } from '../src/crawler/loginNotification.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('notifyLoginRequired', () => {
  afterEach(() => {
    resetLoginNotificationDedupeForTests();
  });

  it('captures and sends one login screenshot notification per stage', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'login-notification-'));
    const page = { screenshot: vi.fn(async () => Buffer.from([1, 2, 3])) };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token' });
      }
      if (String(url).includes('/im/v1/images')) {
        return jsonResponse({ code: 0, data: { image_key: 'img_v3_login' } });
      }
      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    });
    const log = vi.fn();
    const env = {
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
      FEISHU_WEBHOOK_URL: 'https://example.invalid/webhook',
      FEISHU_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_RECEIVE_ID: 'oc_legacy_group',
      FEISHU_GROUP_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_GROUP_RECEIVE_ID: 'oc_group',
    };

    const first = await notifyLoginRequired({ page, stage: 'goods-export', outputDir, env, fetchImpl: fetchImpl as typeof fetch, log });
    const second = await notifyLoginRequired({ page, stage: 'goods-export', outputDir, env, fetchImpl: fetchImpl as typeof fetch, log });

    expect(first.notified).toBe(true);
    expect(second).toEqual({ notified: false, reason: 'already notified for stage goods-export' });
    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
    expect(calls.some((call) => call.url === 'https://open.feishu.cn/open-apis/im/v1/images')).toBe(true);
    expect(calls.some((call) => call.url === 'https://example.invalid/webhook')).toBe(false);

    const messageCalls = calls.filter((call) => call.url.includes('/im/v1/messages'));
    expect(messageCalls).toHaveLength(2);
    expect(messageCalls.every((call) => String(call.init.body).includes('ou_personal'))).toBe(true);
    expect(messageCalls.some((call) => String(call.init.body).includes('oc_group'))).toBe(false);
    expect(messageCalls.some((call) => String(call.init.body).includes('oc_legacy_group'))).toBe(false);

    const screenshotDir = join(outputDir, 'state', 'login-screenshots');
    const files = await readdir(screenshotDir);
    expect(files).toHaveLength(1);
    const bytes = await readFile(join(screenshotDir, files[0]));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('returns a skipped result and logs when Feishu personal config is missing', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'login-notification-'));
    const page = { screenshot: vi.fn(async () => Buffer.from([1, 2, 3])) };
    const log = vi.fn();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token' });
      }
      if (String(url).includes('/im/v1/images')) {
        return jsonResponse({ code: 0, data: { image_key: 'img_v3_login' } });
      }
      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    });

    const result = await notifyLoginRequired({
      page,
      stage: 'goods-export',
      outputDir,
      env: {
        FEISHU_WEBHOOK_URL: 'https://example.invalid/webhook',
        FEISHU_RECEIVE_ID_TYPE: 'chat_id',
        FEISHU_RECEIVE_ID: 'oc_legacy_group',
        FEISHU_GROUP_RECEIVE_ID_TYPE: 'chat_id',
        FEISHU_GROUP_RECEIVE_ID: 'oc_group',
      },
      fetchImpl: fetchImpl as typeof fetch,
      log,
    });

    expect(result.notified).toBe(false);
    if (result.notified) {
      throw new Error('expected notification to be skipped');
    }
    expect(result.reason).toContain('missing Feishu personal app config');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('支付宝登录截图通知跳过'));
    expect(calls).toEqual([]);

    const retry = await notifyLoginRequired({
      page,
      stage: 'goods-export',
      outputDir,
      env: {
        FEISHU_APP_ID: 'cli_test',
        FEISHU_APP_SECRET: 'secret',
        FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
      },
      fetchImpl: fetchImpl as typeof fetch,
      log,
    });

    expect(retry.notified).toBe(true);
    expect(page.screenshot).toHaveBeenCalledTimes(2);
  });
});
