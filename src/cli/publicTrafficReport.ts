import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { crawlExposurePage } from '../crawler/exposureCrawler.js';
import { sendFeishuText } from '../notify/feishu.js';
import { computeExposureDailyDelta } from '../publicTraffic/exposureDelta.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import type { ExposureCumulativeProduct, PublicTrafficReportContext } from '../publicTraffic/types.js';
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

async function sendFeishuTextSafely(text: string, log: ReturnType<typeof createRunLog>): Promise<void> {
  try {
    const feishuResult = await sendFeishuText(process.env, text);
    log.addEvent(feishuResult.sent ? '飞书通知已发送' : `飞书通知跳过: ${feishuResult.reason}`);
  } catch (error) {
    log.addEvent(`飞书通知失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runPublicTrafficReportCli(): Promise<void> {
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
    const dailyDelta = computeExposureDailyDelta(date, previousProducts, crawlResult.products);
    await writeFile(paths.exposureDailyDelta, JSON.stringify(dailyDelta, null, 2), 'utf8');
    log.addEvent(`日差分: ${dailyDelta.length} 条, 新品=${dailyDelta.filter((row) => row.flags.includes('new_product')).length}`);

    const context: PublicTrafficReportContext = {
      date,
      overview: crawlResult.overview,
      exposureOptimization: [],
      conversionOptimization: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };

    await writeFile(paths.reportContext, JSON.stringify(context, null, 2), 'utf8');
    await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
    await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));
    log.addEvent(`报告已生成: ${paths.markdown}`);

    const feishuText = buildPublicTrafficFeishuText(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });

    await sendFeishuTextSafely(feishuText, log);

    console.log(feishuText);

    console.log(`公域流量报告已生成: ${paths.dir}`);
  } catch (error) {
    log.addEvent(`错误: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await writeFile(paths.log, log.toText(), 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicTrafficReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
