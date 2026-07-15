import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';
import { loadClosedOrderRegistryContext } from '../src/closedOrderFeedback/runtime.js';
import { writeRefreshSuppressionState } from '../src/linkRegistry/refreshSuppressionState.js';

describe('link registry runtime', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-link-registry-runtime-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('attributes a daemon-delisted product to a persisted agent delist event', async () => {
    const goodsSnapshotPath = join(outputDir, 'goods-current-snapshot.json');
    const productIdMapPath = join(outputDir, 'product-id-map.json');
    const productNameMapPath = join(outputDir, 'product-name-map.json');
    const firstSeenPath = join(outputDir, 'goods-first-seen.json');
    const lifecyclePath = join(outputDir, 'goods-link-lifecycle.json');
    const daemonCatalogPath = join(outputDir, 'link-registry-daemon-catalog.json');
    const overridesPath = join(outputDir, 'link-registry-overrides.json');

    await Promise.all([
      writeFile(goodsSnapshotPath, '[]', 'utf8'),
      writeFile(productIdMapPath, '{}', 'utf8'),
      writeFile(productNameMapPath, '{}', 'utf8'),
      writeFile(firstSeenPath, '{}', 'utf8'),
      writeFile(lifecyclePath, 'null', 'utf8'),
      writeFile(daemonCatalogPath, JSON.stringify({
        generatedAt: '2026-07-14T10:00:00.000Z',
        count: 1,
        excludedCount: 0,
        entries: [{
          internalProductId: '1702',
          productName: 'Agent下架商品',
          syncStatus: '已下架',
          discoveredAt: '2026-07-14T10:00:00.000Z',
        }],
      }), 'utf8'),
      writeFile(overridesPath, 'null', 'utf8'),
    ]);
    await recordOperationEvent(outputDir, {
      planId: 'plan-1',
      at: '2026-07-14T09:00:00.000Z',
      event: 'execution_succeeded',
      toolName: 'rental.delistBatch',
      subject: { kind: 'product', id: '1702' },
      metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
    });

    const context = await loadClosedOrderRegistryContext({
      artifactsDir: outputDir,
      goodsSnapshotPath,
      productIdMapPath,
      productNameMapPath,
      firstSeenPath,
      lifecyclePath,
      daemonCatalogPath,
      overridesPath,
    }, outputDir);

    expect(context.registry.find((entry) => entry.internalProductId === '1702')).toMatchObject({
      delistCause: 'agent_confirmed_manual_off_shelf',
      delistCauseConfidence: 'confirmed',
    });
  });
  it('confirms a 09:00 Agent delist when a fresh same-day goods observation arrives after it', async () => {
    const goodsSnapshotPath = join(outputDir, 'goods-current-snapshot.json');
    const productIdMapPath = join(outputDir, 'product-id-map.json');
    const productNameMapPath = join(outputDir, 'product-name-map.json');
    const firstSeenPath = join(outputDir, 'goods-first-seen.json');
    const lifecyclePath = join(outputDir, 'goods-link-lifecycle.json');
    const daemonCatalogPath = join(outputDir, 'link-registry-daemon-catalog.json');
    const overridesPath = join(outputDir, 'link-registry-overrides.json');

    await Promise.all([
      writeFile(goodsSnapshotPath, JSON.stringify([{
        platformProductId: 'platform-1702', internalProductId: '1702', productName: 'freshly observed delist',
        listingState: 'delisted', listingStatusText: '已下架', observedAt: '2026-07-14T10:30:00.000Z',
      }]), 'utf8'),
      writeFile(productIdMapPath, '{}', 'utf8'),
      writeFile(productNameMapPath, '{}', 'utf8'),
      writeFile(firstSeenPath, '{}', 'utf8'),
      writeFile(lifecyclePath, 'null', 'utf8'),
      writeFile(daemonCatalogPath, JSON.stringify({ generatedAt: '2026-07-14T10:30:00.000Z', count: 0, excludedCount: 0, entries: [] }), 'utf8'),
      writeFile(overridesPath, 'null', 'utf8'),
    ]);
    await recordOperationEvent(outputDir, {
      planId: 'plan-1', at: '2026-07-14T09:00:00.000Z', event: 'execution_succeeded', toolName: 'rental.delist',
      subject: { kind: 'product', id: '1702' }, metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
    });

    const context = await loadClosedOrderRegistryContext({
      artifactsDir: outputDir, goodsSnapshotPath, productIdMapPath, productNameMapPath, firstSeenPath, lifecyclePath, daemonCatalogPath, overridesPath,
    }, outputDir);

    expect(context.registry.find((entry) => entry.internalProductId === '1702')).toMatchObject({
      delistCause: 'agent_confirmed_manual_off_shelf', delistCauseConfidence: 'confirmed',
    });
  });
  it('suppresses daemon delist attribution only for an unhealthy refresh on the same reference date', async () => {
    const goodsSnapshotPath = join(outputDir, 'goods-current-snapshot.json');
    const productIdMapPath = join(outputDir, 'product-id-map.json');
    const productNameMapPath = join(outputDir, 'product-name-map.json');
    const firstSeenPath = join(outputDir, 'goods-first-seen.json');
    const lifecyclePath = join(outputDir, 'goods-link-lifecycle.json');
    const daemonCatalogPath = join(outputDir, 'link-registry-daemon-catalog.json');
    const overridesPath = join(outputDir, 'link-registry-overrides.json');

    await Promise.all([
      writeFile(goodsSnapshotPath, '[]', 'utf8'),
      writeFile(productIdMapPath, '{}', 'utf8'),
      writeFile(productNameMapPath, '{}', 'utf8'),
      writeFile(firstSeenPath, '{}', 'utf8'),
      writeFile(lifecyclePath, 'null', 'utf8'),
      writeFile(daemonCatalogPath, JSON.stringify({
        generatedAt: '2026-07-15T10:00:00.000Z',
        count: 1,
        excludedCount: 0,
        entries: [{ internalProductId: '1702', productName: 'Agent下架商品', syncStatus: '已下架', discoveredAt: '2026-07-15T10:00:00.000Z' }],
      }), 'utf8'),
      writeFile(overridesPath, 'null', 'utf8'),
    ]);
    await recordOperationEvent(outputDir, {
      planId: 'plan-1', at: '2026-07-15T09:00:00.000Z', event: 'execution_succeeded', toolName: 'rental.delist',
      subject: { kind: 'product', id: '1702' }, metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
    });
    await writeRefreshSuppressionState(outputDir, { version: 1, referenceDate: '2026-07-15', suppressDelistAttribution: true });

    const input = { artifactsDir: outputDir, goodsSnapshotPath, productIdMapPath, productNameMapPath, firstSeenPath, lifecyclePath, daemonCatalogPath, overridesPath };
    const sameDate = await loadClosedOrderRegistryContext({ ...input, referenceDate: '2026-07-15' }, outputDir);
    const otherDate = await loadClosedOrderRegistryContext({ ...input, referenceDate: '2026-07-16' }, outputDir);

    expect(sameDate.registry.find((entry) => entry.internalProductId === '1702')).toMatchObject({ listingState: 'delisted' });
    expect(sameDate.registry.find((entry) => entry.internalProductId === '1702')).not.toHaveProperty('delistCause');
    expect(otherDate.registry.find((entry) => entry.internalProductId === '1702')).toMatchObject({
      listingState: 'delisted', delistCause: 'agent_confirmed_manual_off_shelf', delistCauseConfidence: 'confirmed',
    });
  });
});
