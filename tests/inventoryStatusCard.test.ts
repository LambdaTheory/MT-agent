import { describe, expect, it } from 'vitest';
import {
  buildInventoryStatusDetailCard,
  buildInventoryStatusOverviewCard,
  formatInventoryStatusAmbiguousText,
  formatInventoryStatusMissingText,
} from '../src/feishuBot/inventoryStatusCard.js';
import type {
  InventoryStatusAmbiguousResult,
  InventoryStatusDetailResult,
  InventoryStatusOverviewResult,
} from '../src/inventoryStatus/query.js';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';

const snapshot: InventoryStatusSnapshot = {
  schemaVersion: 1,
  generationId: 'generation-card-test',
  date: '2026-06-24',
  sourceReportDate: '2026-06-23',
  generatedAt: '2026-06-24T00:00:00.000Z',
  warnings: [],
  summary: {
    sameSkuGroupCount: 2,
    activeLinkCount: 3,
    totalLinkCount: 4,
  },
  coverage: {
    groupedLinkCount: 4,
    ungroupedLinkCount: 0,
    groupsWithMetrics: 2,
    groupsWithoutMetrics: 0,
  },
  registryAuditSummary: {
    totalLinks: 4,
    onSaleLinks: 2,
    delistedLinks: 1,
    goneLinks: 1,
    unknownLinks: 0,
    overrideRiskCount: 1,
  },
  groups: [
    {
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 2,
      totalLinkCount: 3,
      mappedRowCount: 2,
      missingMetricLinkCount: 1,
      periods: {
        '1d': {
          exposure: 300,
          publicVisits: 30,
          amount: 120,
          createdOrders: 3,
          signedOrders: 3,
          reviewedOrders: 3,
          shippedOrders: 2,
          createdOrderAmount: 140,
          signedOrderAmount: 125,
          reviewedOrderAmount: 120,
          shippedOrderAmount: 110,
          exposureVisitRate: 0.1,
          visitCreatedOrderRate: 0.1,
          visitShipmentRate: 2 / 30,
        },
        '7d': {
          exposure: 2100,
          publicVisits: 210,
          amount: 980,
          createdOrders: 12,
          signedOrders: 10,
          reviewedOrders: 10,
          shippedOrders: 8,
          createdOrderAmount: 1180,
          signedOrderAmount: 1080,
          reviewedOrderAmount: 980,
          shippedOrderAmount: 930,
          exposureVisitRate: 0.1,
          visitCreatedOrderRate: 12 / 210,
          visitShipmentRate: 8 / 210,
        },
        '30d': {
          exposure: 9000,
          publicVisits: 720,
          amount: 3600,
          createdOrders: 35,
          signedOrders: 32,
          reviewedOrders: 30,
          shippedOrders: 28,
          createdOrderAmount: 3900,
          signedOrderAmount: 3720,
          reviewedOrderAmount: 3600,
          shippedOrderAmount: 3450,
          exposureVisitRate: 0.08,
          visitCreatedOrderRate: 35 / 720,
          visitShipmentRate: 28 / 720,
        },
      },
      topLinks: [
        {
          internalProductId: '701',
          platformProductId: 'p701',
          productName: 'DJI Pocket 3 创作者套装',
          shortName: 'Pocket 3',
          listingState: 'on_sale',
          oneDayExposure: 200,
          oneDayPublicVisits: 20,
          oneDayAmount: 80,
        },
      ],
      risks: ['组内 1 条链接无日报数据'],
    },
    {
      sameSkuGroupId: 'canon-sx70',
      groupName: 'Canon SX70',
      activeLinkCount: 1,
      totalLinkCount: 1,
      mappedRowCount: 1,
      missingMetricLinkCount: 0,
      periods: {
        '1d': {
          exposure: 50,
          publicVisits: 5,
          amount: 40,
          createdOrders: 1,
          signedOrders: 1,
          reviewedOrders: 1,
          shippedOrders: 1,
          createdOrderAmount: 40,
          signedOrderAmount: 40,
          reviewedOrderAmount: 40,
          shippedOrderAmount: 40,
          exposureVisitRate: 0.1,
          visitCreatedOrderRate: 0.2,
          visitShipmentRate: 0.2,
        },
        '7d': {
          exposure: 200,
          publicVisits: 22,
          amount: 160,
          createdOrders: 3,
          signedOrders: 3,
          reviewedOrders: 3,
          shippedOrders: 2,
          createdOrderAmount: 180,
          signedOrderAmount: 170,
          reviewedOrderAmount: 160,
          shippedOrderAmount: 140,
          exposureVisitRate: 0.11,
          visitCreatedOrderRate: 3 / 22,
          visitShipmentRate: 2 / 22,
        },
        '30d': {
          exposure: 1000,
          publicVisits: 90,
          amount: 720,
          createdOrders: 9,
          signedOrders: 9,
          reviewedOrders: 8,
          shippedOrders: 7,
          createdOrderAmount: 820,
          signedOrderAmount: 780,
          reviewedOrderAmount: 720,
          shippedOrderAmount: 680,
          exposureVisitRate: 0.09,
          visitCreatedOrderRate: 0.1,
          visitShipmentRate: 7 / 90,
        },
      },
      topLinks: [],
      risks: [],
    },
  ],
};

