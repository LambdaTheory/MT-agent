import type { LinkRegistryEntry } from './types.js';

export const MIN_SAME_SKU_GROUP_SAMPLE_SIZE = 3;

export type SameSkuGroupConfidence = 'none' | 'low' | 'sufficient';

export interface ListBySameSkuGroupOptions {
  includeRemoved?: boolean;
  includeUnknown?: boolean;
}

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
  /** Alias of byInternalId for the archive-layer API. */
  getByInternalId(internalProductId: string): LinkRegistryEntry | null;
  /** Trims the platform product ID and returns the first matching registry entry, or null when absent. */
  byPlatformProductId(platformProductId: string): LinkRegistryEntry | null;
  /**
   * Trims the group ID and returns a structured result for downstream confidence handling.
   * Missing groups return an empty result with confidence='none'; groups with 1-2 entries
   * are sampleInsufficient and confidence='low'; 3+ entries are confidence='sufficient'.
   */
  bySameSkuGroup(sameSkuGroupId: string): SameSkuGroupQueryResult;
  /** Returns group entries, defaulting to active-only unless opted in otherwise. */
  listBySameSkuGroup(sameSkuGroupId: string, options?: ListBySameSkuGroupOptions): LinkRegistryEntry[];
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

function includedByStatus(entry: LinkRegistryEntry, options: ListBySameSkuGroupOptions = {}): boolean {
  if (entry.status === 'active') return true;
  if (entry.status === 'removed') return options.includeRemoved === true;
  if (entry.status === 'unknown') return options.includeUnknown === true;
  return false;
}

export function createLinkRegistryQuery(entries: LinkRegistryEntry[]): LinkRegistryQuery {
  const byInternalIdIndex = new Map<string, LinkRegistryEntry>();
  const byPlatformProductIdIndex = new Map<string, LinkRegistryEntry>();
  const bySameSkuGroupIndex = new Map<string, LinkRegistryEntry[]>();

  for (const entry of entries) {
    const internalProductId = trimKey(entry.internalProductId);
    if (internalProductId && !byInternalIdIndex.has(internalProductId)) byInternalIdIndex.set(internalProductId, entry);

    const platformProductId = entry.platformProductId?.trim();
    if (platformProductId && !byPlatformProductIdIndex.has(platformProductId)) byPlatformProductIdIndex.set(platformProductId, entry);

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
    getByInternalId(internalProductId: string): LinkRegistryEntry | null {
      return byInternalIdIndex.get(trimKey(internalProductId)) ?? null;
    },
    byPlatformProductId(platformProductId: string): LinkRegistryEntry | null {
      return byPlatformProductIdIndex.get(trimKey(platformProductId)) ?? null;
    },
    bySameSkuGroup(sameSkuGroupId: string): SameSkuGroupQueryResult {
      const trimmed = trimKey(sameSkuGroupId);
      return sameSkuGroupResult(trimmed, bySameSkuGroupIndex.get(trimmed) ?? []);
    },
    listBySameSkuGroup(sameSkuGroupId: string, options: ListBySameSkuGroupOptions = {}): LinkRegistryEntry[] {
      const trimmed = trimKey(sameSkuGroupId);
      return (bySameSkuGroupIndex.get(trimmed) ?? []).filter((entry) => includedByStatus(entry, options));
    },
  };
}
