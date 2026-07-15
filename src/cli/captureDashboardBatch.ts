import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { collectDashboardPage } from '../crawler/dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from '../crawler/failureHandling.js';
import { ensureAuthenticatedMerchantSession } from '../crawler/merchantSession.js';
import type { AgentConfig } from '../domain/types.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { assertDashboardDataDate } from '../publicTraffic/dashboardCaptureDate.js';
import { type DashboardRefreshResult, saveDashboardRefreshCapture } from '../publicTraffic/dashboardRefresh.js';
import { buildDashboardRefreshResultCard, formatDashboardRefreshResultText } from '../feishuBot/dashboardRefreshCard.js';

export type FeishuSendTo = 'personal' | 'group' | 'both';

export interface CaptureDashboardBatchCliOptions {
  dates: string[];
  sendTo?: FeishuSendTo;
  json: boolean;
}

export type DashboardBatchItemResult =
  | { ok: true; date: string; result: DashboardRefreshResult; cardSent?: boolean }
  | { ok: false; date: string; error: string };

export interface DashboardBatchRecaptureResult {
  total: number;
  completed: number;
  failed: number;
  stopped: boolean;
  results: DashboardBatchItemResult[];
}

export interface DashboardBatchRecaptureInput {
  config: AgentConfig;
  page: Page | unknown;
  dates: string[];
  sendTo?: FeishuSendTo;
  env?: NodeJS.ProcessEnv;
}

function readArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseSendTo(value: string | undefined): FeishuSendTo | undefined {
  if (!value) return undefined;
  if (value === 'personal' || value === 'group' || value === 'both') return value;
  throw new Error(`Invalid --send-to value: ${value}. Expected personal, group, or both.`);
}

function uniqueDates(dates: string[]): string[] {
  return [...new Set(dates)];
}

export function parseCaptureDashboardBatchCliOptions(argv: string[]): CaptureDashboardBatchCliOptions {
  const rawDates = readArgValue(argv, '--dates');
  if (!rawDates) throw new Error('--dates is required');
  const dates = uniqueDates(rawDates.split(',').map((date) => date.trim()).filter(Boolean).map((date) => assertDashboardDataDate(date)));
  if (dates.length === 0) throw new Error('--dates is required');
  return {
    dates,
    sendTo: parseSendTo(readArgValue(argv, '--send-to')),
    json: hasFlag(argv, '--json'),
  };
}

function batchSummary(results: DashboardBatchItemResult[], total: number): Pick<DashboardBatchRecaptureResult, 'completed' | 'failed' | 'stopped'> {
  const failed = results.filter((result) => !result.ok).length;
  return {
    completed: results.filter((result) => result.ok).length,
    failed,
    stopped: failed > 0 || results.length < total,
  };
}

function resultStatusCounts(results: DashboardBatchItemResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of results) {
    const key = item.ok ? item.result.status : 'failed';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendResultCard(result: DashboardRefreshResult, sendTo: FeishuSendTo, env: NodeJS.ProcessEnv): Promise<void> {
  const sendResult = await sendFeishuCard({ ...env, FEISHU_SEND_TO: sendTo }, buildDashboardRefreshResultCard(result), formatDashboardRefreshResultText(result));
  if (!sendResult.sent) throw new Error(`补抓结果卡发送失败：${sendResult.reason}`);
}

export async function runDashboardBatchRecapture(input: DashboardBatchRecaptureInput): Promise<DashboardBatchRecaptureResult> {
  const results: DashboardBatchItemResult[] = [];
  for (const date of input.dates) {
    try {
      const capture = await collectDashboardPage(input.config, input.page as Page, { dataDate: date });
      if (!capture.actualPageDate) throw new Error(`Dashboard capture did not confirm requested dataDate=${date}`);
      const result = await saveDashboardRefreshCapture({
        config: input.config,
        dataDate: date,
        capture: { tables: capture.tables, actualPageDate: capture.actualPageDate },
        sendReport: false,
        sendTo: input.sendTo,
      });
      if (input.sendTo) await sendResultCard(result, input.sendTo, input.env ?? process.env);
      results.push({ ok: true, date, result, ...(input.sendTo ? { cardSent: true } : {}) });
    } catch (error) {
      results.push({ ok: false, date, error: errorMessage(error) });
      break;
    }
  }

  const summary = batchSummary(results, input.dates.length);
  return { total: input.dates.length, ...summary, results };
}

function formatHumanItem(item: DashboardBatchItemResult, index: number): string[] {
  if (!item.ok) return [`[${index}] 业务数据日 ${item.date}: 失败`, `错误: ${item.error}`];
  return [
    `[${index}] 业务数据日 ${item.result.dataDate}: ${item.result.status}`,
    `页面回读日期: ${item.result.actualPageDate}`,
    `补抓结果: ${item.result.refreshQualityText}`,
    `raw 位置: ${item.result.rawLocation}`,
    `动作: ${item.result.message}`,
    ...(item.cardSent ? ['结果卡: 已发送'] : []),
  ];
}

function formatHumanSummary(result: DashboardBatchRecaptureResult): string {
  const counts = resultStatusCounts(result.results);
  return [
    `访问页批量补抓完成: total=${result.total}, completed=${result.completed}, failed=${result.failed}, stopped=${result.stopped ? 'yes' : 'no'}`,
    `状态统计: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
    ...result.results.flatMap((item, index) => ['', ...formatHumanItem(item, index + 1)]),
  ].join('\n');
}

export async function runCaptureDashboardBatchCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCaptureDashboardBatchCliOptions(argv);
  await loadEnv();
  const config = await loadConfig();
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: 'dashboard-refresh-batch' });
  let completed = false;
  try {
    const result = await runDashboardBatchRecapture({ config, page, dates: options.dates, sendTo: options.sendTo });
    completed = result.failed === 0;
    console.log(options.json ? JSON.stringify(result, null, 2) : formatHumanSummary(result));
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('访问页批量补抓失败；保留浏览器窗口供检查。');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCaptureDashboardBatchCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
