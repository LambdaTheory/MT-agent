export type DecisionRecommendation = 'observe' | 'approve_to_execute' | 'skip';
export type DecisionRisk = 'read' | 'write' | 'high';

export interface DecisionSubject {
  kind: 'product' | 'sameSkuGroup' | 'link';
  id: string;
  displayName?: string;
}

export interface DecisionRecord {
  decisionId: string;
  runId: string;
  title: string;
  subjects: DecisionSubject[];
  operationType: 'price_up' | 'price_down' | 'new_link' | 'delist' | 'observe';
  recommendation: DecisionRecommendation;
  risk: DecisionRisk;
  rationale: string[];
  evidenceRefs: string[];
  proposedTool?: { toolName: string; arguments: Record<string, unknown> };
  uncertainties: string[];
  blockedReason?: string;
}

const RECOMMENDATIONS: DecisionRecommendation[] = ['observe', 'approve_to_execute', 'skip'];
const RISKS: DecisionRisk[] = ['read', 'write', 'high'];
const OPERATION_TYPES: DecisionRecord['operationType'][] = ['price_up', 'price_down', 'new_link', 'delist', 'observe'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDecisionSubject(value: unknown): value is DecisionSubject {
  if (!isRecord(value)) return false;
  return (value.kind === 'product' || value.kind === 'sameSkuGroup' || value.kind === 'link')
    && typeof value.id === 'string'
    && (value.displayName === undefined || typeof value.displayName === 'string');
}

function isProposedTool(value: unknown): value is DecisionRecord['proposedTool'] {
  if (!isRecord(value)) return false;
  return typeof value.toolName === 'string'
    && value.toolName.trim().length > 0
    && isRecord(value.arguments);
}

export function isValidDecisionRecord(value: unknown): value is DecisionRecord {
  if (!isRecord(value)) return false;
  return typeof value.decisionId === 'string'
    && typeof value.runId === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.subjects)
    && value.subjects.length > 0
    && value.subjects.every(isDecisionSubject)
    && typeof value.operationType === 'string'
    && OPERATION_TYPES.includes(value.operationType as DecisionRecord['operationType'])
    && typeof value.recommendation === 'string'
    && RECOMMENDATIONS.includes(value.recommendation as DecisionRecommendation)
    && typeof value.risk === 'string'
    && RISKS.includes(value.risk as DecisionRisk)
    && Array.isArray(value.rationale)
    && value.rationale.every((item) => typeof item === 'string')
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.every((item) => typeof item === 'string' && item.trim().length > 0)
    && Array.isArray(value.uncertainties)
    && value.uncertainties.every((item) => typeof item === 'string')
    && (value.proposedTool === undefined || isProposedTool(value.proposedTool))
    && (value.blockedReason === undefined || typeof value.blockedReason === 'string');
}
