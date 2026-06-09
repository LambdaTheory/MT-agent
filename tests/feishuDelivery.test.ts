import { describe, expect, it } from 'vitest';
import { sendFeishuText } from '../src/notify/feishu.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sendFeishuText', () => {
  it('prefers app api when app config is complete', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      }

      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await sendFeishuText(
      {
        FEISHU_APP_ID: 'cli_test',
        FEISHU_APP_SECRET: 'secret',
        FEISHU_RECEIVE_ID: 'ou_test',
        FEISHU_WEBHOOK_URL: 'https://example.invalid/webhook',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(urls).toEqual([
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    ]);
  });

  it('falls back to webhook when app config is incomplete', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ StatusCode: 0 });
    };

    const result = await sendFeishuText(
      {
        FEISHU_WEBHOOK_URL: 'https://example.invalid/webhook',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'webhook' });
    expect(calls[0].url).toBe('https://example.invalid/webhook');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      msg_type: 'text',
      content: { text: 'hello' },
    });
  });

  it('returns missing config when no delivery channel is configured', async () => {
    const result = await sendFeishuText({}, 'hello');

    expect(result).toEqual({ sent: false, channel: 'none', reason: 'missing Feishu app config and webhook url' });
  });
});
