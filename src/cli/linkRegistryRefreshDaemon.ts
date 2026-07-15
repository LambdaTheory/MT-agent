import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { resolveClosedOrderRegistryPaths } from '../closedOrderFeedback/runtime.js';
import { fetchDaemonCatalogSnapshot, mergeGoodsSnapshotWithDaemon, saveDaemonCatalogSnapshot } from '../linkRegistry/daemonCatalog.js';
import { decideRefreshHealth } from '../linkRegistry/refreshHealth.js';
import { writeRefreshSuppressionState } from '../linkRegistry/refreshSuppressionState.js';
import { writeJsonAtomic } from '../linkRegistry/persistence.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { mutateGoodsSnapshotStateSerialized, updateGoodsFirstSeenStateSerialized, updateGoodsLinkLifecycleStateSerialized } from '../publicTraffic/goodsStatePersistence.js';
import type { GoodsSnapshotItem } from '../publicTraffic/types.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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

export async function runLinkRegistryRefreshDaemonCli(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const referenceDate = readArg(argv, '--reference-date') ?? today();
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  const resolvedPaths = await resolveClosedOrderRegistryPaths({
    productIdMapPath: mappingPath,
    artifactsDir: config.outputDir,
  }, process.cwd());

  const mapping = await loadProductIdMapping(resolvedPaths.productIdMapPath).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  });

  const daemonSnapshot = await fetchDaemonCatalogSnapshot({ cwd: process.cwd() });
  await saveDaemonCatalogSnapshot(resolvedPaths.daemonCatalogPath, daemonSnapshot);

  const { previous: existingSnapshot, current: mergedSnapshot } = await mutateGoodsSnapshotStateSerialized(resolvedPaths.goodsSnapshotPath, (latestPrevious) => mergeGoodsSnapshotWithDaemon(
    latestPrevious.length > 0 ? latestPrevious : goodsSnapshotFromMapping(mapping),
    daemonSnapshot.entries,
  ));
  const refreshHealth = decideRefreshHealth({
    previousSnapshotCount: existingSnapshot.length,
    currentMergedSnapshotCount: mergedSnapshot.length,
    daemonCount: daemonSnapshot.count,
    daemonExcludedCount: daemonSnapshot.excludedCount,
    daemonPagesScraped: daemonSnapshot.pagesScraped,
    daemonFetchMode: 'live',
  });

  await writeRefreshSuppressionState(resolvedPaths.artifactsDir, {
    version: 1,
    referenceDate,
    suppressDelistAttribution: refreshHealth.suppressLifecycleDrop,
  });

  const firstSeen = await updateGoodsFirstSeenStateSerialized({
    path: resolvedPaths.firstSeenPath,
    currentDate: referenceDate,
    current: mergedSnapshot,
  });

  const lifecycle = await updateGoodsLinkLifecycleStateSerialized({
    path: resolvedPaths.lifecyclePath,
    currentDate: referenceDate,
    current: mergedSnapshot,
    suppressNewRemovals: refreshHealth.suppressLifecycleDrop,
  });

  const datedPaths = buildPublicTrafficPaths(config.outputDir, referenceDate);
  await writeJsonAtomic(datedPaths.goodsListSnapshot, mergedSnapshot);

  console.log(JSON.stringify({
    referenceDate,
    daemonEntries: daemonSnapshot.count,
    daemonExcluded: daemonSnapshot.excludedCount,
    daemonPages: daemonSnapshot.pagesScraped ?? null,
    currentSnapshotEntries: mergedSnapshot.length,
    firstSeenEntries: Object.keys(firstSeen).length,
    activeLifecycleEntries: Object.keys(lifecycle.state.active).length,
    removedLifecycleEntries: lifecycle.state.removedLinks.length,
    healthWarnings: refreshHealth.warnings,
    lifecycleSuppressed: refreshHealth.suppressLifecycleDrop,
    daemonCatalogPath: resolvedPaths.daemonCatalogPath,
    goodsSnapshotPath: resolvedPaths.goodsSnapshotPath,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryRefreshDaemonCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
