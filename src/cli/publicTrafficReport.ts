import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { crawlPublicTrafficSources } from '../crawler/publicTrafficCrawler.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { annotateGoodsExportWorkbookWithInternalId } from '../mapping/annotateGoodsExportWorkbook.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { analyzePublicTrafficData } from '../publicTraffic/analyzePublicTrafficData.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { assessDashboardQuality } from '../publicTraffic/dashboardQuality.js';
import { aggregateExposureDeltas } from '../publicTraffic/exposureAggregate.js';
import { computeExposureDailyDelta } from '../publicTraffic/exposureDelta.js';
import { resolveFallbackProductId } from '../publicTraffic/extractProductIdFromInfo.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { updateGoodsLinkLifecycle, type GoodsLinkLifecycleState } from '../publicTraffic/goodsLinkLifecycle.js';
import { fetchRecentGoodsManagerProducts } from '../publicTraffic/goodsManagerNewProducts.js';
import { filterFirstSeenWithinDays, updateGoodsFirstSeen, type GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import { mergePublicTrafficData } from '../publicTraffic/mergePublicTrafficData.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { loadProductNameMap } from '../publicTraffic/productDisplayName.js';
import { savePublicTrafficRunState } from '../publicTraffic/publicTrafficRunState.js';
import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';
import type { PeriodProductMetrics, RawTableData } from '../domain/types.js';
import type { GoodsManagerNewProductPoolItem } from '../publicTraffic/goodsManagerNewProducts.js';
import type { ExposureCumulativeProduct, GoodsSnapshotItem, PublicTrafficDataReportContext, PublicTrafficDataSummary } from '../publicTraffic/types.js';
import { createRunLog } from '../storage/runLog.js';

const TODAY_DASHBOARD_NOT_UPDATED_NOTE = '今日访问数据支付宝暂未更新，本期访问量板块指标缺失。';
type FeishuSendTo = 'personal' | 'group' | 'both';

export function parseFeishuSendToArg(argv: string[]): FeishuSendTo | undefined {
  const flagIndex = argv.indexOf('--send-to');
  const rawValue = flagIndex >= 0 ? argv[flagIndex + 1] : argv.find((item) => item.startsWith('--send-to='))?.slice('--send-to='.length);
  if (!rawValue) return undefined;
  if (rawValue === 'personal' || rawValue === 'group' || rawValue === 'both') return rawValue;
  throw new Error(`Invalid --send-to value: ${rawValue}. Expected personal, group, or both.`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysBefore(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
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

interface PreviousCumulativeSnapshot {
  products: ExposureCumulativeProduct[];
  found: boolean;
}

export function parsePreviousCumulativeSnapshot(text: string): ExposureCumulativeProduct[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isExposureCumulativeProduct)) {
    throw new Error('Invalid previous exposure snapshot: expected ExposureCumulativeProduct[]');
  }

  return parsed;
}

function canonicalProductId(platformProductId: string, mapping: Record<string, string>): string {
  return resolveFallbackProductId(platformProductId, mapping) ?? platformProductId;
}

export function mergePreviousCumulativeSnapshots(snapshots: ExposureCumulativeProduct[][], mapping: Record<string, string>): ExposureCumulativeProduct[] {
  const merged = new Map<string, ExposureCumulativeProduct>();
  for (const snapshot of snapshots) {
    for (const row of snapshot) {
      const platformProductId = canonicalProductId(row.platformProductId, mapping);
      if (!merged.has(platformProductId)) {
        merged.set(platformProductId, { ...row, platformProductId });
      }
    }
  }
  return Array.from(merged.values());
}

async function loadPreviousCumulative(outputDir: string, date: string, mapping: Record<string, string>): Promise<PreviousCumulativeSnapshot> {
  const snapshots: ExposureCumulativeProduct[][] = [];
  for (let days = 1; days <= 7; days += 1) {
    const snapshotDate = daysBefore(date, days);
    const exposurePath = buildPublicTrafficPaths(outputDir, snapshotDate).exposureCumulativeProducts;
    try {
      snapshots.push(parsePreviousCumulativeSnapshot(await readFile(exposurePath, 'utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  if (snapshots.length > 0) return { products: mergePreviousCumulativeSnapshots(snapshots, mapping), found: true };
  return { products: [], found: false };
}

export function previousReportContextCandidatePaths(outputDir: string, date: string, cwd = process.cwd()): string[] {
  const previousDate = yesterday(date);
  const resolvedOutputDir = isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir);
  const candidates = [buildPublicTrafficPaths(resolvedOutputDir, previousDate).reportContext];
  const normalizedCwd = cwd.replace(/\\/g, '/');
  const marker = '/.worktrees/';
  const markerIndex = normalizedCwd.indexOf(marker);
  if (markerIndex >= 0) {
    const parentRoot = normalizedCwd.slice(0, markerIndex);
    candidates.push(buildPublicTrafficPaths(`${parentRoot}/${basename(resolvedOutputDir)}`, previousDate).reportContext);
  }
  return Array.from(new Set(candidates));
}

async function loadPreviousReportSummary(outputDir: string, date: string, log: ReturnType<typeof createRunLog>): Promise<PublicTrafficDataSummary | undefined> {
  const candidates = previousReportContextCandidatePaths(outputDir, date);
  let missing = true;
  for (const reportContextPath of candidates) {
  try {
    const parsed = JSON.parse(await readFile(reportContextPath, 'utf8')) as unknown;
    missing = false;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid previous public traffic summary');
    }
    const summary = (parsed as Partial<PublicTrafficDataReportContext>).summary?.['1d'];
    if (!isPublicTrafficDataSummary(summary)) {
      throw new Error('Invalid previous public traffic summary');
    }
    log.addEvent(`昨日公域数据上下文已读取: ${reportContextPath}`);
    return summary;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      continue;
    }
    missing = false;
    log.addEvent(`昨日公域数据上下文读取失败: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  }
  if (missing) log.addEvent('昨日公域数据上下文缺失: 结论使用今日基准值');
  return undefined;
}

function isPublicTrafficDataSummary(value: unknown): value is PublicTrafficDataSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<keyof PublicTrafficDataSummary, unknown>;
  return (
    Number.isFinite(summary.exposure) &&
    Number.isFinite(summary.publicVisits) &&
    Number.isFinite(summary.dashboardVisits) &&
    Number.isFinite(summary.createdOrders) &&
    Number.isFinite(summary.shippedOrders) &&
    Number.isFinite(summary.amount) &&
    Number.isFinite(summary.exposureVisitRate) &&
    Number.isFinite(summary.visitCreatedOrderRate) &&
    Number.isFinite(summary.visitShipmentRate)
  );
}

export function normalizeDashboardRowsForReport(rawTables: RawTableData[], log: ReturnType<typeof createRunLog>): PeriodProductMetrics[] {
  return rawTables.flatMap((table) => {
    try {
      return normalizeRowsForPeriod(table);
    } catch (error) {
      const isEmptyFailedTable =
        table.headers.length === 0 &&
        table.rows.length === 0 &&
        table.collection.rowCount === 0 &&
        table.collection.dedupedRowCount === 0 &&
        table.collection.complete === false;
      if (!isEmptyFailedTable) {
        throw error;
      }

      log.addEvent(`后链路数据跳过 ${table.period}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
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

async function loadGoodsManagerNewProductPool(date: string, log: ReturnType<typeof createRunLog>): Promise<GoodsManagerNewProductPoolItem[]> {
  const baseUrl = process.env.GOODS_MANAGER_BASE_URL?.trim();
  if (!baseUrl) return [];

  try {
    const products = await fetchRecentGoodsManagerProducts({ baseUrl, days: 7, referenceDate: date, requireAlipaySynced: true });
    log.addEvent(`goods-manager 新品池: ${products.length} 个商品`);
    return products;
  } catch (error) {
    log.addEvent(`goods-manager 新品池读取失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function goodsSnapshotFromMapping(mapping: ProductIdMapping): GoodsSnapshotItem[] {
  const seen = new Set<string>();
  const items: GoodsSnapshotItem[] = [];
  for (const [platformProductId, internalProductId] of Object.entries(mapping)) {
    const id = internalProductId.trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({ platformProductId, internalProductId: id, productName: '' });
  }
  return items;
}

async function loadGoodsFirstSeenState(path: string): Promise<{ state: GoodsFirstSeenIndex; found: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: {}, found: true };
    const state: GoodsFirstSeenIndex = {};
    for (const [internalId, value] of Object.entries(parsed)) {
      if (!/^\d+$/.test(internalId) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (typeof record.firstSeenDate !== 'string') continue;
      state[internalId] = {
        firstSeenDate: record.firstSeenDate,
        platformProductId: typeof record.platformProductId === 'string' ? record.platformProductId : '',
        productName: typeof record.productName === 'string' ? record.productName : '',
        ...(record.baseline === true ? { baseline: true } : {}),
      };
    }
    return { state, found: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { state: {}, found: false };
    throw error;
  }
}

async function saveGoodsFirstSeenState(path: string, state: GoodsFirstSeenIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function isGoodsLinkLifecycleState(value: unknown): value is GoodsLinkLifecycleState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (!state.active || typeof state.active !== 'object' || Array.isArray(state.active) || !Array.isArray(state.removedLinks)) return false;
  const activeValid = Object.values(state.active as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return typeof record.platformProductId === 'string' && typeof record.productName === 'string';
  });
  const removedValid = state.removedLinks.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.productId === 'string' &&
      typeof record.platformProductId === 'string' &&
      typeof record.productName === 'string' &&
      typeof record.removedDate === 'string' &&
      record.reason === '商品总表缺失' &&
      record.source === 'goods_snapshot_diff'
    );
  });
  return activeValid && removedValid;
}

async function loadGoodsLinkLifecycleState(path: string, log: ReturnType<typeof createRunLog>): Promise<GoodsLinkLifecycleState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isGoodsLinkLifecycleState(parsed)) throw new Error('Invalid goods link lifecycle state');
    return parsed;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    log.addEvent('商品链接生命周期状态损坏: 重新初始化');
    return null;
  }
}

async function saveGoodsLinkLifecycleState(path: string, state: GoodsLinkLifecycleState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function filterNewLinkPoolByFirstSeen(products: GoodsManagerNewProductPoolItem[], currentGoods: GoodsSnapshotItem[], firstSeen: GoodsFirstSeenIndex, referenceDate: string): GoodsManagerNewProductPoolItem[] {
  const eligibleIds = new Set(filterFirstSeenWithinDays(currentGoods, firstSeen, referenceDate, 7).map((item) => item.internalProductId));
  return sortNewLinkPoolBySubmittedAt(products.filter((item) => eligibleIds.has(item.productId)));
}

function parseSubmittedAtTime(value: string): number {
  if (!value.trim()) return Number.NEGATIVE_INFINITY;
  const date = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
}

function compareProductIds(a: string, b: string): number {
  const aNumber = /^\d+$/.test(a) ? Number(a) : null;
  const bNumber = /^\d+$/.test(b) ? Number(b) : null;
  if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  return a.localeCompare(b);
}

function sortNewLinkPoolBySubmittedAt(items: GoodsManagerNewProductPoolItem[]): GoodsManagerNewProductPoolItem[] {
  return [...items].sort((a, b) => parseSubmittedAtTime(b.submittedAt) - parseSubmittedAtTime(a.submittedAt) || compareProductIds(a.productId, b.productId));
}

function resolveProductIdMappingPath(config: Awaited<ReturnType<typeof loadConfig>>): string {
  return config.productIdMappingPath ?? 'config/product-id-map.json';
}

async function refreshProductIdMappingForReport(exportPath: string, mappingPath: string, logPath: string, log: ReturnType<typeof createRunLog>): Promise<void> {
  log.addEvent('开始从商品总表刷新商品ID映射');
  const mappingCount = await writeProductIdMappingFromExport(exportPath, mappingPath, logPath);
  log.addEvent(`商品ID映射已刷新: ${mappingCount} 条, source=${exportPath}`);
}

function isEmptyDashboardTable(table: RawTableData): boolean {
  return table.headers.length === 0 && table.rows.length === 0 && table.collection.rowCount === 0 && table.collection.dedupedRowCount === 0 && table.collection.complete === false;
}

function dashboardDataQualityNotes(rawTables: RawTableData[]): string[] {
  return rawTables.some((table) => table.period === '1d' && isEmptyDashboardTable(table)) ? [TODAY_DASHBOARD_NOT_UPDATED_NOTE] : [];
}

export async function runPublicTrafficReportCli(): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const runDate = today();
  const dataDate = yesterday(runDate);
  const paths = buildPublicTrafficPaths(config.outputDir, runDate);
  const log = createRunLog(new Date().toISOString(), config.exposureUrl ?? config.targetUrl);

  await mkdir(paths.dir, { recursive: true });

  try {
    const mappingPath = resolveProductIdMappingPath(config);
    log.addEvent('开始下载商品总表、抓取曝光与后链路数据');
    const { goodsExportPath, exposure: crawlResult, dashboard: rawTables, orderAnalysis: orderAnalysisCapture } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);
    await refreshProductIdMappingForReport(goodsExportPath, mappingPath, paths.productIdMappingSyncLog, log);
    const mapping = await loadMappingSafely(mappingPath, log);
    const currentGoodsSnapshot = goodsSnapshotFromMapping(mapping);
    await writeFile(paths.goodsListSnapshot, JSON.stringify(currentGoodsSnapshot, null, 2), 'utf8');
    const previousFirstSeen = await loadGoodsFirstSeenState(paths.goodsFirstSeenState);
    const firstSeenState = updateGoodsFirstSeen({
      currentDate: runDate,
      previous: previousFirstSeen.state,
      current: currentGoodsSnapshot,
      baseline: !previousFirstSeen.found,
    });
    await saveGoodsFirstSeenState(paths.goodsFirstSeenState, firstSeenState);
    const previousLinkLifecycleState = await loadGoodsLinkLifecycleState(paths.goodsLinkLifecycleState, log);
    const linkLifecycle = updateGoodsLinkLifecycle({
      currentDate: runDate,
      previous: previousLinkLifecycleState,
      current: currentGoodsSnapshot,
    });
    await saveGoodsLinkLifecycleState(paths.goodsLinkLifecycleState, linkLifecycle.state);
    log.addEvent(`商品链接生命周期: 当前=${Object.keys(linkLifecycle.state.active).length}, 近7天下架=${linkLifecycle.removedLinks.length}`);

    try {
      const annotatedCount = annotateGoodsExportWorkbookWithInternalId(paths.goodsExportWorkbook);
      log.addEvent(`商品总表端内ID列已注入: ${annotatedCount} 行`);
    } catch (error) {
      log.addEvent(`商品总表端内ID列注入失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    await writeFile(paths.exposureCumulativeProducts, JSON.stringify(crawlResult.products, null, 2), 'utf8');
    log.addEvent(`保存累计快照: ${crawlResult.products.length} 条商品`);

    const orderAnalysis = { ...orderAnalysisCapture, runDate };
    await writeFile(paths.orderAnalysis, JSON.stringify(orderAnalysis, null, 2), 'utf8');
    const latestDir = `${config.outputDir}/latest`;
    await mkdir(latestDir, { recursive: true });
    await writeFile(`${latestDir}/order-analysis.json`, JSON.stringify(orderAnalysis, null, 2), 'utf8');
    log.addEvent(`订单分析: ${Object.values(orderAnalysis.pages).map((page) => `${page.label}=${page.indicators.length}条(${page.dataDate ?? '未知'})`).join(', ')}`);

    if (crawlResult.overview.length > 0) {
      await writeFile(paths.exposureOverview, JSON.stringify(crawlResult.overview, null, 2), 'utf8');
      log.addEvent(`保存总体概况: ${crawlResult.overview.length} 个周期`);
    }

    const previous = await loadPreviousCumulative(config.outputDir, runDate, mapping);
    if (!previous.found) {
      log.addEvent('商品级曝光历史不足: 跳过商品级日差分');
    }
    const dailyDelta = previous.found ? computeExposureDailyDelta(dataDate, previous.products, crawlResult.products, mapping) : [];
    await writeFile(paths.exposureDailyDelta, JSON.stringify(dailyDelta, null, 2), 'utf8');
    log.addEvent(`日差分: ${dailyDelta.length} 条, 新品=${dailyDelta.filter((row) => row.flags.includes('new_product')).length}`);

    const sevenDayDeltas = await loadRecentExposureDeltas(config.outputDir, runDate, 7);
    const thirtyDayDeltas = await loadRecentExposureDeltas(config.outputDir, runDate, 30);
    const sevenDaySummary = aggregateExposureDeltas(sevenDayDeltas, mapping);
    const thirtyDaySummary = aggregateExposureDeltas(thirtyDayDeltas, mapping);
    await writeFile(paths.exposure7dSummary, JSON.stringify(sevenDaySummary, null, 2), 'utf8');
    await writeFile(paths.exposure30dSummary, JSON.stringify(thirtyDaySummary, null, 2), 'utf8');
    log.addEvent(`7日汇总: ${sevenDaySummary.length} 条商品`);
    log.addEvent(`30日汇总: ${thirtyDaySummary.length} 条商品`);

    log.addEvent('开始处理后链路数据');
    for (const table of rawTables) {
      await writeFile(paths.publicVisitRaw[table.period], JSON.stringify(table, null, 2), 'utf8');
      log.addPeriodStats(table.collection);
    }
    const dashboardRows = normalizeDashboardRowsForReport(rawTables, log);
    const dataQualityNotes = dashboardDataQualityNotes(rawTables);
    for (const note of dataQualityNotes) log.addEvent(note);
    log.addEvent(`后链路数据: ${dashboardRows.length} 条周期商品记录`);

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
      cumulativeProducts: crawlResult.products,
      mapping,
    });
    const previousSummary = await loadPreviousReportSummary(config.outputDir, runDate, log);
    const context = analyzePublicTrafficData({
      date: dataDate,
      rows: merged.rows,
      overview: crawlResult.overview,
      previousSummary,
      dataQualityNotes,
      dailyDelta,
      sevenDaySummary,
      thirtyDaySummary,
      cumulativeProducts: crawlResult.products,
      orderAnalysis,
    });
    const rawNewProductPoolItems = await loadGoodsManagerNewProductPool(runDate, log);
    const newProductPoolItems = filterNewLinkPoolByFirstSeen(rawNewProductPoolItems, currentGoodsSnapshot, firstSeenState, runDate);
    if (rawNewProductPoolItems.length > 0) {
      log.addEvent(`goods-manager 新链接观察: 原始=${rawNewProductPoolItems.length}, 商品总表近7天首次出现=${newProductPoolItems.length}`);
    }
    if (newProductPoolItems.length > 0) {
      context.newProductPoolItems = newProductPoolItems;
      context.newProductPoolIds = newProductPoolItems.map((item) => item.productId);
    }
    context.agentData = { ...(context.agentData ?? {}), removedLinks: linkLifecycle.removedLinks };
    log.addEvent(
      `规则分析: 曝光不足=${context.lowExposure.length}, 点击弱=${context.weakClick.length}, 转化弱=${context.weakConversion.length}, 高潜力=${context.highPotential.length}, 新品观察=${context.newProductObservation.length}, 生命周期治理=${context.lifecycleGovernance.length}, 建议操作=${context.recommendedActions.length}`,
    );

    await writeFile(paths.reportContext, JSON.stringify(context, null, 2), 'utf8');
    await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
    await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));
    log.addEvent(`报告已生成: ${paths.markdown}`);

    const productNameMap = await loadProductNameMap('config/product-name-map.json', (message) => log.addEvent(message));
    const card = buildPublicTrafficCard(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    }, {
      productNameMap,
    });
    const fallbackText = buildPublicTrafficFeishuText(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });

    const firstReportSent = await sendFeishuCardSafely(card, fallbackText, log);
    await savePublicTrafficRunState(paths.publicTrafficRunState, {
      date: runDate,
      firstReportSent,
      firstReportGeneratedAt: new Date().toISOString(),
      firstDashboardQuality: assessDashboardQuality(rawTables, context.dataQualityNotes),
      dashboardRefreshResent: false,
    });
    log.addEvent(`首版日报运行状态已记录: ${paths.publicTrafficRunState}`);

    console.log(fallbackText);

    console.log(`公域流量报告已生成: ${paths.dir}`);
  } catch (error) {
    log.addEvent(`错误: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await writeFile(paths.log, log.toText(), 'utf8');
  }
}

async function sendFeishuCardSafely(card: Record<string, unknown>, fallbackText: string, log: ReturnType<typeof createRunLog>): Promise<boolean> {
  try {
    const sendTo = parseFeishuSendToArg(process.argv);
    const env = sendTo ? { ...process.env, FEISHU_SEND_TO: sendTo } : process.env;
    const feishuResult = await sendFeishuCard(env, card, fallbackText);
    log.addEvent(feishuResult.sent ? '飞书通知已发送' : `飞书通知跳过: ${feishuResult.reason}`);
    return feishuResult.sent;
  } catch (error) {
    log.addEvent(`飞书通知失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicTrafficReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
