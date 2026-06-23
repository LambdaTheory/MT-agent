import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClosedOrderFeedbackApiProviderFromEnv, type ClosedOrderFeedbackApiEnv } from './apiProvider.js';
import { ingestClosedOrderFeedbackInputs, loadClosedOrderIngestState, saveClosedOrderIngestState } from './ingest.js';
import type { ClosedOrderSyncResult } from './types.js';

export async function syncClosedOrderFeedbackFromApi(
  ingestStatePath: string,
  env: ClosedOrderFeedbackApiEnv = process.env,
  limit = 20,
  fetchImpl: typeof fetch = fetch,
): Promise<ClosedOrderSyncResult> {
  const provider = createClosedOrderFeedbackApiProviderFromEnv(env, fetchImpl);
  if (!provider) {
    throw new Error('Missing closed order remarks API env: CLOSED_ORDER_REMARKS_BASE_URL / CLOSED_ORDER_REMARKS_API_TOKEN / CLOSED_ORDER_REMARKS_SOURCE_APP_CODE');
  }

  const [previousState, recentInputs] = await Promise.all([
    loadClosedOrderIngestState(ingestStatePath),
    provider.listRecentFeedback(limit),
  ]);
  const ingestResult = ingestClosedOrderFeedbackInputs(previousState, recentInputs);
  await saveClosedOrderIngestState(ingestStatePath, ingestResult.state);

  return {
    fetchedCount: recentInputs.length,
    addedCount: ingestResult.addedCount,
    updatedCount: ingestResult.updatedCount,
    totalCount: ingestResult.state.items.length,
    state: ingestResult.state,
  };
}

export async function writeClosedOrderSyncArtifact(
  path: string,
  summary: Omit<ClosedOrderSyncResult, 'state'> & { date: string; generatedAt: string },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
