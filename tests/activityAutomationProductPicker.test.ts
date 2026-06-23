import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS,
  isAddProductModalText,
  pickDifferentialPricingProducts,
  planProductPickerPageSelection,
  type ProductPickerCheckboxSnapshot,
} from '../src/activityAutomation/productPicker.js';

function createPickerPage(products: ProductPickerCheckboxSnapshot[]): ProductPickerCheckboxSnapshot[] {
  return products.map((product) => ({ ...product }));
}

function fakeProductPickerPage(pageSnapshots: ProductPickerCheckboxSnapshot[][]): Page & { __confirmClicks(): number } {
  let currentPageIndex = 0;
  let pendingPageIndex: number | null = null;
  let confirmClicks = 0;

  const page = {
    locator(selector: string) {
      if (selector === '.ant-modal') {
        return {
          last() {
            return {
              async innerText() {
                return '添加商品\n全部商品\n已选商品(0)\n取消\n确定';
              },
            };
          },
        };
      }

      if (selector === '.ant-modal-footer button') {
        return {
          filter(options?: { hasText?: RegExp }) {
            return {
              last() {
                return {
                  async click() {
                    if (options?.hasText?.test('确定')) confirmClicks += 1;
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected locator selector: ${selector}`);
    },
    getByRole() {
      return {
        first() {
          return {
            async click() {
              return undefined;
            },
          };
        },
      };
    },
    async waitForFunction() {
      if (pendingPageIndex !== null) {
        currentPageIndex = pendingPageIndex;
        pendingPageIndex = null;
      }
    },
    async waitForTimeout(ms: number) {
      if (pendingPageIndex !== null && ms >= 300) {
        currentPageIndex = pendingPageIndex;
        pendingPageIndex = null;
      }
    },
    async evaluate(_callback: unknown, args: Record<string, string>) {
      if ('merchantProductIdPattern' in args) {
        return pageSnapshots[currentPageIndex].map((snapshot) => ({ ...snapshot }));
      }

      if ('targetProductId' in args) {
        const snapshot = pageSnapshots[currentPageIndex].find((item) => item.platformProductId === args.targetProductId);
        if (snapshot) snapshot.checked = true;
        return undefined;
      }

      if (currentPageIndex >= pageSnapshots.length - 1) return false;
      pendingPageIndex = currentPageIndex + 1;
      return true;
    },
    __confirmClicks() {
      return confirmClicks;
    },
  };

  return page as unknown as Page & { __confirmClicks(): number };
}

describe('differential pricing product picker', () => {
  it('recognizes an already-open add-product modal from its stable text', () => {
    expect(isAddProductModalText('\u6dfb\u52a0\u5546\u54c1\n\u5168\u90e8\u5546\u54c1\n\u5df2\u9009\u5546\u54c1(0)\n\u53d6\u6d88\n\u786e\u5b9a')).toBe(true);
    expect(isAddProductModalText('\u914d\u7f6e\u5dee\u5f02\u5316\u5b9a\u4ef7\n\u521b\u5efa\u6d3b\u52a8\n\u6dfb\u52a0\u5546\u54c1')).toBe(false);
  });

  it('ignores the modal select-all checkbox and plans only enabled unchecked product rows', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: '', merchantProductId: '', productName: '', checked: false, disabled: false, inModal: true, selectableRow: false },
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '鍟嗗搧1', checked: false, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: '鍟嗗搧2', checked: true, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-3', merchantProductId: '81665859-789-061116596', productName: '鍟嗗搧3', checked: false, disabled: true, inModal: true, selectableRow: true },
      { platformProductId: 'platform-4', merchantProductId: '81665859-790-061116597', productName: '鍟嗗搧4', checked: false, disabled: false, wrapperClassName: 'ant-checkbox-wrapper ant-checkbox-wrapper-disabled', inModal: true, selectableRow: true },
      { platformProductId: 'platform-5', merchantProductId: '81665859-791-061116598', productName: '鍟嗗搧5', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 8);

    expect(plan.selectProductIds).toEqual(['platform-1', 'platform-5']);
    expect(plan.selectedOnPage).toBe(2);
    expect(plan.remainingAfterPage).toBe(0);
    expect(plan.shouldContinuePaging).toBe(false);
  });

  it('continues paging when the current page has fewer selectable products than the batch limit', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: '', merchantProductId: '', productName: '', checked: false, disabled: false, inModal: true, selectableRow: false },
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '鍟嗗搧1', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 0);

    expect(MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS).toBe(10);
    expect(plan.selectProductIds).toEqual(['platform-1']);
    expect(plan.remainingAfterPage).toBe(9);
    expect(plan.shouldContinuePaging).toBe(true);
  });

  it('skips products that were already picked earlier in the same browser session', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '鍟嗗搧1', checked: false, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: '鍟嗗搧2', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 1, new Set(['platform-1']));

    expect(plan.selectProductIds).toEqual(['platform-2']);
    expect(plan.selectedOnPage).toBe(1);
    expect(plan.remainingAfterPage).toBe(8);
  });

  it('continues selecting products after moving to the next modal page without exceeding the 20-item cap', async () => {
    const page = fakeProductPickerPage([
      createPickerPage([
        { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '鍟嗗搧1', checked: false, disabled: false, inModal: true, selectableRow: true },
      ]),
      createPickerPage([
        { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: '鍟嗗搧2', checked: false, disabled: false, inModal: true, selectableRow: true },
      ]),
    ]);

    const result = await pickDifferentialPricingProducts(page);

    expect(result.selectedCount).toBe(2);
    expect(result.selectedCount).toBeLessThanOrEqual(MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS);
    expect(result.pagesVisited).toBe(2);
    expect(result.confirmed).toBe(true);
    expect(result.pickedProducts.map((product) => product.platformProductId)).toEqual(['platform-1', 'platform-2']);
    expect(page.__confirmClicks()).toBe(1);
  });
});
