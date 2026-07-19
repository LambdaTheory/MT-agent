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

export type InventoryStatusSnapshotMissingReason = 'missing' | 'report_generation_missing' | 'mismatched_generation' | 'mismatched_report_date' | 'mismatched_snapshot_date';

export type InventoryStatusDetailResult = {
  status: 'detail';
  query: string;
  matchedBy: InventoryStatusMatchMethod;
  sameSkuGroupId: string;
  snapshot: InventoryStatusSnapshot;
  group: InventoryStatusGroupSnapshot;
  historySnapshots?: InventoryStatusSnapshot[];
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
  | { status: 'snapshot_missing'; reason: InventoryStatusSnapshotMissingReason; query?: string };

interface QueryInventoryStatusInput {
  snapshot: InventoryStatusSnapshot | null;
  registryStore: LinkRegistryStore;
  query: string;
  reportGenerationId: string | undefined;
  reportDate: string | undefined;
  snapshotDate: string | undefined;
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
  if (!query) return { status: 'snapshot_missing', reason: 'missing' };

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

function snapshotMissingResult(reason: InventoryStatusSnapshotMissingReason, rawQuery: string): InventoryStatusQueryResult {
  const query = rawQuery.trim();
  return query ? { status: 'snapshot_missing', reason, query: rawQuery } : { status: 'snapshot_missing', reason };
}

export function queryInventoryStatus(input: QueryInventoryStatusInput): InventoryStatusQueryResult {
  const query = input.query.trim();
  if (!input.snapshot) return snapshotMissingResult('missing', input.query);
  if (!input.reportGenerationId?.trim()) return snapshotMissingResult('report_generation_missing', input.query);
  if (input.snapshot.generationId !== input.reportGenerationId) return snapshotMissingResult('mismatched_generation', input.query);
  if (input.snapshot.sourceReportDate !== input.reportDate) return snapshotMissingResult('mismatched_report_date', input.query);
  if (input.snapshot.date !== input.snapshotDate) return snapshotMissingResult('mismatched_snapshot_date', input.query);
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
