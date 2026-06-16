import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { activityAutomationOutputDir, type ActivityAutomationConfig } from './config.js';
import { collectVisibleActivityControls, type ActivityControlSummary } from './pageModel.js';
import { createEmptyActivityRecordingDraft } from './recording.js';
import { detectActivityFormWorkarounds } from './workarounds.js';

export interface ActivityScoutResult {
  url: string;
  outputDir: string;
  screenshotPath: string;
  controlsPath: string;
  bodyTextPath: string;
  recordingDraftPath: string;
  workaroundReportPath: string;
  controls: ActivityControlSummary[];
  detectedWorkarounds: string[];
}

async function safeBodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).replace(/\r\n/g, '\n');
}

export async function scoutActivityFormPage(page: Page, config: ActivityAutomationConfig): Promise<ActivityScoutResult> {
  const outputDir = activityAutomationOutputDir(config);
  await mkdir(outputDir, { recursive: true });

  const screenshotPath = join(outputDir, 'activity-form-scout.png');
  const controlsPath = join(outputDir, 'activity-form-controls.json');
  const bodyTextPath = join(outputDir, 'activity-form-body.txt');
  const recordingDraftPath = join(outputDir, 'activity-form-recording-draft.json');
  const workaroundReportPath = join(outputDir, 'activity-form-workarounds.json');

  const controls = await collectVisibleActivityControls(page);
  const detectedWorkarounds = await detectActivityFormWorkarounds(page);
  const bodyText = await safeBodyText(page);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(controlsPath, `${JSON.stringify(controls, null, 2)}\n`, 'utf8');
  await writeFile(bodyTextPath, bodyText, 'utf8');
  await writeFile(recordingDraftPath, `${JSON.stringify(createEmptyActivityRecordingDraft(page.url()), null, 2)}\n`, 'utf8');
  await writeFile(workaroundReportPath, `${JSON.stringify({ detectedWorkarounds }, null, 2)}\n`, 'utf8');

  return { url: page.url(), outputDir, screenshotPath, controlsPath, bodyTextPath, recordingDraftPath, workaroundReportPath, controls, detectedWorkarounds };
}
