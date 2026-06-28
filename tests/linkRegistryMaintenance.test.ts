import { describe, expect, it } from 'vitest';
import { buildLinkRegistryMaintenanceReport, isLinkRegistryMaintenanceIgnoredEntry } from '../src/linkRegistry/maintenance.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'Canon SX70 HS',
    shortName: 'Canon SX70',
    sameSkuGroupId: 'canon-sx70',
    categoryId: 'camera',
    categoryName: '\u76f8\u673a',
    productType: 'canon-sx',
    status: 'active',
    confidence: 0.95,
    source: ['product_id_mapping', 'link_registry_override'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'Wide300 \u5355\u673a\u8eab',
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
    productName: 'Wide300 + 20\u5f20\u76f8\u7eb8',
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
    categoryName: '\u76f8\u673a',
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
    categoryName: '\u76f8\u673a',
    productType: 'sony-zv',
    status: 'active',
    firstSeenDate: '2026-06-10',
    confidence: 0.88,
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '706',
    platformProductId: 'platform-706',
    productName: 'MQ \u4e09\u811a\u67b6\u7ebf\u4e0b\u81ea\u63d0',
    shortName: 'MQ FY820/830 \u4e09\u811a\u67b6',
    sameSkuGroupId: 'mq-tripod-offline',
    categoryId: 'accessory',
    categoryName: '\u914d\u4ef6',
    productType: 'tripod',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.9,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '707',
    productName: '\u95f2\u9c7c \u6240\u6709\u5546\u54c1\u514d\u62bc\u94fe\u63a5 WHY',
    shortName: '\u95f2\u9c7c \u6240\u6709\u5546\u54c1\u514d\u62bc\u94fe\u63a5 WHY',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.2,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '708',
    productName: 'YMH \u597d\u673a\u7b49\u4f60\u79df \u5546\u54c1\u514d\u62bc\u94fe\u63a5',
    shortName: 'YMH \u597d\u673a\u7b49\u4f60\u79df \u5546\u54c1\u514d\u62bc\u94fe\u63a5',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.2,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '709',
    productName: 'HYZ \u5973\u670b\u53cb\u5bb6 \u514d\u62bc\u94fe\u63a5',
    shortName: 'HYZ \u5973\u670b\u53cb\u5bb6 \u514d\u62bc\u94fe\u63a5',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.2,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '710',
    platformProductId: 'platform-710',
    productName: '\u4f73\u80fd IXUS 210',
    shortName: 'IXUS 210',
    sameSkuGroupId: 'canon-ixus-210',
    categoryId: 'camera',
    categoryName: '\u76f8\u673a',
    productType: 'camera',
    status: 'active',
    updatedAt: '2026-06-24',
    confidence: 0.8,
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '711',
    productName: 'Pocket 3 \u672a\u540c\u6b65\u65b0\u94fe',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '\u76f8\u673a',
    productType: 'gimbal-camera',
    status: 'active',
    firstSeenDate: '2026-06-24',
    updatedAt: '2026-06-24',
    daemonSyncStatus: '\u672a\u540c\u6b65',
    confidence: 0.56,
    source: ['daemon_catalog', 'goods_snapshot'],
  },
];

const overrideRisks: LinkRegistryOverrideRisk[] = [
  { type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' },
  { type: 'unknown_same_sku_group_id', message: 'Same sku group rule target not found: pocket-unknown', shortName: 'pocket-unknown' },
];

describe('link registry maintenance report', () => {
  it('builds coverage metrics and entry-level maintenance queue items', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.coverage.grouped).toMatchObject({ ready: 7, total: 11 });
    expect(report.coverage.classified).toMatchObject({ ready: 6, total: 11 });
    expect(report.coverage.mapped).toMatchObject({ ready: 6, total: 11 });
    expect(report.summary).toMatchObject({ totalEntries: 11, readyCount: 4 });

    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'entry',
        internalProductId: '702',
        reasonCodes: expect.arrayContaining(['same_sku_group_missing', 'recent_new_link']),
        reasonLabels: expect.arrayContaining(['\u7f3a\u540c\u6b3e\u7ec4', '\u8fd17\u5929\u65b0\u94fe\u63a5']),
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
        reasonLabels: ['\u540c\u6b3e\u7ec4\u6837\u672c\u4e0d\u8db3'],
      }),
      expect.objectContaining({
        kind: 'override_risk',
        reasonLabels: ['\u4eba\u5de5\u8986\u76d6\u98ce\u9669'],
        internalProductId: '999',
      }),
    ]));
    expect(report.queue.some((item) => item.kind === 'override_risk' && item.shortName === 'pocket-unknown')).toBe(false);
    expect(report.queue.some((item) => item.kind === 'same_sku_group' && item.sameSkuGroupId === 'canon-ixus-210')).toBe(false);
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
    expect(isLinkRegistryMaintenanceIgnoredEntry(entries[6]!)).toBe(true);
    expect(isLinkRegistryMaintenanceIgnoredEntry(entries[7]!)).toBe(true);
    expect(isLinkRegistryMaintenanceIgnoredEntry(entries[8]!)).toBe(true);

    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.summary.totalEntries).toBe(11);
    expect(report.queue.some((item) => item.internalProductId === '706')).toBe(false);
    expect(report.queue.some((item) => item.sameSkuGroupId === 'mq-tripod-offline')).toBe(false);
    expect(report.queue.some((item) => item.internalProductId === '707')).toBe(false);
    expect(report.queue.some((item) => item.internalProductId === '708')).toBe(false);
    expect(report.queue.some((item) => item.internalProductId === '709')).toBe(false);
  });

  it('does not treat daemon unsynced links without platform mapping as manual maintenance gaps', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.queue.some((item) => item.internalProductId === '711')).toBe(false);
  });
});
