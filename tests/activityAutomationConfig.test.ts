import { describe, expect, it } from 'vitest';
import { ALIPAY_ACTIVITY_APP_ID, ALIPAY_ACTIVITY_FORM_URL, ALIPAY_ACTIVITY_PRODUCT_CODE, activityAutomationConfigFromAgentConfig, activityAutomationOutputDir } from '../src/activityAutomation/config.js';
import { createEmptyDifferentialPricingDraft } from '../src/activityAutomation/differentialPricing.js';
import { createEmptyActivityRecordingDraft } from '../src/activityAutomation/recording.js';
import type { AgentConfig } from '../src/domain/types.js';

const agentConfig: AgentConfig = {
  targetUrl: 'https://b.alipay.com/page/assistant-data-analysis/index/product/list',
  periods: ['1d'],
  preferredPageSize: 50,
  outputDir: 'output',
  browserProfileDir: '.browser-profile',
};

describe('activity automation config', () => {
  it('targets the Alipay differential pricing activity form', () => {
    expect(ALIPAY_ACTIVITY_APP_ID).toBe('2021005181665859');
    expect(ALIPAY_ACTIVITY_PRODUCT_CODE).toBe('PROMO_ZHIMA_REDUCTION');
    expect(ALIPAY_ACTIVITY_FORM_URL).toBe('https://b.alipay.com/page/commodity-operation/activity/activityForm?appId=2021005181665859&productCode=PROMO_ZHIMA_REDUCTION');
  });

  it('reuses agent browser profile and output directories', () => {
    const config = activityAutomationConfigFromAgentConfig(agentConfig);
    expect(config).toMatchObject({
      targetUrl: ALIPAY_ACTIVITY_FORM_URL,
      outputDir: 'output',
      browserProfileDir: '.browser-profile',
      headless: false,
      keepBrowserOnFailure: true,
      pickProducts: false,
      fillDiscounts: true,
      draft: { productIds: [] },
    });
    expect(activityAutomationOutputDir(config)).toContain('activity-automation');
  });

  it('can enable automatic product picking from CLI options', () => {
    const config = activityAutomationConfigFromAgentConfig(agentConfig, { pickProducts: true });
    expect(config.pickProducts).toBe(true);
  });

  it('can pass date draft values from CLI options', () => {
    const config = activityAutomationConfigFromAgentConfig(agentConfig, {
      draft: { productIds: [], startsAt: '2026-06-23', endsAt: '2026-06-30' },
    });

    expect(config.draft).toEqual({ productIds: [], startsAt: '2026-06-23', endsAt: '2026-06-30' });
  });
});

describe('differential pricing draft', () => {
  it('starts as an explicit non-submitting pricing draft', () => {
    expect(createEmptyDifferentialPricingDraft()).toEqual({ productIds: [] });
    expect(createEmptyActivityRecordingDraft(ALIPAY_ACTIVITY_FORM_URL)).toMatchObject({
      businessPurpose: 'differential-pricing',
      url: ALIPAY_ACTIVITY_FORM_URL,
      steps: [],
    });
  });
});
