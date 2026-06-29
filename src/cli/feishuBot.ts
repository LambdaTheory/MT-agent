import { pathToFileURL } from 'node:url';
import { createAgentPlannerProvider } from '../agentRuntime/llmPlanner.js';
import { startClosedOrderPriceAlertMonitor } from '../closedOrderFeedback/priceAlertMonitor.js';
import { loadEnv } from '../config/loadEnv.js';
import { startFeishuBotServer } from '../feishuBot/server.js';
import { createLlmProviderFromEnv, formatLlmProviderEnvSummary, summarizeLlmProviderEnv } from '../llm/openAiCompatibleProvider.js';

export async function runFeishuBotCli(): Promise<void> {
  await loadEnv();
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  const port = Number(process.env.FEISHU_BOT_PORT ?? 8787);
  console.log(`MT-agent LLM planner: ${formatLlmProviderEnvSummary(summarizeLlmProviderEnv(process.env))}`);
  const llmProvider = createLlmProviderFromEnv(process.env);
  startFeishuBotServer({
    port,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    botMentionOpenId: process.env.FEISHU_BOT_OPEN_ID,
    botMentionName: process.env.FEISHU_BOT_MENTION_NAME,
    verificationToken: process.env.FEISHU_BOT_VERIFICATION_TOKEN,
    encryptKey: process.env.FEISHU_BOT_ENCRYPT_KEY,
    outputDir: process.env.MT_AGENT_OUTPUT_DIR ?? 'output',
    ...(llmProvider ? { agentPlannerProvider: createAgentPlannerProvider(llmProvider) } : {}),
  });
  startClosedOrderPriceAlertMonitor({
    env: process.env,
    outputDir: process.env.MT_AGENT_OUTPUT_DIR ?? 'output',
  });
  console.log(`Feishu bot listening on http://localhost:${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFeishuBotCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
