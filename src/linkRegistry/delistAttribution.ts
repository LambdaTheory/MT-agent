import type { PlatformRestrictionObservation } from '../publicTraffic/types.js';
import type { AgentDelistEvent } from './delistOperationEvidence.js';
import type { LinkDelistCause, LinkDelistCauseConfidence, LinkDelistCauseEvidence, LinkListingState } from './types.js';

export interface DelistAttributionInput {
  listingState: LinkListingState;
  statusObservedAt?: string;
  platformRestrictions?: PlatformRestrictionObservation[];
  agentDelistEvents?: AgentDelistEvent[];
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

function selectRestriction(items: PlatformRestrictionObservation[]): PlatformRestrictionObservation | null {
  const candidates = items.filter((item) => item.reasonText.trim());
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const timeOrder = (validTimestamp(right.observedAt) ?? -Infinity) - (validTimestamp(left.observedAt) ?? -Infinity);
    return timeOrder || restrictionRank(right.kind) - restrictionRank(left.kind) || left.reasonText.localeCompare(right.reasonText);
  })[0] ?? null;
}

function matchingAgentEvent(events: AgentDelistEvent[], statusObservedAt: string | undefined): AgentDelistEvent | null {
  const observed = validTimestamp(statusObservedAt);
  if (observed === null) return null;
  return [...events]
    .filter((event) => {
      const at = validTimestamp(event.at);
      return at !== null && at <= observed;
    })
    .sort((left, right) => right.at.localeCompare(left.at))[0] ?? null;
}

export function attributeDelist(input: DelistAttributionInput): DelistAttributionResult | null {
  if (input.listingState !== 'delisted') return null;

  const restriction = selectRestriction(input.platformRestrictions ?? []);
  if (restriction) {
    return {
      cause: causeForRestriction(restriction.kind),
      confidence: 'confirmed',
      evidence: [{
        source: 'goods_snapshot',
        kind: 'platform_restriction',
        ...(restriction.observedAt ? { observedAt: restriction.observedAt } : {}),
        reasonText: restriction.reasonText,
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
