import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import { loadConfig } from '../config/loadConfig.js';
import type { PeriodKey, RawTableData } from '../domain/types.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { buildInventorySameSkuSnapshot } from '../inventoryStatus/snapshot.js';
import { writeInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { analyzePublicTrafficData } from '../publicTraffic/analyzePublicTrafficData.js';
import { aggregateExposureDeltas } from '../publicTraffic/exposureAggregate.js';
import { computeExposureDailyDelta } from '../publicTraffic/exposureDelta.js';
import { resolveFallbackProductId } from '../publicTraffic/extractProductIdFromInfo.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { mergePublicTrafficData } from '../publicTraffic/mergePublicTrafficData.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';
import type {
  ExposureCumulativeProduct,
  ExposureDailyDelta,
  ExposureOverviewMetric,
  ExposureProductSummary,
  PublicTrafficDataReportContext,
} from '../publicTraffic/types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function requireArg(argv: string[], name: string): string {
  const value = argValue(argv, name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

async function backup(path: string, token: string): Promise<string> {
  const target = `${path}.bak-${token}`;
  await copyFile(path, target);
  return target;
}

function isEmptyDashboardTable(table: RawTableData): boolean {
  return table.headers.length === 0 && table.rows.length === 0 && table.collection.rowCount === 0 && table.collection.dedupedRowCount === 0 && table.collection.complete === false;
}

function normalizeDashboardRowsSafely(rawTables: RawTableData[]) {
  return rawTables.flatMap((table) => {
    try {
      return normalizeRowsForPeriod(table);
    } catch (error) {
      if (isEmptyDashboardTable(table)) return [];
      throw error;
    }
  });
}

function canonicalProductId(platformProductId: string, mapping: ProductIdMapping): string {
  return resolveFallbackProductId(platformProductId, mapping) ?? platformProductId;
}

function findSyntheticNewProductIds(
  baseline: ExposureCumulativeProduct[],
  current: ExposureCumulativeProduct[],
  mapping: ProductIdMapping,
): string[] {
  const baselineIds = new Set(baseline.map((row) => canonicalProductId(row.platformProductId, mapping)));
  return current
    .filter((row) => !baselineIds.has(canonicalProductId(row.platformProductId, mapping)))
    .map((row) => row.platformProductId);
}

function oneDaySummaryFromDelta(rows: ExposureDailyDelta[]): ExposureProductSummary[] {
  return rows.map((row) => ({
    productName: row.productName,
    platformProductId: row.platformProductId,
    exposure: row.exposure,
    visits: row.visits,
    amount: row.amount,
    visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
    days: 1,
    flags: row.flags,
  }));
}

function sumDelta(rows: ExposureDailyDelta[]) {
  return rows.reduce(
    (sum, row) => ({
      exposure: sum.exposure + row.exposure,
      visits: sum.visits + row.visits,
      amount: Math.round((sum.amount + row.amount) * 100) / 100,
    }),
    { exposure: 0, visits: 0, amount: 0 },
  );
}

function repairNote(input: { reportDate: string; targetDate: string; baselineDate: string }): string {
  return `${input.reportDate} 商品级曝光为修复估算：因 ${input.targetDate} 前一日累计快照损坏，本版使用 ${input.targetDate} 累计快照 - ${input.baselineDate} 累计快照重建；该值可能包含中间缺失日期的合计，不作为单日精确审计口径。`;
}

async function writeInventorySameSkuSnapshotSafely(input: {
  outputDir: string;
  runDate: string;
  reportDate: string;
  context: PublicTrafficDataReportContext;
  snapshotPath: string;
  productIdMappingPath?: string;
}): Promise<string | undefined> {
  try {
    const registryContext = await loadClosedOrderRegistryContext({
      ...(input.productIdMappingPath ? { productIdMapPath: input.productIdMappingPath } : {}),
      artifactsDir: input.outputDir,
    }, process.cwd());
    const sameSkuSnapshot = buildInventorySameSkuSnapshot({
      date: input.runDate,
      reportDate: input.reportDate,
      context: input.context,
      registry: registryContext.registry,
      overrideRisks: registryContext.overrideRisks,
    });
    await writeInventorySameSkuSnapshot(sameSkuSnapshot, input.snapshotPath);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function repairPublicTrafficExposure(argv = process.argv.slice(2)): Promise<void> {
  const config = await loadConfig();
  const targetDate = requireArg(argv, '--target-date');
  const baselineDate = requireArg(argv, '--baseline-date');
  const outputDir = argValue(argv, '--output-dir') ?? config.outputDir;
  const mappingPath = argValue(argv, '--product-id-map') ?? config.productIdMappingPath;
  const mapping = mappingPath ? await loadProductIdMapping(mappingPath) : {};
  const token = timestampToken();

  const targetPaths = buildPublicTrafficPaths(outputDir, targetDate);
  const baselinePaths = buildPublicTrafficPaths(outputDir, baselineDate);
  const priorContext = await readJson<PublicTrafficDataReportContext>(targetPaths.reportContext);
  const currentSnapshot = await readJson<ExposureCumulativeProduct[]>(targetPaths.exposureCumulativeProducts);
  const baselineSnapshot = await readJson<ExposureCumulativeProduct[]>(baselinePaths.exposureCumulativeProducts);
  const overview = await readJson<ExposureOverviewMetric[]>(targetPaths.exposureOverview);
  const rawTables = await Promise.all(PERIODS.map((period) => readJson<RawTableData>(targetPaths.publicVisitRaw[period])));
  const orderAnalysis = await readJson<PublicTrafficDataReportContext['orderAnalysis']>(targetPaths.orderAnalysis);

  const newProductPlatformIds = findSyntheticNewProductIds(baselineSnapshot, currentSnapshot, mapping);
  const dailyDelta = computeExposureDailyDelta(priorContext.date, baselineSnapshot, currentSnapshot, mapping, { newProductPlatformIds });

  const backups = await Promise.all([
    backup(targetPaths.exposureDailyDelta, token),
    backup(targetPaths.exposure7dSummary, token),
    backup(targetPaths.exposure30dSummary, token),
    backup(targetPaths.reportContext, token),
    backup(targetPaths.markdown, token),
    backup(targetPaths.workbook, token),
  ]);

  await writeJson(targetPaths.exposureDailyDelta, dailyDelta);
  const sevenDaySummary = aggregateExposureDeltas(await loadRecentExposureDeltas(outputDir, targetDate, 7), mapping);
  const thirtyDaySummary = aggregateExposureDeltas(await loadRecentExposureDeltas(outputDir, targetDate, 30), mapping);
  await writeJson(targetPaths.exposure7dSummary, sevenDaySummary);
  await writeJson(targetPaths.exposure30dSummary, thirtyDaySummary);

  const dashboardRows = normalizeDashboardRowsSafely(rawTables);
  const merged = mergePublicTrafficData({
    dashboardRows,
    exposureByPeriod: {
      '1d': oneDaySummaryFromDelta(dailyDelta),
      '7d': sevenDaySummary,
      '30d': thirtyDaySummary,
    },
    cumulativeProducts: currentSnapshot,
    mapping,
  });

  const note = repairNote({ reportDate: priorContext.date, targetDate, baselineDate });
  const context = analyzePublicTrafficData({
    date: priorContext.date,
    rows: merged.rows,
    overview,
    previousSummary: priorContext.previousSummary,
    dataQualityNotes: Array.from(new Set([...(priorContext.dataQualityNotes ?? []), note])),
    dailyDelta,
    sevenDaySummary,
    thirtyDaySummary,
    cumulativeProducts: currentSnapshot,
    orderAnalysis,
  });
  context.newProductPoolItems = priorContext.newProductPoolItems;
  context.newProductPoolIds = priorContext.newProductPoolIds;
  context.agentData = priorContext.agentData;

  await writeJson(targetPaths.reportContext, context);
  await writeFile(targetPaths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
  await writeFile(targetPaths.workbook, writePublicTrafficWorkbookBuffer(context));

  const inventoryWarning = await writeInventorySameSkuSnapshotSafely({
    outputDir,
    runDate: targetDate,
    reportDate: context.date,
    context,
    snapshotPath: targetPaths.sameSkuSnapshot,
    productIdMappingPath: mappingPath,
  });

  const repairLog = [
    `targetDate=${targetDate}`,
    `reportDate=${priorContext.date}`,
    `baselineDate=${baselineDate}`,
    `backupToken=${token}`,
    `newProductIds=${newProductPlatformIds.length}`,
    `dailyDeltaRows=${dailyDelta.length}`,
    `dailyDeltaSum=${JSON.stringify(sumDelta(dailyDelta))}`,
    `backups=${backups.join('; ')}`,
    inventoryWarning ? `inventorySnapshotWarning=${inventoryWarning}` : 'inventorySnapshot=updated',
  ].join('\n');
  const repairLogPath = `${targetPaths.dir}/公域曝光修复日志_${targetDate}.log`;
  await writeFile(repairLogPath, `${repairLog}\n`, 'utf8');

  console.log(repairLog);
  console.log(`repairLog=${repairLogPath}`);
}

repairPublicTrafficExposure().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
