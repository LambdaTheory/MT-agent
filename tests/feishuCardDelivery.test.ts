import { describe, expect, it } from 'vitest';
import { sendFeishuCard } from '../src/notify/feishu.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sendFeishuCard', () => {
  it('uses app card delivery when app config exists', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token' });
      return jsonResponse({ code: 0 });
    };

    const result = await sendFeishuCard(
      { FEISHU_APP_ID: 'cli', FEISHU_APP_SECRET: 'secret', FEISHU_RECEIVE_ID: 'ou' },
      { schema: '2.0', body: { elements: [] } },
      'fallback text',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(JSON.parse(String(calls[1].init.body)).msg_type).toBe('interactive');
  });
});
