import { pathToFileURL } from 'node:url';
import { maybeSendFeishuTestMessage } from '../notify/feishu.js';

export async function runTestFeishuCli(): Promise<void> {
  const result = await maybeSendFeishuTestMessage();
  if (!result.sent) {
    throw new Error(`Feishu test message was not sent: ${result.reason}`);
  }

  console.log(`Feishu test message sent via ${result.channel}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTestFeishuCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
