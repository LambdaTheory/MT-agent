import type { DailyReportData } from '../domain/types.js';
import { sendFeishuAppCard, sendFeishuAppText, type FeishuAppConfig, type FeishuCardPayload } from './feishuApp.js';
import { buildFeishuReportText, buildFeishuTestText, sendFeishuWebhookText, type FeishuReportPaths } from './feishuWebhook.js';

export type FeishuDeliveryResult =
  | { sent: true; channel: 'app' | 'webhook' }
  | { sent: false; channel: 'app' | 'webhook' | 'none'; reason: string };

export interface FeishuEnv {
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_SEND_TO?: string;
  FEISHU_PERSONAL_RECEIVE_ID_TYPE?: string;
  FEISHU_PERSONAL_RECEIVE_ID?: string;
  FEISHU_GROUP_RECEIVE_ID_TYPE?: string;
  FEISHU_GROUP_RECEIVE_ID?: string;
  FEISHU_RECEIVE_ID_TYPE?: string;
  FEISHU_RECEIVE_ID?: string;
  FEISHU_WEBHOOK_URL?: string;
}

type FeishuSendTarget = 'personal' | 'group' | 'both';

function normalizeSendTarget(value: string | undefined): FeishuSendTarget {
  return value === 'group' || value === 'both' || value === 'personal' ? value : 'personal';
}

function baseAppConfig(env: FeishuEnv): Pick<FeishuAppConfig, 'appId' | 'appSecret'> | null {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    return null;
  }

  return {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
  };
}

function personalRecipient(env: FeishuEnv): Pick<FeishuAppConfig, 'receiveIdType' | 'receiveId'> | null {
  const receiveId = env.FEISHU_PERSONAL_RECEIVE_ID ?? env.FEISHU_RECEIVE_ID;
  if (!receiveId) return null;
  return {
    receiveIdType: env.FEISHU_PERSONAL_RECEIVE_ID_TYPE ?? env.FEISHU_RECEIVE_ID_TYPE ?? 'open_id',
    receiveId,
  };
}

function groupRecipient(env: FeishuEnv): Pick<FeishuAppConfig, 'receiveIdType' | 'receiveId'> | null {
  if (!env.FEISHU_GROUP_RECEIVE_ID) return null;
  return {
    receiveIdType: env.FEISHU_GROUP_RECEIVE_ID_TYPE ?? 'chat_id',
    receiveId: env.FEISHU_GROUP_RECEIVE_ID,
  };
}

function appConfigsFromEnv(env: FeishuEnv): FeishuAppConfig[] {
  const base = baseAppConfig(env);
  if (!base) return [];

  const target = normalizeSendTarget(env.FEISHU_SEND_TO);
  const recipients = target === 'both' ? [personalRecipient(env), groupRecipient(env)] : [target === 'group' ? groupRecipient(env) : personalRecipient(env)];

  return recipients.filter((recipient): recipient is Pick<FeishuAppConfig, 'receiveIdType' | 'receiveId'> => Boolean(recipient)).map((recipient) => ({ ...base, ...recipient }));
}

function appConfigFromEnv(env: FeishuEnv): FeishuAppConfig | null {
  return appConfigsFromEnv(env)[0] ?? null;
}

export async function sendFeishuText(env: FeishuEnv, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  const appConfig = appConfigFromEnv(env);
  if (appConfig) {
    return sendFeishuAppText(appConfig, text, fetchImpl);
  }

  if (env.FEISHU_WEBHOOK_URL) {
    const result = await sendFeishuWebhookText(env.FEISHU_WEBHOOK_URL, text, fetchImpl);
    return result.sent ? { sent: true, channel: 'webhook' } : { sent: false, channel: 'webhook', reason: result.reason };
  }

  return { sent: false, channel: 'none', reason: 'missing Feishu app config and webhook url' };
}

export async function sendFeishuCard(
  env: FeishuEnv,
  card: FeishuCardPayload,
  fallbackText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuDeliveryResult> {
  const appConfigs = appConfigsFromEnv(env);
  if (appConfigs.length > 0) {
    const results = [];
    for (const appConfig of appConfigs) {
      results.push(await sendFeishuAppCard(appConfig, card, fetchImpl));
    }
    const failed = results.find((result) => !result.sent);
    return failed ?? { sent: true, channel: 'app' };
  }

  if (env.FEISHU_WEBHOOK_URL) {
    const result = await sendFeishuWebhookText(env.FEISHU_WEBHOOK_URL, fallbackText, fetchImpl);
    return result.sent ? { sent: true, channel: 'webhook' } : { sent: false, channel: 'webhook', reason: result.reason };
  }

  return { sent: false, channel: 'none', reason: 'missing Feishu app config and webhook url' };
}

export async function maybeSendFeishuReport(
  data: DailyReportData,
  paths: FeishuReportPaths,
  env: FeishuEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuDeliveryResult> {
  return sendFeishuText(env, buildFeishuReportText(data, paths), fetchImpl);
}

export async function maybeSendFeishuTestMessage(env: FeishuEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  return sendFeishuText(env, buildFeishuTestText(), fetchImpl);
}
