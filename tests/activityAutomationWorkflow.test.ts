import { describe, expect, it } from 'vitest';
import type { ActivityScoutResult } from '../src/activityAutomation/scout.js';
import { runActivityFormAutomation } from '../src/activityAutomation/workflow.js';
import type { ActivityAutomationConfig } from '../src/activityAutomation/config.js';
import type { DifferentialPricingDateFillResult } from '../src/activityAutomation/dateFilling.js';
import type { DifferentialPricingDiscountFillResult } from '../src/activityAutomation/discountFilling.js';
import type { DifferentialPricingProductPickResult } from '../src/activityAutomation/productPicker.js';

const config: ActivityAutomationConfig = {
  targetUrl: 'https://example.com/activity',
  outputDir: 'output',
  browserProfileDir: '.browser-profile',
  productIdMappingPath: 'config/product-id-map.json',
  headless: false,
  keepBrowserOnFailure: true,
  pickProducts: false,
  fillDiscounts: true,
  draft: { productIds: [] },
};

const scoutResult: ActivityScoutResult = {
  url: 'https://example.com/activity',
  outputDir: 'output/latest/activity-automation',
  screenshotPath: 'output/latest/activity-automation/activity-form-scout.png',
  controlsPath: 'output/latest/activity-automation/activity-form-controls.json',
  bodyTextPath: 'output/latest/activity-automation/activity-form-body.txt',
  recordingDraftPath: 'output/latest/activity-automation/activity-form-recording-draft.json',
  workaroundReportPath: 'output/latest/activity-automation/activity-form-workarounds.json',
  analysisPath: 'output/latest/activity-automation/activity-form-analysis.json',
  controls: [],
  detectedWorkarounds: [],
  analysis: {
    safeAutomationStage: 'scout_only',
    requiredSignals: [],
    selectedProductCount: 0,
    selectedProducts: [],
    mutatingControlCount: 0,
    mutatingControls: [],
    detectedWorkarounds: [],
    nextSteps: [],
  },
};

const pickResult: DifferentialPricingProductPickResult = {
  selectedCount: 12,
  pagesVisited: 2,
  confirmed: true,
  pickedProducts: [
    { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: '商品1', pickedOnPage: 1 },
  ],
};

const dateFillResult: DifferentialPricingDateFillResult = {
  configured: true,
  rangeCount: 1,
  emptyRangeCount: 1,
  fills: [{ index: 0, startsAt: '2026-06-23', endsAt: '2026-06-30' }],
  filledCount: 1,
};

const discountFillResult: DifferentialPricingDiscountFillResult = {
  inputCount: 4,
  emptyInputCount: 4,
  exceedsBatchLimit: false,
  fills: [
    { index: 0, level: 'SS', value: '8.5' },
    { index: 1, level: 'S', value: '9.0' },
    { index: 2, level: 'A', value: '9.5' },
    { index: 3, level: 'B', value: '9.8' },
  ],
  unrecognizedMaxValues: [],
  filledCount: 4,
};

describe('runActivityFormAutomation', () => {
  it('waits for the form and scouts without picking when product auto-pick is disabled', async () => {
    const steps: string[] = [];
    const result = await runActivityFormAutomation({} as never, config, {
      waitForActivityFormShell: async () => {
        steps.push('wait');
      },
      pickDifferentialPricingProducts: async () => {
        steps.push('pick');
        return pickResult;
      },
      fillDifferentialPricingDateRanges: async () => {
        steps.push('fill-dates');
        return dateFillResult;
      },
      fillMissingDifferentialPricingDiscounts: async () => {
        steps.push('fill-discounts');
        return discountFillResult;
      },
      scoutActivityFormPage: async () => {
        steps.push('scout');
        return scoutResult;
      },
    });

    expect(steps).toEqual(['wait', 'scout']);
    expect(result.productPickResult).toBeUndefined();
    expect(result.dateFillResult).toBeUndefined();
    expect(result.discountFillResult).toBeUndefined();
  });

  it('waits, picks products, fills dates and discounts, and returns the fill results when automation is enabled', async () => {
    const steps: string[] = [];
    const result = await runActivityFormAutomation({} as never, {
      ...config,
      pickProducts: true,
      draft: { productIds: [], startsAt: '2026-06-23', endsAt: '2026-06-30' },
    }, {
      waitForActivityFormShell: async () => {
        steps.push('wait');
      },
      pickDifferentialPricingProducts: async () => {
        steps.push('pick');
        return pickResult;
      },
      fillDifferentialPricingDateRanges: async () => {
        steps.push('fill-dates');
        return dateFillResult;
      },
      fillMissingDifferentialPricingDiscounts: async () => {
        steps.push('fill-discounts');
        return discountFillResult;
      },
      scoutActivityFormPage: async () => {
        steps.push('scout');
        return scoutResult;
      },
    });

    expect(steps).toEqual(['wait', 'pick', 'wait', 'fill-dates', 'fill-discounts', 'scout']);
    expect(result.productPickResult).toEqual(pickResult);
    expect(result.dateFillResult).toEqual(dateFillResult);
    expect(result.discountFillResult).toEqual(discountFillResult);
  });
});
