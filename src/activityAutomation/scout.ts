import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { DifferentialPricingDateFillResult } from './dateFilling.js';
import type { DifferentialPricingDiscountFillResult } from './discountFilling.js';
import { findLatestReportContext } from '../feishuBot/reportStore.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import { activityAutomationOutputDir, type ActivityAutomationConfig } from './config.js';
import { collectVisibleActivityControls, type ActivityControlSummary } from './pageModel.js';
import { mapPickedProductsToInternalIds, type ResolvedPickedProductSummary } from './productPickSession.js';
import type { DifferentialPricingProductPickResult } from './productPicker.js';
import { createEmptyActivityRecordingDraft } from './recording.js';
import { analyzeDifferentialPricingScout, type DifferentialPricingScoutAnalysis, type DifferentialPricingSelectedProduct } from './scoutAnalysis.js';
import type { ActivitySubmitResult } from './submit.js';
import { detectActivityFormWorkarounds } from './workarounds.js';

export interface ActivityProductPickSessionReport extends ResolvedPickedProductSummary {
  reportContextPath?: string;
  productIdMappingPath?: string;
}

export interface ActivityScoutResult {
  url: string;
  outputDir: string;
  screenshotPath: string;
  controlsPath: string;
  bodyTextPath: string;
  recordingDraftPath: string;
  workaroundReportPath: string;
  analysisPath: string;
  controls: ActivityControlSummary[];
  detectedWorkarounds: string[];
  analysis: DifferentialPricingScoutAnalysis;
  productPickResult?: DifferentialPricingProductPickResult;
  dateFillResult?: DifferentialPricingDateFillResult;
  discountFillResult?: DifferentialPricingDiscountFillResult;
  productPickSessionPath?: string;
  productPickSession?: ActivityProductPickSessionReport;
  submitResult?: ActivitySubmitResult;
  submitSessionPath?: string;
}

async function safeBodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).replace(/\r\n/g, '\n');
}

async function safeLoadProductIdMapping(path: string | undefined): Promise<ProductIdMapping> {
  if (!path) return {};

  try {
    return await loadProductIdMapping(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function findLatestReportContextForActivity(outputDir: string) {
  for (const candidate of [outputDir, join(outputDir, 'public-traffic')]) {
    const latest = await findLatestReportContext(candidate);
    if (latest) return latest;
  }

  return null;
}

async function extractSelectedProductRows(page: Page): Promise<DifferentialPricingSelectedProduct[]> {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.ant-table-tbody tr[data-row-key]');
    return Array.from(rows)
      .map((row) => {
        const rowKey = row.getAttribute('data-row-key') ?? '';
        const text = (row.textContent ?? '').replace(/\s+/g, ' ').trim();
        const merchantProductId = (/(?:\u5546\u5bb6)?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/u.exec(text)?.[1]) ?? '';
        const nameEl = row.querySelector('.goodsTitle___oa1fI span');
        const name = nameEl ? (nameEl.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
        return { rowKey, name, merchantProductId };
      })
      .filter((product) => product.rowKey && product.merchantProductId);
  });
}

function buildSelectedProductFallback(productPickResult: DifferentialPricingProductPickResult | undefined): DifferentialPricingSelectedProduct[] {
  return (productPickResult?.pickedProducts ?? []).map((product) => ({
    rowKey: product.platformProductId,
    name: product.productName,
    merchantProductId: product.merchantProductId,
  }));
}

export async function scoutActivityFormPage(
  page: Page,
  config: ActivityAutomationConfig,
  productPickResult?: DifferentialPricingProductPickResult,
): Promise<ActivityScoutResult> {
  const outputDir = activityAutomationOutputDir(config);
  await mkdir(outputDir, { recursive: true });

  const screenshotPath = join(outputDir, 'activity-form-scout.png');
  const controlsPath = join(outputDir, 'activity-form-controls.json');
  const bodyTextPath = join(outputDir, 'activity-form-body.txt');
  const recordingDraftPath = join(outputDir, 'activity-form-recording-draft.json');
  const workaroundReportPath = join(outputDir, 'activity-form-workarounds.json');
  const analysisPath = join(outputDir, 'activity-form-analysis.json');
  const productPickSessionPath = join(outputDir, 'activity-product-pick-session.json');

  const controls = await collectVisibleActivityControls(page);
  const detectedWorkarounds = await detectActivityFormWorkarounds(page);
  const bodyText = await safeBodyText(page);
  const selectedProductRows = await extractSelectedProductRows(page);
  const analysis = analyzeDifferentialPricingScout({
    controls,
    bodyText,
    detectedWorkarounds,
    selectedProductRows: selectedProductRows.length > 0 ? selectedProductRows : buildSelectedProductFallback(productPickResult),
  });
  const latestReportContext = await findLatestReportContextForActivity(config.outputDir);
  const productIdMapping = await safeLoadProductIdMapping(config.productIdMappingPath);
  const productPickSession = productPickResult?.pickedProducts.length
    ? {
        ...mapPickedProductsToInternalIds(productPickResult.pickedProducts, latestReportContext?.context, productIdMapping),
        reportContextPath: latestReportContext?.path,
        productIdMappingPath: Object.keys(productIdMapping).length > 0 ? config.productIdMappingPath : undefined,
      }
    : undefined;

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(controlsPath, `${JSON.stringify(controls, null, 2)}\n`, 'utf8');
  await writeFile(bodyTextPath, bodyText, 'utf8');
  await writeFile(recordingDraftPath, `${JSON.stringify(createEmptyActivityRecordingDraft(page.url()), null, 2)}\n`, 'utf8');
  await writeFile(workaroundReportPath, `${JSON.stringify({ detectedWorkarounds }, null, 2)}\n`, 'utf8');
  await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  if (productPickSession) {
    await writeFile(productPickSessionPath, `${JSON.stringify(productPickSession, null, 2)}\n`, 'utf8');
  }

  return {
    url: page.url(),
    outputDir,
    screenshotPath,
    controlsPath,
    bodyTextPath,
    recordingDraftPath,
    workaroundReportPath,
    analysisPath,
    controls,
    detectedWorkarounds,
    analysis,
    productPickResult,
    productPickSessionPath: productPickSession ? productPickSessionPath : undefined,
    productPickSession,
  };
}
