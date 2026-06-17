import { describe, expect, it } from 'vitest';
import { MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS, isAddProductModalText, planProductPickerPageSelection } from '../src/activityAutomation/productPicker.js';

describe('differential pricing product picker', () => {
  it('recognizes an already-open add-product modal from its stable text', () => {
    expect(isAddProductModalText('添加商品\n全部商品\n已选商品(0)\n取 消\n确 定')).toBe(true);
    expect(isAddProductModalText('配置差异化定价\n创建活动\n添加商品')).toBe(false);
  });

  it('plans only enabled unchecked products up to the remaining batch allowance', () => {
    const plan = planProductPickerPageSelection([
      { checked: false, disabled: false, inModal: true },
      { checked: true, disabled: false, inModal: true },
      { checked: false, disabled: true, inModal: true },
      { checked: false, disabled: false, wrapperClassName: 'ant-checkbox-wrapper ant-checkbox-wrapper-disabled', inModal: true },
      { checked: false, disabled: false, inModal: true },
    ], 18);

    expect(plan.selectIndexes).toEqual([0, 4]);
    expect(plan.selectedOnPage).toBe(2);
    expect(plan.remainingAfterPage).toBe(0);
    expect(plan.shouldContinuePaging).toBe(false);
  });

  it('continues paging when the current page has fewer selectable products than the batch limit', () => {
    const plan = planProductPickerPageSelection([{ checked: false, disabled: false, inModal: true }], 0);

    expect(MAX_DIFFERENTIAL_PRICING_PICK_PRODUCTS).toBe(20);
    expect(plan.selectIndexes).toEqual([0]);
    expect(plan.remainingAfterPage).toBe(19);
    expect(plan.shouldContinuePaging).toBe(true);
  });
});
