import { describe, expect, it } from 'vitest';
import { buildLinkRegistryMaintenanceReport, isLinkRegistryMaintenanceIgnoredEntry } from '../src/linkRegistry/maintenance.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';

const entries: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'Canon SX70 HS',
    shortName: 'Canon SX70',
    sameSkuGroupId: 'canon-sx70',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'canon-sx',
    status: 'active',
    confidence: 0.95,
    source: ['product_id_mapping', 'link_registry_override'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'Wide300 单机身',
    shortName: 'Wide300',
    status: 'active',
    firstSeenDate: '2026-06-24',
    updatedAt: '2026-06-24',
    confidence: 0.42,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'Wide300 + 20张相纸',
    shortName: 'Wide300',
    sameSkuGroupId: 'instax-wide300',
    status: 'active',
    firstSeenDate: '2026-06-23',
    updatedAt: '2026-06-23',
    confidence: 0.48,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '704',
    productName: 'Canon legacy',
    shortName: 'Canon legacy',
    sameSkuGroupId: 'canon-legacy',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'canon-legacy',
    status: 'removed',
    updatedAt: '2026-05-01',
    confidence: 0.7,
    source: ['goods_link_lifecycle'],
  },
  {
    internalProductId: '705',
    platformProductId: 'platform-705',
    productName: 'Sony ZV-1',
    shortName: 'Sony ZV-1',
    sameSkuGroupId: 'sony-zv1',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'sony-zv',
    status: 'active',
    firstSeenDate: '2026-06-10',
    confidence: 0.88,
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '706',
    platformProductId: 'platform-706',
    productName: 'MQ 富图宝 FY820/830 专业三脚架短租 摄影摄像稳定器 面交',
    shortName: 'MQ 富图宝 FY820/830 三脚架',
    sameSkuGroupId: 'mq-tripod-offline',
    categoryId: 'accessory',
    categoryName: '配件',
    productType: 'tripod',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.9,
    source: ['goods_first_seen'],
  },
];

const overrideRisks: LinkRegistryOverrideRisk[] = [
  { type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' },
];

describe('link registry maintenance report', () => {
  it('builds coverage metrics and entry-level maintenance queue items', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.coverage.grouped).toMatchObject({ ready: 5, total: 6 });
    expect(report.coverage.classified).toMatchObject({ ready: 4, total: 6 });
    expect(report.coverage.mapped).toMatchObject({ ready: 5, total: 6 });
    expect(report.summary).toMatchObject({ totalEntries: 6, readyCount: 3 });

    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'entry',
        internalProductId: '702',
        reasonCodes: expect.arrayContaining(['same_sku_group_missing', 'recent_new_link']),
        reasonLabels: expect.arrayContaining(['缺同款组', '近7天新链接']),
      }),
      expect.objectContaining({
        kind: 'entry',
        internalProductId: '703',
        reasonCodes: expect.arrayContaining(['classification_missing', 'recent_new_link']),
      }),
      expect.objectContaining({
        kind: 'entry',
        internalProductId: '704',
        reasonCodes: expect.arrayContaining(['platform_mapping_missing']),
      }),
    ]));
  });

  it('exports readable chinese labels for maintenance reasons', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'same_sku_group',
        reasonLabels: ['同款组样本不足'],
      }),
      expect.objectContaining({
        kind: 'override_risk',
        reasonLabels: ['人工覆盖风险'],
      }),
    ]));
  });

  it('prioritizes recent active items and group-level sample issues ahead of old removed links', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.queue[0]).toMatchObject({
      kind: 'entry',
      internalProductId: '702',
      priority: 'p0',
    });
    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'same_sku_group',
        sameSkuGroupId: 'sony-zv1',
        reasonCodes: expect.arrayContaining(['same_sku_group_sample_insufficient']),
      }),
      expect.objectContaining({
        kind: 'override_risk',
        priority: 'p1',
        reasonCodes: ['override_risk'],
      }),
    ]));
  });

  it('ignores MQ offline links in maintenance queues while keeping them in the registry', () => {
    expect(isLinkRegistryMaintenanceIgnoredEntry(entries[5]!)).toBe(true);

    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.summary.totalEntries).toBe(6);
    expect(report.queue.some((item) => item.internalProductId === '706')).toBe(false);
    expect(report.queue.some((item) => item.sameSkuGroupId === 'mq-tripod-offline')).toBe(false);
  });
});
