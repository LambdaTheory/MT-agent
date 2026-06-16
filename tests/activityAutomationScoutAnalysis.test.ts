import { describe, expect, it } from 'vitest';
import { analyzeDifferentialPricingScout } from '../src/activityAutomation/scoutAnalysis.js';
import type { ActivityControlSummary } from '../src/activityAutomation/pageModel.js';

const controls: ActivityControlSummary[] = [
  { text: '活动名称', tagName: 'input', mutating: false },
  { text: '选择商品', tagName: 'button', mutating: false },
  { text: '优惠金额', tagName: 'input', mutating: false },
  { text: '活动时间', tagName: 'input', mutating: false },
  { text: '提交', tagName: 'button', mutating: true },
];

describe('analyzeDifferentialPricingScout', () => {
  it('marks required form signals present and counts mutating controls', () => {
    const analysis = analyzeDifferentialPricingScout({ controls, bodyText: '差异化定价 活动名称 选择商品 优惠金额 活动时间', detectedWorkarounds: ['modal-scroll'], selectedProductRows: [] });

    expect(analysis.requiredSignals.every((signal) => signal.present)).toBe(true);
    expect(analysis.mutatingControlCount).toBe(1);
    expect(analysis.detectedWorkarounds).toEqual(['modal-scroll']);
    expect(analysis.safeAutomationStage).toBe('scout_only');
    expect(analysis.nextSteps).toContain('基于控件清单录制字段定位，不要自动点击提交类控件。');
  });

  it('returns deterministic missing signals for empty scout input', () => {
    const analysis = analyzeDifferentialPricingScout({ controls: [], bodyText: '', detectedWorkarounds: [], selectedProductRows: [] });

    expect(analysis.requiredSignals.map((signal) => ({ key: signal.key, present: signal.present }))).toEqual([
      { key: 'activity_name', present: false },
      { key: 'product_selection', present: false },
      { key: 'pricing_rule', present: false },
      { key: 'time_range', present: false },
    ]);
    expect(analysis.mutatingControlCount).toBe(0);
    expect(analysis.nextSteps[0]).toContain('缺少页面信号');
  });

  it('records selected product ids from DOM data-row-key extraction', () => {
    const analysis = analyzeDifferentialPricingScout({
      controls,
      bodyText: '已选2个商品',
      detectedWorkarounds: [],
      selectedProductRows: [
        { rowKey: '2026061522000833579766', name: '影石insta360 Ace P....', merchantProductId: '商家81665859-870-06151612' },
        { rowKey: '2026061522000333557499', name: '大疆Osmo pocket4 一....', merchantProductId: '商家81665859-853-06151449' },
      ],
    });

    expect(analysis.selectedProductCount).toBe(2);
    expect(analysis.selectedProducts).toEqual([
      { rowKey: '2026061522000833579766', name: '影石insta360 Ace P....', merchantProductId: '商家81665859-870-06151612' },
      { rowKey: '2026061522000333557499', name: '大疆Osmo pocket4 一....', merchantProductId: '商家81665859-853-06151449' },
    ]);
  });
});
