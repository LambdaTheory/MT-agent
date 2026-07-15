import { mkdir, writeFile } from 'node:fs/promises';
import { collectDashboardPage } from '../crawler/dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from '../crawler/failureHandling.js';
import { ensureAuthenticatedMerchantSession } from '../crawler/merchantSession.js';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { assertDashboardDataDate } from './dashboardCaptureDate.js';
import { assessDashboardQuality, type DashboardQualitySummary } from './dashboardQuality.js';
import { findPublicTrafficReportByDataDate } from './reportContextLocator.js';
import { saveHistoricalDashboardCapture } from './historicalDashboardCapture.js';
import { buildPublicTrafficPaths } from './paths.js';
import { loadPublicTrafficRunState, savePublicTrafficRunState, type PublicTrafficRunState } from './publicTrafficRunState.js';
import { rebuildPublicTrafficReport } from './rebuildPublicTrafficReport.js';

export type DashboardRefreshStatus =
  | 'repaired'
  | 'still_missing'
  | 'saved_existing_complete'
  | 'saved_already_resent'
  | 'saved_historical_without_report';

export interface DashboardRefreshInput {
  config: AgentConfig;
  dataDate: string;
  sendTo?: 'personal' | 'group' | 'both';
}

export interface DashboardRefreshResult {
  status: DashboardRefreshStatus;
  dataDate: string;
  actualPageDate: string;
  resolvedReportRunDate?: string;
  firstQuality?: DashboardQualitySummary;
  refreshQuality: DashboardQualitySummary;
  rebuild: 'performed' | 'skipped';
  resend: 'performed' | 'skipped';
  rawLocation: string;
  message: string;
}


export function decideDashboardRefreshOutcome(input: {
  reportFound: boolean;
  firstQuality?: DashboardQualitySummary;
  refreshQuality: DashboardQualitySummary;
  alreadyResent: boolean;
}): DashboardRefreshStatus {
  if (!input.reportFound) return 'saved_historical_without_report';
  if (input.alreadyResent) return 'saved_already_resent';
  if (!input.firstQuality || !input.firstQuality.hasMissing) return 'saved_existing_complete';
  if (input.refreshQuality.hasMissing) return 'still_missing';
  return 'repaired';
}

export async function captureDashboardRawTables(config: AgentConfig, dataDate: string): Promise<{ tables: RawTableData[]; actualPageDate: string }> {
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: 'dashboard-refresh' });
  let completed = false;

  try {
    const capture = await collectDashboardPage(config, page, { dataDate });
    if (!capture.actualPageDate) throw new Error(`Dashboard capture did not confirm requested dataDate=${dataDate}`);
    completed = true;
    return { tables: capture.tables, actualPageDate: capture.actualPageDate };
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

function messageForDashboardRefreshStatus(status: DashboardRefreshStatus): string {
  if (status === 'repaired') return '已补抓完整访问页 raw，重建并重发对应公域日报';
  if (status === 'still_missing') return '已保存访问页 raw，但 1日/7日/30日仍未全部完整，未重建或重发';
  if (status === 'saved_existing_complete') return '已保存访问页 raw；既有日报无需自动重发';
  if (status === 'saved_already_resent') return '已保存访问页 raw；该业务数据日已补抓重发过，跳过重复重发';
  return '未找到该业务数据日的既有日报上下文，已归档历史访问页 raw，未重建或重发';
}

function conservativeMissingQuality(): DashboardQualitySummary {
  return {
    hasMissing: true,
    notes: ['未找到补抓运行状态，保守跳过自动重发'],
    periods: {
      '1d': { complete: false, rowCount: 0, reason: 'run state missing' },
      '7d': { complete: false, rowCount: 0, reason: 'run state missing' },
      '30d': { complete: false, rowCount: 0, reason: 'run state missing' },
    },
  };
}

function conservativeState(dataDate: string): PublicTrafficRunState {
  return {
    date: dataDate,
    firstReportSent: false,
    firstReportGeneratedAt: new Date().toISOString(),
    firstDashboardQuality: conservativeMissingQuality(),
    dashboardRefreshResent: true,
    dashboardRefreshDecision: 'already_resent',
  };
}

export async function runDashboardRefresh(input: DashboardRefreshInput): Promise<DashboardRefreshResult> {
  const dataDate = assertDashboardDataDate(input.dataDate);
  const capture = await captureDashboardRawTables(input.config, dataDate);
  const refreshQuality = assessDashboardQuality(capture.tables, []);
  const capturedAt = new Date().toISOString();
  const located = await findPublicTrafficReportByDataDate(input.config.outputDir, dataDate);

  if (!located) {
    const archived = await saveHistoricalDashboardCapture({
      outputDir: input.config.outputDir,
      dataDate,
      actualPageDate: capture.actualPageDate,
      rawTables: capture.tables,
      refreshQuality,
      capturedAt,
    });
    const status = decideDashboardRefreshOutcome({ reportFound: false, refreshQuality, alreadyResent: false });
    return {
      status,
      dataDate,
      actualPageDate: capture.actualPageDate,
      refreshQuality,
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: archived.dir,
      message: messageForDashboardRefreshStatus(status),
    };
  }

  const paths = buildPublicTrafficPaths(input.config.outputDir, located.runDate);
  await writeDashboardRaw(paths, capture.tables);

  const existingState = await loadPublicTrafficRunState(paths.publicTrafficRunState);
  const state = existingState ?? conservativeState(dataDate);
  const status = existingState
    ? decideDashboardRefreshOutcome({
        reportFound: true,
        firstQuality: state.firstDashboardQuality,
        refreshQuality,
        alreadyResent: state.dashboardRefreshResent,
      })
    : 'saved_existing_complete';

  let rebuild: DashboardRefreshResult['rebuild'] = 'skipped';
  let resend: DashboardRefreshResult['resend'] = 'skipped';
  if (status === 'repaired') {
    await rebuildPublicTrafficReport({
      outputDir: input.config.outputDir,
      date: located.runDate,
      productIdMappingPath: input.config.productIdMappingPath,
      sendTo: input.sendTo,
      send: true,
    });
    rebuild = 'performed';
    resend = 'performed';
  }

  const nextState: PublicTrafficRunState = {
    ...state,
    dashboardRefreshResent: state.dashboardRefreshResent || status === 'repaired',
    ...(status === 'repaired' ? { dashboardRefreshResentAt: capturedAt } : {}),
    dashboardRefreshDecision: status,
  };
  await savePublicTrafficRunState(paths.publicTrafficRunState, nextState);

  return {
    status,
    dataDate,
    actualPageDate: capture.actualPageDate,
    resolvedReportRunDate: located.runDate,
    firstQuality: state.firstDashboardQuality,
    refreshQuality,
    rebuild,
    resend,
    rawLocation: paths.dir,
    message: messageForDashboardRefreshStatus(status),
  };
}


