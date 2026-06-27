import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { loadOptionalJson, resolveClosedOrderRegistryPaths } from '../closedOrderFeedback/runtime.js';
import { fetchDaemonCatalogSnapshot, mergeGoodsSnapshotWithDaemon, saveDaemonCatalogSnapshot } from '../linkRegistry/daemonCatalog.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { updateGoodsLinkLifecycle, type GoodsLinkLifecycleState } from '../publicTraffic/goodsLinkLifecycle.js';
import { updateGoodsFirstSeen, type GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import type { GoodsSnapshotItem } from '../publicTraffic/types.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

  const [mapping, existingSnapshot, previousFirstSeen, previousLifecycle, firstSeenExists] = await Promise.all([
    loadProductIdMapping(resolvedPaths.productIdMapPath).catch((error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }),
    loadOptionalJson<GoodsSnapshotItem[]>(resolvedPaths.goodsSnapshotPath, []),
    loadOptionalJson<GoodsFirstSeenIndex>(resolvedPaths.firstSeenPath, {}),
    loadOptionalJson<GoodsLinkLifecycleState | null>(resolvedPaths.lifecyclePath, null),
    pathExists(resolvedPaths.firstSeenPath),
  ]);

  const daemonSnapshot = await fetchDaemonCatalogSnapshot({ cwd: process.cwd() });
  await saveDaemonCatalogSnapshot(resolvedPaths.daemonCatalogPath, daemonSnapshot);

  const mergedSnapshot = mergeGoodsSnapshotWithDaemon(
    existingSnapshot.length > 0 ? existingSnapshot : goodsSnapshotFromMapping(mapping),
    daemonSnapshot.entries,
  );
  await writeJson(resolvedPaths.goodsSnapshotPath, mergedSnapshot);

  const firstSeen = updateGoodsFirstSeen({
    currentDate: referenceDate,
    previous: previousFirstSeen,
    current: mergedSnapshot,
    baseline: !firstSeenExists,
  });
  await writeJson(resolvedPaths.firstSeenPath, firstSeen);

  const lifecycle = updateGoodsLinkLifecycle({
    currentDate: referenceDate,
    previous: previousLifecycle,
    current: mergedSnapshot,
  });
  await writeJson(resolvedPaths.lifecyclePath, lifecycle.state);

  const datedPaths = buildPublicTrafficPaths(config.outputDir, referenceDate);
  await writeJson(datedPaths.goodsListSnapshot, mergedSnapshot);

  console.log(JSON.stringify({
    referenceDate,
    daemonEntries: daemonSnapshot.count,
    daemonExcluded: daemonSnapshot.excludedCount,
    daemonPages: daemonSnapshot.pagesScraped ?? null,
    currentSnapshotEntries: mergedSnapshot.length,
    firstSeenEntries: Object.keys(firstSeen).length,
    activeLifecycleEntries: Object.keys(lifecycle.state.active).length,
    removedLifecycleEntries: lifecycle.state.removedLinks.length,
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
