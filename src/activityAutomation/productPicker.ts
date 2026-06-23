import type { Page } from 'playwright';
import { mergePickedProducts, type PickedProduct } from './productPickSession.js';

function pattern(source: string): RegExp {
  return new RegExp(source, 'u');
}

const ALL_PRODUCTS_PATTERN = pattern('\\u5168\\u90e8\\u5546\\u54c1');
const SELECTED_COUNT_PATTERN = pattern('\\u5df2\\u9009\\u5546\\u54c1\\((\\d+)\\)');
const CANCEL_BUTTON_PATTERN = pattern('\\u53d6\\s*\\u6d88');
const CONFIRM_BUTTON_PATTERN = pattern('\\u786e\\s*\\u5b9a');
const MERCHANT_PRODUCT_ID_PATTERN = pattern('(?:\\u5546\\u5bb6)?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)');

export const MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS = 10;

export interface ProductPickerCheckboxSnapshot {
  platformProductId: string;
  merchantProductId: string;
  productName: string;
  checked: boolean;
  disabled: boolean;
  wrapperClassName?: string;
  inModal: boolean;
  selectableRow: boolean;
}

export interface ProductPickerPageSelectionPlan {
  selectProductIds: string[];
  selectedProducts: PickedProduct[];
  selectedOnPage: number;
  remainingAfterPage: number;
  shouldContinuePaging: boolean;
}

export interface DifferentialPricingProductPickResult {
  selectedCount: number;
  pagesVisited: number;
  confirmed: boolean;
  pickedProducts: PickedProduct[];
}

const productPickSessions = new WeakMap<Page, PickedProduct[]>();

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isProductModalText(text: string): boolean {
  const compact = normalizeText(text);
  return ALL_PRODUCTS_PATTERN.test(compact) && SELECTED_COUNT_PATTERN.test(compact);
}

function rememberPickedProducts(page: Page, products: PickedProduct[]): PickedProduct[] {
  const merged = mergePickedProducts(productPickSessions.get(page) ?? [], products);
  productPickSessions.set(page, merged);
  return merged;
}

function readPickedProducts(page: Page): PickedProduct[] {
  return [...(productPickSessions.get(page) ?? [])];
}

export function isAddProductModalText(text: string): boolean {
  return isProductModalText(text) && CANCEL_BUTTON_PATTERN.test(text) && CONFIRM_BUTTON_PATTERN.test(text);
}

export function planProductPickerPageSelection(
  inputs: ProductPickerCheckboxSnapshot[],
  alreadySelected: number,
  alreadyPickedProductIds: ReadonlySet<string> = new Set(),
): ProductPickerPageSelectionPlan {
  const remaining = Math.max(0, MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS - alreadySelected);
  const selectedProducts = inputs
    .filter(
      (input) =>
        input.inModal &&
        input.selectableRow &&
        Boolean(input.platformProductId) &&
        !alreadyPickedProductIds.has(input.platformProductId) &&
        !input.checked &&
        !input.disabled &&
        !/ant-checkbox-wrapper-disabled/.test(input.wrapperClassName ?? ''),
    )
    .slice(0, remaining)
    .map((input) => ({
      platformProductId: input.platformProductId,
      merchantProductId: input.merchantProductId,
      productName: input.productName,
      pickedOnPage: 0,
    }));
  const remainingAfterPage = Math.max(0, remaining - selectedProducts.length);

  return {
    selectProductIds: selectedProducts.map((product) => product.platformProductId),
    selectedProducts,
    selectedOnPage: selectedProducts.length,
    remainingAfterPage,
    shouldContinuePaging: remainingAfterPage > 0,
  };
}

async function currentModalText(page: Page): Promise<string> {
  return page.locator('.ant-modal').last().innerText({ timeout: 3000 }).catch(() => '');
}

