import { describe, expect, it } from 'vitest';
import { sendFeishuAppText } from '../src/notify/feishuApp.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sendFeishuAppText', () => {
  it('gets tenant token and sends text message to open_id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      }

      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await sendFeishuAppText(
      {
        appId: 'cli_test',
        appSecret: 'secret',
        receiveIdType: 'open_id',
        receiveId: 'ou_test',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(calls[0].url).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ app_id: 'cli_test', app_secret: 'secret' });
    expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      receive_id: 'ou_test',
      msg_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
    });
  });

  it('returns a token failure reason when token request fails', async () => {
    const fetchImpl = async () => jsonResponse({ code: 999, msg: 'bad secret' }, 400);

    const result = await sendFeishuAppText(
      {
        appId: 'cli_test',
        appSecret: 'secret',
        receiveIdType: 'open_id',
        receiveId: 'ou_test',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    if (result.sent) {
      throw new Error('expected token request to fail');
    }

    expect(result.reason).toContain('token request failed');
  });
});
