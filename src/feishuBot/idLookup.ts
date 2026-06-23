import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';

export interface ProductIdIndex {
  internalToPlatform: Map<string, string[]>;
  platformToInternal: Map<string, string | undefined>;
  internalProductName: Map<string, string>;
  platformProductName: Map<string, string>;
}

export type ProductIdLookupResult =
  | { kind: 'internal'; input: string; internalId: string; platformIds: string[]; productName?: string }
  | { kind: 'platform'; input: string; internalId?: string; platformIds: string[]; productName?: string }
  | { kind: 'ambiguous'; input: string; internalId?: string; platformIds?: string[]; productName?: string }
  | { kind: 'not_found'; input: string };

const INTERNAL_DISPLAY_ID = /^端内ID\s*(\d+)$/;
const PLATFORM_ID = /^20\d{18,}$/;

export function buildProductIdIndex(context: PublicTrafficDataReportContext): ProductIdIndex {
  const internalToPlatform = new Map<string, string[]>();
  const platformToInternal = new Map<string, string | undefined>();
  const internalProductName = new Map<string, string>();
  const platformProductName = new Map<string, string>();

  for (const row of context.rows) {
    const platformProductId = row.platformProductId.trim();
    if (!platformProductId) continue;

    const internalId = INTERNAL_DISPLAY_ID.exec(row.displayProductId.trim())?.[1];
    platformToInternal.set(platformProductId, internalId);
    platformProductName.set(platformProductId, row.productName);

    if (!internalId) continue;

    const platformIds = internalToPlatform.get(internalId) ?? [];
    if (!platformIds.includes(platformProductId)) platformIds.push(platformProductId);
    internalToPlatform.set(internalId, platformIds);
    if (!internalProductName.has(internalId)) internalProductName.set(internalId, row.productName);
  }

  return { internalToPlatform, platformToInternal, internalProductName, platformProductName };
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function parseQuery(query: string): { type: 'internal' | 'platform' | 'bare'; id: string } | undefined {
  const text = query.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  const explicitInternal = firstMatch(text, [
    /端内ID\s*(\d+)/i,
    /端内\s*(\d+)/i,
    /(?:查ID|ID查询)\s*(\d+)/i,
    /^(\d+)\s*的平台ID$/i,
  ]);
  if (explicitInternal) return { type: 'internal', id: explicitInternal };

  const explicitPlatform = firstMatch(text, [
    /平台商品ID\s*(\d+)/i,
    /平台ID\s*(?:转|查|查询|对应)?\s*端内\s*(\d+)/i,
    /平台ID\s*(\d+)/i,
    /(20\d{18,})\s*的端内ID/i,
  ]);
  if (explicitPlatform) return { type: 'platform', id: explicitPlatform };

  if (/^\d+$/.test(text)) return { type: 'bare', id: text };

  const longPlatformId = /(20\d{18,})/.exec(text)?.[1];
  if (longPlatformId) return { type: 'platform', id: longPlatformId };

  return undefined;
}

function lookupInternal(index: ProductIdIndex, internalId: string): ProductIdLookupResult | undefined {
  const platformIds = index.internalToPlatform.get(internalId);
  if (!platformIds) return undefined;
  return { kind: 'internal', input: internalId, internalId, platformIds, productName: index.internalProductName.get(internalId) };
}

function lookupPlatform(index: ProductIdIndex, platformProductId: string): ProductIdLookupResult | undefined {
  if (!index.platformToInternal.has(platformProductId)) return undefined;
  const internalId = index.platformToInternal.get(platformProductId);
  return { kind: 'platform', input: platformProductId, internalId, platformIds: [platformProductId], productName: index.platformProductName.get(platformProductId) };
}

export function lookupProductId(context: PublicTrafficDataReportContext, query: string): ProductIdLookupResult {
  const parsed = parseQuery(query);
  const input = parsed?.id ?? query.trim();
  if (!parsed) return { kind: 'not_found', input };

  const index = buildProductIdIndex(context);
  if (parsed.type === 'internal') return lookupInternal(index, parsed.id) ?? { kind: 'not_found', input: parsed.id };
  if (parsed.type === 'platform') return lookupPlatform(index, parsed.id) ?? { kind: 'not_found', input: parsed.id };

  // Bare numbers are ambiguous in chat; short IDs usually mean 端内ID, while long 20... IDs usually mean 平台商品ID.
  const first = PLATFORM_ID.test(parsed.id) ? lookupPlatform(index, parsed.id) : lookupInternal(index, parsed.id);
  const fallback = PLATFORM_ID.test(parsed.id) ? lookupInternal(index, parsed.id) : lookupPlatform(index, parsed.id);
  return first ?? fallback ?? { kind: 'not_found', input: parsed.id };
}

function productNameSuffix(productName: string | undefined): string {
  return productName ? `（${productName}）` : '';
}

export function formatIdLookupResult(result: ProductIdLookupResult): string {
  if (result.kind === 'internal') {
    return `端内ID ${result.internalId} 对应平台商品ID：${result.platformIds.join('、')}${productNameSuffix(result.productName)}`;
  }

  if (result.kind === 'platform') {
    if (!result.internalId) return `平台商品ID ${result.input} 暂未映射端内ID${productNameSuffix(result.productName)}`;
    return `平台商品ID ${result.input} 对应端内ID ${result.internalId}${productNameSuffix(result.productName)}`;
  }

  if (result.kind === 'ambiguous') return `请说明要查询端内ID还是平台商品ID：${result.input}`;

  return `没有找到 ${result.input} 的ID映射。请确认已生成最新公域日报，或使用“端内ID 565”“平台商品ID 2000...”再试。`;
}
