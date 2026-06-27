import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GoodsSnapshotItem } from '../publicTraffic/types.js';

const execFileAsync = promisify(execFile);

export interface DaemonCatalogEntry {
  internalProductId: string;
  productName: string;
  listingStatusText?: string;
  syncStatus?: string;
  channels?: string[];
  tags?: string[];
  stockText?: string;
  rowText?: string;
  copyAvailable?: boolean;
  discoveredAt: string;
}

export interface DaemonCatalogSnapshot {
  generatedAt: string;
  count: number;
  excludedCount: number;
  pagesScraped?: number;
  entries: DaemonCatalogEntry[];
}

interface DaemonCatalogFetchOptions {
  cwd?: string;
  rootDir?: string;
  daemonUrl?: string;
  daemonToken?: string;
}

interface ResolvedDaemonConfig {
  daemonUrl: string;
  daemonToken: string | null;
  rootDir: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function dedupeStrings(values: string[] | undefined): string[] | undefined {
  const items = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return dedupeStrings(value.split(/[，,]/u).map((item) => item.trim()));
}

function splitTags(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return dedupeStrings(value.split(/\s+/u).map((item) => item.trim()));
}

function looksLikeListingStatus(value: string | undefined): boolean {
  return !!value && /\d{4}-\d{2}-\d{2}|\b上架\b|\b下架\b|展示|通过/u.test(value);
}

function looksLikeChannels(value: string | undefined): boolean {
  return !!value && /小程序|APP|网页|H5|抖音|快手|微信/u.test(value);
}

function looksLikeSyncStatus(value: string | undefined): boolean {
  return !!value && /可售卖|已下架|未同步|已同步|停售/u.test(value);
}

function looksLikeTags(value: string | undefined): boolean {
  return !!value && !looksLikeChannels(value) && !looksLikeSyncStatus(value) && !looksLikeListingStatus(value) && /新品|热租|推荐|精选|全新|爆款/u.test(value);
}

function normalizeCells(record: Record<string, unknown>): string[] {
  const value = record.cells;
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
}

function entryFromPlatformRow(record: Record<string, unknown>, discoveredAt: string): DaemonCatalogEntry | null {
  const internalProductId = readString(record, 'id');
  if (!internalProductId || !/^\d+$/.test(internalProductId)) return null;

  const productName = readString(record, 'name');
  if (!productName) return null;

  const cells = normalizeCells(record);
  const detectedListingStatus = cells.find((cell) => looksLikeListingStatus(cell));
  const detectedChannels = cells.find((cell) => looksLikeChannels(cell));
  const detectedSyncStatus = [...cells].reverse().find((cell) => looksLikeSyncStatus(cell));
  const detectedTags = cells.find((cell) => looksLikeTags(cell));
  const syncStatus = readString(record, 'syncStatus') ?? detectedSyncStatus;
  const channels = readStringArray(record, 'channels') ?? splitList(detectedChannels);
  const tags = readStringArray(record, 'tags') ?? splitTags(detectedTags);
  const listingStatusText = readString(record, 'listingStatusText') ?? detectedListingStatus;
  const stockText = readString(record, 'stockText') ?? cells[5];
  const rowText = readString(record, 'text') ?? cells.join(' | ');

  return {
    internalProductId,
    productName,
    ...(listingStatusText ? { listingStatusText } : {}),
    ...(syncStatus ? { syncStatus } : {}),
    ...(channels ? { channels } : {}),
    ...(tags ? { tags } : {}),
    ...(stockText ? { stockText } : {}),
    ...(rowText ? { rowText } : {}),
    ...(readBoolean(record, 'copyAvailable') !== undefined ? { copyAvailable: readBoolean(record, 'copyAvailable') } : {}),
    discoveredAt,
  };
}

export function parseDaemonCatalogSnapshot(value: unknown): DaemonCatalogSnapshot {
  const record = asRecord(value);
  if (!record) throw new Error('Daemon catalog snapshot must be an object');

  const generatedAt = readString(record, 'generatedAt');
  const count = typeof record.count === 'number' ? record.count : NaN;
  const excludedCount = typeof record.excludedCount === 'number' ? record.excludedCount : NaN;
  const pagesScraped = typeof record.pagesScraped === 'number' ? record.pagesScraped : undefined;
  const entriesValue = record.entries;
  if (!generatedAt || !Number.isFinite(count) || !Number.isFinite(excludedCount) || !Array.isArray(entriesValue)) {
    throw new Error('Invalid daemon catalog snapshot payload');
  }

  const entries = entriesValue
    .map((item) => {
      const entryRecord = asRecord(item);
      return entryRecord ? entryFromPlatformRow(entryRecord, generatedAt) ?? {
        internalProductId: readString(entryRecord, 'internalProductId') ?? '',
        productName: readString(entryRecord, 'productName') ?? '',
        ...(readString(entryRecord, 'listingStatusText') ? { listingStatusText: readString(entryRecord, 'listingStatusText') } : {}),
        ...(readString(entryRecord, 'syncStatus') ? { syncStatus: readString(entryRecord, 'syncStatus') } : {}),
        ...(readStringArray(entryRecord, 'channels') ? { channels: readStringArray(entryRecord, 'channels') } : {}),
        ...(readStringArray(entryRecord, 'tags') ? { tags: readStringArray(entryRecord, 'tags') } : {}),
        ...(readString(entryRecord, 'stockText') ? { stockText: readString(entryRecord, 'stockText') } : {}),
        ...(readString(entryRecord, 'rowText') ? { rowText: readString(entryRecord, 'rowText') } : {}),
        ...(readBoolean(entryRecord, 'copyAvailable') !== undefined ? { copyAvailable: readBoolean(entryRecord, 'copyAvailable') } : {}),
        discoveredAt: readString(entryRecord, 'discoveredAt') ?? generatedAt,
      } : null;
    })
    .filter((item): item is DaemonCatalogEntry => Boolean(item && item.internalProductId && item.productName));

  return { generatedAt, count, excludedCount, ...(pagesScraped !== undefined ? { pagesScraped } : {}), entries };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return value || null;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function resolveDaemonConfig(options: DaemonCatalogFetchOptions = {}): Promise<ResolvedDaemonConfig> {
  const cwd = options.cwd ?? process.cwd();
  const rootDir = options.rootDir ?? process.env.RENTAL_PRICE_AGENT_DIR ?? resolve(cwd, 'vendor', 'rental-price-agent');
  const configuredDaemonUrl = options.daemonUrl ?? process.env.RENTAL_PRICE_AGENT_DAEMON_URL ?? '';
  const configuredDaemonToken = options.daemonToken ?? process.env.RENTAL_PRICE_AGENT_DAEMON_TOKEN ?? '';
  if (configuredDaemonUrl) {
    return {
      daemonUrl: configuredDaemonUrl,
      daemonToken: configuredDaemonToken || null,
      rootDir,
    };
  }

  const port = await readOptionalText(join(rootDir, '.daemon.port'));
  const token = configuredDaemonToken || await readOptionalText(join(rootDir, '.daemon.token'));
  return {
    daemonUrl: port ? `http://127.0.0.1:${port}` : 'http://127.0.0.1:9223',
    daemonToken: token || null,
    rootDir,
  };
}

function buildSnapshotFromPlatformSearchPayload(value: unknown, generatedAt = new Date().toISOString()): DaemonCatalogSnapshot {
  const record = asRecord(value);
  if (!record || readString(record, 'status') !== 'ok') {
    throw new Error(`Daemon catalog request failed: ${readString(record ?? {}, 'message') ?? 'unknown error'}`);
  }

  const products = Array.isArray(record.products) ? record.products : [];
  const entries = products
    .map((item) => {
      const productRecord = asRecord(item);
      return productRecord ? entryFromPlatformRow(productRecord, generatedAt) : null;
    })
    .filter((item): item is DaemonCatalogEntry => Boolean(item));

  return {
    generatedAt,
    count: entries.length,
    excludedCount: typeof record.excludedCount === 'number' ? record.excludedCount : 0,
    ...(typeof record.pagesScraped === 'number' ? { pagesScraped: record.pagesScraped } : {}),
    entries,
  };
}

async function fetchDaemonCatalogViaHttp(config: ResolvedDaemonConfig): Promise<DaemonCatalogSnapshot> {
  const { daemonUrl, daemonToken } = config;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (daemonToken) headers['x-rental-agent-token'] = daemonToken;

  const response = await fetch(daemonUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'platform-search-all' }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`Daemon catalog request failed: HTTP ${response.status}`);
  }
  return buildSnapshotFromPlatformSearchPayload(payload);
}

