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
    const analysis = analyzeDifferentialPricingScout({ controls, bodyText: '差异化定价 活动名称 选择商品 优惠金额 活动时间', detectedWorkarounds: ['modal-scroll'] });

    expect(analysis.requiredSignals.every((signal) => signal.present)).toBe(true);
    expect(analysis.mutatingControlCount).toBe(1);
    expect(analysis.detectedWorkarounds).toEqual(['modal-scroll']);
    expect(analysis.safeAutomationStage).toBe('scout_only');
    expect(analysis.nextSteps).toContain('基于控件清单录制字段定位，不要自动点击提交类控件。');
  });

  it('returns deterministic missing signals for empty scout input', () => {
    const analysis = analyzeDifferentialPricingScout({ controls: [], bodyText: '', detectedWorkarounds: [] });

    expect(analysis.requiredSignals.map((signal) => ({ key: signal.key, present: signal.present }))).toEqual([
      { key: 'activity_name', present: false },
      { key: 'product_selection', present: false },
      { key: 'pricing_rule', present: false },
      { key: 'time_range', present: false },
    ]);
    expect(analysis.mutatingControlCount).toBe(0);
    expect(analysis.nextSteps[0]).toContain('缺少页面信号');
  });

  it('records selected merchant product ids from the configured activity table', () => {
    const analysis = analyzeDifferentialPricingScout({
      controls,
      bodyText: [
        '已选3个商品',
        '预览',
        '索尼Sony ZV1 4K视频v....',
        'ID:平台202603...1337商家81665859-505-03311656',
        '8.68~90.00元/日',
        '移除',
        '预览',
        '佳能CCD IXUS130 卡片....',
        'ID:平台202604...3387商家81665859-584-04141147',
        '4.89~66.90元/日',
        '移除',
      ].join('\n'),
      detectedWorkarounds: [],
    });

    expect(analysis.selectedProductCount).toBe(3);
    expect(analysis.selectedProducts).toEqual([
      { name: '索尼Sony ZV1 4K视频v....', platformIdFragment: '平台202603...1337', merchantProductId: '商家81665859-505-03311656' },
      { name: '佳能CCD IXUS130 卡片....', platformIdFragment: '平台202604...3387', merchantProductId: '商家81665859-584-04141147' },
    ]);
  });
});
