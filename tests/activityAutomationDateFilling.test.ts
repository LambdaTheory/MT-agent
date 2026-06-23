import { describe, expect, it } from 'vitest';
import { planDifferentialPricingDateFills } from '../src/activityAutomation/dateFilling.js';

describe('differential pricing date filling', () => {
  it('plans the same start and end dates for every empty visible row range', () => {
    const plan = planDifferentialPricingDateFills(
      [
        { startValue: '', endValue: '' },
        { startValue: '', endValue: '' },
      ],
      { startsAt: '2026-06-23', endsAt: '2026-06-30' },
    );

    expect(plan.configured).toBe(true);
    expect(plan.rangeCount).toBe(2);
    expect(plan.emptyRangeCount).toBe(2);
    expect(plan.fills).toEqual([
      { index: 0, startsAt: '2026-06-23', endsAt: '2026-06-30' },
      { index: 1, startsAt: '2026-06-23', endsAt: '2026-06-30' },
    ]);
  });

  it('skips partially or fully filled ranges and stays disabled when dates are incomplete', () => {
    const configuredPlan = planDifferentialPricingDateFills(
      [
        { startValue: '2026-06-23', endValue: '2026-06-30' },
        { startValue: '2026-06-23', endValue: '' },
        { startValue: '', endValue: '' },
      ],
      { startsAt: '2026-06-23', endsAt: '2026-06-30' },
    );

    expect(configuredPlan.configured).toBe(true);
    expect(configuredPlan.emptyRangeCount).toBe(1);
    expect(configuredPlan.fills).toEqual([{ index: 2, startsAt: '2026-06-23', endsAt: '2026-06-30' }]);

    const incompletePlan = planDifferentialPricingDateFills(
      [{ startValue: '', endValue: '' }],
      { startsAt: '2026-06-23', endsAt: undefined },
    );

    expect(incompletePlan.configured).toBe(false);
    expect(incompletePlan.fills).toEqual([]);
  });
});
