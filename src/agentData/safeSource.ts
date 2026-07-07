import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export interface SafeSourceResult {
  sameSkuGroupId: string;
  sourceProductId?: string;
  sourceProductName?: string;
  status: 'found' | 'blocked' | 'missing_group';
  reason?: string;
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内ID\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function findReportRowForEntry(context: PublicTrafficDataReportContext, entry: LinkRegistryEntry): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => {
    const internalProductId = extractInternalProductId(row.displayProductId);
    return internalProductId === entry.internalProductId || (!!entry.platformProductId && row.platformProductId === entry.platformProductId);
  });
}

function sourceScore(row: PublicTrafficProductDataRow): number {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const thirty = row.periods['30d'];
  return (
    seven.shippedOrders * 1000
    + seven.amount * 2
    + seven.publicVisits * 5
    + one.shippedOrders * 300
    + one.amount * 3
    + thirty.shippedOrders * 100
    + thirty.createdOrders * 50
    + Math.min(seven.exposure, 5000) * 0.1
  );
}

export function resolveSafeSourceForSameSkuGroup(
  registryEntries: LinkRegistryEntry[],
  context: PublicTrafficDataReportContext,
  sameSkuGroupId: string,
  excludedProductIds: Set<string>,
): SafeSourceResult {
  const groupEntries = registryEntries.filter((entry) => entry.sameSkuGroupId?.trim() === sameSkuGroupId);
  if (groupEntries.length === 0) {
    return { sameSkuGroupId, status: 'missing_group', reason: '没有找到同款组。' };
  }

  const source = groupEntries
    .filter((entry) => entry.status === 'active' && !excludedProductIds.has(entry.internalProductId))
    .map((entry) => {
      const row = findReportRowForEntry(context, entry);
      return row ? { entry, row, score: sourceScore(row) } : null;
    })
    .filter((candidate): candidate is { entry: LinkRegistryEntry; row: PublicTrafficProductDataRow; score: number } => Boolean(candidate && candidate.score > 0))
    .sort((left, right) => right.score - left.score || Number(left.entry.internalProductId) - Number(right.entry.internalProductId))[0];

  if (!source) {
    return {
      sameSkuGroupId,
      status: 'blocked',
      reason: '同款组没有可用的安全源商品；不会从即将下架或缺少有效数据的链接复制新链。',
    };
  }

  return {
    sameSkuGroupId,
    sourceProductId: source.entry.internalProductId,
    sourceProductName: source.row.productName || source.entry.productName || source.entry.shortName || source.entry.internalProductId,
    status: 'found',
  };
}
