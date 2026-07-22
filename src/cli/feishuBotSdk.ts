import { pathToFileURL } from 'node:url';
import { createAgentPlannerProvider } from '../agentRuntime/llmPlanner.js';
import { createAuditLogger as createDefaultAuditLogger, type AuditWriter } from '../audit/auditLogger.js';
import { parseAuditConfig } from '../audit/config.js';
import { createAuditShutdownAdapter, type ShutdownAuditLogger } from '../audit/shutdown.js';
import type { AuditConfig } from '../audit/types.js';
import { startClosedOrderPriceAlertMonitor } from '../closedOrderFeedback/priceAlertMonitor.js';
import { loadEnv } from '../config/loadEnv.js';
import { parseInactiveRefreshApproverIds } from '../feishuBot/inactiveRefreshAuthorization.js';
import { createFeishuSdkBot, type FeishuSdkBot, type FeishuSdkBotConfig } from '../feishuBot/sdkClient.js';
import { createLlmProviderFromEnv, formatLlmProviderEnvSummary, summarizeLlmProviderEnv } from '../llm/openAiCompatibleProvider.js';

type BotSignal = 'SIGINT' | 'SIGTERM';
type Env = Record<string, string | undefined>;
type CliAuditLogger = AuditWriter & ShutdownAuditLogger;

export interface FeishuBotSdkCliDependencies {
  loadEnv?: () => Promise<void>;
  env?: Env;
  createAuditLogger?: (config: AuditConfig) => CliAuditLogger;
  createBot?: (config: FeishuSdkBotConfig) => FeishuSdkBot;
  startPriceAlertMonitor?: (options: Parameters<typeof startClosedOrderPriceAlertMonitor>[0]) => unknown;
  registerSignal?: (signal: BotSignal, handler: () => void | Promise<void>) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

export async function main(dependencies: FeishuBotSdkCliDependencies = {}): Promise<void> {
  await (dependencies.loadEnv ?? loadEnv)();
  const env = dependencies.env ?? process.env;
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required for feishu-bot:sdk');
  const log = dependencies.log ?? console.log;
  log(`MT-agent LLM planner: ${formatLlmProviderEnvSummary(summarizeLlmProviderEnv(env))}`);
  const auditConfig = parseAuditConfig(env);
  const auditLogger = (dependencies.createAuditLogger ?? ((config) => createDefaultAuditLogger({ config })))(auditConfig);
  const shutdown = createAuditShutdownAdapter({ logger: auditLogger, timeoutMs: auditConfig.flushTimeoutMs });
  const llmProvider = createLlmProviderFromEnv(env);

  const bot = (dependencies.createBot ?? createFeishuSdkBot)({
    appId,
    appSecret,
    botMentionOpenId: env.FEISHU_BOT_OPEN_ID,
    botMentionName: env.FEISHU_BOT_MENTION_NAME,
    outputDir: env.MT_AGENT_OUTPUT_DIR ?? 'output',
    inactiveRefreshApproverIds: parseInactiveRefreshApproverIds(env.MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS),
    auditLogger,
    ...(llmProvider ? { agentPlannerProvider: createAgentPlannerProvider(llmProvider), agentExploreProvider: llmProvider } : {}),
  });
  await bot.start();
  wireSdkSignals(shutdown.shutdown, dependencies.registerSignal ?? ((signal, handler) => process.on(signal, handler)), dependencies.exit ?? defaultExit);
  (dependencies.startPriceAlertMonitor ?? startClosedOrderPriceAlertMonitor)({
    env,
    outputDir: env.MT_AGENT_OUTPUT_DIR ?? 'output',
  });
  log('Feishu SDK bot long connection started.');
}

function wireSdkSignals(shutdown: () => Promise<unknown>, registerSignal: (signal: BotSignal, handler: () => Promise<void>) => void, exit: (code: number) => void): void {
  let termination: Promise<void> | undefined;
  const terminate = (exitCode: number): Promise<void> => {
    if (termination === undefined) {
      termination = (async () => {
        await shutdown();
        exit(exitCode);
      })();
    }
    return termination;
  };
  registerSignal('SIGINT', () => terminate(130));
  registerSignal('SIGTERM', () => terminate(143));
}

function defaultExit(code: number): void {
  process.exitCode = code;
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
