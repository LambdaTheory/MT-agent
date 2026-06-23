import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPublicTrafficArtifactManifest,
  buildPublicTrafficArtifactManifestPath,
  loadPublicTrafficArtifactManifest,
  parsePublicTrafficArtifactManifest,
  savePublicTrafficArtifactManifest,
  type PublicTrafficArtifactManifest,
} from '../src/publicTraffic/artifacts.js';

function manifest(overrides: Partial<PublicTrafficArtifactManifest> = {}): PublicTrafficArtifactManifest {
  return {
    artifactVersion: 1,
    runDate: '2026-06-18',
    capturedAt: '2026-06-18T01:02:03.000Z',
    source: 'alipay',
    stage: 'dashboard',
    sourceUrl: 'https://b.alipay.com/page/assistant-data-analysis/index/product/list',
    merchantVerified: true,
    dataDate: '2026-06-17',
    freshness: 'not_updated',
    notes: ['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'],
    files: {
      raw1d: 'output/2026-06-18/公域访问数据_1日.json',
    },
    ...overrides,
  };
}

describe('public traffic artifact manifests', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a stable manifest path per stage', () => {
    expect(buildPublicTrafficArtifactManifestPath('output', '2026-06-18', 'exposure')).toBe('output/2026-06-18/artifacts/exposure-manifest.json');
  });

  it('builds a manifest with default artifact metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T01:02:03.000Z'));

    expect(buildPublicTrafficArtifactManifest({
      runDate: '2026-06-18',
      stage: 'goods-export',
      sourceUrl: 'https://b.alipay.com/page/commerce/goods/list?itemSubType=RENT&itemType=NORMAL_ITEM',
      files: { goodsExportWorkbook: 'output/2026-06-18/商品总表_2026-06-18.xlsx' },
    })).toEqual({
      artifactVersion: 1,
      runDate: '2026-06-18',
      capturedAt: '2026-06-18T01:02:03.000Z',
      source: 'alipay',
      stage: 'goods-export',
      sourceUrl: 'https://b.alipay.com/page/commerce/goods/list?itemSubType=RENT&itemType=NORMAL_ITEM',
      merchantVerified: true,
      files: { goodsExportWorkbook: 'output/2026-06-18/商品总表_2026-06-18.xlsx' },
    });
  });

  it('omits undefined optional fields and empty notes', () => {
    const built = buildPublicTrafficArtifactManifest({
      runDate: '2026-06-18',
      capturedAt: '2026-06-18T01:02:03.000Z',
      stage: 'dashboard',
      sourceUrl: 'https://b.alipay.com/page/assistant-data-analysis/index/product/list',
      dataDate: undefined,
      freshness: undefined,
      notes: [],
      files: { '1d': 'output/2026-06-18/公域访问数据_1日.json' },
    });

    expect(built).not.toHaveProperty('dataDate');
    expect(built).not.toHaveProperty('freshness');
    expect(built).not.toHaveProperty('notes');
  });

  it('parses a valid manifest and rejects invalid stage values', () => {
    expect(parsePublicTrafficArtifactManifest(JSON.stringify(manifest({ stage: 'exposure', freshness: 'fresh' })))).toMatchObject({
      artifactVersion: 1,
      stage: 'exposure',
      freshness: 'fresh',
    });

    expect(() => parsePublicTrafficArtifactManifest(JSON.stringify({ ...manifest(), stage: 'report' }))).toThrow('Invalid public traffic artifact manifest');
  });

  it('round trips readable JSON and returns null for a missing manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-artifacts-'));
    const path = join(dir, 'artifacts', 'dashboard-manifest.json');
    try {
      await expect(loadPublicTrafficArtifactManifest(path)).resolves.toBeNull();
      await savePublicTrafficArtifactManifest(path, manifest());
      await expect(loadPublicTrafficArtifactManifest(path)).resolves.toEqual(manifest());
      await expect(readFile(path, 'utf8')).resolves.toContain('\n  "stage": "dashboard",\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
