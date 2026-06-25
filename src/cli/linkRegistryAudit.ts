import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildLinkRegistryAudit, type LinkRegistryAudit } from '../linkRegistry/audit.js';
import { buildLinkRegistry } from '../linkRegistry/buildRegistry.js';
import { buildLinkRegistryMaintenanceReport, type LinkRegistryMaintenanceReport } from '../linkRegistry/maintenance.js';
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
    return typeof item.productId === 'string'
      && typeof item.platformProductId === 'string'
      && typeof item.productName === 'string'
      && typeof item.removedDate === 'string'
      && item.reason === '商品总表缺失'
      && item.source === 'goods_snapshot_diff';
  });
  return { active, removedLinks };
}

function parseRegistryEntries(value: unknown): LinkRegistryEntry[] {
  if (!Array.isArray(value)) throw new Error('Registry file must contain a LinkRegistryEntry array');
  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.internalProductId !== 'string'
      || (item.status !== 'active' && item.status !== 'removed' && item.status !== 'unknown')
      || !Array.isArray(item.source)
    ) {
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

interface AuditBuildResult {
  audit: LinkRegistryAudit;
  maintenance: LinkRegistryMaintenanceReport;
}

async function buildReportsFromArgs(argv: string[]): Promise<AuditBuildResult> {
  const entries = await buildEntriesFromInputs(argv);
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const rawOverrides = await readOptionalJson(overridesPath);
  const referenceDate = readArg(argv, '--reference-date') ?? new Date().toISOString().slice(0, 10);
  if (rawOverrides === null) {
    return {
      audit: buildLinkRegistryAudit(entries),
      maintenance: buildLinkRegistryMaintenanceReport(entries, [], { referenceDate }),
    };
  }
  const overrideResult = applyLinkRegistryOverrides(entries, parseLinkRegistryOverrides(rawOverrides));
  return {
    audit: buildLinkRegistryAudit(overrideResult.entries, overrideResult.risks),
    maintenance: buildLinkRegistryMaintenanceReport(overrideResult.entries, overrideResult.risks, { referenceDate }),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readyPercent(maintenance: LinkRegistryMaintenanceReport): string {
  const { readyCount, totalEntries } = maintenance.summary;
  if (totalEntries <= 0) return '0.0%';
  return percent(readyCount / totalEntries);
}

function printSummary(audit: LinkRegistryAudit, maintenance: LinkRegistryMaintenanceReport): void {
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
  console.log('维护覆盖率:');
  console.log(`- 完整就绪: ${maintenance.summary.readyCount}/${maintenance.summary.totalEntries} (${readyPercent(maintenance)})`);
  console.log(`- 已归组: ${maintenance.coverage.grouped.ready}/${maintenance.coverage.grouped.total} (${percent(maintenance.coverage.grouped.ratio)})`);
  console.log(`- 已分类: ${maintenance.coverage.classified.ready}/${maintenance.coverage.classified.total} (${percent(maintenance.coverage.classified.ratio)})`);
  console.log(`- 已映射: ${maintenance.coverage.mapped.ready}/${maintenance.coverage.mapped.total} (${percent(maintenance.coverage.mapped.ratio)})`);
  console.log(`待维护队列: ${maintenance.summary.pendingCount}`);
  for (const [index, item] of maintenance.queue.slice(0, 5).entries()) {
    const subject = item.internalProductId ?? item.sameSkuGroupId ?? item.message ?? '未命名项';
    const name = item.productName ?? item.shortName ?? '';
    console.log(`${index + 1}. [${item.priority.toUpperCase()}] ${subject}${name ? ` ${name}` : ''} | ${item.reasonLabels.join('、')}`);
  }
}

export async function runLinkRegistryAuditCli(argv = process.argv.slice(2)): Promise<void> {
  const reports = await buildReportsFromArgs(argv);
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify({ ...reports.audit, maintenance: reports.maintenance }, null, 2));
    return;
  }
  printSummary(reports.audit, reports.maintenance);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryAuditCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
