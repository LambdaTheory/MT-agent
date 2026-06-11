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
  downloadGoodsExport: vi.fn(),
  writeProductIdMappingFromExport: vi.fn(),
  loadProductIdMapping: vi.fn(),
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

vi.mock('../src/crawler/goodsExportCrawler.js', () => ({
  downloadGoodsExport: mocks.downloadGoodsExport,
}));

vi.mock('../src/mapping/refreshProductIdMapping.js', () => ({
  writeProductIdMappingFromExport: mocks.writeProductIdMappingFromExport,
}));

vi.mock('../src/mapping/productIdMapping.js', () => ({
  loadProductIdMapping: mocks.loadProductIdMapping,
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
      goodsExportPath: join(mocks.outputDir, 'goods.xlsx'),
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
      orderAnalysis: {
        capturedAt: '2026-06-10T12:00:00Z',
        pages: {
          overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-09', indicators: [{ label: '创建订单量', value: '1', delta: '' }] },
          delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-09', indicators: [] },
          return: { key: 'return', label: '归还分析', dataDate: '2026-06-09', indicators: [] },
          customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-09', indicators: [] },
        },
      },
    });
    mocks.downloadGoodsExport.mockResolvedValue(join(mocks.outputDir, 'goods.xlsx'));
    mocks.writeProductIdMappingFromExport.mockResolvedValue(50);
    mocks.loadProductIdMapping.mockResolvedValue({});
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

    const orderAnalysisJson = JSON.parse(await readFile(todayPaths.orderAnalysis, 'utf8')) as { runDate: string };
    expect(orderAnalysisJson.runDate).toBe('2026-06-10');
    const latestOrderAnalysis = JSON.parse(await readFile(join(mocks.outputDir, 'latest', 'order-analysis.json'), 'utf8')) as { runDate: string };
    expect(latestOrderAnalysis.runDate).toBe('2026-06-10');
    expect(context.orderAnalysis?.pages?.overview?.label).toBe('标准订单分析');
  });

  it('uses the source data date in the report title while keeping output paths on the run date', async () => {
    vi.setSystemTime(new Date('2026-06-11T12:00:00Z'));
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const runPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-11');
    const context = JSON.parse(await readFile(runPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    const markdown = await readFile(runPaths.markdown, 'utf8');
    expect(context.date).toBe('2026-06-10');
    expect(markdown).toContain('# 公域数据日报 2026-06-10');
    await expect(readFile(buildPublicTrafficPaths(mocks.outputDir, '2026-06-10').reportContext, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('parses optional Feishu send target argument', async () => {
    const { parseFeishuSendToArg } = await import('../src/cli/publicTrafficReport.js');

    expect(parseFeishuSendToArg(['node', 'cli'])).toBeUndefined();
    expect(parseFeishuSendToArg(['node', 'cli', '--send-to', 'group'])).toBe('group');
    expect(parseFeishuSendToArg(['node', 'cli', '--send-to=both'])).toBe('both');
    expect(() => parseFeishuSendToArg(['node', 'cli', '--send-to', 'bad'])).toThrow('Invalid --send-to value: bad');
  });

  it('refreshes product id mapping from goods export before loading mapping', async () => {
    const source = await readFile(join(process.cwd(), 'src/cli/publicTrafficReport.ts'), 'utf8');

    expect(source).toContain("import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';");
    expect(source).not.toContain("import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';");
    expect(source).toContain('const { goodsExportPath, exposure: crawlResult, dashboard: rawTables, orderAnalysis: orderAnalysisCapture } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);');
    expect(source).toContain('await refreshProductIdMappingForReport(goodsExportPath, mappingPath, paths.productIdMappingSyncLog, log);');
    expect(source.indexOf('await refreshProductIdMappingForReport(goodsExportPath')).toBeLessThan(source.indexOf('const mapping = await loadMappingSafely'));
    expect(source).toContain('paths.goodsExportWorkbook');
    expect(source).toContain('paths.productIdMappingSyncLog');
  });

  it('loads the refreshed default mapping path when productIdMappingPath is not configured', async () => {
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    expect(mocks.crawlPublicTrafficSources).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining('商品总表_2026-06-10.xlsx'));
    expect(mocks.writeProductIdMappingFromExport).toHaveBeenCalledWith(join(mocks.outputDir, 'goods.xlsx'), 'config/product-id-map.json', expect.any(String));
    expect(mocks.loadProductIdMapping).toHaveBeenCalledWith('config/product-id-map.json');
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

  it('marks one-day dashboard empty table as Alipay not updated instead of zero traffic', async () => {
    mocks.crawlPublicTrafficSources.mockResolvedValueOnce({
      goodsExportPath: join(mocks.outputDir, 'goods.xlsx'),
      exposure: {
        overview: [{ period: '1d', exposure: 10, visits: 2, amount: 3, conversionRate: 20 }],
        products: [{ productName: '当前商品', platformProductId: 'p-current', exposure: 1000, visits: 100, amount: 200, custodyDays: null, raw: {} }],
      },
      dashboard: [
        {
          period: '1d',
          headers: [],
          rows: [],
          collection: { period: '1d', actualPageSizes: [], pageCount: 0, rowCount: 0, dedupedRowCount: 0, displayedTotalCount: 0, pageSizeFallback: false, complete: false },
        },
        ...(['7d', '30d'] as const).map((period) => ({
          period,
          headers: [],
          rows: [],
          collection: { period, actualPageSizes: [1], pageCount: 1, rowCount: 1, dedupedRowCount: 1, displayedTotalCount: 1, pageSizeFallback: false, complete: true },
        })),
      ] satisfies RawTableData[],
      orderAnalysis: {
        capturedAt: '2026-06-10T12:00:00Z',
        pages: {
          overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-09', indicators: [] },
          delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-09', indicators: [] },
          return: { key: 'return', label: '归还分析', dataDate: '2026-06-09', indicators: [] },
          customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-09', indicators: [] },
        },
      },
    });
    mocks.normalizeRowsForPeriod.mockImplementation((table) => {
      if (table.period === '1d') throw new Error('Missing required headers for 1d');
      return [];
    });
    const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

    await runPublicTrafficReportCli();

    const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
    const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
    expect(context.dataQualityNotes).toEqual(['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。']);
    await expect(readFile(todayPaths.markdown, 'utf8')).resolves.toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
    await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
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
      date: '2026-06-09',
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
