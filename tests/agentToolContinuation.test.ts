import { describe, expect, it } from 'vitest';
import { resolvePlannerArguments } from '../src/agentRuntime/stepResolution.js';

describe('agent tool continuation metadata references', () => {
  it('resolves common data and strategy metadata shapes for later steps', () => {
    expect(resolvePlannerArguments({ productIds: '${agg.productIds}' }, {
      agg: { productIds: ['648', '649'] },
    })).toEqual({ ok: true, value: { productIds: ['648', '649'] } });

    expect(resolvePlannerArguments({ productIds: '${explain.candidateProductIds}' }, {
      explain: { candidateProductIds: ['681'] },
    })).toEqual({ ok: true, value: { productIds: ['681'] } });

    expect(resolvePlannerArguments({ sourceProductId: '${safe.sourceProductId}' }, {
      safe: { sourceProductId: '680' },
    })).toEqual({ ok: true, value: { sourceProductId: '680' } });
  });
});
