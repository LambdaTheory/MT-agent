import { mkdir, writeFile } from 'node:fs/promises';
import { collectDashboardPage } from '../crawler/dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from '../crawler/failureHandling.js';
import { ensureAuthenticatedMerchantSession } from '../crawler/merchantSession.js';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { assessDashboardQuality, formatDashboardQuality, type DashboardQualitySummary } from './dashboardQuality.js';
import { buildPublicTrafficPaths } from './paths.js';
import { loadPublicTrafficRunState, savePublicTrafficRunState, type PublicTrafficRunState } from './publicTrafficRunState.js';
import { rebuildPublicTrafficReport } from './rebuildPublicTrafficReport.js';

export type DashboardRefreshDecision = 'first_report_complete' | 'refresh_still_missing' | 'rebuilt_and_resent' | 'already_resent';

export interface DashboardRefreshInput {
  config: AgentConfig;
  date: string;
  sendTo?: 'personal' | 'group' | 'both';
}

export interface DashboardRefreshResult {
  decision: DashboardRefreshDecision;
  firstQuality: DashboardQualitySummary;
  refreshQuality: DashboardQualitySummary;
  firstQualityText: string;
  refreshQualityText: string;
  message: string;
}

export function decideDashboardRefreshAction(input: { firstQuality: DashboardQualitySummary; refreshQuality: DashboardQualitySummary; alreadyResent: boolean }): DashboardRefreshDecision {
  if (input.alreadyResent) return 'already_resent';
  if (!input.firstQuality.hasMissing) return 'first_report_complete';
  if (input.refreshQuality.hasMissing) return 'refresh_still_missing';
  return 'rebuilt_and_resent';
}

export async function captureDashboardRawTables(config: AgentConfig): Promise<RawTableData[]> {
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: 'dashboard-refresh' });
  let completed = false;

  try {
    const dashboard = await collectDashboardPage(config, page);
    completed = true;
    return dashboard.tables;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('访问页补抓失败；保留浏览器窗口供检查。');
    }
  }
}

async function writeDashboardRaw(paths: ReturnType<typeof buildPublicTrafficPaths>, rawTables: RawTableData[]): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
  await Promise.all(rawTables.map((table) => writeFile(paths.publicVisitRaw[table.period], `${JSON.stringify(table, null, 2)}\n`, 'utf8')));
}

function message(decision: DashboardRefreshDecision): string {
  if (decision === 'rebuilt_and_resent') return '已重建日报并重发飞书';
  if (decision === 'first_report_complete') return '首版日报访问页完整，仅保存 raw';
  if (decision === 'refresh_still_missing') return '首版缺失且本次补抓仍缺失，仅保存 raw';
  return '该日期已因访问页补抓自动重发过，本次仅保存 raw';
}

function fallbackState(date: string, refreshQuality: DashboardQualitySummary): PublicTrafficRunState {
  return {
    date,
    firstReportSent: false,
    firstReportGeneratedAt: new Date().toISOString(),
    firstDashboardQuality: refreshQuality,
    dashboardRefreshResent: false,
    dashboardRefreshDecision: 'saved_raw_only',
  };
}

export async function runDashboardRefresh(input: DashboardRefreshInput): Promise<DashboardRefreshResult> {
  const paths = buildPublicTrafficPaths(input.config.outputDir, input.date);
  const rawTables = await captureDashboardRawTables(input.config);
  await writeDashboardRaw(paths, rawTables);
  const refreshQuality = assessDashboardQuality(rawTables, []);
  const existingState = await loadPublicTrafficRunState(paths.publicTrafficRunState);
  const state = existingState ?? fallbackState(input.date, refreshQuality);
  const decision = decideDashboardRefreshAction({
    firstQuality: state.firstDashboardQuality,
    refreshQuality,
    alreadyResent: state.dashboardRefreshResent,
  });

  if (decision === 'rebuilt_and_resent') {
    await rebuildPublicTrafficReport({ outputDir: input.config.outputDir, date: input.date, productIdMappingPath: input.config.productIdMappingPath, sendTo: input.sendTo, send: true });
  }

  const nextState: PublicTrafficRunState = {
    ...state,
    dashboardRefreshResent: state.dashboardRefreshResent || decision === 'rebuilt_and_resent',
    ...(decision === 'rebuilt_and_resent' ? { dashboardRefreshResentAt: new Date().toISOString() } : {}),
    dashboardRefreshDecision: decision,
  };
  await savePublicTrafficRunState(paths.publicTrafficRunState, nextState);

  return {
    decision,
    firstQuality: state.firstDashboardQuality,
    refreshQuality,
    firstQualityText: formatDashboardQuality(state.firstDashboardQuality),
    refreshQualityText: formatDashboardQuality(refreshQuality),
    message: message(decision),
  };
}
