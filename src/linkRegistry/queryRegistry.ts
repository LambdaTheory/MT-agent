import type { LinkRegistryEntry } from './types.js';

export interface LinkRegistryQuery {
  byInternalId(internalProductId: string): LinkRegistryEntry | null;
  bySameSkuGroup(sameSkuGroupId: string): LinkRegistryEntry[];
}

function trimKey(value: string): string {
  return value.trim();
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
    bySameSkuGroup(sameSkuGroupId: string): LinkRegistryEntry[] {
      return [...(bySameSkuGroupIndex.get(trimKey(sameSkuGroupId)) ?? [])];
    },
  };
}
