import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseLinkListingStatus } from '../src/cli/linkListingStatusDiagnose.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-link-listing-diagnose-'));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('diagnoseLinkListingStatus', () => {
  it('reports missing Phase 0 artifacts without throwing', async () => {
    const dir = await makeTempDir();

    const report = await diagnoseLinkListingStatus({
      cwd: dir,
      artifactsDir: join(dir, 'output'),
      productIdMapPath: join(dir, 'missing-product-id-map.json'),
      productNameMapPath: join(dir, 'missing-product-name-map.json'),
      goodsSnapshotPath: join(dir, 'output', 'state', 'missing-goods-current-snapshot.json'),
      firstSeenPath: join(dir, 'output', 'state', 'missing-first-seen.json'),
      lifecyclePath: join(dir, 'output', 'state', 'missing-lifecycle.json'),
      daemonCatalogPath: join(dir, 'output', 'state', 'missing-daemon-catalog.json'),
      overridesPath: join(dir, 'output', 'state', 'missing-overrides.json'),
    });

    expect(report.artifacts.outputDir.exists).toBe(false);
    expect(report.artifacts.goodsSnapshot.exists).toBe(false);
    expect(report.artifacts.daemonCatalog.exists).toBe(false);
    expect(report.registryEntryCount).toBe(0);
    expect(report.activeButSourceDelistedCount).toBe(0);
  });

  it('keeps explicit daemon delisted source signals out of active registry entries', async () => {
    const dir = await makeTempDir();
    const stateDir = join(dir, 'output', 'state');
    const productIdMapPath = join(stateDir, 'product-id-map.json');
    const goodsSnapshotPath = join(stateDir, 'goods-current-snapshot.json');
    const daemonCatalogPath = join(stateDir, 'link-registry-daemon-catalog.json');

    await writeJson(productIdMapPath, { 'platform-701': '701' });
    await writeJson(goodsSnapshotPath, [
      { platformProductId: 'platform-701', internalProductId: '701', productName: '测试商品' },
    ]);
    await writeJson(daemonCatalogPath, {
      generatedAt: '2026-07-04T00:00:00.000Z',
      count: 1,
      excludedCount: 0,
      entries: [
        {
          internalProductId: '701',
          productName: '测试商品',
          syncStatus: '已下架',
          discoveredAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    });

    const report = await diagnoseLinkListingStatus({
      cwd: dir,
      artifactsDir: join(dir, 'output'),
      productIdMapPath,
      productNameMapPath: join(stateDir, 'missing-product-name-map.json'),
      goodsSnapshotPath,
      firstSeenPath: join(stateDir, 'missing-first-seen.json'),
      lifecyclePath: join(stateDir, 'missing-lifecycle.json'),
      daemonCatalogPath,
      overridesPath: join(stateDir, 'missing-overrides.json'),
    });

    expect(report.registryEntryCount).toBe(1);
    expect(report.sourceDelistedCounts.daemon).toBe(1);
    expect(report.activeButSourceDelistedCount).toBe(0);
    expect(report.activeButSourceDelisted).toEqual([]);
  });

  it('keeps explicit exposure delisted source signals out of active registry entries', async () => {
    const dir = await makeTempDir();
    const stateDir = join(dir, 'output', 'state');
    const productIdMapPath = join(stateDir, 'product-id-map.json');
    const goodsSnapshotPath = join(stateDir, 'goods-current-snapshot.json');
    const exposurePath = join(dir, 'output', '2026-07-04', '公域曝光商品快照_2026-07-04.json');

    await writeJson(productIdMapPath, { 'platform-801': '801' });
    await writeJson(goodsSnapshotPath, [
      { platformProductId: 'platform-801', internalProductId: '801', productName: '曝光下架商品' },
    ]);
    await writeJson(exposurePath, [
      {
        platformProductId: 'platform-801',
        productName: '曝光下架商品',
        exposure: 10,
        visits: 1,
        amount: 0,
        custodyDays: null,
        raw: { 商品状态: '已下架' },
      },
    ]);

    const report = await diagnoseLinkListingStatus({
      cwd: dir,
      artifactsDir: join(dir, 'output'),
      productIdMapPath,
      productNameMapPath: join(stateDir, 'missing-product-name-map.json'),
      goodsSnapshotPath,
      firstSeenPath: join(stateDir, 'missing-first-seen.json'),
      lifecyclePath: join(stateDir, 'missing-lifecycle.json'),
      daemonCatalogPath: join(stateDir, 'missing-daemon-catalog.json'),
      overridesPath: join(stateDir, 'missing-overrides.json'),
    });

    expect(report.registryEntryCount).toBe(1);
    expect(report.sourceDelistedCounts.exposure).toBe(1);
    expect(report.activeButSourceDelistedCount).toBe(0);
    expect(report.activeButSourceDelisted).toEqual([]);
  });
});
