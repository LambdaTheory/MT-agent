import { join } from 'node:path';
import { buildClosedOrderConfidenceFeedback, inferClosedOrderReasonTags } from './feedback.js';
import { buildClosedOrderIngestDedupeKey, ingestClosedOrderFeedbackInputs, loadClosedOrderIngestState, saveClosedOrderIngestState } from './ingest.js';
import { createClosedOrderFeedbackApiProviderFromEnv, type ClosedOrderFeedbackApiEnv } from './apiProvider.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from './runtime.js';
import { buildClosedOrderPriceAlertCard, formatClosedOrderPriceAlertText, type ClosedOrderPriceAlertItem } from '../feishuBot/closedOrderPriceAlertCard.js';
import { sendFeishuCard, type FeishuDeliveryResult, type FeishuEnv } from '../notify/feishu.js';
import type { ClosedOrderFeedbackInput } from './types.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;

interface ClosedOrderPriceAlertLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ClosedOrderPriceAlertEnv extends ClosedOrderFeedbackApiEnv, FeishuEnv {
  CLOSED_ORDER_PRICE_ALERT_ENABLED?: string;
  CLOSED_ORDER_PRICE_ALERT_INTERVAL_MS?: string;
  CLOSED_ORDER_PRICE_ALERT_LIMIT?: string;
  CLOSED_ORDER_PRICE_ALERT_FEISHU_SEND_TO?: string;
  MT_AGENT_OUTPUT_DIR?: string;
}

export interface ClosedOrderPriceAlertPollOptions {
  env?: ClosedOrderPriceAlertEnv;
  outputDir?: string;
  ingestStatePath?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  sendCard?: (env: FeishuEnv, card: Record<string, unknown>, fallbackText: string, fetchImpl?: typeof fetch) => Promise<FeishuDeliveryResult>;
  loadRegistryContext?: (input?: ClosedOrderRegistryPathsInput, cwd?: string) => Promise<ClosedOrderRegistryContext>;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  logger?: ClosedOrderPriceAlertLogger;
}

export interface ClosedOrderPriceAlertPollResult {
  fetchedCount: number;
  addedCount: number;
  updatedCount: number;
  pricingCount: number;
  sent: boolean;
  delivery?: FeishuDeliveryResult;
  skippedReason?: 'disabled' | 'missing_api_env';
}

export interface ClosedOrderPriceAlertMonitorControl {
  stop(): void;
}

function defaultLogger(): ClosedOrderPriceAlertLogger {
  return {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  };
}

function closedOrderIngestStatePath(outputDir: string): string {
  return join(outputDir, 'state', 'closed-order-feedback-ingest.json');
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  return defaultValue;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (!value?.trim()) return defaultValue;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function closedOrderPriceAlertEnabled(env: ClosedOrderPriceAlertEnv = process.env): boolean {
  return parseBooleanFlag(env.CLOSED_ORDER_PRICE_ALERT_ENABLED, true);
}

export function closedOrderPriceAlertIntervalMs(env: ClosedOrderPriceAlertEnv = process.env): number {
  return parsePositiveInteger(env.CLOSED_ORDER_PRICE_ALERT_INTERVAL_MS, DEFAULT_INTERVAL_MS);
}

export function closedOrderPriceAlertLimit(env: ClosedOrderPriceAlertEnv = process.env): number {
  return parsePositiveInteger(env.CLOSED_ORDER_PRICE_ALERT_LIMIT, DEFAULT_LIMIT);
}

function alertSendEnv(env: ClosedOrderPriceAlertEnv): FeishuEnv {
  if (!env.CLOSED_ORDER_PRICE_ALERT_FEISHU_SEND_TO?.trim()) return env;
  return { ...env, FEISHU_SEND_TO: env.CLOSED_ORDER_PRICE_ALERT_FEISHU_SEND_TO.trim() };
}

function dedupeNewInputs(previousKeys: Set<string>, inputs: readonly ClosedOrderFeedbackInput[]): ClosedOrderFeedbackInput[] {
  const seenKeys = new Set(previousKeys);
  const freshInputs: ClosedOrderFeedbackInput[] = [];
  for (const input of inputs) {
    const dedupeKey = buildClosedOrderIngestDedupeKey(input);
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);
    freshInputs.push(input);
  }
  return freshInputs;
}

