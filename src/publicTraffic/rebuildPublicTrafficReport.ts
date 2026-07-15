import { readFile, writeFile } from 'node:fs/promises';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import type { PeriodKey, RawTableData } from '../domain/types.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { buildInventorySameSkuSnapshot } from '../inventoryStatus/snapshot.js';
import { writeInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { analyzePublicTrafficData } from './analyzePublicTrafficData.js';
import { buildPublicTrafficCard } from './buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from './buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from './buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from './buildPublicTrafficWorkbook.js';
import { mergePublicTrafficData } from './mergePublicTrafficData.js';
import { buildPublicTrafficPaths } from './paths.js';
import type { ExposureCumulativeProduct, ExposureDailyDelta, ExposureOverviewMetric, ExposureProductSummary, PublicTrafficDataReportContext } from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface RebuildPublicTrafficReportInput {
  outputDir: string;
  date: string;
  productIdMappingPath?: string;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  refreshedAt?: string;
  sendTo?: 'personal' | 'group' | 'both';
  send?: boolean;
}

export interface RebuildPublicTrafficReportResult {
  context: PublicTrafficDataReportContext;
  markdownPath: string;
  workbookPath: string;
  sent: boolean;
  sendReason?: string;
  inventorySnapshotWarning?: string;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function loadMapping(path: string | undefined): Promise<ProductIdMapping> {
  return path ? loadProductIdMapping(path) : {};
}

function normalizeDashboardRows(rawTables: RawTableData[]) {
  return rawTables.flatMap((table) => normalizeRowsForPeriod(table));
}

function filterRecoveredDashboardNotes(notes: string[] | undefined): string[] {
  return (notes ?? []).filter((note) => !(/访问数据|访问页|后链路|访问量板块/.test(note) && /缺失|未更新|失败|跳过/.test(note)));
}

function rebuildNote(refreshedAt: string | undefined): string {
  return `访问页数据已于 ${refreshedAt ?? new Date().toISOString()} 补抓更新，本报告为重建版。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeInventorySameSkuSnapshotSafely(input: {
  outputDir: string;
  date: string;
  reportDate: string;
  context: PublicTrafficDataReportContext;
  snapshotPath: string;
  productIdMappingPath?: string;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
}): Promise<string | undefined> {
  try {
    const registryContext = await loadClosedOrderRegistryContext({
      ...input.closedOrderRegistryPaths,
      ...(input.productIdMappingPath ? { productIdMapPath: input.productIdMappingPath } : {}),
      artifactsDir: input.closedOrderRegistryPaths?.artifactsDir ?? input.outputDir,
      referenceDate: input.date,
    }, process.cwd());
    const sameSkuSnapshot = buildInventorySameSkuSnapshot({
      date: input.date,
      reportDate: input.reportDate,
      context: input.context,
      registry: registryContext.registry,
      overrideRisks: registryContext.overrideRisks,
    });
    await writeInventorySameSkuSnapshot(sameSkuSnapshot, input.snapshotPath);
    return undefined;
  } catch (error) {
    const warning = `inventory same-sku snapshot skipped: ${errorMessage(error)}`;
    console.warn(warning);
    return warning;
  }
}

export async function rebuildPublicTrafficReport(input: RebuildPublicTrafficReportInput): Promise<RebuildPublicTrafficReportResult> {
  const paths = buildPublicTrafficPaths(input.outputDir, input.date);
  const priorContext = await readJson<PublicTrafficDataReportContext>(paths.reportContext);
  const mapping = await loadMapping(input.productIdMappingPath);
  const rawTables = await Promise.all(PERIODS.map((period) => readJson<RawTableData>(paths.publicVisitRaw[period])));
  const dashboardRows = normalizeDashboardRows(rawTables);
  const cumulativeProducts = await readJson<ExposureCumulativeProduct[]>(paths.exposureCumulativeProducts);
  const overview = await readJson<ExposureOverviewMetric[]>(paths.exposureOverview);
  const dailyDelta = await readJson<ExposureDailyDelta[]>(paths.exposureDailyDelta);
  const sevenDaySummary = await readJson<ExposureProductSummary[]>(paths.exposure7dSummary);
  const thirtyDaySummary = await readJson<ExposureProductSummary[]>(paths.exposure30dSummary);
  const orderAnalysis = await readJson<PublicTrafficDataReportContext['orderAnalysis']>(paths.orderAnalysis);

  const merged = mergePublicTrafficData({
    dashboardRows,
    exposureByPeriod: {
      '1d': dailyDelta.map((row) => ({
        productName: row.productName,
        platformProductId: row.platformProductId,
        exposure: row.exposure,
        visits: row.visits,
        amount: row.amount,
        visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
        days: 1,
        flags: row.flags,
      })),
      '7d': sevenDaySummary,
      '30d': thirtyDaySummary,
    },
    cumulativeProducts,
    mapping,
  });

  const context = analyzePublicTrafficData({
    date: priorContext.date,
    rows: merged.rows,
    overview,
    dataQualityNotes: [...filterRecoveredDashboardNotes(priorContext.dataQualityNotes), rebuildNote(input.refreshedAt)],
    dailyDelta,
    sevenDaySummary,
    thirtyDaySummary,
    cumulativeProducts,
    orderAnalysis,
  });

  context.newProductPoolItems = priorContext.newProductPoolItems;
  context.newProductPoolIds = priorContext.newProductPoolIds;
  context.agentData = priorContext.agentData;

  const inventorySnapshotWarning = await writeInventorySameSkuSnapshotSafely({
    outputDir: input.outputDir,
    date: input.date,
    reportDate: context.date,
    context,
    snapshotPath: paths.sameSkuSnapshot,
    productIdMappingPath: input.productIdMappingPath,
    closedOrderRegistryPaths: input.closedOrderRegistryPaths,
  });

  await writeFile(paths.reportContext, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
  await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));

  if (input.send === false) return { context, markdownPath: paths.markdown, workbookPath: paths.workbook, sent: false, sendReason: 'send disabled', inventorySnapshotWarning };

  const env = input.sendTo ? { ...process.env, FEISHU_SEND_TO: input.sendTo } : process.env;
  const card = buildPublicTrafficCard(context, { markdownPath: paths.markdown, workbookPath: paths.workbook });
  const fallbackText = buildPublicTrafficFeishuText(context, { markdownPath: paths.markdown, workbookPath: paths.workbook });
  const result = await sendFeishuCard(env, card, fallbackText);
  return { context, markdownPath: paths.markdown, workbookPath: paths.workbook, sent: result.sent, sendReason: result.sent ? undefined : result.reason, inventorySnapshotWarning };
}
