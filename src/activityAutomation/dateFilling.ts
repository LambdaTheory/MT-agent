import type { Page } from 'playwright';

export interface DifferentialPricingDateDraft {
  startsAt?: string;
  endsAt?: string;
}

export interface DifferentialPricingDateRangeSnapshot {
  startValue: string;
  endValue: string;
}

export interface DifferentialPricingDateFill {
  index: number;
  startsAt: string;
  endsAt: string;
}

export interface DifferentialPricingDateFillPlan {
  configured: boolean;
  rangeCount: number;
  emptyRangeCount: number;
  fills: DifferentialPricingDateFill[];
}

export interface DifferentialPricingDateFillResult extends DifferentialPricingDateFillPlan {
  filledCount: number;
}

function normalized(value: string | undefined): string {
  return String(value ?? '').trim();
}

function isEmptyRange(range: DifferentialPricingDateRangeSnapshot): boolean {
  return !normalized(range.startValue) && !normalized(range.endValue);
}

export function planDifferentialPricingDateFills(
  ranges: DifferentialPricingDateRangeSnapshot[],
  draft: DifferentialPricingDateDraft,
): DifferentialPricingDateFillPlan {
  const startsAt = normalized(draft.startsAt);
  const endsAt = normalized(draft.endsAt);
  const configured = Boolean(startsAt && endsAt);

  return {
    configured,
    rangeCount: ranges.length,
    emptyRangeCount: ranges.filter(isEmptyRange).length,
    fills: configured
      ? ranges.flatMap((range, index) => (isEmptyRange(range) ? [{ index, startsAt, endsAt }] : []))
      : [],
  };
}

export async function fillDifferentialPricingDateRanges(
  page: Page,
  draft: DifferentialPricingDateDraft,
): Promise<DifferentialPricingDateFillResult> {
  const dateRanges = page.locator('.ant-table-tbody tr[data-row-key] .ant-picker-range');
  const snapshots = await dateRanges.evaluateAll((ranges) =>
    ranges.map((range) => {
      const inputs = Array.from(range.querySelectorAll('input'));
      const startInput = inputs[0];
      const endInput = inputs[1];
      return {
        startValue: startInput instanceof HTMLInputElement ? startInput.value : '',
        endValue: endInput instanceof HTMLInputElement ? endInput.value : '',
      };
    }),
  );
  const plan = planDifferentialPricingDateFills(snapshots, draft);

  for (const fill of plan.fills) {
    const range = dateRanges.nth(fill.index);
    const inputs = range.locator('input');

    await inputs.nth(0).click();
    let dropdown = page.locator('.ant-picker-dropdown').last();
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    await dropdown.locator(`td[title="${fill.startsAt}"]`).first().click();
    await dropdown.locator('.ant-picker-ok button').click();

    await inputs.nth(1).click();
    dropdown = page.locator('.ant-picker-dropdown').last();
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    await dropdown.locator(`td[title="${fill.endsAt}"]`).first().click();
    await dropdown.locator('.ant-picker-ok button').click();

    await page.waitForFunction(
      ({ index, startsAt, endsAt }) => {
        const range = document.querySelectorAll('.ant-table-tbody tr[data-row-key] .ant-picker-range')[index];
        if (!(range instanceof HTMLElement)) return false;
        const inputs = Array.from(range.querySelectorAll('input'));
        const startInput = inputs[0];
        const endInput = inputs[1];
        const startValue = startInput instanceof HTMLInputElement ? startInput.value.trim() : '';
        const endValue = endInput instanceof HTMLInputElement ? endInput.value.trim() : '';
        return startValue.startsWith(startsAt) && endValue.startsWith(endsAt);
      },
      fill,
      { timeout: 5000 },
    );
  }

  return { ...plan, filledCount: plan.fills.length };
}
