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

function raw(period: PeriodKey): RawTableData {
  return {
    period,
    headers: ['商品', '访问'],
    rows: [['A', '1']],
    collection: {
      period,
      actualPageSizes: [50],
      pageCount: 1,
      rowCount: 1,
      dedupedRowCount: 1,
      displayedTotalCount: 1,
      pageSizeFallback: false,
      complete: true,
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
      'resend',
      'status',
    ]);
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
});
