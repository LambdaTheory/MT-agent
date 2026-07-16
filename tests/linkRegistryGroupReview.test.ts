import { describe, expect, it } from 'vitest';
import {
  buildLinkRegistryGroupReviewReport,
  renderLinkRegistryGroupReviewApprovalCsv,
  renderLinkRegistryGroupReviewApprovalGuide,
  renderLinkRegistryGroupReviewMarkdown,
} from '../src/linkRegistry/groupReview.js';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'p701',
    productName: 'DJI Pocket 3 标准版',
    shortName: 'Pocket 3',
    aliases: ['Pocket3'],
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '702',
    platformProductId: 'p702',
    productName: 'DJI Pocket 3 创作者套装',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '801',
    platformProductId: 'p801',
    productName: 'DJI Pocket 3 海外版',
    shortName: 'Pocket3',
    sameSkuGroupId: 'dji-pocket-3-global',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '901',
    platformProductId: 'p901',
    productName: 'vivo X200 Ultra 演唱会神器',
    sameSkuGroupId: 'vivo-x200-ultra',
    status: 'active',
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '999',
    platformProductId: 'p999',
    productName: '未归组商品',
    status: 'unknown',
    source: ['goods_first_seen'],
  },
];

const snapshot: InventoryStatusSnapshot = {
  schemaVersion: 1,
  generationId: 'link-registry-group-review-2026-06-26',
  date: '2026-06-26',
  sourceReportDate: '2026-06-25',
  generatedAt: '2026-06-26T00:00:00.000Z',
  warnings: [],
  summary: {
    sameSkuGroupCount: 3,
    activeLinkCount: 4,
    totalLinkCount: 5,
  },
  coverage: {
    groupedLinkCount: 4,
    ungroupedLinkCount: 1,
    groupsWithMetrics: 2,
    groupsWithoutMetrics: 1,
  },
  registryAuditSummary: {
    totalLinks: 5,
    onSaleLinks: 4,
    delistedLinks: 0,
    goneLinks: 0,
    unknownLinks: 1,
    overrideRiskCount: 0,
  },
  groups: [
    {
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 2,
      totalLinkCount: 2,
      mappedRowCount: 2,
      missingMetricLinkCount: 0,
      periods: { '1d': metric(), '7d': metric(), '30d': metric() },
      topLinks: [],
      risks: [],
    },
    {
      sameSkuGroupId: 'dji-pocket-3-global',
      groupName: 'Pocket3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 1,
      totalLinkCount: 1,
      mappedRowCount: 1,
      missingMetricLinkCount: 0,
      periods: { '1d': metric(), '7d': metric(), '30d': metric() },
      topLinks: [],
      risks: ['仅 1 条 active 链接'],
    },
    {
      sameSkuGroupId: 'vivo-x200-ultra',
      groupName: 'vivo-x200-ultra',
      activeLinkCount: 1,
      totalLinkCount: 1,
      mappedRowCount: 0,
      missingMetricLinkCount: 1,
      periods: { '1d': metric(), '7d': metric(), '30d': metric() },
      topLinks: [],
      risks: ['组内 1 条链接无日报数据'],
    },
  ],
};

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

