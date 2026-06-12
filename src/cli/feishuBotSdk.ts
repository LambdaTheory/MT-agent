import { loadEnv } from '../config/loadEnv.js';
import { createFeishuSdkBot } from '../feishuBot/sdkClient.js';

async function main(): Promise<void> {
  await loadEnv();
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required for feishu-bot:sdk');

  const bot = createFeishuSdkBot({ appId, appSecret, outputDir: process.env.MT_AGENT_OUTPUT_DIR ?? 'output' });
  bot.start();
  console.log('Feishu SDK bot long connection started.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
