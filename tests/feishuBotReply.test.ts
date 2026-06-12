import { describe, expect, it, vi } from 'vitest';
import { replyFeishuMessageText } from '../src/notify/feishuApp.js';

describe('replyFeishuMessageText', () => {
  it('posts text reply to message reply endpoint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ code: 0, tenant_access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ code: 0 }) });
    const result = await replyFeishuMessageText({ appId: 'app', appSecret: 'secret', messageId: 'mid' }, 'hello', fetchImpl as any);
    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(fetchImpl.mock.calls[1][0]).toContain('/im/v1/messages/mid/reply');
  });
});
