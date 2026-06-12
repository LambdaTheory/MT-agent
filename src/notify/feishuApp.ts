export interface FeishuAppConfig {
  appId: string;
  appSecret: string;
  receiveIdType: string;
  receiveId: string;
}

type FeishuTokenConfig = Pick<FeishuAppConfig, 'appId' | 'appSecret'>;

export type FeishuAppSendResult = { sent: true; channel: 'app' } | { sent: false; channel: 'app'; reason: string };

export type FeishuCardPayload = Record<string, unknown>;

export interface FeishuReplyConfig {
  appId: string;
  appSecret: string;
  messageId: string;
}

async function getTenantAccessToken(config: FeishuTokenConfig, fetchImpl: typeof fetch): Promise<{ token: string } | { reason: string }> {
  const tokenResponse = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });

  const tokenText = await tokenResponse.text();
  if (!tokenResponse.ok) {
    return { reason: `token request failed: http ${tokenResponse.status}: ${tokenText}` };
  }

  const tokenBody = JSON.parse(tokenText) as { code?: number; tenant_access_token?: string };
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) {
    return { reason: `token request failed: ${tokenText}` };
  }

  return { token: tokenBody.tenant_access_token };
}

export async function sendFeishuAppText(config: FeishuAppConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuAppSendResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) {
    return { sent: false, channel: 'app', reason: token.reason };
  }

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.token}`,
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

export async function sendFeishuAppCard(
  config: FeishuAppConfig,
  card: FeishuCardPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuAppSendResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) {
    return { sent: false, channel: 'app', reason: token.reason };
  }

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.token}`,
    },
    body: JSON.stringify({
      receive_id: config.receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
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

export async function replyFeishuMessageText(config: FeishuReplyConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuAppSendResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) {
    return { sent: false, channel: 'app', reason: token.reason };
  }

  const response = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(config.messageId)}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.token}`,
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  const body = await response.text();
  if (!response.ok) return { sent: false, channel: 'app', reason: `message reply failed: http ${response.status}: ${body}` };
  const parsed = JSON.parse(body) as { code?: number };
  if (parsed.code !== 0) return { sent: false, channel: 'app', reason: `message reply failed: ${body}` };
  return { sent: true, channel: 'app' };
}
