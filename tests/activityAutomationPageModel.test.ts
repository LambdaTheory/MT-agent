import { describe, expect, it } from 'vitest';
import { hasDifferentialPricingFormReadySignals, isKnownMutatingControlText } from '../src/activityAutomation/pageModel.js';

describe('activity automation page model', () => {
  it('does not treat a generic search shell as a ready differential pricing form', () => {
    expect(hasDifferentialPricingFormReadySignals('搜索')).toBe(false);
    expect(hasDifferentialPricingFormReadySignals('搜索 重置 查询')).toBe(false);
  });

  it('treats the loaded differential pricing activity form as ready once core business signals appear', () => {
    expect(hasDifferentialPricingFormReadySignals('差异化定价 活动名称 选择商品 优惠金额 活动时间')).toBe(true);
    expect(hasDifferentialPricingFormReadySignals('创建活动 添加商品 已选商品(10) 优惠金额 活动时间')).toBe(true);
  });

  it('treats spaced mutating labels as mutating controls', () => {
    expect(isKnownMutatingControlText('提 交')).toBe(true);
    expect(isKnownMutatingControlText('确 定')).toBe(true);
  });
});
