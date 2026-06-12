import { pathToFileURL } from 'node:url';
import { loadEnv } from '../config/loadEnv.js';
import { startFeishuBotServer } from '../feishuBot/server.js';

export async function runFeishuBotCli(): Promise<void> {
  await loadEnv();
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) throw new Error('Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  const port = Number(process.env.FEISHU_BOT_PORT ?? 8787);
  startFeishuBotServer({
    port,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    verificationToken: process.env.FEISHU_BOT_VERIFICATION_TOKEN,
    encryptKey: process.env.FEISHU_BOT_ENCRYPT_KEY,
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
