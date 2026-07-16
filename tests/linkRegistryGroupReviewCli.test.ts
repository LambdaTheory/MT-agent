import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

const runtimeMocks = vi.hoisted(() => ({
  loadClosedOrderRegistryContext: vi.fn(),
}));

vi.mock('../src/closedOrderFeedback/runtime.js', () => ({
  loadClosedOrderRegistryContext: runtimeMocks.loadClosedOrderRegistryContext,
}));

const { runLinkRegistryGroupReviewCli } = await import('../src/cli/linkRegistryGroupReview.js');

const tempDirs: string[] = [];

describe('link registry group review CLI inventory snapshot validation', () => {
  beforeEach(() => {
    runtimeMocks.loadClosedOrderRegistryContext.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const dirs = tempDirs.splice(0);
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('rejects an explicitly requested shallow invalid inventory snapshot', async () => {
    const outputDir = await makeTempDir('mt-agent-group-review-explicit-invalid-');
    const paths = buildPublicTrafficPaths(outputDir, '2026-06-26');
    await writeSnapshot(paths.sameSkuSnapshot, invalidLegacySnapshot('2026-06-26'));
    mockRegistryContext(outputDir);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runLinkRegistryGroupReviewCli([
      '--output-dir', outputDir,
      '--snapshot-date', '2026-06-26',
    ])).rejects.toThrow(/invalid inventory snapshot/i);
  });

  it('skips a newer shallow invalid snapshot when auto-selecting the latest snapshot', async () => {
    const outputDir = await makeTempDir('mt-agent-group-review-auto-valid-');
    const invalidPaths = buildPublicTrafficPaths(outputDir, '2026-06-26');
    const validPaths = buildPublicTrafficPaths(outputDir, '2026-06-25');
    await writeSnapshot(invalidPaths.sameSkuSnapshot, invalidLegacySnapshot('2026-06-26'));
    await writeSnapshot(validPaths.sameSkuSnapshot, validSnapshot('2026-06-25'));
    mockRegistryContext(outputDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runLinkRegistryGroupReviewCli(['--output-dir', outputDir, '--json']);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      markdownPath: string;
      jsonPath: string;
      approvalCsvPath: string;
      approvalGuidePath: string;
      report: { snapshotDate?: string };
    };
    expect(payload.report.snapshotDate).toBe('2026-06-25');
    expect(payload.jsonPath).toContain('link-registry-group-review-2026-06-25.json');
    expect(payload.markdownPath).toContain('link-registry-group-review-2026-06-25.md');
    expect(payload.approvalCsvPath).toContain('link-registry-group-review-approval-2026-06-25.csv');
    expect(payload.approvalGuidePath).toContain('link-registry-group-review-approval-guide-2026-06-25.md');
    expect(payload.jsonPath).not.toContain('2026-06-26');
    expect(await readFile(payload.jsonPath, 'utf8')).toContain('"snapshotDate": "2026-06-25"');
  });
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeSnapshot(path: string, snapshot: unknown): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function mockRegistryContext(outputDir: string): void {
  runtimeMocks.loadClosedOrderRegistryContext.mockResolvedValue({
    registry: [],
    resolvedPaths: {
      overridesPath: join(outputDir, 'missing-link-registry-overrides.json'),
    },
  });
}

function metric() {
  return {
    exposure: 0,
    publicVisits: 0,
    amount: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    createdOrderAmount: 0,
    signedOrderAmount: 0,
    reviewedOrderAmount: 0,
    shippedOrderAmount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

function invalidLegacySnapshot(date: string) {
  return {
    date,
    sourceReportDate: '2026-06-24',
    summary: {
      sameSkuGroupCount: 1,
      activeLinkCount: 1,
      totalLinkCount: 1,
    },
    coverage: {
      groupedLinkCount: 1,
      ungroupedLinkCount: 0,
      groupsWithMetrics: 1,
      groupsWithoutMetrics: 0,
    },
    registryAuditSummary: {
      totalLinks: 1,
      onSaleLinks: 1,
      delistedLinks: 0,
      goneLinks: 0,
      unknownLinks: 0,
      overrideRiskCount: 0,
    },
    groups: [
      {
        sameSkuGroupId: 'legacy-camera-kit',
        groupName: 'Legacy Camera Kit',
        activeLinkCount: 1,
        totalLinkCount: 1,
        mappedRowCount: 1,
        missingMetricLinkCount: 0,
        periods: { '1d': metric(), '7d': metric(), '30d': metric() },
        topLinks: [
          {
            internalProductId: 'legacy-701',
            platformProductId: 'platform-legacy-701',
            productName: 'Legacy Camera Kit',
            shortName: 'Legacy Kit',
            status: 'active',
            oneDayExposure: 10,
            oneDayPublicVisits: 2,
            oneDayAmount: 0,
          },
        ],
        risks: [],
      },
    ],
  };
}

function validSnapshot(date: '2026-06-25'): InventoryStatusSnapshot {
  return {
    schemaVersion: 1,
    generationId: `link-registry-group-review-${date}`,
    date,
    sourceReportDate: '2026-06-24',
    generatedAt: '2026-06-25T00:00:00.000Z',
    warnings: [],
    summary: {
      sameSkuGroupCount: 1,
      activeLinkCount: 1,
      totalLinkCount: 1,
    },
    coverage: {
      groupedLinkCount: 1,
      ungroupedLinkCount: 0,
      groupsWithMetrics: 1,
      groupsWithoutMetrics: 0,
    },
    registryAuditSummary: {
      totalLinks: 1,
      onSaleLinks: 1,
      delistedLinks: 0,
      goneLinks: 0,
      unknownLinks: 0,
      overrideRiskCount: 0,
    },
    groups: [
      {
        sameSkuGroupId: 'valid-camera-kit',
        groupName: 'Valid Camera Kit',
        categoryId: 'camera',
        categoryName: 'Camera',
        productType: 'camera-kit',
        activeLinkCount: 1,
        totalLinkCount: 1,
        mappedRowCount: 1,
        missingMetricLinkCount: 0,
        periods: { '1d': metric(), '7d': metric(), '30d': metric() },
        topLinks: [
          {
            internalProductId: 'valid-701',
            platformProductId: 'platform-valid-701',
            productName: 'Valid Camera Kit',
            shortName: 'Valid Kit',
            listingState: 'on_sale',
            oneDayExposure: 20,
            oneDayPublicVisits: 4,
            oneDayAmount: 100,
          },
        ],
        risks: [],
      },
    ],
  };
}
