import { describe, expect, it } from 'vitest';
import { gateByConfidence, isClarifyDepthExceeded, MAX_CLARIFY_DEPTH } from '../src/agentRuntime/intentResolution.js';

describe('confidence gate', () => {
  it('executes at or above the default threshold and clarifies below it', () => {
    expect(gateByConfidence(0.9)).toBe('execute');
    expect(gateByConfidence(0.3)).toBe('clarify');
    expect(gateByConfidence(0.6)).toBe('execute');
  });

  it('honors a custom execute threshold', () => {
    expect(gateByConfidence(0.7, { executeThreshold: 0.8 })).toBe('clarify');
    expect(gateByConfidence(0.8, { executeThreshold: 0.8 })).toBe('execute');
  });

  it('detects exhausted clarification depth', () => {
    expect(isClarifyDepthExceeded(MAX_CLARIFY_DEPTH - 1)).toBe(false);
    expect(isClarifyDepthExceeded(MAX_CLARIFY_DEPTH)).toBe(true);
  });
});