async function ensureAddProductModal(page: Page): Promise<void> {
  if (isAddProductModalText(await currentModalText(page))) {
    await page.locator('.ant-modal-footer button').filter({ hasText: CANCEL_BUTTON_PATTERN }).last().click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  await page.getByRole('button', { name: '\u6dfb\u52a0\u5546\u54c1' }).first().click();
  await page.waitForFunction(
    ({ allProductsPattern, selectedCountPattern, confirmButtonPattern }) => {
      const text = Array.from(document.querySelectorAll('.ant-modal')).map((node) => node.textContent ?? '').join('\n');
      return (
        new RegExp(allProductsPattern, 'u').test(text) &&
        new RegExp(selectedCountPattern, 'u').test(text) &&
        new RegExp(confirmButtonPattern, 'u').test(text)
      );
    },
    {
      allProductsPattern: ALL_PRODUCTS_PATTERN.source,
      selectedCountPattern: SELECTED_COUNT_PATTERN.source,
      confirmButtonPattern: CONFIRM_BUTTON_PATTERN.source,
    },
    { timeout: 30000 },
  );
  await page.waitForFunction(
    ({ allProductsPattern, selectedCountPattern }) => {
      const containers = Array.from(document.querySelectorAll('*')).filter((element) => {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return (
          new RegExp(allProductsPattern, 'u').test(text) &&
          new RegExp(selectedCountPattern, 'u').test(text) &&
          element.querySelectorAll('tr[data-row-key] input.ant-checkbox-input').length > 0
        );
      });
      return containers.length > 0;
    },
    {
      allProductsPattern: ALL_PRODUCTS_PATTERN.source,
      selectedCountPattern: SELECTED_COUNT_PATTERN.source,
    },
    { timeout: 30000 },
  );
  await page.waitForTimeout(2000);
}

async function checkboxSnapshots(page: Page): Promise<ProductPickerCheckboxSnapshot[]> {
  return page.evaluate(
    ({ allProductsPattern, selectedCountPattern, merchantProductIdPattern }) => {
      const merchantProductIdMatcher = new RegExp(merchantProductIdPattern, 'u');
      const containers = Array.from(document.querySelectorAll('*')).filter((element) => {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return (
          new RegExp(allProductsPattern, 'u').test(text) &&
          new RegExp(selectedCountPattern, 'u').test(text) &&
          element.querySelectorAll('tr[data-row-key] input.ant-checkbox-input').length > 0
        );
      });
      const container = containers.sort((left, right) => left.querySelectorAll('*').length - right.querySelectorAll('*').length)[0];
      if (!container) return [];

      const rows = container.querySelectorAll('tr[data-row-key]');
      const snapshots = [];
      for (const row of Array.from(rows)) {
        const platformProductId = row.getAttribute('data-row-key')?.trim() ?? '';
        const input = row.querySelector('input.ant-checkbox-input');
        if (!(input instanceof HTMLInputElement) || !platformProductId) continue;

        const label = input.closest('label');
        const cells = Array.from(row.querySelectorAll('td'))
          .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        const rowText = (row.textContent ?? '').replace(/\s+/g, ' ').trim();
        const merchantProductId = merchantProductIdMatcher.exec(rowText)?.[1] ?? '';
        const productName = cells.find((cell) => cell !== merchantProductId && cell !== `\u5546\u5bb6${merchantProductId}`) ?? rowText;
        snapshots.push({
          platformProductId,
          merchantProductId,
          productName: productName.replace(/\s+/g, ' ').trim(),
          checked: input.checked,
          disabled: input.disabled,
          wrapperClassName: label?.className ?? '',
          inModal: true,
          selectableRow: true,
        });
      }

      return snapshots;
    },
    {
      allProductsPattern: ALL_PRODUCTS_PATTERN.source,
      selectedCountPattern: SELECTED_COUNT_PATTERN.source,
      merchantProductIdPattern: MERCHANT_PRODUCT_ID_PATTERN.source,
    },
  );
}

async function clickProductRowCheckbox(page: Page, platformProductId: string): Promise<void> {
  await page.evaluate(
    ({ allProductsPattern, selectedCountPattern, targetProductId }) => {
      const containers = Array.from(document.querySelectorAll('*')).filter((element) => {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return (
          new RegExp(allProductsPattern, 'u').test(text) &&
          new RegExp(selectedCountPattern, 'u').test(text) &&
          element.querySelectorAll('tr[data-row-key] input.ant-checkbox-input').length > 0
        );
      });
      const container = containers.sort((left, right) => left.querySelectorAll('*').length - right.querySelectorAll('*').length)[0];
      if (!container) return;

      const row = Array.from(container.querySelectorAll('tr[data-row-key]')).find((candidate) => candidate.getAttribute('data-row-key') === targetProductId);
      const input = row?.querySelector('input.ant-checkbox-input');
      if (input instanceof HTMLInputElement && !input.disabled && !input.checked) input.click();
    },
    {
      allProductsPattern: ALL_PRODUCTS_PATTERN.source,
      selectedCountPattern: SELECTED_COUNT_PATTERN.source,
      targetProductId: platformProductId,
    },
  );
}

async function goNextModalPage(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ allProductsPattern, selectedCountPattern }) => {
      const modal = Array.from(document.querySelectorAll('.ant-modal, .ant-modal-content, .ant-modal-body, .ant-modal-wrap, [class*="ant-modal"]')).find((element) => {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return new RegExp(allProductsPattern, 'u').test(text) && new RegExp(selectedCountPattern, 'u').test(text);
      });
      if (!modal) return false;

      const nextButton = modal.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)');
      if (!nextButton) return false;
      (nextButton as HTMLElement).click();
      return true;
    },
    {
      allProductsPattern: ALL_PRODUCTS_PATTERN.source,
      selectedCountPattern: SELECTED_COUNT_PATTERN.source,
    },
  );
}

