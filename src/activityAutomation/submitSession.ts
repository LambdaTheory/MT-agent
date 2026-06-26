import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activityAutomationOutputDir, type ActivityAutomationConfig } from './config.js';
import type { ActivityScoutResult } from './scout.js';
import type { ActivitySubmitResult } from './submit.js';

export interface ActivitySubmitSessionProduct {
  platformProductId: string;
  merchantProductId: string;
  internalProductId?: string;
  productName?: string;
}

export interface ActivitySubmitSession {
  status: ActivitySubmitSessionStatus;
  submittedAt: string;
  submittedUrl: string;
  confirmationText?: string;
  activityId?: string;
  startsAt?: string;
  endsAt?: string;
  discounts?: ActivityAutomationConfig['draft']['discounts'];
  productPickSessionPath?: string;
  mappedCount: number;
  unmappedCount: number;
  products: ActivitySubmitSessionProduct[];
}

export type ActivitySubmitSessionStatus = 'price_callback_pending' | 'cancel_assistance_opened' | 'cancelled';

function buildSubmitSession(
  config: ActivityAutomationConfig,
  scoutResult: ActivityScoutResult,
  submitResult: ActivitySubmitResult,
): ActivitySubmitSession {
  const mappedProducts = scoutResult.productPickSession?.products
    ?? scoutResult.productPickResult?.pickedProducts.map((product) => ({
      ...product,
      internalProductId: undefined,
    }))
    ?? [];

  const products = mappedProducts.map((product) => ({
    platformProductId: product.platformProductId,
    merchantProductId: product.merchantProductId,
    internalProductId: product.internalProductId,
    ...(product.productName ? { productName: product.productName } : {}),
  }));

  const mappedCount = products.filter((product) => Boolean(product.internalProductId)).length;
  return {
    status: 'price_callback_pending',
    submittedAt: submitResult.submittedAt,
    submittedUrl: submitResult.submittedUrl,
    confirmationText: submitResult.confirmationText,
    activityId: submitResult.activityId,
    startsAt: config.draft.startsAt,
    endsAt: config.draft.endsAt,
    discounts: config.draft.discounts,
    productPickSessionPath: scoutResult.productPickSessionPath,
    mappedCount,
    unmappedCount: products.length - mappedCount,
    products,
  };
}

export async function writeActivitySubmitSession(
  config: ActivityAutomationConfig,
  scoutResult: ActivityScoutResult,
  submitResult: ActivitySubmitResult,
): Promise<string> {
  const outputDir = activityAutomationOutputDir(config);
  await mkdir(outputDir, { recursive: true });

  const sessionPath = join(outputDir, 'activity-submit-session.json');
  const session = buildSubmitSession(config, scoutResult, submitResult);
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return sessionPath;
}

export async function readActivitySubmitSession(sessionPath: string): Promise<ActivitySubmitSession> {
  return JSON.parse(await readFile(sessionPath, 'utf8')) as ActivitySubmitSession;
}

export async function updateActivitySubmitSessionStatus(
  sessionPath: string,
  status: ActivitySubmitSessionStatus,
): Promise<ActivitySubmitSession> {
  const session = await readActivitySubmitSession(sessionPath);
  const updated = { ...session, status };
  await writeFile(sessionPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}
