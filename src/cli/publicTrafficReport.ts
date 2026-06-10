import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { crawlDashboard } from '../crawler/dashboardCrawler.js';
import { crawlExposurePage } from '../crawler/exposureCrawler.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { loadProductIdMapping } from '../mapping/productIdMapping.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { analyzePublicTrafficData } from '../publicTraffic/analyzePublicTrafficData.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { aggregateExposureDeltas } from '../publicTraffic/exposureAggregate.js';
import { computeExposureDailyDelta } from '../publicTraffic/exposureDelta.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { mergePublicTrafficData } from '../publicTraffic/mergePublicTrafficData.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';
import type { ExposureCumulativeProduct } from '../publicTraffic/types.js';
import { createRunLog } from '../storage/runLog.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isExposureCumulativeProduct(value: unknown): value is ExposureCumulativeProduct {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.productName === 'string' &&
    typeof row.platformProductId === 'string' &&
    typeof row.exposure === 'number' &&
    typeof row.visits === 'number' &&
    typeof row.amount === 'number' &&
    (typeof row.custodyDays === 'number' || row.custodyDays === null) &&
    !!row.raw &&
    typeof row.raw === 'object' &&
    !Array.isArray(row.raw)
  );
}

export function parsePreviousCumulativeSnapshot(text: string): ExposureCumulativeProduct[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isExposureCumulativeProduct)) {
    throw new Error('Invalid previous exposure snapshot: expected ExposureCumulativeProduct[]');
  }

  return parsed;
}

async function loadPreviousCumulative(outputDir: string, date: string): Promise<ExposureCumulativeProduct[]> {
  const prev = buildPublicTrafficPaths(outputDir, yesterday(date));
  try {
    return parsePreviousCumulativeSnapshot(await readFile(prev.exposureCumulativeProducts, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function loadMappingSafely(path: string | undefined, log: ReturnType<typeof createRunLog>) {
  if (!path) {
    log.addEvent('商品ID映射跳过: 未配置 productIdMappingPath');
    return {};
  }
  try {
    return await loadProductIdMapping(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      log.addEvent(`商品ID映射缺失: ${path}`);
      return {};
    }
    throw error;
  }
}

export async function runPublicTrafficReportCli(): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const date = today();
  const paths = buildPublicTrafficPaths(config.outputDir, date);
  const log = createRunLog(new Date().toISOString(), config.exposureUrl ?? config.targetUrl);

  await mkdir(paths.dir, { recursive: true });

  try {
    log.addEvent('开始抓取曝光数据');
    const crawlResult = await crawlExposurePage(config);

    await writeFile(paths.exposureCumulativeProducts, JSON.stringify(crawlResult.products, null, 2), 'utf8');
    log.addEvent(`保存累计快照: ${crawlResult.products.length} 条商品`);

    if (crawlResult.overview.length > 0) {
      await writeFile(paths.exposureOverview, JSON.stringify(crawlResult.overview, null, 2), 'utf8');
      log.addEvent(`保存总体概况: ${crawlResult.overview.length} 个周期`);
    }

    const previousProducts = await loadPreviousCumulative(config.outputDir, date);
    const hasReliableExposureHistory = previousProducts.length > 0;
    if (!hasReliableExposureHistory) {
      log.addEvent('商品级曝光历史不足: 跳过商品级曝光聚合');
    }
    const dailyDelta = computeExposureDailyDelta(date, previousProducts, crawlResult.products);
    await writeFile(paths.exposureDailyDelta, JSON.stringify(dailyDelta, null, 2), 'utf8');
    log.addEvent(`日差分: ${dailyDelta.length} 条, 新品=${dailyDelta.filter((row) => row.flags.includes('new_product')).length}`);

    const sevenDayDeltas = await loadRecentExposureDeltas(config.outputDir, date, 7);
    const thirtyDayDeltas = await loadRecentExposureDeltas(config.outputDir, date, 30);
    const sevenDaySummary = aggregateExposureDeltas(sevenDayDeltas);
    const thirtyDaySummary = aggregateExposureDeltas(thirtyDayDeltas);
    await writeFile(paths.exposure7dSummary, JSON.stringify(sevenDaySummary, null, 2), 'utf8');
    await writeFile(paths.exposure30dSummary, JSON.stringify(thirtyDaySummary, null, 2), 'utf8');
    log.addEvent(`7日汇总: ${sevenDaySummary.length} 条商品`);
    log.addEvent(`30日汇总: ${thirtyDaySummary.length} 条商品`);

    log.addEvent('开始抓取后链路数据');
    const rawTables = await crawlDashboard(config);
    for (const table of rawTables) {
      log.addPeriodStats(table.collection);
    }
    const dashboardRows = rawTables.flatMap(normalizeRowsForPeriod);
    log.addEvent(`后链路数据: ${dashboardRows.length} 条周期商品记录`);

    const mapping = await loadMappingSafely(config.productIdMappingPath, log);
    const merged = mergePublicTrafficData({
      dashboardRows,
      exposureByPeriod: {
        '1d': hasReliableExposureHistory
          ? dailyDelta.map((row) => ({
              productName: row.productName,
              platformProductId: row.platformProductId,
              exposure: row.exposure,
              visits: row.visits,
              amount: row.amount,
              visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
              days: 1,
              flags: row.flags,
            }))
          : [],
        '7d': hasReliableExposureHistory ? sevenDaySummary : [],
        '30d': hasReliableExposureHistory ? thirtyDaySummary : [],
      },
      cumulativeProducts: crawlResult.products,
      mapping,
    });
    const context = analyzePublicTrafficData({
      date,
      rows: merged.rows,
      overview: crawlResult.overview,
    });
    log.addEvent(
      `规则分析: 曝光不足=${context.lowExposure.length}, 点击弱=${context.weakClick.length}, 转化弱=${context.weakConversion.length}, 高潜力=${context.highPotential.length}`,
    );

    await writeFile(paths.reportContext, JSON.stringify(context, null, 2), 'utf8');
    await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
    await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));
    log.addEvent(`报告已生成: ${paths.markdown}`);

    const card = buildPublicTrafficCard(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });
    const fallbackText = buildPublicTrafficFeishuText(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });

    await sendFeishuCardSafely(card, fallbackText, log);

    console.log(fallbackText);

    console.log(`公域流量报告已生成: ${paths.dir}`);
  } catch (error) {
    log.addEvent(`错误: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await writeFile(paths.log, log.toText(), 'utf8');
  }
}

async function sendFeishuCardSafely(card: Record<string, unknown>, fallbackText: string, log: ReturnType<typeof createRunLog>): Promise<void> {
  try {
    const feishuResult = await sendFeishuCard(process.env, card, fallbackText);
    log.addEvent(feishuResult.sent ? '飞书通知已发送' : `飞书通知跳过: ${feishuResult.reason}`);
  } catch (error) {
    log.addEvent(`飞书通知失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicTrafficReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
