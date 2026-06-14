import { describe, expect, it } from 'vitest';
import { sendFeishuAppCard, sendFeishuAppImage, sendFeishuAppText, uploadFeishuAppImage } from '../src/notify/feishuApp.js';

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

it('sends interactive card message to open_id', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
    }
    return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
  };

  const card = { schema: '2.0', header: { title: { tag: 'plain_text', content: '标题' } }, body: { elements: [] } };
  const result = await sendFeishuAppCard(
    { appId: 'cli_test', appSecret: 'secret', receiveIdType: 'open_id', receiveId: 'ou_test' },
    card,
    fetchImpl as typeof fetch,
  );

  expect(result).toEqual({ sent: true, channel: 'app' });
  expect(JSON.parse(String(calls[1].init.body))).toEqual({
    receive_id: 'ou_test',
    msg_type: 'interactive',
    content: JSON.stringify(card),
  });
});

it('uploads image with tenant token', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
    }

    return jsonResponse({ code: 0, data: { image_key: 'img_v3_test' } });
  };

  const result = await uploadFeishuAppImage(
    { appId: 'cli_test', appSecret: 'secret' },
    new Uint8Array([137, 80, 78, 71]),
    fetchImpl as typeof fetch,
  );

  expect(result).toEqual({ uploaded: true, imageKey: 'img_v3_test' });
  expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/images');
  expect(calls[1].init.method).toBe('POST');
  expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  expect(calls[1].init.body).toBeInstanceOf(FormData);
});

it('sends image message to open_id', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
    }

    return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
  };

  const result = await sendFeishuAppImage(
    { appId: 'cli_test', appSecret: 'secret', receiveIdType: 'open_id', receiveId: 'ou_test' },
    'img_v3_test',
    fetchImpl as typeof fetch,
  );

  expect(result).toEqual({ sent: true, channel: 'app' });
  expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
  expect(JSON.parse(String(calls[1].init.body))).toEqual({
    receive_id: 'ou_test',
    msg_type: 'image',
    content: JSON.stringify({ image_key: 'img_v3_test' }),
  });
});
