import { describe, expect, it } from 'vitest';
import type { ActivityAutomationConfig } from '../src/activityAutomation/config.js';
import { isKnownMutatingControlText } from '../src/activityAutomation/pageModel.js';
import { runActivityFormAutomation } from '../src/activityAutomation/workflow.js';

const config: ActivityAutomationConfig = {
  targetUrl: 'https://example.com/activity',
  outputDir: 'output',
  browserProfileDir: '.browser-profile',
  headless: false,
  keepBrowserOnFailure: true,
  confirmSubmit: false,
  pickProducts: false,
  fillDiscounts: true,
  draft: { productIds: [] },
};

describe('activity automation safety', () => {
  it('marks known submit-like controls as mutating', () => {
    expect(isKnownMutatingControlText('\u63d0\u4ea4')).toBe(true);
    expect(isKnownMutatingControlText('\u4fdd\u5b58\u5e76\u63d0\u4ea4')).toBe(true);
    expect(isKnownMutatingControlText('\u9009\u62e9\u5546\u54c1')).toBe(false);
  });

  it('keeps submission disabled by default even if a submit hook is available', async () => {
    let submitted = false;

    await runActivityFormAutomation({} as never, config, {
      waitForActivityFormShell: async () => undefined,
      scoutActivityFormPage: async () => ({
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
      }),
      submitDifferentialPricingActivity: async () => {
        submitted = true;
        throw new Error('submit should not run');
      },
    });

    expect(submitted).toBe(false);
  });
});
