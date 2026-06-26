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

  it('defaults to personal recipient and can send to both personal and group', async () => {
    const messageUrls: string[] = [];
    const messageBodies: unknown[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const asString = String(url);
      if (asString.includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token' });
      messageUrls.push(asString);
      messageBodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ code: 0 });
    };

    const baseEnv = {
      FEISHU_APP_ID: 'cli',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_PERSONAL_RECEIVE_ID_TYPE: 'open_id',
      FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
      FEISHU_GROUP_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_GROUP_RECEIVE_ID: 'oc_group',
    };

    await expect(sendFeishuCard(baseEnv, { schema: '2.0' }, 'fallback', fetchImpl as typeof fetch)).resolves.toEqual({ sent: true, channel: 'app' });
    expect(messageUrls.at(-1)).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
    expect(messageBodies.at(-1)).toMatchObject({ receive_id: 'ou_personal' });

    await expect(sendFeishuCard({ ...baseEnv, FEISHU_SEND_TO: 'group' }, { schema: '2.0' }, 'fallback', fetchImpl as typeof fetch)).resolves.toEqual({ sent: true, channel: 'app' });
    expect(messageUrls.at(-1)).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');
    expect(messageBodies.at(-1)).toMatchObject({ receive_id: 'oc_group' });

    messageUrls.length = 0;
    messageBodies.length = 0;
    await expect(sendFeishuCard({ ...baseEnv, FEISHU_SEND_TO: 'both' }, { schema: '2.0' }, 'fallback', fetchImpl as typeof fetch)).resolves.toEqual({ sent: true, channel: 'app' });
    expect(messageUrls).toEqual([
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    ]);
    expect(messageBodies).toMatchObject([{ receive_id: 'ou_personal' }, { receive_id: 'oc_group' }]);
  });

  it('sends group cards to every configured group recipient', async () => {
    const messageBodies: unknown[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token' });
      messageBodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ code: 0 });
    };

    await expect(sendFeishuCard(
      {
        FEISHU_APP_ID: 'cli',
        FEISHU_APP_SECRET: 'secret',
        FEISHU_SEND_TO: 'group',
        FEISHU_GROUP_RECEIVE_ID_TYPE: 'chat_id',
        FEISHU_GROUP_RECEIVE_ID: 'oc_group',
        FEISHU_GROUP_RECEIVE_IDS: 'oc_group, oc_extra_1 oc_extra_2',
      },
      { schema: '2.0' },
      'fallback',
      fetchImpl as typeof fetch,
    )).resolves.toEqual({ sent: true, channel: 'app' });

    expect(messageBodies).toMatchObject([
      { receive_id: 'oc_group' },
      { receive_id: 'oc_extra_1' },
      { receive_id: 'oc_extra_2' },
    ]);
  });
});
