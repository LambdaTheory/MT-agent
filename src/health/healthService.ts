import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config/loadConfig.js';
import { findLatestReportContext } from '../feishuBot/reportStore.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../feishuBot/rentalPrice.js';
import { loadOptionalDaemonCatalogSnapshot } from '../linkRegistry/daemonCatalog.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export type HealthStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  summary: string;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  outputDir: string;
  checks: HealthCheckResult[];
}

export interface CheckHealthOptions {
  configPath?: string;
  outputDir?: string;
  now?: () => Date;
  rentalPriceClient?: Pick<RentalPriceSkillClient, 'daemonStatus'>;
  daemonTimeoutMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function outputDirCheck(outputDir: string): Promise<HealthCheckResult> {
  try {
    const info = await stat(outputDir);
    if (!info.isDirectory()) return { name: 'output_dir', status: 'fail', summary: 'outputDir 不是目录', detail: outputDir };
    return { name: 'output_dir', status: 'ok', summary: 'outputDir 可访问', detail: outputDir };
  } catch (error) {
    return { name: 'output_dir', status: 'fail', summary: 'outputDir 不可访问', detail: `${outputDir}\n${errorMessage(error)}` };
  }
}

async function latestReportCheck(outputDir: string): Promise<HealthCheckResult> {
  try {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { name: 'latest_report', status: 'warn', summary: '未找到最新公域日报上下文', detail: outputDir };
    return { name: 'latest_report', status: 'ok', summary: `最新日报 ${latest.context.date}`, detail: latest.path };
  } catch (error) {
    return { name: 'latest_report', status: 'fail', summary: '读取最新日报上下文失败', detail: errorMessage(error) };
  }
}

async function stateFilesCheck(outputDir: string): Promise<HealthCheckResult> {
  const files = [
    join(outputDir, 'state', 'goods-current-snapshot.json'),
    join(outputDir, 'state', 'goods-first-seen.json'),
    join(outputDir, 'state', 'goods-link-lifecycle.json'),
  ];
  const present = await Promise.all(files.map(async (file) => ({ file, ok: await exists(file) })));
  const missing = present.filter((item) => !item.ok).map((item) => item.file);
  if (!missing.length) return { name: 'state_files', status: 'ok', summary: '关键 state 文件齐全', detail: files.join('\n') };
  if (missing.length < files.length) return { name: 'state_files', status: 'warn', summary: `缺少 ${missing.length} 个 state 文件`, detail: missing.join('\n') };
  return { name: 'state_files', status: 'warn', summary: '未找到关键 state 文件', detail: missing.join('\n') };
}

async function daemonCatalogCheck(outputDir: string): Promise<HealthCheckResult> {
  const path = join(outputDir, 'state', 'link-registry-daemon-catalog.json');
  try {
    const snapshot = await loadOptionalDaemonCatalogSnapshot(path);
    if (!snapshot) return { name: 'daemon_catalog', status: 'warn', summary: '未找到链接 daemon catalog 快照', detail: path };
    return { name: 'daemon_catalog', status: 'ok', summary: `链接 daemon catalog ${snapshot.count} 条`, detail: `generatedAt: ${snapshot.generatedAt}` };
  } catch (error) {
    return { name: 'daemon_catalog', status: 'fail', summary: '链接 daemon catalog 快照损坏或不可读', detail: errorMessage(error) };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function rentalDaemonCheck(options: CheckHealthOptions): Promise<HealthCheckResult> {
  const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
  if (!client.daemonStatus) return { name: 'rental_daemon', status: 'warn', summary: '租赁价客户端未提供 daemonStatus', detail: 'daemon ping skipped' };
  try {
    const result = await withTimeout(client.daemonStatus(), options.daemonTimeoutMs ?? 1500);
    return {
      name: 'rental_daemon',
      status: result.ok ? 'ok' : 'fail',
      summary: result.ok ? '租赁价 daemon 可达' : `租赁价 daemon 异常：${result.status}`,
      detail: result.lines.join('\n'),
    };
  } catch (error) {
    return { name: 'rental_daemon', status: 'warn', summary: '租赁价 daemon 不可达或未启动', detail: errorMessage(error) };
  }
}

function overallStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'ok';
}

export async function checkHealth(options: CheckHealthOptions = {}): Promise<HealthReport> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const checks: HealthCheckResult[] = [{ name: 'process', status: 'ok', summary: `进程在线，pid ${process.pid}`, detail: `uptime ${Math.round(process.uptime())}s` }];
  let outputDir = options.outputDir ?? 'output';

  try {
    const config = await loadConfig(options.configPath);
    outputDir = options.outputDir ?? config.outputDir;
    checks.push({ name: 'config', status: 'ok', summary: '配置文件可读取', detail: options.configPath ?? 'config/agent.config.json' });
  } catch (error) {
    checks.push({ name: 'config', status: 'fail', summary: '配置文件读取失败', detail: errorMessage(error) });
  }

  checks.push(
    await outputDirCheck(outputDir),
    await latestReportCheck(outputDir),
    await stateFilesCheck(outputDir),
    await daemonCatalogCheck(outputDir),
    await rentalDaemonCheck(options),
  );

  return { status: overallStatus(checks), checkedAt, outputDir, checks };
}

function statusLabel(status: HealthStatus): string {
  if (status === 'ok') return '<text_tag color="green">OK</text_tag>';
  if (status === 'warn') return '<text_tag color="orange">WARN</text_tag>';
  return '<text_tag color="red">FAIL</text_tag>';
}

function headerTemplate(status: HealthStatus): 'green' | 'orange' | 'red' {
  if (status === 'ok') return 'green';
  if (status === 'warn') return 'orange';
  return 'red';
}

export function formatHealthReportMarkdown(report: HealthReport): string {
  return [
    `整体状态：${statusLabel(report.status)}`,
    `检查时间：${report.checkedAt}`,
    `输出目录：${report.outputDir}`,
    '',
    ...report.checks.map((check) => `- ${statusLabel(check.status)} **${check.name}**：${check.summary}${check.detail ? `\n  ${check.detail.replace(/\n/gu, '\n  ')}` : ''}`),
  ].join('\n');
}

export function buildHealthReportCard(report: HealthReport): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '/health 系统健康检查' }, template: headerTemplate(report.status) },
    body: { elements: [{ tag: 'markdown', content: formatHealthReportMarkdown(report) }] },
  };
}
