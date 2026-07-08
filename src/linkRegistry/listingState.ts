import type { LinkListingState, LinkRegistryStatus } from './types.js';

export type ListingObservationSource = 'daemon_catalog' | 'goods_snapshot' | 'exposure' | 'goods_link_lifecycle';

export interface ListingStateObservation {
  source: ListingObservationSource;
  state: LinkListingState;
  observedAt?: string;
  rawText?: string;
}

export interface ListingStateArbitrationOptions {
  freshnessOverrideMs?: number;
}

export interface ListingStateDecision {
  state: LinkListingState;
  source?: ListingObservationSource;
  observedAt?: string;
}

const SOURCE_TRUST: Record<ListingObservationSource, number> = {
  daemon_catalog: 4,
  goods_snapshot: 3,
  exposure: 2,
  goods_link_lifecycle: 1,
};

function normalizedText(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function parseListingStateFromText(text: string | undefined): LinkListingState {
  const value = normalizedText(text);
  if (!value) return 'unknown';
  if (/已下架|停售/u.test(value)) return 'delisted';
  if (/未同步|审核失败/u.test(value)) return 'unknown';
  if (/可售卖|已同步|通过|上架|出售中/u.test(value)) return 'on_sale';
  return 'unknown';
}

export function listingStateToStatus(state: LinkListingState): LinkRegistryStatus {
  if (state === 'on_sale') return 'active';
  if (state === 'delisted' || state === 'gone') return 'removed';
  return 'unknown';
}

function observedTime(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareByTrust(left: ListingStateObservation, right: ListingStateObservation): number {
  return SOURCE_TRUST[right.source] - SOURCE_TRUST[left.source];
}

export function arbitrateListingState(
  observations: ListingStateObservation[],
  options: ListingStateArbitrationOptions = {},
): ListingStateDecision {
  const explicit = observations.filter((item) => item.state !== 'unknown');
  const candidates = explicit.length > 0 ? explicit : observations.filter((item) => item.state === 'unknown');
  if (candidates.length === 0) return { state: 'unknown' };

  let winner = [...candidates].sort(compareByTrust)[0]!;
  const freshnessOverrideMs = options.freshnessOverrideMs;
  if (freshnessOverrideMs !== undefined) {
    const winnerTime = observedTime(winner.observedAt);
    for (const candidate of candidates) {
      if (SOURCE_TRUST[candidate.source] >= SOURCE_TRUST[winner.source]) continue;
      const candidateTime = observedTime(candidate.observedAt);
      if (winnerTime === null || candidateTime === null) continue;
      if (candidateTime - winnerTime > freshnessOverrideMs) winner = candidate;
    }
  }

  return {
    state: winner.state,
    source: winner.source,
    ...(winner.observedAt ? { observedAt: winner.observedAt } : {}),
  };
}
