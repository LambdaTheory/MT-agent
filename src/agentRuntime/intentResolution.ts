export interface ResolutionCandidate {
  toolName: string;
  arguments: Record<string, unknown>;
  label: string;
  description?: string;
}

export interface ClarificationContext {
  originalMessage: string;
  question: string;
  reason: string;
  candidates: ResolutionCandidate[];
  depth: number;
  confidence: number;
}

export interface ConfidenceGateOptions {
  executeThreshold?: number;
}

export type GateVerdict = 'execute' | 'clarify';

export const MAX_CLARIFY_DEPTH = 3;

export function isClarifyDepthExceeded(depth: number): boolean {
  return depth >= MAX_CLARIFY_DEPTH;
}

export function gateByConfidence(confidence: number, options: ConfidenceGateOptions = {}): GateVerdict {
  const executeThreshold = options.executeThreshold ?? 0.6;
  return confidence >= executeThreshold ? 'execute' : 'clarify';
}