async function buildAlertItems(
  inputs: readonly ClosedOrderFeedbackInput[],
  registryContext: ClosedOrderRegistryContext,
): Promise<ClosedOrderPriceAlertItem[]> {
  const items = await Promise.all(inputs.map(async (input) => {
    const feedback = await buildClosedOrderConfidenceFeedback(input, registryContext.query);
    return {
      feedback,
      entry: registryContext.query.byInternalId(feedback.internalProductId),
    };
  }));
  return items;
}

export async function runClosedOrderPriceAlertPoll(options: ClosedOrderPriceAlertPollOptions = {}): Promise<ClosedOrderPriceAlertPollResult> {
  const env = options.env ?? process.env;
  const outputDir = options.outputDir ?? env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const ingestPath = options.ingestStatePath ?? closedOrderIngestStatePath(outputDir);
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? defaultLogger();

  if (!closedOrderPriceAlertEnabled(env)) {
    return {
      fetchedCount: 0,
      addedCount: 0,
      updatedCount: 0,
      pricingCount: 0,
      sent: false,
      skippedReason: 'disabled',
    };
  }

  const provider = createClosedOrderFeedbackApiProviderFromEnv(env, fetchImpl);
  if (!provider) {
    logger.warn('Closed order price alert monitor skipped: missing closed order remarks API env.');
    return {
      fetchedCount: 0,
      addedCount: 0,
      updatedCount: 0,
      pricingCount: 0,
      sent: false,
      skippedReason: 'missing_api_env',
    };
  }

  const limit = options.limit ?? closedOrderPriceAlertLimit(env);
  const previousState = await loadClosedOrderIngestState(ingestPath);
  const recentInputs = await provider.listRecentFeedback(limit);
  const freshInputs = dedupeNewInputs(new Set(previousState.items.map((item) => item.dedupeKey)), recentInputs);
  const ingestResult = ingestClosedOrderFeedbackInputs(previousState, recentInputs);
  await saveClosedOrderIngestState(ingestPath, ingestResult.state);

  const pricingInputs = freshInputs.filter((input) => inferClosedOrderReasonTags(input.rawRemark).includes('pricing'));
  if (pricingInputs.length === 0) {
    return {
      fetchedCount: recentInputs.length,
      addedCount: ingestResult.addedCount,
      updatedCount: ingestResult.updatedCount,
      pricingCount: 0,
      sent: false,
    };
  }

  const registryContext = await (options.loadRegistryContext ?? loadClosedOrderRegistryContext)(
    options.closedOrderRegistryPaths,
    process.cwd(),
  );
  const items = await buildAlertItems(pricingInputs, registryContext);
  const card = buildClosedOrderPriceAlertCard(items);
  const fallbackText = formatClosedOrderPriceAlertText(items);
  const delivery = await (options.sendCard ?? sendFeishuCard)(alertSendEnv(env), card, fallbackText, fetchImpl);
  if (!delivery.sent) {
    logger.warn(`Closed order price alert send failed: ${delivery.reason}`);
  } else {
    logger.info(`Closed order price alert sent: ${items.length} pricing remark(s).`);
  }

  return {
    fetchedCount: recentInputs.length,
    addedCount: ingestResult.addedCount,
    updatedCount: ingestResult.updatedCount,
    pricingCount: items.length,
    sent: delivery.sent,
    delivery,
  };
}

export function startClosedOrderPriceAlertMonitor(options: ClosedOrderPriceAlertPollOptions = {}): ClosedOrderPriceAlertMonitorControl {
  const env = options.env ?? process.env;
  const logger = options.logger ?? defaultLogger();

  if (!closedOrderPriceAlertEnabled(env)) {
    logger.info('Closed order price alert monitor disabled by env.');
    return { stop() {} };
  }

  const intervalMs = closedOrderPriceAlertIntervalMs(env);
  let running = false;

  const run = async (trigger: 'startup' | 'interval'): Promise<void> => {
    if (running) {
      logger.warn(`Closed order price alert monitor skipped ${trigger} tick because previous run is still in progress.`);
      return;
    }

    running = true;
    try {
      const result = await runClosedOrderPriceAlertPoll(options);
      if (result.skippedReason === 'missing_api_env') return;
      logger.info(
        `Closed order price alert monitor ${trigger} tick finished: fetched=${result.fetchedCount}, new=${result.addedCount}, pricing=${result.pricingCount}, sent=${result.sent}.`,
      );
    } catch (error) {
      logger.error(`Closed order price alert monitor failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  void run('startup');
  const timer = setInterval(() => {
    void run('interval');
  }, intervalMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
