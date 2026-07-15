import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, RawTableData } from '../src/domain/types.js';
import {
  parseCaptureDashboardBatchCliOptions,
  runDashboardBatchRecapture,
} from '../src/cli/captureDashboardBatch.js';
import { collectDashboardPage } from '../src/crawler/dashboardCrawler.js';
import { sendFeishuCard } from '../src/notify/feishu.js';

vi.mock('../src/crawler/dashboardCrawler.js', () => ({
  collectDashboardPage: vi.fn(),
}));

vi.mock('../src/publicTraffic/dashboardRefresh.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/publicTraffic/dashboardRefresh.js')>();
  return {
    ...actual,
    saveDashboardRefreshCapture: vi.fn(async (_input: unknown) => ({
      status: 'saved_existing_complete',
      dataDate: '2026-06-12',
      actualPageDate: '2026-06-12',
      refreshQuality: { hasMissing: false, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } },
      refreshQualityText: '1d=complete, 7d=complete, 30d=complete',
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: 'output/2026-06-13',
      message: 'fixture message',
    })),
  };
});

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: vi.fn(async () => ({ sent: true, channel: 'app' })),
}));

function config(): AgentConfig {
  return {
    targetUrl: 'https://example.test/dashboard',
    periods: ['1d', '7d', '30d'],
    preferredPageSize: 100,
    outputDir: 'output',
    browserProfileDir: 'profile',
  };
}

function raw(period: RawTableData['period']): RawTableData {
  return {
    period,
    headers: ['商品', '访问'],
    rows: [['A', '1']],
    collection: { period, actualPageSizes: [100], pageCount: 1, rowCount: 1, dedupedRowCount: 1, displayedTotalCount: 1, pageSizeFallback: false, complete: true },
  };
}

describe('parseCaptureDashboardBatchCliOptions', () => {
  it('parses comma-separated dates, send target, and json flag', () => {
    expect(parseCaptureDashboardBatchCliOptions(['--dates', '2026-06-12,2026-06-13', '--send-to=group', '--json'])).toEqual({
      dates: ['2026-06-12', '2026-06-13'],
      sendTo: 'group',
      json: true,
    });
  });

  it('deduplicates dates while preserving order', () => {
    expect(parseCaptureDashboardBatchCliOptions(['--dates=2026-06-12,2026-06-13,2026-06-12']).dates).toEqual(['2026-06-12', '2026-06-13']);
  });

  it('requires at least one valid date', () => {
    expect(() => parseCaptureDashboardBatchCliOptions([])).toThrow('--dates is required');
    expect(() => parseCaptureDashboardBatchCliOptions(['--dates', 'bad-date'])).toThrow('dataDate must be YYYY-MM-DD');
  });
});

describe('runDashboardBatchRecapture', () => {
  afterEach(() => vi.clearAllMocks());

  it('captures dates in one supplied page session and stops on the first failure', async () => {
    vi.mocked(collectDashboardPage)
      .mockResolvedValueOnce({ tables: [raw('1d'), raw('7d'), raw('30d')], actualPageDate: '2026-06-12' })
      .mockRejectedValueOnce(new Error('picker failed'));

    const result = await runDashboardBatchRecapture({
      config: config(),
      page: {},
      dates: ['2026-06-12', '2026-06-13', '2026-06-16'],
    });

    expect(collectDashboardPage).toHaveBeenCalledTimes(2);
    expect(collectDashboardPage).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), { dataDate: '2026-06-12' });
    expect(collectDashboardPage).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), { dataDate: '2026-06-13' });
    expect(result).toMatchObject({ total: 3, completed: 1, failed: 1, stopped: true });
    expect(result.results.map((item) => item.date)).toEqual(['2026-06-12', '2026-06-13']);
  });

  it('sends only per-date result cards when sendTo is provided', async () => {
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: [raw('1d'), raw('7d'), raw('30d')], actualPageDate: '2026-06-12' });

    const result = await runDashboardBatchRecapture({
      config: config(),
      page: {},
      dates: ['2026-06-12'],
      sendTo: 'group',
    });

    expect(sendFeishuCard).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ ok: true, date: '2026-06-12' });
  });

  it('stops when a result card send fails', async () => {
    vi.mocked(collectDashboardPage).mockResolvedValueOnce({ tables: [raw('1d'), raw('7d'), raw('30d')], actualPageDate: '2026-06-12' });
    vi.mocked(sendFeishuCard).mockResolvedValueOnce({ sent: false, channel: 'none', reason: 'missing config' });

    const result = await runDashboardBatchRecapture({
      config: config(),
      page: {},
      dates: ['2026-06-12', '2026-06-13'],
      sendTo: 'group',
    });

    expect(collectDashboardPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ total: 2, completed: 0, failed: 1, stopped: true });
    expect(result.results[0]).toMatchObject({ ok: false, date: '2026-06-12', error: '补抓结果卡发送失败：missing config' });
  });
});
