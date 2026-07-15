import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, PeriodKey, RawTableData } from '../src/domain/types.js';
import type { DashboardQualitySummary } from '../src/publicTraffic/dashboardQuality.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';
import { decideDashboardRefreshOutcome, runDashboardRefresh } from '../src/publicTraffic/dashboardRefresh.js';
import { collectDashboardPage } from '../src/crawler/dashboardCrawler.js';
import { rebuildPublicTrafficReport } from '../src/publicTraffic/rebuildPublicTrafficReport.js';

vi.mock('../src/crawler/merchantSession.js', () => ({
  ensureAuthenticatedMerchantSession: vi.fn(async () => ({
    browser: { close: vi.fn(async () => undefined) },
    page: {},
  })),
}));

vi.mock('../src/crawler/dashboardCrawler.js', () => ({
  collectDashboardPage: vi.fn(),
}));

vi.mock('../src/publicTraffic/rebuildPublicTrafficReport.js', () => ({
  rebuildPublicTrafficReport: vi.fn(async () => ({ sent: true })),
}));

const complete: DashboardQualitySummary = {
  hasMissing: false,
  notes: [],
  periods: {
    '1d': { complete: true, rowCount: 1 },
    '7d': { complete: true, rowCount: 1 },
    '30d': { complete: true, rowCount: 1 },
  },
};

const missing: DashboardQualitySummary = {
  hasMissing: true,
  notes: ['后链路数据缺失'],
  periods: {
    '1d': { complete: false, rowCount: 0 },
    '7d': { complete: true, rowCount: 1 },
    '30d': { complete: true, rowCount: 1 },
  },
};

function raw(period: PeriodKey, options: { rowCount?: number; complete?: boolean } = {}): RawTableData {
  const rowCount = options.rowCount ?? 1;
  const completeFlag = options.complete ?? true;
  return {
    period,
    headers: ['商品', '访问'],
    rows: rowCount > 0 ? [['A', '1']] : [],
    collection: {
      period,
      actualPageSizes: [50],
      pageCount: 1,
      rowCount,
      dedupedRowCount: rowCount,
      displayedTotalCount: rowCount,
      pageSizeFallback: false,
      complete: completeFlag,
    },
  };
}

function config(outputDir: string): AgentConfig {
  return {
    targetUrl: 'https://example.test/dashboard',
    periods: ['1d', '7d', '30d'],
    preferredPageSize: 50,
    outputDir,
    browserProfileDir: join(outputDir, 'profile'),
    productIdMappingPath: join(outputDir, 'mapping.json'),
  };
}

describe('decideDashboardRefreshOutcome', () => {
  it('maps existing-report quality combinations to structured statuses', () => {
    expect(decideDashboardRefreshOutcome({ reportFound: true, firstQuality: missing, refreshQuality: complete, alreadyResent: false })).toBe('repaired');
    expect(decideDashboardRefreshOutcome({ reportFound: true, firstQuality: missing, refreshQuality: missing, alreadyResent: false })).toBe('still_missing');
    expect(decideDashboardRefreshOutcome({ reportFound: true, firstQuality: complete, refreshQuality: complete, alreadyResent: false })).toBe('saved_existing_complete');
    expect(decideDashboardRefreshOutcome({ reportFound: true, firstQuality: missing, refreshQuality: complete, alreadyResent: true })).toBe('saved_already_resent');
  });

  it('archives without rebuild when no matching report context exists', () => {
    expect(decideDashboardRefreshOutcome({ reportFound: false, refreshQuality: complete, alreadyResent: false })).toBe('saved_historical_without_report');
  });
});