function snapshotSignature(snapshots: ProductPickerCheckboxSnapshot[]): string {
  return snapshots.map((snapshot) => snapshot.platformProductId).filter(Boolean).join('|');
}

async function waitForNextModalPage(page: Page, previousSignature: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(300);
    const nextSignature = snapshotSignature(await checkboxSnapshots(page));
    if (nextSignature && nextSignature !== previousSignature) return true;
  }
  return false;
}

export async function pickDifferentialPricingProducts(page: Page): Promise<DifferentialPricingProductPickResult> {
  await ensureAddProductModal(page);

  let selectedCount = readPickedProducts(page).length;
  let pagesVisited = 0;
  const seenPageSignatures = new Set<string>();
  while (selectedCount < MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS) {
    pagesVisited += 1;
    const snapshots = await checkboxSnapshots(page);
    const pageSignature = snapshotSignature(snapshots);
    if (pageSignature && seenPageSignatures.has(pageSignature)) break;
    if (pageSignature) seenPageSignatures.add(pageSignature);

    const alreadyPickedProductIds = new Set(readPickedProducts(page).map((product) => product.platformProductId));
    const plan = planProductPickerPageSelection(snapshots, selectedCount, alreadyPickedProductIds);
    const pickedOnCurrentPage = plan.selectedProducts.map((product) => ({ ...product, pickedOnPage: pagesVisited }));

    for (const productId of plan.selectProductIds) {
      await clickProductRowCheckbox(page, productId);
      await page.waitForTimeout(200);
    }

    if (pickedOnCurrentPage.length > 0) {
      selectedCount = rememberPickedProducts(page, pickedOnCurrentPage).length;
    }
    if (!plan.shouldContinuePaging) break;
    if (!(await goNextModalPage(page))) break;
    if (!(await waitForNextModalPage(page, pageSignature))) break;
  }

  if (selectedCount > 0) {
    await page.locator('.ant-modal-footer button').filter({ hasText: CONFIRM_BUTTON_PATTERN }).last().click();
    await page.waitForTimeout(3000);
  }

  return {
    selectedCount,
    pagesVisited,
    confirmed: selectedCount > 0,
    pickedProducts: readPickedProducts(page),
  };
}
