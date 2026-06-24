import type { LinkRegistryAliasResolutionCandidate, LinkRegistryStore } from '../linkRegistry/store.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusSnapshot } from './types.js';

export type InventoryStatusMatchMethod = 'internal_id' | 'same_sku_group' | 'alias';

export interface InventoryStatusCandidate {
  sameSkuGroupId: string | null;
  shortName?: string;
  internalProductIds: string[];
  reason: string;
}

export type InventoryStatusOverviewResult = { status: 'overview'; snapshot: InventoryStatusSnapshot };

export type InventoryStatusDetailResult = {
  status: 'detail';
  query: string;
  matchedBy: InventoryStatusMatchMethod;
  sameSkuGroupId: string;
  snapshot: InventoryStatusSnapshot;
  group: InventoryStatusGroupSnapshot;
};

export type InventoryStatusAmbiguousResult = {
  status: 'ambiguous';
  query: string;
  candidates: InventoryStatusCandidate[];
};

export type InventoryStatusQueryResult =
  | InventoryStatusOverviewResult
  | InventoryStatusDetailResult
  | InventoryStatusAmbiguousResult
  | { status: 'not_found'; query: string }
  | { status: 'snapshot_missing'; query?: string };

interface QueryInventoryStatusInput {
  snapshot: InventoryStatusSnapshot | null;
  registryStore: LinkRegistryStore;
  query: string;
}

interface ResolvedGroup {
  matchedBy: InventoryStatusMatchMethod;
  sameSkuGroupId: string;
}

function candidateFromAlias(candidate: LinkRegistryAliasResolutionCandidate): InventoryStatusCandidate {
  const shortName = candidate.entries.find((entry) => entry.shortName?.trim())?.shortName?.trim();
  return {
    sameSkuGroupId: candidate.sameSkuGroupId,
    ...(shortName ? { shortName } : {}),
    internalProductIds: candidate.candidateInternalProductIds,
    reason: candidate.reason,
  };
}

function resolveGroup(registryStore: LinkRegistryStore, rawQuery: string): ResolvedGroup | InventoryStatusQueryResult {
  const query = rawQuery.trim();
  if (!query) return { status: 'snapshot_missing', query: rawQuery };

  if (/^\d+$/.test(query)) {
    const entry = registryStore.getByInternalId(query);
    const sameSkuGroupId = entry?.sameSkuGroupId?.trim();
    if (!entry || !sameSkuGroupId) return { status: 'not_found', query: rawQuery };
    return { matchedBy: 'internal_id', sameSkuGroupId };
  }

  const directEntries = registryStore.listBySameSkuGroup(query, { includeRemoved: true, includeUnknown: true });
  if (directEntries.length > 0) return { matchedBy: 'same_sku_group', sameSkuGroupId: query };

  const alias = registryStore.resolveAlias(query);
  if (alias.status === 'not_found') return { status: 'not_found', query: rawQuery };
  if (alias.status === 'multiple') return { status: 'ambiguous', query: rawQuery, candidates: alias.candidates.map(candidateFromAlias) };

  const sameSkuGroupId = alias.sameSkuGroupId?.trim();
  if (!sameSkuGroupId) return { status: 'not_found', query: rawQuery };
  return { matchedBy: 'alias', sameSkuGroupId };
}

function findGroup(snapshot: InventoryStatusSnapshot, sameSkuGroupId: string): InventoryStatusGroupSnapshot | null {
  return snapshot.groups.find((group) => group.sameSkuGroupId === sameSkuGroupId) ?? null;
}

export function queryInventoryStatus(input: QueryInventoryStatusInput): InventoryStatusQueryResult {
  const query = input.query.trim();
  if (!input.snapshot) return query ? { status: 'snapshot_missing', query: input.query } : { status: 'snapshot_missing' };
  if (!query) return { status: 'overview', snapshot: input.snapshot };

  const resolved = resolveGroup(input.registryStore, input.query);
  if ('status' in resolved) return resolved;

  const group = findGroup(input.snapshot, resolved.sameSkuGroupId);
  if (!group) return { status: 'not_found', query: input.query };

  return {
    status: 'detail',
    query: input.query,
    matchedBy: resolved.matchedBy,
    sameSkuGroupId: resolved.sameSkuGroupId,
    snapshot: input.snapshot,
    group,
  };
}