describe('inventoryStatusCard', () => {
  it('builds an overview card focused on link archive maintenance state', () => {
    const result: InventoryStatusOverviewResult = { status: 'overview', snapshot };
    const card = buildInventoryStatusOverviewCard(result);
    const serialized = JSON.stringify(card);
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    const charts = elements.filter((element) => element.tag === 'chart');

    expect(serialized).toContain('库存情况');
    expect(serialized).toContain('链接维护概览');
    expect(serialized).toContain('已归组链接占比');
    expect(serialized).toContain('有数据同款组占比');
    expect(serialized).toContain('待核查同款组占比');
    expect(serialized).toContain('缺数据链接');
    expect(serialized).toContain('有数据同款组是什么意思');
    expect(serialized).toContain('Pocket 3');
    expect(serialized).toContain('链接不存在');
    expect(serialized).toContain('待确认链接');
    expect(serialized).toContain('覆盖规则风险 1');
    expect(serialized).not.toContain('未知状态链接');
    expect(serialized).not.toContain('7日总金额');
    expect(serialized).not.toContain('7日总访问');
    expect(serialized).not.toContain('active 占比');
    expect(charts).toHaveLength(1);
  });

  it('builds a detail card with Chinese metric labels and explanation', () => {
    const result: InventoryStatusDetailResult = {
      status: 'detail',
      query: 'pocket3',
      matchedBy: 'alias',
      sameSkuGroupId: 'dji-pocket-3',
      snapshot,
      group: snapshot.groups[0]!,
    };
    const card = buildInventoryStatusDetailCard(result);
    const serialized = JSON.stringify(card);

    expect(serialized).toContain('Pocket 3');
    expect(serialized).toContain('近7日金额占比');
    expect(serialized).toContain('近7日访问占比');
    expect(serialized).toContain('缺数据链接');
    expect(serialized).toContain('这些指标反映的是同款组经营快照');
    expect(serialized).toContain('主力链接');
  });

  it('renders missing metrics as dashes without turning true zero into missing data', () => {
    const baseGroup = snapshot.groups[0]!;
    const group = {
      ...baseGroup,
      periods: {
        ...baseGroup.periods,
        '1d': {
          ...baseGroup.periods['1d'],
          exposure: null,
          publicVisits: 0,
          amount: null,
          createdOrders: 0,
          shippedOrders: null,
          exposureVisitRate: null,
          visitCreatedOrderRate: 0,
          visitShipmentRate: null,
        },
      },
      topLinks: baseGroup.topLinks.map((link) => ({
        ...link,
        oneDayPublicVisits: 0,
        oneDayAmount: null,
      })),
    };
    const result: InventoryStatusDetailResult = {
      status: 'detail',
      query: 'pocket3',
      matchedBy: 'alias',
      sameSkuGroupId: group.sameSkuGroupId,
      snapshot: { ...snapshot, groups: [group, snapshot.groups[1]!] },
      group,
    };

    const serialized = JSON.stringify(buildInventoryStatusDetailCard(result));

    expect(serialized).toContain('曝光 - | 访问 0 | 金额 -');
    expect(serialized).toContain('创建 0 | 发货 -');
    expect(serialized).toContain('1日金额 - | 访问 0');
    expect(serialized).not.toContain('null');
  });

  it('formats ambiguous and fallback text in Chinese', () => {
    const ambiguous: InventoryStatusAmbiguousResult = {
      status: 'ambiguous',
      query: 'ace pro',
      candidates: [
        { sameSkuGroupId: 'insta360-ace-pro', shortName: 'Ace Pro', internalProductIds: ['851'], reason: '命中别名 Ace Pro' },
        { sameSkuGroupId: 'insta360-ace-pro-2', shortName: 'Ace Pro 2', internalProductIds: ['841', '842'], reason: '命中别名 Ace pro 2' },
      ],
    };

    expect(formatInventoryStatusAmbiguousText(ambiguous)).toContain('需要你澄清');
    expect(formatInventoryStatusMissingText({ status: 'not_found', query: 'unknown' })).toContain('没有找到');
    expect(formatInventoryStatusMissingText({ status: 'snapshot_missing', reason: 'missing' })).toContain('还没有可用的库存情况快照');
  });
});
