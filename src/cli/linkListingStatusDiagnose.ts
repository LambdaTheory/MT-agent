import { access, readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { loadOptionalDaemonCatalogSnapshot } from '../linkRegistry/daemonCatalog.js';
import type { LinkRegistryStatus } from '../linkRegistry/types.js';

interface ArtifactStatus {
  path: string;
  exists: boolean;
}

export interface LinkListingStatusMismatch {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  registryStatus: LinkRegistryStatus;
  delistedSources: string[];
}

export interface LinkListingStatusDiagnosticReport {
  artifacts: {
    outputDir: ArtifactStatus;
    goodsSnapshot: ArtifactStatus;
    daemonCatalog: ArtifactStatus;
    exposureCumulativeProducts: ArtifactStatus;
  };
  registryEntryCount: number;
  sourceDelistedCounts: {
    daemon: number;
    goodsSnapshot: number;
    exposure: number;
  };
  activeButSourceDelistedCount: number;
  activeButSourceDelisted: LinkListingStatusMismatch[];
}

export interface LinkListingStatusDiagnosticOptions extends ClosedOrderRegistryPathsInput {
  cwd?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function isDelistedText(value: string | undefined): boolean {
  return !!value && /已下架|停售/u.test(value);
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function delistedInternalIdsFromGoodsSnapshot(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const internalProductId = readString(record, 'internalProductId');
    const statusText = readString(record, 'listingStatus') ?? readString(record, 'listingStatusText') ?? readString(record, 'statusText');
    if (internalProductId && isDelistedText(statusText)) ids.add(internalProductId);
  }
  return ids;
}

function delistedInternalIdsFromExposure(value: unknown, platformToInternal: Map<string, string>): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const platformProductId = readString(record, 'platformProductId');
    const raw = asRecord(record.raw);
    const statusText = readString(record, 'listingStatus')
      ?? readString(record, 'listingStatusText')
      ?? readString(record, 'statusText')
      ?? (raw ? Object.values(raw).find((cell): cell is string => typeof cell === 'string' && isDelistedText(cell)) : undefined);
    const internalProductId = platformProductId ? platformToInternal.get(platformProductId) : undefined;
    if (internalProductId && isDelistedText(statusText)) ids.add(internalProductId);
  }
  return ids;
}

async function latestExposureCumulativePath(artifactsDir: string): Promise<string> {
  try {
    const entries = await readdir(artifactsDir, { withFileTypes: true });
    const latestDate = entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))[0];
    return latestDate ? `${artifactsDir}/${latestDate}/公域曝光商品快照_${latestDate}.json` : `${artifactsDir}/latest-exposure-cumulative-products.json`;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return `${artifactsDir}/latest-exposure-cumulative-products.json`;
    throw error;
  }
}

export async function diagnoseLinkListingStatus(options: LinkListingStatusDiagnosticOptions = {}): Promise<LinkListingStatusDiagnosticReport> {
  const cwd = options.cwd ?? process.cwd();
  const artifactsDir = options.artifactsDir ?? 'output';
  const goodsSnapshotPath = options.goodsSnapshotPath ?? 'output/state/goods-current-snapshot.json';
  const daemonCatalogPath = options.daemonCatalogPath ?? 'output/state/link-registry-daemon-catalog.json';
  const resolvedArtifactsDir = resolve(cwd, artifactsDir);
  const resolvedGoodsSnapshotPath = resolve(cwd, goodsSnapshotPath);
  const resolvedDaemonCatalogPath = resolve(cwd, daemonCatalogPath);
  const exposurePath = await latestExposureCumulativePath(resolvedArtifactsDir);

  const context = await loadClosedOrderRegistryContext(options, cwd);
  const daemonCatalog = await loadOptionalDaemonCatalogSnapshot(context.resolvedPaths.daemonCatalogPath);
  const goodsSnapshotJson = await readOptionalJson(context.resolvedPaths.goodsSnapshotPath);
  const exposureJson = await readOptionalJson(exposurePath);

  const daemonDelisted = new Set(
    (daemonCatalog?.entries ?? [])
      .filter((entry) => isDelistedText(entry.syncStatus) || isDelistedText(entry.listingStatusText))
      .map((entry) => entry.internalProductId),
  );
  const goodsDelisted = delistedInternalIdsFromGoodsSnapshot(goodsSnapshotJson);
  const platformToInternal = new Map(Object.entries(context.productIdMapping));
  const exposureDelisted = delistedInternalIdsFromExposure(exposureJson, platformToInternal);

  const activeButSourceDelisted = context.registry
    .map((entry) => {
      const delistedSources = [
        daemonDelisted.has(entry.internalProductId) ? 'daemon' : '',
        goodsDelisted.has(entry.internalProductId) ? 'goodsSnapshot' : '',
        exposureDelisted.has(entry.internalProductId) ? 'exposure' : '',
      ].filter(Boolean);
      return { entry, delistedSources };
    })
    .filter(({ entry, delistedSources }) => entry.status === 'active' && delistedSources.length > 0)
    .map(({ entry, delistedSources }) => ({
      internalProductId: entry.internalProductId,
      ...(entry.platformProductId ? { platformProductId: entry.platformProductId } : {}),
      ...(entry.productName ? { productName: entry.productName } : {}),
      registryStatus: entry.status,
      delistedSources,
    }));

  return {
    artifacts: {
      outputDir: { path: resolvedArtifactsDir, exists: await exists(resolvedArtifactsDir) },
      goodsSnapshot: { path: context.resolvedPaths.goodsSnapshotPath, exists: await exists(context.resolvedPaths.goodsSnapshotPath) },
      daemonCatalog: { path: context.resolvedPaths.daemonCatalogPath, exists: await exists(context.resolvedPaths.daemonCatalogPath) },
      exposureCumulativeProducts: { path: exposurePath, exists: await exists(exposurePath) },
    },
    registryEntryCount: context.registry.length,
    sourceDelistedCounts: {
      daemon: daemonDelisted.size,
      goodsSnapshot: goodsDelisted.size,
      exposure: exposureDelisted.size,
    },
    activeButSourceDelistedCount: activeButSourceDelisted.length,
    activeButSourceDelisted,
  };
}

export async function runLinkListingStatusDiagnoseCli(argv = process.argv.slice(2)): Promise<void> {
  const json = argv.includes('--json');
  const report = await diagnoseLinkListingStatus();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`registry entries: ${report.registryEntryCount}`);
  console.log(`source delisted: daemon=${report.sourceDelistedCounts.daemon}, goods=${report.sourceDelistedCounts.goodsSnapshot}, exposure=${report.sourceDelistedCounts.exposure}`);
  console.log(`active but source delisted: ${report.activeButSourceDelistedCount}`);
  for (const item of report.activeButSourceDelisted) {
    console.log(`- ${item.internalProductId} ${item.productName ?? ''} sources=${item.delistedSources.join(',')}`.trim());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkListingStatusDiagnoseCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
