import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClosedOrderFeedbackApiProviderFromEnv } from '../closedOrderFeedback/apiProvider.js';
import { buildClosedOrderConfidenceFeedback } from '../closedOrderFeedback/feedback.js';
import { ingestClosedOrderFeedbackInputs, loadClosedOrderIngestState, saveClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import { loadEnv, type MutableEnv } from '../config/loadEnv.js';
import type { ClosedOrderConfidenceFeedback } from '../closedOrderFeedback/types.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toMarkdown(reportDate: string, items: ClosedOrderConfidenceFeedback[]): string {
  const lines = [
    `# 关单反馈预览 ${reportDate}`,
    '',
    `共 ${items.length} 条`,
    '',
  ];
  for (const [index, item] of items.entries()) {
    const title = [
      item.orderNo ? `订单 ${item.orderNo}` : '',
      item.internalProductId ? `商品 ${item.internalProductId}` : '',
      item.merchant ?? '',
    ].filter(Boolean).join(' | ');
    lines.push(`## ${index + 1}. ${title || item.closeId || '未命名关单'}`);
    lines.push(`原因：${item.inferredReason} | 标签：${item.reasonTags.join(', ')} | 置信度：${item.confidence}`);
    lines.push(`同 SKU 组：${item.sameSkuGroupId ?? '未识别'} | 样本数：${item.sameSkuSampleSize}`);
    lines.push(`数据完整性：${item.dataCompleteness.missingFields.length > 0 ? item.dataCompleteness.missingFields.join(', ') : '完整'}`);
    lines.push(`备注：${item.rawRemark.replace(/\r?\n/g, ' / ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function runClosedOrderFeedbackPreviewCli(
  argv = process.argv.slice(2),
  env: MutableEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await loadEnv('.env', env);

  const limit = Number(readArg(argv, '--limit') ?? '20');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid --limit: ${limit}`);

  const reportDate = readArg(argv, '--date') ?? today();
  const outDir = readArg(argv, '--out-dir') ?? 'output/closed-order-feedback';
  const productIdMapPath = readArg(argv, '--product-id-map') ?? 'config/product-id-map.json';
  const productNameMapPath = readArg(argv, '--product-name-map') ?? 'config/product-name-map.json';
  const goodsSnapshotPath = readArg(argv, '--goods-snapshot') ?? 'output/state/goods-current-snapshot.json';
  const firstSeenPath = readArg(argv, '--first-seen-state') ?? 'output/state/goods-first-seen.json';
  const lifecyclePath = readArg(argv, '--link-lifecycle-state') ?? 'output/state/goods-link-lifecycle.json';
  const daemonCatalogPath = readArg(argv, '--daemon-catalog') ?? 'output/state/link-registry-daemon-catalog.json';
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const ingestStatePath = readArg(argv, '--ingest-state') ?? 'output/state/closed-order-feedback-ingest.json';
  const artifactsDir = readArg(argv, '--artifacts-dir') ?? 'output';

  const provider = createClosedOrderFeedbackApiProviderFromEnv(env, fetchImpl);
  if (!provider) {
    throw new Error('Missing closed order remarks API env: CLOSED_ORDER_REMARKS_BASE_URL / CLOSED_ORDER_REMARKS_API_TOKEN / CLOSED_ORDER_REMARKS_SOURCE_APP_CODE');
  }

  const [registryContext, recentInputs] = await Promise.all([
    loadClosedOrderRegistryContext({
      productIdMapPath,
      productNameMapPath,
      goodsSnapshotPath,
      firstSeenPath,
      lifecyclePath,
      daemonCatalogPath,
      overridesPath,
      artifactsDir,
    }),
    provider.listRecentFeedback(limit),
  ]);

  const previousIngestState = await loadClosedOrderIngestState(ingestStatePath);
  const ingestResult = ingestClosedOrderFeedbackInputs(previousIngestState, recentInputs);
  await saveClosedOrderIngestState(ingestStatePath, ingestResult.state);

  const feedbackItems = await Promise.all(recentInputs.map((input) => buildClosedOrderConfidenceFeedback(input, registryContext.query)));
  const registryStats = {
    entryCount: registryContext.registry.length,
    groupedEntryCount: registryContext.registry.filter((entry) => Boolean(entry.sameSkuGroupId)).length,
    distinctSameSkuGroupCount: new Set(registryContext.registry.map((entry) => entry.sameSkuGroupId).filter(Boolean)).size,
  };

  await mkdir(outDir, { recursive: true });
  const baseName = `closed-order-feedback-${reportDate}`;
  const jsonPath = join(outDir, `${baseName}.json`);
  const markdownPath = join(outDir, `${baseName}.md`);
  await writeFile(
    jsonPath,
    `${JSON.stringify({
      date: reportDate,
      count: feedbackItems.length,
      registryStats,
      ingestStats: {
        totalCount: ingestResult.state.items.length,
        addedCount: ingestResult.addedCount,
        updatedCount: ingestResult.updatedCount,
      },
      items: feedbackItems,
    }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(markdownPath, `${toMarkdown(reportDate, feedbackItems)}\n`, 'utf8');
  console.log(`关单反馈预览已生成: ${markdownPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runClosedOrderFeedbackPreviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
