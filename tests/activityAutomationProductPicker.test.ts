import { describe, expect, it } from 'vitest';
import { MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS, isAddProductModalText, planProductPickerPageSelection } from '../src/activityAutomation/productPicker.js';

describe('differential pricing product picker', () => {
  it('recognizes an already-open add-product modal from its stable text', () => {
    expect(isAddProductModalText('添加商品\n全部商品\n已选商品(0)\n取 消\n确 定')).toBe(true);
    expect(isAddProductModalText('配置差异化定价\n创建活动\n添加商品')).toBe(false);
  });

  it('ignores the modal select-all checkbox and plans only enabled unchecked product rows', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: '', merchantProductId: '', productName: '', checked: false, disabled: false, inModal: true, selectableRow: false },
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '商品1', checked: false, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: '商品2', checked: true, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-3', merchantProductId: '81665859-789-061116596', productName: '商品3', checked: false, disabled: true, inModal: true, selectableRow: true },
      { platformProductId: 'platform-4', merchantProductId: '81665859-790-061116597', productName: '商品4', checked: false, disabled: false, wrapperClassName: 'ant-checkbox-wrapper ant-checkbox-wrapper-disabled', inModal: true, selectableRow: true },
      { platformProductId: 'platform-5', merchantProductId: '81665859-791-061116598', productName: '商品5', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 18);

    expect(plan.selectProductIds).toEqual(['platform-1', 'platform-5']);
    expect(plan.selectedOnPage).toBe(2);
    expect(plan.remainingAfterPage).toBe(0);
    expect(plan.shouldContinuePaging).toBe(false);
  });

  it('continues paging when the current page has fewer selectable products than the batch limit', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: '', merchantProductId: '', productName: '', checked: false, disabled: false, inModal: true, selectableRow: false },
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '商品1', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 0);

    expect(MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS).toBe(20);
    expect(plan.selectProductIds).toEqual(['platform-1']);
    expect(plan.remainingAfterPage).toBe(19);
    expect(plan.shouldContinuePaging).toBe(true);
  });

  it('skips products that were already picked earlier in the same browser session', () => {
    const plan = planProductPickerPageSelection([
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '商品1', checked: false, disabled: false, inModal: true, selectableRow: true },
      { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: '商品2', checked: false, disabled: false, inModal: true, selectableRow: true },
    ], 1, new Set(['platform-1']));

    expect(plan.selectProductIds).toEqual(['platform-2']);
    expect(plan.selectedOnPage).toBe(1);
    expect(plan.remainingAfterPage).toBe(18);
  });
});
