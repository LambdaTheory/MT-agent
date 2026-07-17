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
    ]));
    expect(report.queue.some((item) => item.internalProductId === '704')).toBe(false);
  });

  it('exports readable chinese labels for maintenance reasons', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'override_risk',
        reasonLabels: ['\u4eba\u5de5\u8986\u76d6\u98ce\u9669'],
        internalProductId: '999',
      }),
    ]));
    expect(report.queue.some((item) => item.kind === 'override_risk' && item.shortName === 'pocket-unknown')).toBe(false);
    expect(report.queue.some((item) => item.kind === 'same_sku_group' && item.sameSkuGroupId === 'canon-ixus-210')).toBe(false);
    expect(report.queue.some((item) => item.reasonCodes.includes('same_sku_group_sample_insufficient'))).toBe(false);
  });

  it('prioritizes recent active items and override risks ahead of old removed links', () => {
    const report = buildLinkRegistryMaintenanceReport(entries, overrideRisks, { recentWindowDays: 7, referenceDate: '2026-06-24' });

    expect(report.queue[0]).toMatchObject({
      kind: 'entry',
      internalProductId: '702',
      priority: 'p0',
    });
    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'override_risk',
        priority: 'p1',
        reasonCodes: ['override_risk'],
      }),
    ]));
    expect(report.queue.some((item) => item.internalProductId === '704')).toBe(false);
  });

  it('auto-cleans low-value sample-only and historical items from human review', () => {
    const lowValueEntries: LinkRegistryEntry[] = Array.from({ length: 30 }, (_, index) => ({
      internalProductId: String(2000 + index),
      productName: `Removed historical link ${index}`,
      shortName: `History ${index}`,
      sameSkuGroupId: `sample-only-${index}`,
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'camera',
      status: 'removed',
      source: ['goods_link_lifecycle'],
    }));
    const report = buildLinkRegistryMaintenanceReport([
      ...lowValueEntries,
      {
        internalProductId: '3001',
        productName: 'Active missing mapping',
        shortName: 'Active gap',
        sameSkuGroupId: 'active-gap',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'camera',
        status: 'active',
        source: ['goods_snapshot'],
      },
      {
        internalProductId: '3002',
        platformProductId: 'platform-3002',
        productName: 'Phone member',
        shortName: 'Mixed group',
        sameSkuGroupId: 'mixed-high-value',
        categoryId: 'phone',
        categoryName: '手机',
        productType: 'smartphone',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '3003',
        platformProductId: 'platform-3003',
        productName: 'Lens member',
        shortName: 'Mixed group lens',
        sameSkuGroupId: 'mixed-high-value',
        categoryId: 'lens',
        categoryName: '镜头',
        productType: 'lens-accessory',
        status: 'active',
        source: ['product_id_mapping'],
      },
    ], [], { referenceDate: '2026-06-24' });

    expect(report.queue).toHaveLength(2);
    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'entry', internalProductId: '3001', reasonCodes: ['platform_mapping_missing'] }),
      expect.objectContaining({ kind: 'same_sku_group', sameSkuGroupId: 'mixed-high-value', reasonCodes: ['mixed_product_type'] }),
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

  it('queues group-level governance issues for mixed productType, leaked promo slug, and missing classification', () => {
    const leakedGroupId = 'fujifilm-instax-mini90一次成像-婚礼聚会旅游立即出片-相纸可选';
    const report = buildLinkRegistryMaintenanceReport([
      {
        internalProductId: '801',
        platformProductId: 'platform-801',
        productName: 'Canon R50',
        shortName: 'Canon R50',
        sameSkuGroupId: 'canon-eos-r50',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'camera',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '802',
        platformProductId: 'platform-802',
        productName: 'Canon R50 Kit',
        shortName: 'Canon R50 Kit',
        sameSkuGroupId: 'canon-eos-r50',
        categoryId: 'accessory',
        categoryName: '配件',
        productType: 'lens-accessory',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '901',
        platformProductId: 'platform-901',
        productName: 'Mini 90 一次成像',
        shortName: 'Mini 90',
        sameSkuGroupId: leakedGroupId,
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'instant-camera',
        status: 'active',
        source: ['goods_first_seen'],
      },
      {
        internalProductId: '1001',
        platformProductId: 'platform-1001',
        productName: 'vivo X300 Pro',
        shortName: 'X300 Pro',
        sameSkuGroupId: 'vivo-x300-pro',
        status: 'active',
        source: ['goods_first_seen'],
      },
    ]);

    expect(report.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'same_sku_group',
        sameSkuGroupId: 'canon-eos-r50',
        reasonCodes: expect.arrayContaining(['mixed_product_type']),
      }),
      expect.objectContaining({
        kind: 'same_sku_group',
        sameSkuGroupId: leakedGroupId,
        reasonCodes: expect.arrayContaining(['promo_title_slug_leak']),
      }),
      expect.objectContaining({
        kind: 'same_sku_group',
        sameSkuGroupId: 'vivo-x300-pro',
        reasonCodes: expect.arrayContaining(['group_classification_missing']),
      }),
    ]));
  });

  it('does not inherit governance risks from entries ignored by maintenance filtering', () => {
    const report = buildLinkRegistryMaintenanceReport([
      {
        internalProductId: '1101',
        platformProductId: 'platform-1101',
        productName: 'MQ Canon R50 线下自提',
        shortName: 'MQ Canon R50',
        sameSkuGroupId: 'canon-r50-governance-mixed',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'camera',
        status: 'active',
        source: ['goods_first_seen'],
      },
      {
        internalProductId: '1102',
        platformProductId: 'platform-1102',
        productName: 'Canon R50 正常商品',
        shortName: 'Canon R50',
        sameSkuGroupId: 'canon-r50-governance-mixed',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'camera',
        status: 'active',
        source: ['goods_first_seen'],
      },
      {
        internalProductId: '1201',
        platformProductId: 'platform-1201',
        productName: 'MQ Split Class 线下自提',
        shortName: 'MQ Split Class',
        sameSkuGroupId: 'split-classification-visible-gap',
        categoryId: 'camera',
        categoryName: '相机',
        status: 'active',
        source: ['goods_first_seen'],
      },
      {
        internalProductId: '1202',
        platformProductId: 'platform-1202',
        productName: 'Visible Split Class',
        shortName: 'Visible Split Class',
        sameSkuGroupId: 'split-classification-visible-gap',
        productType: 'mirrorless-camera',
        status: 'active',
        source: ['goods_first_seen'],
      },
    ]);

    expect(report.queue.some((item) => item.kind === 'same_sku_group' && item.sameSkuGroupId === 'canon-r50-governance-mixed' && item.reasonCodes.includes('mixed_product_type'))).toBe(false);
    expect(report.queue.some((item) => item.kind === 'same_sku_group' && item.sameSkuGroupId === 'split-classification-visible-gap' && item.reasonCodes.includes('group_classification_missing'))).toBe(true);
  });
});
