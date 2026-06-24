import { access, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { buildLinkRegistry } from '../linkRegistry/buildRegistry.js';
import { applyLinkRegistryOverrides, parseLinkRegistryOverrides, type LinkRegistryOverrideRisk } from '../linkRegistry/overrides.js';
import { createLinkRegistryQuery, type LinkRegistryQuery } from '../linkRegistry/queryRegistry.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import type { GoodsLinkLifecycleState } from '../publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { loadProductNameMap } from '../publicTraffic/productDisplayName.js';

export interface ClosedOrderRegistryPathsInput {
  productIdMapPath?: string;
  productNameMapPath?: string;
  firstSeenPath?: string;
  lifecyclePath?: string;
  overridesPath?: string;
  artifactsDir?: string;
}

export interface ResolvedClosedOrderRegistryPaths {
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}

export interface ClosedOrderRegistryContext {
  registry: LinkRegistryEntry[];
  query: LinkRegistryQuery;
  productIdMapping: ProductIdMapping;
  overrideRisks: LinkRegistryOverrideRisk[];
  resolvedPaths: ResolvedClosedOrderRegistryPaths;
}

export function worktreeCandidatePaths(inputPath: string, cwd = process.cwd()): string[] {
  const resolvedInputPath = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
  const candidates = [resolvedInputPath];
  if (isAbsolute(inputPath)) return candidates;

  const normalizedCwd = cwd.replace(/\\/g, '/');
  const marker = '/.worktrees/';
  const markerIndex = normalizedCwd.indexOf(marker);
  if (markerIndex >= 0) {
    const parentRoot = normalizedCwd.slice(0, markerIndex);
    candidates.push(resolve(parentRoot, inputPath));
  }
  return Array.from(new Set(candidates));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function datedOutputDirs(outputRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(outputRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function hasDatedOutputDirs(outputRoot: string): Promise<boolean> {
  return (await datedOutputDirs(outputRoot)).length > 0;
}

export async function preferExistingPath(
  inputPath: string,
  cwd = process.cwd(),
  predicate: (path: string) => Promise<boolean> = pathExists,
): Promise<string> {
  const candidates = worktreeCandidatePaths(inputPath, cwd);
  for (const candidate of candidates) {
    if (await predicate(candidate)) return candidate;
  }
  return candidates[0];
}

export async function loadOptionalJson<T>(path: string | undefined, fallback: T): Promise<T> {
  if (!path) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function validInternalId(value: string): string | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function addHint(store: Map<string, Set<string>>, internalProductId: string, productName: string | undefined): void {
  const id = validInternalId(internalProductId);
  const name = productName?.trim();
  if (!id || !name) return;
  const current = store.get(id) ?? new Set<string>();
  current.add(name);
  store.set(id, current);
}

async function loadOptionalArtifactJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function collectArtifactProductNameHints(outputRoot: string, productIdMapping: ProductIdMapping): Promise<Record<string, string[]>> {
  const hints = new Map<string, Set<string>>();
  const recentDates = (await datedOutputDirs(outputRoot)).slice(0, 7);

  for (const date of recentDates) {
    const paths = buildPublicTrafficPaths(outputRoot, date);
    const reportContext = asRecord(await loadOptionalArtifactJson(paths.reportContext));
    const reportRows = Array.isArray(reportContext?.rows) ? reportContext.rows : [];
    for (const value of reportRows) {
      const row = asRecord(value);
      if (row) {
        const displayProductId = typeof row.displayProductId === 'string' ? row.displayProductId : '';
        const productName = typeof row.productName === 'string' ? row.productName : undefined;
        addHint(hints, displayProductId.replace(/^端内ID\s*/, ''), productName);
      }
    }

    const exposureRows = await loadOptionalArtifactJson(paths.exposureCumulativeProducts);
    for (const value of Array.isArray(exposureRows) ? exposureRows : []) {
      const row = asRecord(value);
      if (row) {
        const platformProductId = typeof row.platformProductId === 'string' ? row.platformProductId : '';
        const productName = typeof row.productName === 'string' ? row.productName : undefined;
        const internalProductId = platformProductId ? productIdMapping[platformProductId]?.trim() ?? '' : '';
        addHint(hints, internalProductId, productName);
      }
    }
  }

  return Object.fromEntries([...hints.entries()].map(([internalProductId, values]) => [internalProductId, [...values]]));
}

export async function resolveClosedOrderRegistryPaths(
  input: ClosedOrderRegistryPathsInput = {},
  cwd = process.cwd(),
): Promise<ResolvedClosedOrderRegistryPaths> {
  const productIdMapPath = input.productIdMapPath ?? 'config/product-id-map.json';
  const productNameMapPath = input.productNameMapPath ?? 'config/product-name-map.json';
  const firstSeenPath = input.firstSeenPath ?? 'output/state/goods-first-seen.json';
  const lifecyclePath = input.lifecyclePath ?? 'output/state/goods-link-lifecycle.json';
  const overridesPath = input.overridesPath ?? 'config/link-registry-overrides.json';
  const artifactsDir = input.artifactsDir ?? 'output';

  const [
    resolvedProductIdMapPath,
    resolvedProductNameMapPath,
    resolvedFirstSeenPath,
    resolvedLifecyclePath,
    resolvedOverridesPath,
    resolvedArtifactsDir,
  ] = await Promise.all([
    preferExistingPath(productIdMapPath, cwd),
    preferExistingPath(productNameMapPath, cwd),
    preferExistingPath(firstSeenPath, cwd),
    preferExistingPath(lifecyclePath, cwd),
    preferExistingPath(overridesPath, cwd),
    preferExistingPath(artifactsDir, cwd, hasDatedOutputDirs),
  ]);

  return {
    productIdMapPath: resolvedProductIdMapPath,
    productNameMapPath: resolvedProductNameMapPath,
    firstSeenPath: resolvedFirstSeenPath,
    lifecyclePath: resolvedLifecyclePath,
    overridesPath: resolvedOverridesPath,
    artifactsDir: resolvedArtifactsDir,
  };
}

export async function loadClosedOrderRegistryContext(
  input: ClosedOrderRegistryPathsInput = {},
  cwd = process.cwd(),
): Promise<ClosedOrderRegistryContext> {
  const resolvedPaths = await resolveClosedOrderRegistryPaths(input, cwd);
  const [productIdMapping, productNameMap, firstSeen, lifecycle] = await Promise.all([
    loadProductIdMapping(resolvedPaths.productIdMapPath).catch((error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }),
    loadProductNameMap(resolvedPaths.productNameMapPath, (message) => console.warn(message)),
    loadOptionalJson<GoodsFirstSeenIndex>(resolvedPaths.firstSeenPath, {}),
    loadOptionalJson<GoodsLinkLifecycleState | null>(resolvedPaths.lifecyclePath, null),
  ]);
  const [productNameHints, rawOverrides] = await Promise.all([
    collectArtifactProductNameHints(resolvedPaths.artifactsDir, productIdMapping),
    loadOptionalJson<unknown | null>(resolvedPaths.overridesPath, null),
  ]);
  const baseRegistry = buildLinkRegistry({
    productIdMapping,
    productNameMap,
    productNameHints,
    firstSeen,
    lifecycle,
  });
  const overrideResult = rawOverrides === null
    ? { entries: baseRegistry, risks: [] }
    : applyLinkRegistryOverrides(baseRegistry, parseLinkRegistryOverrides(rawOverrides));
  const registry = overrideResult.entries;
  return {
    registry,
    query: createLinkRegistryQuery(registry),
    productIdMapping,
    overrideRisks: overrideResult.risks,
    resolvedPaths,
  };
}
