import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadClosedOrderRegistryContext: vi.fn(),
  resolveClosedOrderRegistryPaths: vi.fn(),
  loadOptionalJson: vi.fn(),
  loadConfig: vi.fn(),
  downloadGoodsExport: vi.fn(),
  writeProductIdMappingFromExport: vi.fn(),
  parseGoodsExportSnapshot: vi.fn(),
  loadProductIdMapping: vi.fn(),
  fetchDaemonCatalogSnapshot: vi.fn(),
  loadOptionalDaemonCatalogSnapshot: vi.fn(),
  mergeGoodsSnapshotWithDaemon: vi.fn(),
  saveDaemonCatalogSnapshot: vi.fn(),
  mutateGoodsSnapshotStateSerialized: vi.fn(),
  updateGoodsFirstSeenStateSerialized: vi.fn(),
  updateGoodsLinkLifecycleStateSerialized: vi.fn(),
  writeJsonAtomic: vi.fn(),
  writeRefreshSuppressionState: vi.fn(),
}));

vi.mock('../src/config/loadEnv.js', () => ({ loadEnv: vi.fn(async () => undefined) }));
vi.mock('../src/config/loadConfig.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../src/closedOrderFeedback/runtime.js', () => ({
  loadClosedOrderRegistryContext: mocks.loadClosedOrderRegistryContext,
  loadOptionalJson: mocks.loadOptionalJson,
  resolveClosedOrderRegistryPaths: mocks.resolveClosedOrderRegistryPaths,
}));
vi.mock('../src/crawler/goodsExportCrawler.js', () => ({ downloadGoodsExport: mocks.downloadGoodsExport }));
vi.mock('../src/mapping/refreshProductIdMapping.js', () => ({ writeProductIdMappingFromExport: mocks.writeProductIdMappingFromExport }));
vi.mock('../src/mapping/goodsExportMapping.js', () => ({ parseGoodsExportSnapshot: mocks.parseGoodsExportSnapshot }));
vi.mock('../src/mapping/productIdMapping.js', () => ({ loadProductIdMapping: mocks.loadProductIdMapping }));
vi.mock('../src/linkRegistry/daemonCatalog.js', () => ({
  fetchDaemonCatalogSnapshot: mocks.fetchDaemonCatalogSnapshot,
  loadOptionalDaemonCatalogSnapshot: mocks.loadOptionalDaemonCatalogSnapshot,
  mergeGoodsSnapshotWithDaemon: mocks.mergeGoodsSnapshotWithDaemon,
  saveDaemonCatalogSnapshot: mocks.saveDaemonCatalogSnapshot,
}));
vi.mock('../src/publicTraffic/goodsStatePersistence.js', () => ({
  mutateGoodsSnapshotStateSerialized: mocks.mutateGoodsSnapshotStateSerialized,
  updateGoodsFirstSeenStateSerialized: mocks.updateGoodsFirstSeenStateSerialized,
  updateGoodsLinkLifecycleStateSerialized: mocks.updateGoodsLinkLifecycleStateSerialized,
}));
vi.mock('../src/linkRegistry/persistence.js', () => ({ writeJsonAtomic: mocks.writeJsonAtomic }));
vi.mock('../src/linkRegistry/refreshSuppressionState.js', () => ({ writeRefreshSuppressionState: mocks.writeRefreshSuppressionState }));

describe('link registry prompt refresh', () => {
  function configureRefresh({ previousSnapshot, mergedSnapshot, daemonSnapshot }: {
    previousSnapshot: unknown[];
    mergedSnapshot: unknown[];
    daemonSnapshot: { count: number; excludedCount: number; pagesScraped: number; entries: unknown[] };
  }): void {
    mocks.loadConfig.mockResolvedValue({ productIdMappingPath: 'config/product-id-map.json' });
    mocks.resolveClosedOrderRegistryPaths.mockResolvedValue({
      productIdMapPath: 'map.json', goodsSnapshotPath: 'snapshot.json', firstSeenPath: 'first.json', lifecyclePath: 'lifecycle.json', daemonCatalogPath: 'daemon.json', artifactsDir: 'output',
    });
    mocks.loadClosedOrderRegistryContext.mockResolvedValue({ registry: [] });
    mocks.loadOptionalJson.mockResolvedValue(previousSnapshot);
    mocks.loadProductIdMapping.mockResolvedValue({});
    mocks.fetchDaemonCatalogSnapshot.mockResolvedValue(daemonSnapshot);
    mocks.saveDaemonCatalogSnapshot.mockResolvedValue(undefined);
    mocks.mergeGoodsSnapshotWithDaemon.mockReturnValue(mergedSnapshot);
    mocks.mutateGoodsSnapshotStateSerialized.mockImplementation(async (_path, mutate) => ({ previous: previousSnapshot, current: mutate(previousSnapshot) }));
    mocks.updateGoodsFirstSeenStateSerialized.mockResolvedValue({});
    mocks.updateGoodsLinkLifecycleStateSerialized.mockResolvedValue({ active: {}, removedLinks: [] });
    mocks.writeJsonAtomic.mockResolvedValue(undefined);
    mocks.writeRefreshSuppressionState.mockResolvedValue(undefined);
  }

  it('persists unhealthy same-date suppression and passes referenceDate to the immediate registry build', async () => {
    configureRefresh({ previousSnapshot: [], mergedSnapshot: [], daemonSnapshot: { count: 0, excludedCount: 0, pagesScraped: 0, entries: [] } });
    const { refreshLinkRegistryForPrompt } = await import('../src/linkRegistry/promptRefresh.js');
    await refreshLinkRegistryForPrompt('output', '2026-07-15', { mode: 'daemon_only' });
    expect(mocks.writeRefreshSuppressionState).toHaveBeenCalledWith('output', { version: 1, referenceDate: '2026-07-15', suppressDelistAttribution: true });
    expect(mocks.loadClosedOrderRegistryContext).toHaveBeenLastCalledWith(expect.objectContaining({ suppressDelistAttribution: true, referenceDate: '2026-07-15' }));
  });

  it('suppresses registry delist attribution for an empty daemon snapshot', async () => {
    configureRefresh({
      previousSnapshot: [],
      mergedSnapshot: [],
      daemonSnapshot: { count: 0, excludedCount: 0, pagesScraped: 0, entries: [] },
    });

    const { refreshLinkRegistryForPrompt } = await import('../src/linkRegistry/promptRefresh.js');
    await refreshLinkRegistryForPrompt('output', '2026-07-15', { mode: 'daemon_only' });

    expect(mocks.loadClosedOrderRegistryContext).toHaveBeenLastCalledWith(expect.objectContaining({
      suppressDelistAttribution: true,
    }));
  });

  it('suppresses registry delist attribution for a sharp snapshot drop', async () => {
    configureRefresh({
      previousSnapshot: Array.from({ length: 10 }, (_, index) => ({ internalProductId: String(index), platformProductId: '', productName: '' })),
      mergedSnapshot: Array.from({ length: 7 }, (_, index) => ({ internalProductId: String(index), platformProductId: '', productName: '' })),
      daemonSnapshot: { count: 7, excludedCount: 0, pagesScraped: 1, entries: [] },
    });

    const { refreshLinkRegistryForPrompt } = await import('../src/linkRegistry/promptRefresh.js');
    await refreshLinkRegistryForPrompt('output', '2026-07-15', { mode: 'daemon_only' });

    expect(mocks.loadClosedOrderRegistryContext).toHaveBeenLastCalledWith(expect.objectContaining({
      suppressDelistAttribution: true,
    }));
  });
});
