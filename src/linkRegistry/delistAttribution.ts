import type { PlatformRestrictionObservation } from '../publicTraffic/types.js';
import type { AgentDelistEvent } from './delistOperationEvidence.js';
import type { LinkDelistCause, LinkDelistCauseConfidence, LinkDelistCauseEvidence, LinkListingState } from './types.js';

const MAX_RESTRICTION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export interface PlatformRestrictionAttributionObservation {
  restriction: PlatformRestrictionObservation;
  listingState?: LinkListingState;
  listingStatusText?: string;
  observedAt?: string;
}

export interface DelistAttributionInput {
  listingState: LinkListingState;
  statusObservedAt?: string;
  platformRestrictions?: PlatformRestrictionAttributionObservation[];
  agentDelistEvents?: AgentDelistEvent[];
  suppressDelistAttribution?: boolean;
}

export interface DelistAttributionResult {
  cause: LinkDelistCause;
  confidence: LinkDelistCauseConfidence;
  evidence: LinkDelistCauseEvidence[];
}

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function causeForRestriction(kind: PlatformRestrictionObservation['kind']): LinkDelistCause {
  if (kind === 'review_rejected') return 'platform_review_rejected';
  if (kind === 'frozen') return 'platform_frozen';
  return 'platform_restricted';
}

function restrictionRank(kind: PlatformRestrictionObservation['kind']): number {
  if (kind === 'frozen') return 3;
  if (kind === 'review_rejected') return 2;
  return 1;
}

function selectRestriction(
  items: PlatformRestrictionAttributionObservation[],
  statusObservedAt: string | undefined,
): PlatformRestrictionAttributionObservation | null {
  const statusTime = validTimestamp(statusObservedAt);
  if (statusTime === null) return null;

  const candidates = items.filter((item) => {
    const observedAt = validTimestamp(item.observedAt);
    const restrictionObservedAt = validTimestamp(item.restriction.observedAt);
    return item.listingState === 'delisted'
      && item.listingStatusText?.trim()
      && item.restriction.reasonText.trim()
      && observedAt !== null
      && restrictionObservedAt !== null
      && observedAt === restrictionObservedAt
      && observedAt <= statusTime
      && statusTime - observedAt <= MAX_RESTRICTION_FRESHNESS_MS;
  });
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const timeOrder = (validTimestamp(right.observedAt) ?? -Infinity) - (validTimestamp(left.observedAt) ?? -Infinity);
    return timeOrder || restrictionRank(right.restriction.kind) - restrictionRank(left.restriction.kind)
      || left.restriction.reasonText.localeCompare(right.restriction.reasonText);
  })[0] ?? null;
}

function matchingAgentEvent(events: AgentDelistEvent[], statusObservedAt: string | undefined): AgentDelistEvent | null {
  const observed = validTimestamp(statusObservedAt);
  if (observed === null) return null;
  return [...events]
    .filter((event) => {
      const at = validTimestamp(event.at);
      return at !== null && at < observed;
    })
    .sort((left, right) => right.at.localeCompare(left.at))[0] ?? null;
}

export function attributeDelist(input: DelistAttributionInput): DelistAttributionResult | null {
  if (input.suppressDelistAttribution || input.listingState !== 'delisted') return null;

  const restriction = selectRestriction(input.platformRestrictions ?? [], input.statusObservedAt);
  if (restriction) {
    return {
      cause: causeForRestriction(restriction.restriction.kind),
      confidence: 'confirmed',
      evidence: [{
        source: 'goods_snapshot',
        kind: 'platform_restriction',
        observedAt: restriction.observedAt,
        reasonText: restriction.restriction.reasonText,
        ...(restriction.listingStatusText?.trim() ? { listingStatusText: restriction.listingStatusText.trim() } : {}),
      }],
    };
  }

  const event = matchingAgentEvent(input.agentDelistEvents ?? [], input.statusObservedAt);
  if (event) {
    return {
      cause: 'agent_confirmed_manual_off_shelf',
      confidence: 'confirmed',
      evidence: [{
        source: 'operation_ledger',
        kind: 'agent_delist_execution',
        operationEventAt: event.at,
        toolName: event.toolName,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.decisionId ? { decisionId: event.decisionId } : {}),
      }],
    };
  }

  return {
    cause: 'external_manual_off_shelf_pending_confirmation',
    confidence: 'suspected',
    evidence: [],
  };
}
