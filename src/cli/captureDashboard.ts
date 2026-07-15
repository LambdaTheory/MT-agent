import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { assertDashboardDataDate, previousShanghaiDate } from '../publicTraffic/dashboardCaptureDate.js';
import { runDashboardRefresh } from '../publicTraffic/dashboardRefresh.js';

type FeishuSendTo = 'personal' | 'group' | 'both';

function parseArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseSendTo(argv: string[]): FeishuSendTo | undefined {
  const value = parseArgValue(argv, '--send-to');
  if (!value) return undefined;
  if (value === 'personal' || value === 'group' || value === 'both') return value;
  throw new Error(`Invalid --send-to value: ${value}. Expected personal, group, or both.`);
}

export async function runCaptureDashboardCli(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const explicitDate = parseArgValue(argv, '--date');
  const dataDate = explicitDate ? assertDashboardDataDate(explicitDate) : previousShanghaiDate();
  const result = await runDashboardRefresh({ config, dataDate, sendTo: parseSendTo(argv) });
  console.log(`访问页补抓完成: ${result.refreshQualityText}`);
  console.log(`业务数据日: ${result.dataDate}`);
  console.log(`页面回读日期: ${result.actualPageDate}`);
  console.log(`首版日报访问页状态: ${result.firstQualityText ?? '无既有日报上下文'}`);
  console.log(`raw 位置: ${result.rawLocation}`);
  console.log(`决策: ${result.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCaptureDashboardCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
