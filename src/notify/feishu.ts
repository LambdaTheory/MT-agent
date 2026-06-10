import type { DailyReportData } from '../domain/types.js';
import { sendFeishuAppCard, sendFeishuAppText, type FeishuAppConfig, type FeishuCardPayload } from './feishuApp.js';
import { buildFeishuReportText, buildFeishuTestText, sendFeishuWebhookText, type FeishuReportPaths } from './feishuWebhook.js';

export type FeishuDeliveryResult =
  | { sent: true; channel: 'app' | 'webhook' }
  | { sent: false; channel: 'app' | 'webhook' | 'none'; reason: string };

export interface FeishuEnv {
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_RECEIVE_ID_TYPE?: string;
  FEISHU_RECEIVE_ID?: string;
  FEISHU_WEBHOOK_URL?: string;
}

function appConfigFromEnv(env: FeishuEnv): FeishuAppConfig | null {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_RECEIVE_ID) {
    return null;
  }

  return {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    receiveIdType: env.FEISHU_RECEIVE_ID_TYPE ?? 'open_id',
    receiveId: env.FEISHU_RECEIVE_ID,
  };
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
  const appConfig = appConfigFromEnv(env);
  if (appConfig) {
    return sendFeishuAppCard(appConfig, card, fetchImpl);
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
