import type { Page } from 'playwright';

export const MAX_DIFFERENTIAL_PRICING_BATCH_PRODUCTS = 20;

export type DifferentialPricingDiscountLevel = 'SS' | 'S' | 'A' | 'B';

export interface DifferentialPricingDiscountInputSnapshot {
  value: string;
  ariaValueMax: string | null;
}

export interface DifferentialPricingDiscountFill {
  index: number;
  level: DifferentialPricingDiscountLevel;
  value: string;
}

export interface DifferentialPricingDiscountFillPlan {
  inputCount: number;
  emptyInputCount: number;
  exceedsBatchLimit: boolean;
  fills: DifferentialPricingDiscountFill[];
  unrecognizedMaxValues: string[];
}

export interface DifferentialPricingDiscountFillResult extends DifferentialPricingDiscountFillPlan {
  filledCount: number;
}

const discountByMax = new Map<string, { level: DifferentialPricingDiscountLevel; value: string }>([
  ['8.5', { level: 'SS', value: '8.5' }],
  ['9', { level: 'S', value: '9.0' }],
  ['9.0', { level: 'S', value: '9.0' }],
  ['9.5', { level: 'A', value: '9.5' }],
  ['9.8', { level: 'B', value: '9.8' }],
]);

function normalized(value: string | null): string {
  return String(value ?? '').trim();
}

export function planDifferentialPricingDiscountFills(inputs: DifferentialPricingDiscountInputSnapshot[]): DifferentialPricingDiscountFillPlan {
  const fills: DifferentialPricingDiscountFill[] = [];
  const unrecognizedMaxValues = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    if (normalized(input.value)) continue;
    const max = normalized(input.ariaValueMax);
    const discount = discountByMax.get(max);
    if (!discount) {
      if (max) unrecognizedMaxValues.add(max);
      continue;
    }
    fills.push({ index, level: discount.level, value: discount.value });
  }

  return {
    inputCount: inputs.length,
    emptyInputCount: inputs.filter((input) => !normalized(input.value)).length,
    exceedsBatchLimit: inputs.length > MAX_DIFFERENTIAL_PRICING_BATCH_PRODUCTS * 4,
    fills,
    unrecognizedMaxValues: Array.from(unrecognizedMaxValues),
  };
}

export async function fillMissingDifferentialPricingDiscounts(page: Page): Promise<DifferentialPricingDiscountFillResult> {
  const discountInputs = page.locator('.ant-table-content input.ant-input-number-input[role="spinbutton"]');
  const snapshots = await discountInputs.evaluateAll((inputs) =>
    inputs.map((input) => ({
      value: input instanceof HTMLInputElement ? input.value : '',
      ariaValueMax: input.getAttribute('aria-valuemax'),
    })),
  );
  const plan = planDifferentialPricingDiscountFills(snapshots);

  if (plan.exceedsBatchLimit) return { ...plan, filledCount: 0 };

  for (const fill of plan.fills) {
    await discountInputs.nth(fill.index).fill(fill.value);
  }

  return { ...plan, filledCount: plan.fills.length };
}
