export interface FeishuAppConfig {
  appId: string;
  appSecret: string;
  receiveIdType: string;
  receiveId: string;
}

export type FeishuAppSendResult = { sent: true; channel: 'app' } | { sent: false; channel: 'app'; reason: string };

export async function sendFeishuAppText(config: FeishuAppConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuAppSendResult> {
  const tokenResponse = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });

  const tokenText = await tokenResponse.text();
  if (!tokenResponse.ok) {
    return { sent: false, channel: 'app', reason: `token request failed: http ${tokenResponse.status}: ${tokenText}` };
  }

  const tokenBody = JSON.parse(tokenText) as { code?: number; tenant_access_token?: string };
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) {
    return { sent: false, channel: 'app', reason: `token request failed: ${tokenText}` };
  }

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenBody.tenant_access_token}`,
    },
    body: JSON.stringify({
      receive_id: config.receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  const messageText = await messageResponse.text();
  if (!messageResponse.ok) {
    return { sent: false, channel: 'app', reason: `message send failed: http ${messageResponse.status}: ${messageText}` };
  }

  const messageBody = JSON.parse(messageText) as { code?: number };
  if (messageBody.code !== 0) {
    return { sent: false, channel: 'app', reason: `message send failed: ${messageText}` };
  }

  return { sent: true, channel: 'app' };
}
