import type { ProductObservationOverride, ProductObservationSignal, ProductObservationState } from './types.js';

export function transitionObservationState(current: ProductObservationState, signal: ProductObservationSignal, date: string): ProductObservationState {
  if (current.state === 'cooldown' && current.cooldownUntil && current.cooldownUntil >= date) {
    return current;
  }

  if (signal.newProduct) {
    return { ...current, state: 'new_observation', abnormalDays: signal.abnormal ? current.abnormalDays + 1 : current.abnormalDays };
  }

  if (signal.improved) {
    return { ...current, state: 'resolved_or_stable', abnormalDays: 0, cooldownUntil: null };
  }

  const abnormalDays = signal.abnormal ? current.abnormalDays + 1 : 0;
  if (abnormalDays >= 3) {
    return { ...current, state: 'candidate_action', abnormalDays, cooldownUntil: null };
  }

  if (signal.abnormal) {
    return { ...current, state: 'watching', abnormalDays, cooldownUntil: null };
  }

  return { ...current, state: 'resolved_or_stable', abnormalDays: 0, cooldownUntil: null };
}

function matchesOverride(state: ProductObservationState, override: ProductObservationOverride): boolean {
  return Boolean((override.internalProductId && state.internalProductId === override.internalProductId) || (override.platformProductId && state.platformProductId === override.platformProductId));
}

export function applyObservationOverrides(states: ProductObservationState[], overrides: ProductObservationOverride[]): ProductObservationState[] {
  return states.map((state) => {
    const override = overrides.find((item) => matchesOverride(state, item));
    if (!override) return state;
    return {
      ...state,
      state: override.state,
      cooldownUntil: override.cooldownUntil ?? state.cooldownUntil,
      note: override.note ?? state.note,
    };
  });
}