async function fetchDaemonCatalogViaCommand(config: ResolvedDaemonConfig, cwd: string): Promise<DaemonCatalogSnapshot> {
  const scriptPath = join(config.rootDir, 'scripts', 'playwright-runner.js');
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'platform-search-all'], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  const jsonLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) throw new Error('Daemon catalog command returned no JSON payload');
  return buildSnapshotFromPlatformSearchPayload(JSON.parse(jsonLine) as unknown);
}

function shouldFallbackToCommand(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|fetch failed|Unknown action: platform-search-all|HTTP 4\d{2}|HTTP 5\d{2}/i.test(message);
}

export async function fetchDaemonCatalogSnapshot(options: DaemonCatalogFetchOptions = {}): Promise<DaemonCatalogSnapshot> {
  const config = await resolveDaemonConfig(options);
  const cwd = options.cwd ?? process.cwd();
  try {
    return await fetchDaemonCatalogViaHttp(config);
  } catch (error) {
    if (!shouldFallbackToCommand(error)) throw error;
    return fetchDaemonCatalogViaCommand(config, cwd);
  }
}

export async function loadOptionalDaemonCatalogSnapshot(path: string | undefined): Promise<DaemonCatalogSnapshot | null> {
  if (!path || !(await pathExists(path))) return null;
  return parseDaemonCatalogSnapshot(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function saveDaemonCatalogSnapshot(path: string, snapshot: DaemonCatalogSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export function mergeGoodsSnapshotWithDaemon(base: GoodsSnapshotItem[], daemonEntries: DaemonCatalogEntry[]): GoodsSnapshotItem[] {
  const byInternalId = new Map<string, GoodsSnapshotItem>();
  for (const item of base) {
    if (!/^\d+$/.test(item.internalProductId.trim())) continue;
    byInternalId.set(item.internalProductId.trim(), {
      platformProductId: item.platformProductId.trim(),
      internalProductId: item.internalProductId.trim(),
      productName: item.productName.trim(),
    });
  }

  for (const entry of daemonEntries) {
    const internalProductId = entry.internalProductId.trim();
    if (!/^\d+$/.test(internalProductId)) continue;
    const current = byInternalId.get(internalProductId);
    byInternalId.set(internalProductId, {
      platformProductId: current?.platformProductId?.trim() ?? '',
      internalProductId,
      productName: entry.productName.trim() || current?.productName?.trim() || '',
    });
  }

  return [...byInternalId.values()]
    .sort((left, right) => Number(left.internalProductId) - Number(right.internalProductId) || left.internalProductId.localeCompare(right.internalProductId));
}
