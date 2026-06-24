import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityAutomationConfig } from '../src/activityAutomation/config.js';
import { writeActivitySubmitSession } from '../src/activityAutomation/submitSession.js';
import type { ActivityScoutResult } from '../src/activityAutomation/scout.js';

const config: ActivityAutomationConfig = {
  targetUrl: 'https://example.com/activity',
  outputDir: '',
  browserProfileDir: '.browser-profile',
  headless: false,
  keepBrowserOnFailure: true,
  confirmSubmit: true,
  pickProducts: true,
  fillDiscounts: true,
  draft: {
    productIds: [],
    startsAt: '2026-06-23',
    endsAt: '2026-06-30',
    discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
  },
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
    selectedProductCount: 1,
    selectedProducts: [],
    mutatingControlCount: 0,
    mutatingControls: [],
    detectedWorkarounds: [],
    nextSteps: [],
  },
  productPickSessionPath: 'output/latest/activity-automation/activity-product-pick-session.json',
  productPickSession: {
    products: [
      {
        platformProductId: '2026062322000235349104',
        merchantProductId: '81665859-886-06231159',
        productName: '测试商品',
        pickedOnPage: 1,
        internalProductId: '886',
        mappingSource: 'merchant_product_id',
      },
    ],
    mappedCount: 1,
    unmappedCount: 0,
  },
};

describe('writeActivitySubmitSession', () => {
  it('writes the callback handoff artifact with mapped internal product ids after submit', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-activity-submit-'));
    const submitSessionPath = await writeActivitySubmitSession(
      { ...config, outputDir },
      scoutResult,
      {
        submittedAt: '2026-06-24T08:00:00.000Z',
        submittedUrl: 'https://example.com/activity/success',
        clickedControlText: '提交',
        confirmationText: '创建成功',
      },
    );

    expect(submitSessionPath).toBe(join(outputDir, 'latest', 'activity-automation', 'activity-submit-session.json'));

    const saved = JSON.parse(await readFile(submitSessionPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      status: 'price_callback_pending',
      startsAt: '2026-06-23',
      endsAt: '2026-06-30',
      discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      submittedAt: '2026-06-24T08:00:00.000Z',
      submittedUrl: 'https://example.com/activity/success',
      confirmationText: '创建成功',
      productPickSessionPath: 'output/latest/activity-automation/activity-product-pick-session.json',
      products: [
        {
          platformProductId: '2026062322000235349104',
          merchantProductId: '81665859-886-06231159',
          internalProductId: '886',
        },
      ],
    });
  });
});
