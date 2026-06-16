import type { Page } from 'playwright';

export const MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS = 20;

export interface ProductPickerCheckboxSnapshot {
  checked: boolean;
  disabled: boolean;
  wrapperClassName?: string;
  inModal: boolean;
}

export interface ProductPickerPageSelectionPlan {
  selectIndexes: number[];
  selectedOnPage: number;
  remainingAfterPage: number;
  shouldContinuePaging: boolean;
}

export interface DifferentialPricingProductPickResult {
  selectedCount: number;
  pagesVisited: number;
  confirmed: boolean;
}

export function isAddProductModalText(text: string): boolean {
  return /全部商品/.test(text) && /已选商品\(\d+\)/.test(text) && /取\s*消/.test(text) && /确\s*定/.test(text);
}

export function planProductPickerPageSelection(inputs: ProductPickerCheckboxSnapshot[], alreadySelected: number): ProductPickerPageSelectionPlan {
  const remaining = Math.max(0, MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS - alreadySelected);
  const selectIndexes = inputs
    .map((input, index) => ({ input, index }))
    .filter(({ input }) => input.inModal && !input.checked && !input.disabled && !/ant-checkbox-wrapper-disabled/.test(input.wrapperClassName ?? ''))
    .slice(0, remaining)
    .map(({ index }) => index);
  const remainingAfterPage = Math.max(0, remaining - selectIndexes.length);

  return {
    selectIndexes,
    selectedOnPage: selectIndexes.length,
    remainingAfterPage,
    shouldContinuePaging: remainingAfterPage > 0,
  };
}

async function currentModalText(page: Page): Promise<string> {
  return page.locator('.ant-modal').last().innerText({ timeout: 3000 }).catch(() => '');
}

async function ensureAddProductModal(page: Page): Promise<void> {
  // If a stale modal is already open, close it first to ensure a fresh load
  if (isAddProductModalText(await currentModalText(page))) {
    await page.locator('.ant-modal-footer button').filter({ hasText: /取\s*消/ }).last().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.getByRole('button', { name: '添加商品' }).first().click();
  await page.waitForFunction(() => {
    const text = Array.from(document.querySelectorAll('.ant-modal')).map((node) => node.textContent ?? '').join('\n');
    return /全部商品/.test(text) && /已选商品\(\d+\)/.test(text) && /确\s*定/.test(text);
  }, undefined, { timeout: 30000 });
  // Wait for checkbox table to actually render inside the modal
  await page.waitForFunction(() => {
    const containers = Array.from(document.querySelectorAll('*'))
      .filter((el) => {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        return text.includes('全部商品') && /已选商品\(\d+\)/.test(text) && el.querySelectorAll('input.ant-checkbox-input').length > 0;
      });
    return containers.length > 0;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function checkboxSnapshots(page: Page): Promise<ProductPickerCheckboxSnapshot[]> {
  return page.evaluate(() => {
    // Find the modal container by its text signature, regardless of portal rendering
    const containers = Array.from(document.querySelectorAll('*'))
      .filter((el) => {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        return text.includes('全部商品') && /已选商品\(\d+\)/.test(text) && el.querySelectorAll('input.ant-checkbox-input').length > 0;
      });
    // Pick the smallest container (most specific)
    const container = containers.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
    if (!container) return [];

    const inputs = container.querySelectorAll('input.ant-checkbox-input');
    return Array.from(inputs).map((input) => {
      const label = input.closest('label');
      return {
        checked: input instanceof HTMLInputElement ? input.checked : false,
        disabled: input instanceof HTMLInputElement ? input.disabled : true,
        wrapperClassName: label?.className ?? '',
        inModal: true,
      };
    });
  });
}

async function goNextModalPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-body, .ant-modal-wrap, [class*="ant-modal"]'))
      .find((el) => {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        return text.includes('全部商品') && /已选商品\(\d+\)/.test(text);
      });
    if (!modal) return false;
    const nextButton = modal.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)');
    if (!nextButton) return false;
    (nextButton as HTMLElement).click();
    return true;
  });
}

export async function pickDifferentialPricingProducts(page: Page): Promise<DifferentialPricingProductPickResult> {
  await ensureAddProductModal(page);

  let selectedCount = 0;
  let pagesVisited = 0;
  while (selectedCount < MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS) {
    pagesVisited += 1;
    const plan = planProductPickerPageSelection(await checkboxSnapshots(page), selectedCount);
    for (const index of plan.selectIndexes) {
      await page.evaluate((idx) => {
        const containers = Array.from(document.querySelectorAll('*'))
          .filter((el) => {
            const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
            return text.includes('全部商品') && /已选商品\(\d+\)/.test(text) && el.querySelectorAll('input.ant-checkbox-input').length > 0;
          });
        const container = containers.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
        if (!container) return;
        const inputs = container.querySelectorAll('input.ant-checkbox-input');
        const input = inputs[idx];
        if (input instanceof HTMLInputElement && !input.disabled) {
          input.click();
        }
      }, index);
      selectedCount += 1;
      await page.waitForTimeout(200);
    }
    if (!plan.shouldContinuePaging || !(await goNextModalPage(page))) break;
  }

  if (selectedCount > 0) {
    await page.locator('.ant-modal-footer button').filter({ hasText: /确\s*定/ }).last().click();
    await page.waitForTimeout(3000);
  }

  return { selectedCount, pagesVisited, confirmed: selectedCount > 0 };
}
