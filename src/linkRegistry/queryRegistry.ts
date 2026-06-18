import type { LinkRegistryEntry } from './types.js';

export const MIN_SAME_SKU_GROUP_SAMPLE_SIZE = 3;

export type SameSkuGroupConfidence = 'none' | 'low' | 'sufficient';

export interface SameSkuGroupQueryResult {
  sameSkuGroupId: string;
  entries: LinkRegistryEntry[];
  sampleSize: number;
  sampleInsufficient: boolean;
  confidence: SameSkuGroupConfidence;
}

export interface LinkRegistryQuery {
  /** Trims the input ID and returns the first matching registry entry, or null when absent. */
  byInternalId(internalProductId: string): LinkRegistryEntry | null;
  /**
   * Trims the group ID and returns a structured result for downstream confidence handling.
   * Missing groups return an empty result with confidence='none'; groups with 1-2 entries
   * are sampleInsufficient and confidence='low'; 3+ entries are confidence='sufficient'.
   */
  bySameSkuGroup(sameSkuGroupId: string): SameSkuGroupQueryResult;
}

function trimKey(value: string): string {
  return value.trim();
}

function sameSkuGroupResult(sameSkuGroupId: string, entries: LinkRegistryEntry[]): SameSkuGroupQueryResult {
  const sampleSize = entries.length;
  const sampleInsufficient = sampleSize < MIN_SAME_SKU_GROUP_SAMPLE_SIZE;
  const confidence: SameSkuGroupConfidence = sampleSize === 0 ? 'none' : sampleInsufficient ? 'low' : 'sufficient';
  return { sameSkuGroupId, entries: [...entries], sampleSize, sampleInsufficient, confidence };
}

export function createLinkRegistryQuery(entries: LinkRegistryEntry[]): LinkRegistryQuery {
  const byInternalIdIndex = new Map<string, LinkRegistryEntry>();
  const bySameSkuGroupIndex = new Map<string, LinkRegistryEntry[]>();

  for (const entry of entries) {
    const internalProductId = trimKey(entry.internalProductId);
    if (internalProductId && !byInternalIdIndex.has(internalProductId)) byInternalIdIndex.set(internalProductId, entry);

    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) continue;

    const group = bySameSkuGroupIndex.get(sameSkuGroupId) ?? [];
    group.push(entry);
    bySameSkuGroupIndex.set(sameSkuGroupId, group);
  }

  return {
    byInternalId(internalProductId: string): LinkRegistryEntry | null {
      return byInternalIdIndex.get(trimKey(internalProductId)) ?? null;
    },
    bySameSkuGroup(sameSkuGroupId: string): SameSkuGroupQueryResult {
      const trimmed = trimKey(sameSkuGroupId);
      return sameSkuGroupResult(trimmed, bySameSkuGroupIndex.get(trimmed) ?? []);
    },
  };
}
