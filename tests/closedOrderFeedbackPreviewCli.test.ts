import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runClosedOrderFeedbackPreviewCli } from '../src/cli/closedOrderFeedbackPreview.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

describe('closed order feedback preview CLI', () => {
  it('writes local preview artifacts from the delivered remarks API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-'));
    const productIdMapPath = join(dir, 'product-id-map.json');
    const productNameMapPath = join(dir, 'product-name-map.json');
    const artifactsDir = join(dir, 'output');
    const artifactDateDir = join(artifactsDir, '2026-06-21');
    const artifactPaths = buildPublicTrafficPaths(artifactsDir, '2026-06-21');

    await writeFile(productIdMapPath, JSON.stringify({ 'platform-560': '560' }), 'utf8');
    await writeFile(productNameMapPath, JSON.stringify({}), 'utf8');

    await mkdir(artifactDateDir, { recursive: true });
    await writeFile(
      artifactPaths.exposureCumulativeProducts,
      JSON.stringify([
        { platformProductId: 'platform-560', productName: 'DJI Pocket 3 Creator Combo' },
      ]),
      'utf8',
    );

    const env = {
      CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
      CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
      CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        source_app_code: 'order_dispatch',
        items: [
          {
            id: 'close-1',
            order_no: 'SH202606220001',
            goods_id: '560',
            merchant: 'merchant-A',
            merchant_remark: 'cannot reach customer',
            captured_at: '2026-06-20T11:57:42Z',
            received_at: '2026-06-22T03:55:57.917120Z',
          },
        ],
      }), { status: 200 }),
    );

    await runClosedOrderFeedbackPreviewCli([
      '--date', '2026-06-22',
      '--limit', '1',
      '--out-dir', dir,
      '--artifacts-dir', artifactsDir,
      '--ingest-state', join(dir, 'state', 'closed-order-feedback-ingest.json'),
      '--product-id-map', productIdMapPath,
      '--product-name-map', productNameMapPath,
      '--first-seen-state', join(dir, 'missing-first-seen.json'),
      '--link-lifecycle-state', join(dir, 'missing-lifecycle.json'),
    ], env, fetchImpl);

    const json = JSON.parse(await readFile(join(dir, 'closed-order-feedback-2026-06-22.json'), 'utf8')) as {
      count: number;
      registryStats: { groupedEntryCount: number; distinctSameSkuGroupCount: number };
      ingestStats: { totalCount: number; addedCount: number; updatedCount: number };
      items: Array<{ internalProductId: string; orderNo: string; merchant: string; sameSkuGroupId: string; sameSkuSampleSize: number }>;
    };
    const markdown = await readFile(join(dir, 'closed-order-feedback-2026-06-22.md'), 'utf8');
    const ingestState = JSON.parse(await readFile(join(dir, 'state', 'closed-order-feedback-ingest.json'), 'utf8')) as {
      items: Array<{ dedupeKey: string; closeId: string; seenCount: number }>;
    };

    expect(json.count).toBe(1);
    expect(json.registryStats).toMatchObject({ groupedEntryCount: 1, distinctSameSkuGroupCount: 1 });
    expect(json.ingestStats).toMatchObject({ totalCount: 1, addedCount: 1, updatedCount: 0 });
    expect(json.items[0]).toMatchObject({
      internalProductId: '560',
      orderNo: 'SH202606220001',
      merchant: 'merchant-A',
      sameSkuGroupId: 'dji-pocket-3',
      sameSkuSampleSize: 1,
    });
    expect(ingestState.items).toHaveLength(1);
    expect(ingestState.items[0]).toMatchObject({ dedupeKey: 'close:close-1', closeId: 'close-1', seenCount: 1 });
    expect(markdown).toContain('SH202606220001');
    expect(markdown).toContain('merchant-A');
    expect(markdown).toContain('dji-pocket-3');
  });

  it('falls back to parent workspace config and output when running inside a worktree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-worktree-root-'));
    const worktreeDir = join(rootDir, '.worktrees', 'closed-order-feedback');
    const outputDir = join(worktreeDir, 'preview-output');
    const rootConfigDir = join(rootDir, 'config');
    const rootArtifactsDir = join(rootDir, 'output');
    const artifactPaths = buildPublicTrafficPaths(rootArtifactsDir, '2026-06-21');
    const originalCwd = process.cwd();

    await mkdir(worktreeDir, { recursive: true });
    await mkdir(rootConfigDir, { recursive: true });
    await mkdir(join(rootArtifactsDir, 'state'), { recursive: true });
    await mkdir(join(rootArtifactsDir, '2026-06-21'), { recursive: true });
    await mkdir(join(worktreeDir, 'output', 'closed-order-feedback-api-smoke'), { recursive: true });

    await writeFile(join(rootConfigDir, 'product-id-map.json'), JSON.stringify({ 'platform-560': '560' }), 'utf8');
    await writeFile(join(rootConfigDir, 'product-name-map.json'), JSON.stringify({}), 'utf8');
    await writeFile(artifactPaths.exposureCumulativeProducts, JSON.stringify([
      { platformProductId: 'platform-560', productName: 'DJI Pocket 3 Creator Combo' },
    ]), 'utf8');

    const env = {
      CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
      CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
      CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        source_app_code: 'order_dispatch',
        items: [
          {
            id: 'close-1',
            order_no: 'SH202606220001',
            goods_id: '560',
            merchant: 'merchant-A',
            merchant_remark: 'cannot reach customer',
            captured_at: '2026-06-20T11:57:42Z',
            received_at: '2026-06-22T03:55:57.917120Z',
          },
        ],
      }), { status: 200 }),
    );

    process.chdir(worktreeDir);
    try {
      await runClosedOrderFeedbackPreviewCli([
        '--date', '2026-06-22',
        '--limit', '1',
        '--out-dir', outputDir,
      ], env, fetchImpl);
    } finally {
      process.chdir(originalCwd);
    }

    const json = JSON.parse(await readFile(join(outputDir, 'closed-order-feedback-2026-06-22.json'), 'utf8')) as {
      registryStats: { groupedEntryCount: number; distinctSameSkuGroupCount: number };
      ingestStats: { totalCount: number; addedCount: number; updatedCount: number };
      items: Array<{ sameSkuGroupId: string; sameSkuSampleSize: number }>;
    };
    const ingestState = JSON.parse(await readFile(join(worktreeDir, 'output', 'state', 'closed-order-feedback-ingest.json'), 'utf8')) as {
      items: Array<{ dedupeKey: string; seenCount: number }>;
    };

    expect(json.registryStats).toMatchObject({ groupedEntryCount: 1, distinctSameSkuGroupCount: 1 });
    expect(json.ingestStats).toMatchObject({ totalCount: 1, addedCount: 1, updatedCount: 0 });
    expect(json.items[0]).toMatchObject({
      sameSkuGroupId: 'dji-pocket-3',
      sameSkuSampleSize: 1,
    });
    expect(ingestState.items).toHaveLength(1);
    expect(ingestState.items[0]).toMatchObject({ dedupeKey: 'close:close-1', seenCount: 1 });
  });
});
