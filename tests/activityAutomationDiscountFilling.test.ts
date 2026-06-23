import { describe, expect, it } from 'vitest';
import { MAX_DIFFERENTIAL_PRICING_BATCH_PRODUCTS, planDifferentialPricingDiscountFills } from '../src/activityAutomation/discountFilling.js';

describe('differential pricing discount filling', () => {
  it('plans minimum discount values for empty SS/S/A/B inputs from aria-valuemax', () => {
    const plan = planDifferentialPricingDiscountFills([
      { value: '', ariaValueMax: '8.5' },
      { value: '', ariaValueMax: '9' },
      { value: '', ariaValueMax: '9.5' },
      { value: '', ariaValueMax: '9.8' },
    ]);

    expect(plan.emptyInputCount).toBe(4);
    expect(plan.fills.map((fill) => ({ index: fill.index, level: fill.level, value: fill.value }))).toEqual([
      { index: 0, level: 'SS', value: '8.5' },
      { index: 1, level: 'S', value: '9.0' },
      { index: 2, level: 'A', value: '9.5' },
      { index: 3, level: 'B', value: '9.8' },
    ]);
    expect(plan.unrecognizedMaxValues).toEqual([]);
  });

  it('skips filled values and reports unrecognized empty discount inputs', () => {
    const plan = planDifferentialPricingDiscountFills([
      { value: '8.5', ariaValueMax: '8.5' },
      { value: '', ariaValueMax: '7.7' },
    ]);

    expect(plan.emptyInputCount).toBe(1);
    expect(plan.fills).toEqual([]);
    expect(plan.unrecognizedMaxValues).toEqual(['7.7']);
  });

  it('keeps the pre-submit batch guard at twenty selected products', () => {
    const snapshots = Array.from({ length: MAX_DIFFERENTIAL_PRICING_BATCH_PRODUCTS * 4 + 4 }, () => ({ value: '', ariaValueMax: '8.5' }));

    const plan = planDifferentialPricingDiscountFills(snapshots);

    expect(MAX_DIFFERENTIAL_PRICING_BATCH_PRODUCTS).toBe(20);
    expect(plan.exceedsBatchLimit).toBe(true);
  });

  it('uses configured discount values when provided', () => {
    const plan = planDifferentialPricingDiscountFills(
      [
        { value: '', ariaValueMax: '8.5' },
        { value: '', ariaValueMax: '9' },
        { value: '', ariaValueMax: '9.5' },
        { value: '', ariaValueMax: '9.8' },
      ],
      { SS: '8.8', S: '9.1', A: '9.6', B: '9.9' },
    );

    expect(plan.fills.map((fill) => fill.value)).toEqual(['8.8', '9.1', '9.6', '9.9']);
  });
});
