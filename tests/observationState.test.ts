import { describe, expect, it } from 'vitest';
import { applyObservationOverrides, transitionObservationState } from '../src/publicTraffic/observationState.js';

describe('observation state', () => {
  it('moves repeated abnormal watching products to candidate action', () => {
    expect(
      transitionObservationState({ platformProductId: 'p1', state: 'watching', abnormalDays: 2, cooldownUntil: null, note: '' }, { abnormal: true, improved: false, newProduct: false }, '2026-06-09'),
    ).toMatchObject({ platformProductId: 'p1', state: 'candidate_action', abnormalDays: 3 });
  });

  it('keeps cooldown products in cooldown until date passes', () => {
    expect(
      transitionObservationState({ platformProductId: 'p1', state: 'cooldown', abnormalDays: 5, cooldownUntil: '2026-06-10', note: '' }, { abnormal: true, improved: false, newProduct: false }, '2026-06-09'),
    ).toMatchObject({ state: 'cooldown', cooldownUntil: '2026-06-10' });
  });

  it('applies manual override by internal id', () => {
    expect(
      applyObservationOverrides(
        [{ platformProductId: 'p1', internalProductId: '558', state: 'candidate_action', abnormalDays: 3, cooldownUntil: null, note: '' }],
        [{ internalProductId: '558', state: 'cooldown', cooldownUntil: '2026-06-16', note: '已人工处理，观察7天' }],
      ),
    ).toEqual([{ platformProductId: 'p1', internalProductId: '558', state: 'cooldown', abnormalDays: 3, cooldownUntil: '2026-06-16', note: '已人工处理，观察7天' }]);
  });
});
