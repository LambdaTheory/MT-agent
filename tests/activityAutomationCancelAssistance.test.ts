import { describe, expect, it } from 'vitest';
import { deriveActivityListUrl } from '../src/activityAutomation/cancelAssistance.js';
import { ALIPAY_ACTIVITY_LIST_URL } from '../src/activityAutomation/config.js';

describe('activity cancellation assistance', () => {
  it('targets the real Alipay activity list page', () => {
    expect(ALIPAY_ACTIVITY_LIST_URL).toBe('https://b.alipay.com/page/commodity-operation/activity/activityList?productCode=PROMO_ZHIMA_REDUCTION');
  });

  it('derives the real activity list page from the submitted form url', () => {
    expect(deriveActivityListUrl('https://b.alipay.com/page/commodity-operation/activity/activityForm?appId=2021005181665859&productCode=PROMO_ZHIMA_REDUCTION'))
      .toBe('https://b.alipay.com/page/commodity-operation/activity/activityList?productCode=PROMO_ZHIMA_REDUCTION');
  });
});
