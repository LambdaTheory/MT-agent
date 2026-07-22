import { pathToFileURL } from 'node:url';
import { createAgentPlannerProvider } from '../agentRuntime/llmPlanner.js';
import { createAuditLogger as createDefaultAuditLogger, type AuditWriter } from '../audit/auditLogger.js';
import { parseAuditConfig } from '../audit/config.js';
import { createAuditShutdownAdapter, type ShutdownAuditLogger } from '../audit/shutdown.js';
import type { AuditConfig } from '../audit/types.js';
import { startClosedOrderPriceAlertMonitor } from '../closedOrderFeedback/priceAlertMonitor.js';
import { loadEnv } from '../config/loadEnv.js';
import { parseInactiveRefreshApproverIds } from '../feishuBot/inactiveRefreshAuthorization.js';
import { startFeishuBotServer, type FeishuBotServerConfig } from '../feishuBot/server.js';
import { createLlmProviderFromEnv, formatLlmProviderEnvSummary, summarizeLlmProviderEnv } from '../llm/openAiCompatibleProvider.js';

type BotSignal = 'SIGINT' | 'SIGTERM';
type Env = Record<string, string | undefined>;
type CliAuditLogger = AuditWriter & ShutdownAuditLogger;

interface HttpServerHandle {
  on(event: 'close', listener: () => void): unknown;
  close(callback?: (error?: Error) => void): unknown;
}

export interface FeishuBotCliDependencies {
  loadEnv?: () => Promise<void>;
  env?: Env;
  createAuditLogger?: (config: AuditConfig) => CliAuditLogger;
  startServer?: (config: FeishuBotServerConfig) => HttpServerHandle;
  startPriceAlertMonitor?: (options: Parameters<typeof startClosedOrderPriceAlertMonitor>[0]) => unknown;
  registerSignal?: (signal: BotSignal, handler: () => void | Promise<void>) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

export async function runFeishuBotCli(dependencies: FeishuBotCliDependencies = {}): Promise<void> {
  await (dependencies.loadEnv ?? loadEnv)();
  const env = dependencies.env ?? process.env;
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  const port = Number(env.FEISHU_BOT_PORT ?? 8787);
  const log = dependencies.log ?? console.log;
  log(`MT-agent LLM planner: ${formatLlmProviderEnvSummary(summarizeLlmProviderEnv(env))}`);
  const auditConfig = parseAuditConfig(env);
  const auditLogger = (dependencies.createAuditLogger ?? ((config) => createDefaultAuditLogger({ config })))(auditConfig);
  const shutdown = createAuditShutdownAdapter({ logger: auditLogger, timeoutMs: auditConfig.flushTimeoutMs });
  const llmProvider = createLlmProviderFromEnv(env);
  const server = (dependencies.startServer ?? startFeishuBotServer)({
    port,
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    botMentionOpenId: env.FEISHU_BOT_OPEN_ID,
    botMentionName: env.FEISHU_BOT_MENTION_NAME,
    verificationToken: env.FEISHU_BOT_VERIFICATION_TOKEN,
    encryptKey: env.FEISHU_BOT_ENCRYPT_KEY,
    callbackSignatureSecret: env.FEISHU_BOT_CALLBACK_SIGNATURE_SECRET,
    outputDir: env.MT_AGENT_OUTPUT_DIR ?? 'output',
    inactiveRefreshApproverIds: parseInactiveRefreshApproverIds(env.MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS),
    auditLogger,
    ...(llmProvider ? { agentPlannerProvider: createAgentPlannerProvider(llmProvider), agentExploreProvider: llmProvider } : {}),
  });
  server.on('close', () => {
    void shutdown.shutdown();
  });
  wireHttpSignals(server, shutdown.shutdown, dependencies.registerSignal ?? ((signal, handler) => process.on(signal, handler)), dependencies.exit ?? defaultExit);
  (dependencies.startPriceAlertMonitor ?? startClosedOrderPriceAlertMonitor)({
    env,
    outputDir: env.MT_AGENT_OUTPUT_DIR ?? 'output',
  });
  log(`Feishu bot listening on http://localhost:${port}`);
}

function wireHttpSignals(server: HttpServerHandle, shutdown: () => Promise<unknown>, registerSignal: (signal: BotSignal, handler: () => Promise<void>) => void, exit: (code: number) => void): void {
  let termination: Promise<void> | undefined;
  const terminate = (exitCode: number): Promise<void> => {
    if (termination === undefined) {
      termination = (async () => {
        server.close();
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
  runFeishuBotCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
