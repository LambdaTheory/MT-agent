import { pathToFileURL } from 'node:url';
import { createAgentPlannerProvider } from '../agentRuntime/llmPlanner.js';
import { loadEnv } from '../config/loadEnv.js';
import { createFeishuSdkBot } from '../feishuBot/sdkClient.js';
import { createLlmToolSelector } from '../feishuBot/llmToolSelector.js';
import { createLlmProviderFromEnv, formatLlmProviderEnvSummary, summarizeLlmProviderEnv } from '../llm/openAiCompatibleProvider.js';

export async function main(): Promise<void> {
  await loadEnv();
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required for feishu-bot:sdk');
  console.log(`MT-agent LLM planner: ${formatLlmProviderEnvSummary(summarizeLlmProviderEnv(process.env))}`);
  const llmProvider = createLlmProviderFromEnv(process.env);

  const bot = createFeishuSdkBot({
    appId,
    appSecret,
    botMentionOpenId: process.env.FEISHU_BOT_OPEN_ID,
    botMentionName: process.env.FEISHU_BOT_MENTION_NAME,
    outputDir: process.env.MT_AGENT_OUTPUT_DIR ?? 'output',
    ...(llmProvider ? { agentPlannerProvider: createAgentPlannerProvider(llmProvider), llmToolSelector: createLlmToolSelector(llmProvider) } : {}),
  });
  await bot.start();
  console.log('Feishu SDK bot long connection started.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
