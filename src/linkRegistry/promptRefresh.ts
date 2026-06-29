import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import {
  loadClosedOrderRegistryContext,
  loadOptionalJson,
  resolveClosedOrderRegistryPaths,
  type ClosedOrderRegistryContext,
} from '../closedOrderFeedback/runtime.js';
import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';
import { buildLinkRegistryMaintenanceReport, isLinkRegistryMaintenanceIgnoredEntry } from './maintenance.js';
import { fetchDaemonCatalogSnapshot, loadOptionalDaemonCatalogSnapshot, mergeGoodsSnapshotWithDaemon, saveDaemonCatalogSnapshot } from './daemonCatalog.js';
import { parseGoodsExportSnapshot } from '../mapping/goodsExportMapping.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';
import { updateGoodsLinkLifecycle, type GoodsLinkLifecycleState } from '../publicTraffic/goodsLinkLifecycle.js';
import { updateGoodsFirstSeen, type GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import type { GoodsSnapshotItem } from '../publicTraffic/types.js';
import type { LinkRegistryEntry } from './types.js';

export interface LinkRegistryRefreshGroupSummary {
  label: string;
  totalCount: number;
  pendingCount: number;
  autoReadyCount: number;
}

export interface LinkRegistryRefreshSummary {
  referenceDate: string;
  goodsExportRefreshed: boolean;
  daemonRefreshed: boolean;
  newLinkCount: number;
  autoReadyCount: number;
  pendingCount: number;
  grouped: LinkRegistryRefreshGroupSummary[];
  warnings: string[];
}

export interface LinkRegistryRefreshResult {
  registryContext: ClosedOrderRegistryContext;
  summary: LinkRegistryRefreshSummary;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
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

function hasClassification(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.categoryId?.trim() && entry.productType?.trim());
}

function hasGroup(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.sameSkuGroupId?.trim());
}

function hasMapping(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.platformProductId?.trim());
}