describe('runDashboardRefresh', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('archives the capture when the configured output root does not exist', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const outputDir = join(workspace, 'missing-output');
    const dataDate = '2026-07-13';
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    const result = await runDashboardRefresh({ config: config(outputDir), dataDate });

    expect(rebuildPublicTrafficReport).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'saved_historical_without_report',
      dataDate,
      actualPageDate: dataDate,
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: `${outputDir}/historical-dashboard-captures/${dataDate}`,
    });
    await expect(readFile(join(result.rawLocation, '公域访问数据_1日.json'), 'utf8')).resolves.toContain('"period": "1d"');
    await expect(readFile(join(result.rawLocation, 'capture-manifest.json'), 'utf8')).resolves.toContain('"reportContextFound": false');
  });

  it('normalizes a legacy date input to the canonical dataDate', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const outputDir = join(workspace, 'missing-output');
    const dataDate = '2026-07-13';
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    const result = await runDashboardRefresh({ config: config(outputDir), date: dataDate });

    expect(result.dataDate).toBe(dataDate);
  });

  it('returns only the strict structured contract when no report is found', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const dataDate = '2026-07-13';
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    const result = await runDashboardRefresh({ config: config(outputDir), dataDate });

    expect(rebuildPublicTrafficReport).not.toHaveBeenCalled();
    expect(Object.keys(result).sort()).toEqual([
      'actualPageDate',
      'dataDate',
      'message',
      'rawLocation',
      'rebuild',
      'refreshQuality',
      'refreshQualityText',
      'resend',
      'status',
    ]);
    expect(result.refreshQualityText).toBe('1d=complete, 7d=complete, 30d=complete');
    expect(result).toMatchObject({
      status: 'saved_historical_without_report',
      dataDate,
      actualPageDate: dataDate,
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: `${outputDir}/historical-dashboard-captures/${dataDate}`,
    });
    await expect(readdir(result.rawLocation)).resolves.toEqual(expect.arrayContaining([
      'capture-manifest.json',
      '公域访问数据_1日.json',
      '公域访问数据_7日.json',
      '公域访问数据_30日.json',
    ]));
  });

  it('propagates malformed report context JSON instead of treating it as no report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const runDate = '2026-07-14';
    const dataDate = '2026-07-13';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.reportContext, '{not valid JSON}', 'utf8');
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    await expect(runDashboardRefresh({ config: config(outputDir), dataDate })).rejects.toThrow(SyntaxError);
  });

  it('uses the report run date and skips rebuild when run state is absent', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const runDate = '2026-07-14';
    const dataDate = '2026-07-13';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.reportContext, `${JSON.stringify({ date: dataDate, dataQualityNotes: [], rows: [] })}\n`, 'utf8');
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    const result = await runDashboardRefresh({ config: config(outputDir), dataDate, sendTo: 'group' });

    expect(collectDashboardPage).toHaveBeenCalledWith(expect.anything(), expect.anything(), { dataDate });
    expect(rebuildPublicTrafficReport).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'saved_existing_complete',
      dataDate,
      actualPageDate: dataDate,
      resolvedReportRunDate: runDate,
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: paths.dir,
    });
    await expect(readFile(paths.publicVisitRaw['1d'], 'utf8')).resolves.toContain('"period": "1d"');
    await expect(readFile(paths.publicTrafficRunState, 'utf8')).resolves.toContain('"dashboardRefreshResent": true');
  });

  it('returns still_missing when the current capture is incomplete even after a prior resend', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const runDate = '2026-07-14';
    const dataDate = '2026-07-13';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    const rawTables = [raw('1d', { rowCount: 0 }), raw('7d'), raw('30d')];

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.reportContext, `${JSON.stringify({ date: dataDate, dataQualityNotes: [], rows: [] })}\n`, 'utf8');
    await writeFile(paths.publicTrafficRunState, `${JSON.stringify({
      date: dataDate,
      firstReportSent: true,
      firstReportGeneratedAt: '2026-07-14T00:00:00.000Z',
      firstDashboardQuality: missing,
      dashboardRefreshResent: true,
      dashboardRefreshResentAt: '2026-07-14T01:00:00.000Z',
      dashboardRefreshDecision: 'repaired',
    })}\n`, 'utf8');
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });

    const result = await runDashboardRefresh({ config: config(outputDir), dataDate, sendTo: 'group' });

    expect(rebuildPublicTrafficReport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'still_missing', rebuild: 'skipped', resend: 'skipped' });
    expect(result.refreshQuality.periods['1d']).toMatchObject({ complete: false, reason: 'rowCount=0' });
    await expect(readFile(paths.publicTrafficRunState, 'utf8')).resolves.toContain('"dashboardRefreshDecision": "still_missing"');
  });

  it('does not report repaired or resent when rebuild succeeds but Feishu resend fails', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-dashboard-refresh-'));
    const runDate = '2026-07-14';
    const dataDate = '2026-07-13';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    const rawTables = [raw('1d'), raw('7d'), raw('30d')];

    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.reportContext, `${JSON.stringify({ date: dataDate, dataQualityNotes: [], rows: [] })}\n`, 'utf8');
    await writeFile(paths.publicTrafficRunState, `${JSON.stringify({
      date: dataDate,
      firstReportSent: true,
      firstReportGeneratedAt: '2026-07-14T00:00:00.000Z',
      firstDashboardQuality: missing,
      dashboardRefreshResent: false,
    })}\n`, 'utf8');
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: rawTables, actualPageDate: dataDate });
    vi.mocked(rebuildPublicTrafficReport).mockResolvedValueOnce({ sent: false, sendReason: 'missing config' } as Awaited<ReturnType<typeof rebuildPublicTrafficReport>>);

    const result = await runDashboardRefresh({ config: config(outputDir), dataDate, sendTo: 'group' });

    expect(rebuildPublicTrafficReport).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'saved_existing_complete', rebuild: 'performed', resend: 'skipped' });
    expect(result.message).toContain('重发失败');
    await expect(readFile(paths.publicTrafficRunState, 'utf8')).resolves.toContain('"dashboardRefreshResent": false');
  });
});
