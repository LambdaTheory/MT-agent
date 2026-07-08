import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { BotResponse } from './types.js';
import type {
  RentalBatchReadResult,
  RentalDaemonStatusResult,
  RentalPlatformSearchAllResult,
  RentalPlatformSearchResult,
  RentalRawReadResult,
  RentalSpecDiscoverFullResult,
  RentalPriceSkillClient,
} from './rentalPrice.js';

const RENTAL_BATCH_READ_MAX_PRODUCTS = 60;
const RENTAL_PLATFORM_SEARCH_ALL_DEFAULT_LIMIT = 100;
const RENTAL_PLATFORM_SEARCH_ALL_MAX_LIMIT = 200;
const RENTAL_READ_RAW_MAX_FIELDS = 32;

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`${fieldName} is required`);
  return parsed;
}

function requireProductId(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+$/.test(parsed)) throw new Error(`${fieldName} must be numeric`);
  return parsed;
}

function readRentalBatchReadProductIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`批量读取参数无效：productIds 需要是 1 到 ${RENTAL_BATCH_READ_MAX_PRODUCTS} 个端内ID。`);
  if (value.length > RENTAL_BATCH_READ_MAX_PRODUCTS) throw new Error(`批量读取参数无效：单次最多 ${RENTAL_BATCH_READ_MAX_PRODUCTS} 个端内ID。`);
  const ids = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (ids.length !== value.length || ids.some((id) => !/^\d+$/.test(id))) throw new Error('批量读取参数无效：productIds 只能包含数字端内ID。');
  return [...new Set(ids)];
}

function readOptionalPositiveInteger(value: unknown, defaultValue: number, maxValue: number, fieldName: string): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > maxValue) throw new Error(`${fieldName} must be between 1 and ${maxValue}`);
  return raw;
}