function isReady(entry: LinkRegistryEntry): boolean {
  return hasGroup(entry) && hasClassification(entry) && hasMapping(entry);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function groupLabel(entry: LinkRegistryEntry): string {
  const shortName = entry.shortName?.trim();
  if (shortName) return shortName;
  const productName = entry.productName?.trim();
  if (productName) return productName;
  const sameSkuGroupId = entry.sameSkuGroupId?.trim();
  if (sameSkuGroupId) return sameSkuGroupId;
  return `端内ID ${entry.internalProductId}`;
}

function summarizeNewEntries(
  beforeRegistry: LinkRegistryEntry[],
  afterRegistry: LinkRegistryEntry[],
  referenceDate: string,
): Omit<LinkRegistryRefreshSummary, 'referenceDate' | 'goodsExportRefreshed' | 'daemonRefreshed' | 'warnings'> {
  const beforeIds = new Set(beforeRegistry.map((entry) => entry.internalProductId));
  const maintenance = buildLinkRegistryMaintenanceReport(afterRegistry, [], { referenceDate });
  const pendingIds = new Set(
    maintenance.queue
      .filter((item) => item.kind === 'entry' && item.reasonCodes.includes('recent_new_link') && item.internalProductId)
      .map((item) => item.internalProductId!),
  );
  const newEntries = afterRegistry.filter((entry) => !beforeIds.has(entry.internalProductId) && entry.status === 'active' && !isLinkRegistryMaintenanceIgnoredEntry(entry));
  const autoReadyEntries = newEntries.filter((entry) => isReady(entry) && !pendingIds.has(entry.internalProductId));
  const groupedMap = new Map<string, LinkRegistryRefreshGroupSummary>();

  for (const entry of newEntries) {
    const label = groupLabel(entry);
    const current = groupedMap.get(label) ?? { label, totalCount: 0, pendingCount: 0, autoReadyCount: 0 };
    current.totalCount += 1;
    if (pendingIds.has(entry.internalProductId)) current.pendingCount += 1;
    else if (isReady(entry)) current.autoReadyCount += 1;
    groupedMap.set(label, current);
  }

  const grouped = [...groupedMap.values()]
    .sort((left, right) => right.totalCount - left.totalCount || right.pendingCount - left.pendingCount || left.label.localeCompare(right.label))
    .slice(0, 8);

  return {
    newLinkCount: newEntries.length,
    autoReadyCount: autoReadyEntries.length,
    pendingCount: pendingIds.size,
    grouped,
  };
}

export async function refreshLinkRegistryForPrompt(outputDir: string, referenceDate: string): Promise<LinkRegistryRefreshResult> {
  await loadEnv();
  const config = await loadConfig();
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  const registryInput = { productIdMapPath: mappingPath, artifactsDir: outputDir };
  const beforeContext = await loadClosedOrderRegistryContext(registryInput).catch(() => null);
  const resolvedPaths = await resolveClosedOrderRegistryPaths(registryInput);
  const paths = buildPublicTrafficPaths(outputDir, referenceDate);
  const warnings: string[] = [];

  const [previousSnapshot, previousFirstSeen, previousLifecycle, firstSeenExists] = await Promise.all([
    loadOptionalJson<GoodsSnapshotItem[]>(resolvedPaths.goodsSnapshotPath, []),
    loadOptionalJson<GoodsFirstSeenIndex>(resolvedPaths.firstSeenPath, {}),
    loadOptionalJson<GoodsLinkLifecycleState | null>(resolvedPaths.lifecyclePath, null),
    exists(resolvedPaths.firstSeenPath),
  ]);

  let goodsExportRefreshed = false;
  let daemonRefreshed = false;
  let goodsSnapshotFromExport: GoodsSnapshotItem[] | null = null;

  try {
    const goodsExportPath = await downloadGoodsExport(config, paths.goodsExportWorkbook);
    await writeProductIdMappingFromExport(goodsExportPath, resolvedPaths.productIdMapPath, paths.productIdMappingSyncLog);
    goodsSnapshotFromExport = parseGoodsExportSnapshot(goodsExportPath);
    goodsExportRefreshed = true;
  } catch (error) {
    warnings.push(`商品总表刷新失败：${errorMessage(error)}`);
  }

  const mapping = await loadProductIdMapping(resolvedPaths.productIdMapPath).catch(() => ({}));
  const baseSnapshot = goodsSnapshotFromExport ?? (previousSnapshot.length > 0 ? previousSnapshot : goodsSnapshotFromMapping(mapping));

  const daemonSnapshot = await (async () => {
    try {
      const snapshot = await fetchDaemonCatalogSnapshot({ cwd: process.cwd() });
      await saveDaemonCatalogSnapshot(resolvedPaths.daemonCatalogPath, snapshot);
      daemonRefreshed = true;
      return snapshot;
    } catch (error) {
      warnings.push(`daemon 链接目录刷新失败：${errorMessage(error)}`);
      return loadOptionalDaemonCatalogSnapshot(resolvedPaths.daemonCatalogPath);
    }
  })();

  const mergedSnapshot = mergeGoodsSnapshotWithDaemon(baseSnapshot, daemonSnapshot?.entries ?? []);
  await mkdir(dirname(resolvedPaths.goodsSnapshotPath), { recursive: true });
  await writeFile(resolvedPaths.goodsSnapshotPath, `${JSON.stringify(mergedSnapshot, null, 2)}\n`, 'utf8');
  await mkdir(dirname(paths.goodsListSnapshot), { recursive: true });
  await writeFile(paths.goodsListSnapshot, `${JSON.stringify(mergedSnapshot, null, 2)}\n`, 'utf8');

  const firstSeen = updateGoodsFirstSeen({
    currentDate: referenceDate,
    previous: previousFirstSeen,
    current: mergedSnapshot,
    baseline: !firstSeenExists,
  });
  await mkdir(dirname(resolvedPaths.firstSeenPath), { recursive: true });
  await writeFile(resolvedPaths.firstSeenPath, `${JSON.stringify(firstSeen, null, 2)}\n`, 'utf8');

  const lifecycle = updateGoodsLinkLifecycle({
    currentDate: referenceDate,
    previous: previousLifecycle,
    current: mergedSnapshot,
  });
  await mkdir(dirname(resolvedPaths.lifecyclePath), { recursive: true });
  await writeFile(resolvedPaths.lifecyclePath, `${JSON.stringify(lifecycle.state, null, 2)}\n`, 'utf8');

  const registryContext = await loadClosedOrderRegistryContext(registryInput);
  const summaryBase = summarizeNewEntries(beforeContext?.registry ?? [], registryContext.registry, referenceDate);
  return {
    registryContext,
    summary: {
      referenceDate,
      goodsExportRefreshed,
      daemonRefreshed,
      warnings,
      ...summaryBase,
    },
  };
}