describe('linkRegistryGroupReview', () => {
  it('builds naming review and duplicate-name sections', () => {
    const report = buildLinkRegistryGroupReviewReport({
      entries,
      sameSkuGroupAliasRules: [{ sameSkuGroupId: 'dji-pocket-3', aliases: ['口袋3', 'pocket 3'] }],
      snapshot,
      generatedAt: '2026-06-26T10:00:00.000Z',
    });

    expect(report.summary.totalGroups).toBe(3);
    expect(report.summary.machineNamedGroups).toBe(1);
    expect(report.summary.duplicateNameBuckets).toBe(1);
    expect(report.summary.ungroupedEntries).toBe(1);
    expect(report.namingReviewGroups.map((item) => item.sameSkuGroupId)).toContain('vivo-x200-ultra');
    expect(report.duplicateNameGroups[0]?.groups.map((item) => item.sameSkuGroupId)).toEqual(['dji-pocket-3', 'dji-pocket-3-global']);
    expect(report.groups.find((item) => item.sameSkuGroupId === 'dji-pocket-3')?.aliases).toEqual(expect.arrayContaining(['Pocket3', 'Pocket 3', 'pocket 3', '口袋3']));
  });

  it('falls back to snapshot groups when registry groups are missing', () => {
    const report = buildLinkRegistryGroupReviewReport({
      entries: entries.map((entry) => ({ ...entry, sameSkuGroupId: undefined })),
      snapshot,
      generatedAt: '2026-06-26T10:00:00.000Z',
    });

    expect(report.summary.totalGroups).toBe(3);
    expect(report.registryBacked).toBe(false);
    expect(report.summary.ungroupedEntries).toBe(1);
    expect(report.groups.map((item) => item.sameSkuGroupId).sort()).toEqual(['vivo-x200-ultra', 'dji-pocket-3-global', 'dji-pocket-3'].sort());
  });

  it('does not associate sameSkuGroupId by overlap when exact sameSkuGroupId is missing', () => {
    const report = buildLinkRegistryGroupReviewReport({
      entries: [
        {
          internalProductId: '1901',
          platformProductId: 'p1901',
          productName: 'Registry Group 1901',
          shortName: 'Registry1901',
          sameSkuGroupId: 'registry-group-1901',
          categoryId: 'camera',
          categoryName: '相机',
          productType: 'gimbal-camera',
          status: 'active',
          source: ['goods_first_seen'],
        },
      ],
      snapshot: {
        schemaVersion: 1,
        generationId: 'link-registry-group-review-overlap-2026-06-26',
        date: '2026-06-26',
        sourceReportDate: '2026-06-25',
        generatedAt: '2026-06-26T00:00:00.000Z',
        warnings: [],
        summary: {
          sameSkuGroupCount: 1,
          activeLinkCount: 2,
          totalLinkCount: 2,
        },
        coverage: {
          groupedLinkCount: 2,
          ungroupedLinkCount: 0,
          groupsWithMetrics: 1,
          groupsWithoutMetrics: 0,
        },
        registryAuditSummary: {
          totalLinks: 2,
          onSaleLinks: 2,
          delistedLinks: 0,
          goneLinks: 0,
          unknownLinks: 0,
          overrideRiskCount: 0,
        },
        groups: [
          {
            sameSkuGroupId: 'snapshot-group-1901',
            groupName: 'Snapshot 1901',
            categoryId: 'snapshot-category',
            categoryName: 'not-a-real-category',
            productType: 'snapshot-type',
            activeLinkCount: 3,
            totalLinkCount: 4,
            mappedRowCount: 7,
            missingMetricLinkCount: 3,
            periods: {
              '1d': metric(),
              '7d': metric(),
              '30d': metric(),
            },
            topLinks: [
              {
                internalProductId: '1901',
                platformProductId: 'px-1901',
                productName: 'Snapshot 1901 Link',
                shortName: 'Snapshot1901',
                listingState: 'on_sale',
                oneDayExposure: 1,
                oneDayPublicVisits: 1,
                oneDayAmount: 1,
              },
            ],
            risks: ['only-from-overlap-group'],
          },
        ],
      },
      generatedAt: '2026-06-26T10:00:00.000Z',
    });

    expect(report.registryBacked).toBe(true);
    const registryGroup = report.groups.find((item) => item.sameSkuGroupId === 'registry-group-1901');

    expect(registryGroup).toBeTruthy();
    expect(registryGroup?.displayName).toBe('Registry1901');
    expect(registryGroup?.categoryName).toBe('相机');
    expect(registryGroup?.productType).toBe('gimbal-camera');
    expect(registryGroup?.activeLinkCount).toBe(1);
    expect(registryGroup?.totalLinkCount).toBe(1);
    expect(registryGroup?.mappedRowCount).toBe(0);
    expect(registryGroup?.missingMetricLinkCount).toBe(0);
    expect(registryGroup?.risks).toEqual(expect.not.arrayContaining(['only-from-overlap-group']));
  });

  it('renders a readable markdown review sheet', () => {
    const report = buildLinkRegistryGroupReviewReport({ entries, snapshot, generatedAt: '2026-06-26T10:00:00.000Z' });
    const markdown = renderLinkRegistryGroupReviewMarkdown(report);
    expect(markdown).toContain('# 商品组审核单');
    expect(markdown).toContain('## 2. 同名组');
    expect(markdown).toContain('vivo-x200-ultra');
    expect(markdown).toContain('未归组商品');
  });

  it('renders approval artifacts for manual review', () => {
    const report = buildLinkRegistryGroupReviewReport({ entries, snapshot, generatedAt: '2026-06-26T10:00:00.000Z' });
    const csv = renderLinkRegistryGroupReviewApprovalCsv(report);
    const guide = renderLinkRegistryGroupReviewApprovalGuide(report);
    expect(csv).toContain('suggestedShortName');
    expect(csv).toContain('Pocket 3');
    expect(csv).toContain('X200 Ultra');
    expect(guide).toContain('# 商品组审批说明');
    expect(guide).toContain('已审核完，请读取审批清单');
  });

  it('surfaces promo-title slug leaks and missing group classification in group review risks', () => {
    const leakedGroupId = 'fujifilm-instax-mini90一次成像-婚礼聚会旅游立即出片-相纸可选';
    const report = buildLinkRegistryGroupReviewReport({
      entries: [
        {
          internalProductId: '1001',
          platformProductId: 'p1001',
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
          internalProductId: '1002',
          platformProductId: 'p1002',
          productName: 'vivo X300 Pro',
          shortName: 'X300 Pro',
          sameSkuGroupId: 'vivo-x300-pro',
          status: 'active',
          source: ['goods_first_seen'],
        },
      ],
      generatedAt: '2026-06-26T10:00:00.000Z',
    });

    expect(report.groups.find((item) => item.sameSkuGroupId === leakedGroupId)?.risks).toEqual(expect.arrayContaining([
      expect.stringContaining(leakedGroupId),
    ]));
    expect(report.groups.find((item) => item.sameSkuGroupId === 'vivo-x300-pro')?.risks).toEqual(expect.arrayContaining([
      expect.stringContaining('missing group-level classification'),
    ]));
  });
});
