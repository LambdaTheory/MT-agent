import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildLinkRegistry } from '../linkRegistry/buildRegistry.js';
import { buildLinkRegistryAudit, type LinkRegistryAudit } from '../linkRegistry/audit.js';
import { applyLinkRegistryOverrides, parseLinkRegistryOverrides } from '../linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import type { GoodsLinkLifecycleState } from '../publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import type { ProductNameMap } from '../publicTraffic/productDisplayName.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    return await readJson(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') record[key] = item;
  }
  return record;
}

function parseFirstSeen(value: unknown): GoodsFirstSeenIndex {
  if (!isRecord(value)) return {};
  const state: GoodsFirstSeenIndex = {};
  for (const [internalProductId, item] of Object.entries(value)) {
    if (!/^\d+$/.test(internalProductId) || !isRecord(item) || typeof item.firstSeenDate !== 'string') continue;
    state[internalProductId] = {
      firstSeenDate: item.firstSeenDate,
      platformProductId: typeof item.platformProductId === 'string' ? item.platformProductId : '',
      productName: typeof item.productName === 'string' ? item.productName : '',
      ...(item.baseline === true ? { baseline: true } : {}),
    };
  }
  return state;
}

function parseLifecycle(value: unknown): GoodsLinkLifecycleState | null {
  if (!isRecord(value) || !isRecord(value.active) || !Array.isArray(value.removedLinks)) return null;
  const active: GoodsLinkLifecycleState['active'] = {};
  for (const [internalProductId, item] of Object.entries(value.active)) {
    if (!/^\d+$/.test(internalProductId) || !isRecord(item) || typeof item.platformProductId !== 'string' || typeof item.productName !== 'string') continue;
    active[internalProductId] = { platformProductId: item.platformProductId, productName: item.productName };
  }
  const removedLinks = value.removedLinks.filter((item): item is GoodsLinkLifecycleState['removedLinks'][number] => {
    if (!isRecord(item)) return false;
    return typeof item.productId === 'string' && typeof item.platformProductId === 'string' && typeof item.productName === 'string' && typeof item.removedDate === 'string' && item.reason === '商品总表缺失' && item.source === 'goods_snapshot_diff';
  });
  return { active, removedLinks };
}

function parseRegistryEntries(value: unknown): LinkRegistryEntry[] {
  if (!Array.isArray(value)) throw new Error('Registry file must contain a LinkRegistryEntry array');
  return value.map((item) => {
    if (!isRecord(item) || typeof item.internalProductId !== 'string' || (item.status !== 'active' && item.status !== 'removed' && item.status !== 'unknown') || !Array.isArray(item.source)) {
      throw new Error('Invalid LinkRegistryEntry in registry file');
    }
    return item as unknown as LinkRegistryEntry;
  });
}

async function buildEntriesFromInputs(argv: string[]): Promise<LinkRegistryEntry[]> {
  const registryPath = readArg(argv, '--registry');
  if (registryPath) return parseRegistryEntries(await readJson(registryPath));

  const productIdMapPath = readArg(argv, '--product-id-map') ?? 'config/product-id-map.json';
  const productNameMapPath = readArg(argv, '--product-name-map') ?? 'config/product-name-map.json';
  const firstSeenPath = readArg(argv, '--first-seen') ?? 'output/state/goods-first-seen.json';
  const lifecyclePath = readArg(argv, '--lifecycle') ?? 'output/state/goods-link-lifecycle.json';
  const productIdMapping = stringRecord(await readOptionalJson(productIdMapPath)) as ProductIdMapping;
  const productNameMap = stringRecord(await readOptionalJson(productNameMapPath)) as ProductNameMap;
  const firstSeen = parseFirstSeen(await readOptionalJson(firstSeenPath));
  const lifecycle = parseLifecycle(await readOptionalJson(lifecyclePath));
  return buildLinkRegistry({ productIdMapping, productNameMap, firstSeen, lifecycle });
}

async function buildAuditFromArgs(argv: string[]): Promise<LinkRegistryAudit> {
  const entries = await buildEntriesFromInputs(argv);
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const rawOverrides = await readOptionalJson(overridesPath);
  if (rawOverrides === null) return buildLinkRegistryAudit(entries);
  const overrideResult = applyLinkRegistryOverrides(entries, parseLinkRegistryOverrides(rawOverrides));
  return buildLinkRegistryAudit(overrideResult.entries, overrideResult.risks);
}

function printSummary(audit: LinkRegistryAudit): void {
  console.log(`现有链接档案盘点: total=${audit.total} active=${audit.active} removed=${audit.removed} unknown=${audit.unknown}`);
  console.log('品类:');
  for (const category of audit.categories) {
    console.log(`- ${category.categoryId}${category.categoryName ? ` ${category.categoryName}` : ''}: active=${category.active} removed=${category.removed} unknown=${category.unknown} total=${category.total}`);
    for (const productType of category.productTypes) {
      console.log(`  - ${productType.productType}: active=${productType.active} removed=${productType.removed} unknown=${productType.unknown} total=${productType.total}`);
    }
  }
  console.log(`分类不明链接: ${audit.unknownEntries.length}`);
  console.log(`同款样本不足分组: ${audit.sameSkuGroups.filter((group) => group.sampleInsufficient).length}`);
  console.log(`风险: ${audit.risks.length}`);
}

export async function runLinkRegistryAuditCli(argv = process.argv.slice(2)): Promise<void> {
  const audit = await buildAuditFromArgs(argv);
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  printSummary(audit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryAuditCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