function readOptionalStringArray(value: unknown, maxItems: number, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${fieldName} must be an array with at most ${maxItems} items`);
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (items.length !== value.length) throw new Error(`${fieldName} must contain only non-empty strings`);
  return [...new Set(items)];
}

function firstStringField(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return null;
}

function formatRentalDaemonStatus(result: RentalDaemonStatusResult): string {
  return [`租赁 daemon 状态：${result.status}`, ...result.lines].join('\n');
}

function formatRentalPlatformSearch(result: RentalPlatformSearchResult): string {
  const rows = result.rows.slice(0, 10).map((row, index) => {
    const id = firstStringField(row, ['productId', 'internalProductId', 'id']) ?? 'unknown';
    const title = firstStringField(row, ['title', 'name', 'productName']) ?? '';
    return `${index + 1}. ${id}${title ? ` ${title}` : ''}`;
  });
  return [`租赁后台搜索：${result.keyword}`, `状态：${result.status}，命中 ${result.count} 条`, ...rows].join('\n');
}

function formatRentalPlatformSearchAll(result: RentalPlatformSearchAllResult): string {
  const rows = result.rows.map((row, index) => {
    const id = firstStringField(row, ['productId', 'internalProductId', 'id']) ?? 'unknown';
    const title = firstStringField(row, ['title', 'name', 'productName']) ?? '';
    return `${index + 1}. ${id}${title ? ` ${title}` : ''}`;
  });
  return [
    '租赁后台全量搜索',
    `状态：${result.status}，命中 ${result.count} 条，返回 ${result.rows.length} 条`,
    result.pagesScraped !== undefined ? `抓取页数：${result.pagesScraped}` : undefined,
    result.excludedCount !== undefined ? `排除：${result.excludedCount} 条` : undefined,
    `截断：${result.truncated ? '是' : '否'}`,
    ...rows,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function formatRentalBatchRead(result: RentalBatchReadResult, productIds: string[]): string {
  const rows = productIds.slice(0, 20).map((productId) => {
    const item = result.results[productId];
    const status = isRecord(item) && typeof item.status === 'string' ? item.status : 'unknown';
    return `- ${productId}: ${status}`;
  });
  return [`租赁批量读取：${productIds.length} 个端内ID`, `状态：${result.status}，成功/返回 ${result.count} 条`, ...rows].join('\n');
}

function formatRentalSpecDiscoverFull(result: RentalSpecDiscoverFullResult): string {
  const rows = result.dimensions.slice(0, 12).flatMap((dimension, index) => {
    const itemRows = dimension.items.slice(0, 20).map((item) => `  - ${item.id} ${item.title}`);
    const omitted = dimension.items.length > itemRows.length ? [`  - ... 省略 ${dimension.items.length - itemRows.length} 项`] : [];
    return [`${index + 1}. ${dimension.specId} ${dimension.title}（${dimension.items.length} 项）`, ...itemRows, ...omitted];
  });
  const omittedDimensions = result.dimensions.length > 12 ? [`... 省略 ${result.dimensions.length - 12} 个维度`] : [];
  return [`租赁规格读取：${result.productId}`, `状态：${result.status}，维度 ${result.dimensions.length} 个`, ...rows, ...omittedDimensions].join('\n');
}

function formatRentalReadRaw(result: RentalRawReadResult, fields?: string[]): string {
  const requestedFields = fields && fields.length > 0 ? fields : undefined;
  const specRows = result.specs.slice(0, 12).map((spec, index) => {
    const values = result.values[spec.specId] ?? {};
    const visibleFields = requestedFields ?? Object.keys(values).slice(0, 20);
    const valueText = visibleFields.map((field) => `${field}=${values[field] ?? ''}`).join('，');
    const omitted = !requestedFields && Object.keys(values).length > visibleFields.length ? `，... 省略 ${Object.keys(values).length - visibleFields.length} 个字段` : '';
    return `${index + 1}. ${spec.specId} ${spec.title}${valueText ? `：${valueText}${omitted}` : ''}`;
  });
  const omittedSpecs = result.specs.length > 12 ? [`... 省略 ${result.specs.length - 12} 个规格`] : [];
  return [
    `租赁原始读取：${result.productId}`,
    `状态：${result.status}，规格 ${result.specs.length} 个`,
    fields && fields.length > 0 ? `字段：${fields.join('、')}` : undefined,
    result.requestedCount !== undefined ? `请求字段数：${result.requestedCount}` : undefined,
    result.readCount !== undefined ? `读取字段数：${result.readCount}` : undefined,
    ...specRows,
    ...omittedSpecs,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export async function executeRentalReadOnlyOperationHandler(
  request: AgentToolConfirmRequest,
  client: RentalPriceSkillClient,
): Promise<BotResponse> {
  switch (request.toolName) {
    case 'rental.daemonStatus': {
      if (!client.daemonStatus) return { text: '当前租赁客户端还没有接入 daemon 状态查询能力。', metadata: { toolName: 'rental.daemonStatus', ok: false } };
      const result = await client.daemonStatus();
      return { text: formatRentalDaemonStatus(result), metadata: { toolName: 'rental.daemonStatus', ok: result.ok, status: result.status } };
    }
    case 'rental.platformSearch': {
      const keyword = requireString(request.arguments.keyword, 'keyword');
      if (!client.platformSearch) return { text: '当前租赁客户端还没有接入后台搜索能力。', metadata: { toolName: 'rental.platformSearch', ok: false, keyword } };
      const result = await client.platformSearch(keyword);
      return { text: formatRentalPlatformSearch(result), metadata: { toolName: 'rental.platformSearch', ok: result.ok, keyword, count: result.count } };
    }
    case 'rental.platformSearchAll': {
      const limit = readOptionalPositiveInteger(request.arguments.limit, RENTAL_PLATFORM_SEARCH_ALL_DEFAULT_LIMIT, RENTAL_PLATFORM_SEARCH_ALL_MAX_LIMIT, 'limit');
      if (!client.platformSearchAll) return { text: '当前租赁客户端还没有接入后台全量搜索能力。', metadata: { toolName: 'rental.platformSearchAll', ok: false, limit } };
      const result = await client.platformSearchAll(limit);
      return { text: formatRentalPlatformSearchAll(result), metadata: { toolName: 'rental.platformSearchAll', ok: result.ok, count: result.count, returnedCount: result.rows.length, limit } };
    }
    case 'rental.batchRead': {
      const productIds = readRentalBatchReadProductIds(request.arguments.productIds);
      if (!client.batchRead) return { text: '当前租赁客户端还没有接入批量读取能力。', metadata: { toolName: 'rental.batchRead', ok: false, productIds } };
      const result = await client.batchRead(productIds);
      return { text: formatRentalBatchRead(result, productIds), metadata: { toolName: 'rental.batchRead', ok: result.ok, productIds, count: result.count } };
    }
    case 'rental.specDiscoverFull': {
      const productId = requireProductId(request.arguments.productId, 'productId');
      if (!client.specDiscoverFull) return { text: '当前租赁客户端还没有接入完整规格读取能力。', metadata: { toolName: 'rental.specDiscoverFull', ok: false, productId } };
      const result = await client.specDiscoverFull(productId);
      return { text: formatRentalSpecDiscoverFull(result), metadata: { toolName: 'rental.specDiscoverFull', ok: result.ok, productId, dimensionCount: result.dimensions.length } };
    }
    case 'rental.readRaw': {
      const productId = requireProductId(request.arguments.productId, 'productId');
      const fields = readOptionalStringArray(request.arguments.fields, RENTAL_READ_RAW_MAX_FIELDS, 'fields');
      if (!client.readRaw) return { text: '当前租赁客户端还没有接入原始读取能力。', metadata: { toolName: 'rental.readRaw', ok: false, productId } };
      const result = await client.readRaw(productId, fields);
      return { text: formatRentalReadRaw(result, fields), metadata: { toolName: 'rental.readRaw', ok: result.ok, productId, specCount: result.specs.length } };
    }
    default:
      throw new Error(`Unsupported rental read-only tool: ${request.toolName}`);
  }
}
