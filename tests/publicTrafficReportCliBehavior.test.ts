import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, PeriodProductMetrics, RawTableData } from '../src/domain/types.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';
import type { ExposureDailyDelta, PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const mocks = vi.hoisted(() => ({
  outputDir: '',
  loadConfig: vi.fn<() => Promise<AgentConfig>>(),
  crawlPublicTrafficSources: vi.fn(),
  normalizeRowsForPeriod: vi.fn<(table: RawTableData) => PeriodProductMetrics[]>(),
  sendFeishuCard: vi.fn(),
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: vi.fn(async () => undefined),
}));

vi.mock('../src/config/loadConfig.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../src/crawler/publicTrafficCrawler.js', () => ({
  crawlPublicTrafficSources: mocks.crawlPublicTrafficSources,
}));

vi.mock('../src/extractor/normalizeRows.js', () => ({
  normalizeRowsForPeriod: mocks.normalizeRowsForPeriod,
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

describe('runPublicTrafficReportCli public traffic sequencing', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mocks.outputDir = await mkdtemp(join(tmpdir(), 'public-traffic-cli-'));
    mocks.loadConfig.mockResolvedValue({
      targetUrl: 'https://example.test/dashboard',
      exposureUrl: 'https://example.test/exposure',
      periods: ['1d', '7d', '30d'],
      preferredPageSize: 100,
      outputDir: mocks.outputDir,
      browserProfileDir: join(mocks.outputDir, 'profile'),
    });
    mocks.crawlPublicTrafficSources.mockResolvedValue({
      exposure: {
        overview: [
          { period: '1d', exposure: 10, visits: 2, amount: 3, conversionRate: 20 },
          { period: '7d', exposure: 70, visits: 14, amount: 21, conversionRate: 20 },
          { period: '30d', exposure: 300, visits: 60, amount: 90, conversionRate: 20 },
        ],
        products: [{ productName: '当前商品', platformProductId: 'p-current', exposure: 1000, visits: 100, amount: 200, custodyDays: null, raw: {} }],
      },
      dashboard: (['1d', '7d', '30d'] as const).map((period) => ({
        period,
        headers: [],
        rows: [],
        collection: {
          period,
          actualPageSizes: [1],
          pageCount: 1,
          rowCount: 1,
          dedupedRowCount: 1,
          displayedTotalCount: 1,
          pageSizeFallback: false,
          complete: true,
        },
      })) satisfies RawTableData[],
    });
    mocks.normalizeRowsForPeriod.mockReturnValue([
      {
        period: '1d',
        productName: '后链路商品',
        platformProductId: 'p-dashboard',
        visits: 1,
        createdOrders: 0,
        signedOrders: 0,
        reviewedOrders: 0,
        shippedOrders: 0,
      },
    ]);
    mocks.sendFeishuCard.mockResolvedValue({ sent: false, reason: 'test' });

    const historicalPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await mkdir(historicalPaths.dir, { recursive: true });
    const historicalDelta: ExposureDailyDelta[] = [
      {
        date: '2026-06-09',
        productName: '历史商品',
        platformProductId: 'p-history',
        exposure: 7,
        visits: 1,
        amount: 2,
        custodyDays: null,
        flags: [],
      },
    ];
    await writeFile(historicalPaths.exposureDailyDelta, JSON.stringify(historicalDelta, null, 2), 'utf8');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (mocks.outputDir) {
      await rm(mocks.outputDir, { recursive: true, force: true });
    }
  });

  it('keeps first-run daily delta empty while historical deltas still feed report summaries and rows', async () => {
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const dailyDelta = JSON.parse(await readFile(todayPaths.exposureDailyDelta, 'utf8')) as ExposureDailyDelta[];
    expect(dailyDelta).toEqual([]);

    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.summary['1d'].exposure).toBe(10);
    expect(context.summary['1d'].publicVisits).toBe(2);
    expect(context.summary['1d'].amount).toBe(3);
    expect(context.summary['1d'].exposureVisitRate).toBeCloseTo(0.2);
    expect(context.rows.find((row) => row.platformProductId === 'p-history')?.periods['7d'].exposure).toBe(7);

    await expect(readFile(buildPublicTrafficPaths(mocks.outputDir, '2026-06-09').exposureCumulativeProducts, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('商品级曝光历史不足');
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('昨日公域数据上下文缺失: 结论使用今日基准值');

    await expect(readFile(todayPaths.publicVisitRaw['1d'], 'utf8')).resolves.toContain('"period": "1d"');
    await expect(readFile(todayPaths.publicVisitRaw['7d'], 'utf8')).resolves.toContain('"period": "7d"');
    await expect(readFile(todayPaths.publicVisitRaw['30d'], 'utf8')).resolves.toContain('"period": "30d"');
  });

  it('passes previous report context and exposure histories into analyzer', async () => {
    const source = await readFile(join(process.cwd(), 'src/cli/publicTrafficReport.ts'), 'utf8');

    expect(source).toContain('loadPreviousReportSummary');
    expect(source).toContain('previousSummary');
    expect(source).toContain('dailyDelta,');
    expect(source).toContain('sevenDaySummary,');
    expect(source).toContain('thirtyDaySummary,');
    expect(source).toContain('cumulativeProducts: crawlResult.products');
  });

  it('loads yesterday report context summary for conclusions', async () => {
    const yesterdayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await writeFile(
      yesterdayPaths.reportContext,
      JSON.stringify({
        summary: {
          '1d': {
            exposure: 5,
            publicVisits: 1,
            dashboardVisits: 0,
            createdOrders: 0,
            shippedOrders: 0,
            amount: 1,
            exposureVisitRate: 0.1,
            visitCreatedOrderRate: 0,
            visitShipmentRate: 0,
          },
        },
      }),
      'utf8',
    );
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.conclusions[0].label).toBe('曝光');
    expect(context.conclusions[0].text).toContain('较昨日上升 5');
    expect(context.conclusions[0].text).not.toContain('暂无昨日公域数据上下文');
  });

  it('continues with baseline conclusions when yesterday report context is malformed', async () => {
    const yesterdayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await writeFile(yesterdayPaths.reportContext, '{bad json', 'utf8');
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.conclusions[0].label).toBe('基准');
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('昨日公域数据上下文读取失败:');
  });

  it('does not use yesterday report context with malformed summary fields', async () => {
    const yesterdayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await writeFile(yesterdayPaths.reportContext, JSON.stringify({ summary: { '1d': {} } }), 'utf8');
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.conclusions[0].label).toBe('基准');
    expect(context.conclusions[0].text).toContain('暂无昨日公域数据上下文');
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('昨日公域数据上下文读取失败: Invalid previous public traffic summary');
  });

  it('does not use yesterday report context when parsed JSON is null', async () => {
    const yesterdayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await writeFile(yesterdayPaths.reportContext, 'null', 'utf8');
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.conclusions[0].label).toBe('基准');
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('昨日公域数据上下文读取失败: Invalid previous public traffic summary');
  });

  it('treats an existing empty previous cumulative snapshot as history for new-product daily deltas', async () => {
    const yesterdayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-09');
    await writeFile(yesterdayPaths.exposureCumulativeProducts, '[]', 'utf8');
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const dailyDelta = JSON.parse(await readFile(todayPaths.exposureDailyDelta, 'utf8')) as ExposureDailyDelta[];
    expect(dailyDelta).toHaveLength(1);
    expect(dailyDelta[0]).toMatchObject({
      date: '2026-06-10',
      productName: '当前商品',
      platformProductId: 'p-current',
      exposure: 1000,
      visits: 100,
      amount: 200,
      flags: ['new_product'],
    });
    await expect(readFile(todayPaths.log, 'utf8')).resolves.not.toContain('商品级曝光历史不足');
  });
});
