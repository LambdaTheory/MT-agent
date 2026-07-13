import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregateWindowProducts } from '../src/agentData/windowAggregate.js';
import { evaluateMetricThresholdStrategy } from '../src/agentData/metricThresholdStrategy.js';
import { getPublicTrafficMetric, publicTrafficMetricKeys, type PublicTrafficMetricKey } from '../src/agentData/publicTrafficMetricCatalog.js';
import { queryPublicTrafficWindow } from '../src/agentData/windowQuery.js';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

const baseMetric: PublicTrafficPeriodMetrics = {
  exposure: 10,
  publicVisits: 0,
  dashboardVisits: 1,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 1,
  exposureVisitRate: 0,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

type DayMetric = Partial<PublicTrafficPeriodMetrics> & { signedOrderAmount?: number };

const registry: LinkRegistryEntry[] = [
  { internalProductId: '101', platformProductId: 'p101', productName: '曝光访问为零', sameSkuGroupId: 'matrix', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '102', platformProductId: 'p102', productName: '访问页缺失', sameSkuGroupId: 'matrix', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '103', platformProductId: 'p103', productName: '签约金额缺列', sameSkuGroupId: 'matrix', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '104', platformProductId: 'p104', productName: '分母为零', sameSkuGroupId: 'matrix', status: 'active', source: ['link_registry_override'] },
];

const registryById = new Map(registry.map((entry) => [entry.internalProductId, entry]));

function registrySubset(...ids: string[]): LinkRegistryEntry[] {
  return ids.map((id) => registryById.get(id)).filter((entry): entry is LinkRegistryEntry => entry !== undefined);
}

async function writeDay(root: string, date: string, rows: Array<{ id: string; metric: DayMetric }>): Promise<void> {
  const dir = join(root, date);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `公域数据上下文_${date}.json`), JSON.stringify({
    date,
    summary: {},
    conclusions: [],
    dataQualityNotes: [],
    rows: rows.map((row) => ({
      productName: registry.find((entry) => entry.internalProductId === row.id)?.productName ?? row.id,
      platformProductId: `p${row.id}`,
      displayProductId: `端内ID ${row.id}`,
      custodyDays: 30,
      periods: {
        '1d': {
          ...baseMetric,
          ...row.metric,
        },
      },
    })),
  }), 'utf8');
}

function metadataProperties(toolName: string): Record<string, unknown> {
  const schema = findAgentTool(toolName)?.resultMetadataSchema;
  expect(schema).toMatchObject({ properties: expect.any(Object) });
  const properties = schema && typeof schema === 'object' && !Array.isArray(schema) && 'properties' in schema ? schema.properties : undefined;
  expect(properties && typeof properties === 'object' && !Array.isArray(properties)).toBe(true);
  return properties as Record<string, unknown>;
}

function expectStableMetricMetadata(toolName: string): void {
  expect(metadataProperties(toolName)).toMatchObject({
    metric: { type: 'string', enum: [...publicTrafficMetricKeys] },
    windowDays: { type: 'integer' },
    endDate: { type: 'string' },
    availability: { type: 'object' },
    productIds: { type: 'array', items: { type: 'string' } },
  });
}

describe('public traffic metric LLM capability matrix', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-llm-matrix-'));
    for (const date of ['2026-07-01', '2026-07-02']) {
      await writeDay(outputDir, date, [
        { id: '101', metric: { publicVisits: 0, dashboardVisits: Number.NaN, hasDashboardData: true } },
        { id: '102', metric: { publicVisits: 3, dashboardVisits: Number.NaN, createdOrders: 0, hasDashboardData: true } },
        { id: '103', metric: { publicVisits: 4, dashboardVisits: 5, signedOrders: 1 } },
        { id: '104', metric: { publicVisits: 5, dashboardVisits: 0, shippedOrders: 0 } },
      ]);
    }
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it.each(publicTrafficMetricKeys)('%s is represented by catalog, fixed query, and window query schemas', (metric) => {
    const definition = getPublicTrafficMetric(metric);
    expect(definition).toBeDefined();
    expect(definition?.label).toBeTruthy();
    expect(definition?.source).toBeTruthy();

    expect(findAgentTool('publicTraffic.reportQuery')?.inputSchema).toMatchObject({
      properties: {
        metrics: { items: { enum: expect.arrayContaining([metric]) } },
        filters: { items: { properties: { field: { enum: expect.arrayContaining([metric]) } } } },
        sortBy: { enum: expect.arrayContaining([metric]) },
      },
    });
    expect(findAgentTool('publicTraffic.windowQuery')?.inputSchema).toMatchObject({
      properties: {
        metrics: { items: { enum: expect.arrayContaining([metric]) } },
        filters: { items: { properties: { field: { enum: expect.arrayContaining([metric]) } } } },
        sortBy: { enum: expect.arrayContaining([metric]) },
      },
    });
  });

  it('keeps all executable delist metrics explicit and excludes rates/state metrics', () => {
    expect(getPublicTrafficMetric('publicVisits')?.executableDelistAllowed).toBe(true);
    expect(getPublicTrafficMetric('createdOrders')?.executableDelistAllowed).toBe(true);
    expect(getPublicTrafficMetric('visitShipmentRate')?.executableDelistAllowed).toBe(false);
    expect(getPublicTrafficMetric('custodyDays')?.executableDelistAllowed).toBe(false);
  });

  it('covers exposure, dashboard, optional dashboard, and derived metric availability for LLM planning', async () => {
    const publicVisits = await evaluateMetricThresholdStrategy(outputDir, registrySubset('101'), {
      metric: 'publicVisits', operator: 'eq', value: 0, date: '2026-07-02', windowDays: 2, requireActive: true,
    });
    expect(publicVisits.candidateProductIds).toEqual(['101']);
    expect(publicVisits.skipped.unavailableMetric).toBe(0);

    const createdOrders = await evaluateMetricThresholdStrategy(outputDir, registrySubset('102'), {
      metric: 'createdOrders', operator: 'eq', value: 0, date: '2026-07-02', windowDays: 2, requireActive: true,
    });
    expect(createdOrders.candidateProductIds).toEqual([]);
    expect(createdOrders.unavailableMetricProductIds).toEqual(['102']);

    const signedOrderAmount = await evaluateMetricThresholdStrategy(outputDir, registrySubset('103'), {
      metric: 'signedOrderAmount', operator: 'eq', value: 0, date: '2026-07-02', windowDays: 2, requireActive: true,
    });
    expect(signedOrderAmount.candidateProductIds).toEqual([]);
    expect(signedOrderAmount.unavailableMetricProductIds).toEqual(['103']);

    const visitShipmentRate = await evaluateMetricThresholdStrategy(outputDir, registrySubset('104'), {
      metric: 'visitShipmentRate', operator: 'lt', value: 0.05, date: '2026-07-02', windowDays: 2, requireActive: true,
    });
    expect(visitShipmentRate.candidateProductIds).toEqual([]);
    expect(visitShipmentRate.unavailableMetricProductIds).toEqual(['104']);
  });

  it('exposes only metrics and availability on window aggregates without legacy top-level numeric aliases', async () => {
    const [aggregate] = await aggregateWindowProducts({ outputDir, endDate: '2026-07-02', windowDays: 2 });
    expect(aggregate?.metrics.publicVisits).toBe(0);
    expect(aggregate?.availability.publicVisits).toMatchObject({ available: true, source: 'exposure' });
    for (const legacyField of ['exposure', 'publicVisits', 'dashboardVisits', 'createdOrders', 'shippedOrders', 'amount']) {
      expect(Object.hasOwn(aggregate ?? {}, legacyField)).toBe(false);
    }
  });

  it('declares stable metric metadata fields on planner-visible metric tools', () => {
    for (const toolName of [
      'publicTraffic.windowAggregate',
      'publicTraffic.windowQuery',
      'product.rankBestSameSku',
      'product.rankByCategory',
      'strategy.metricThresholdExplain',
      'strategy.refreshCandidateExplain',
      'operations.refreshActivityPlan',
    ]) {
      expectStableMetricMetadata(toolName);
    }
    expect(metadataProperties('strategy.refreshCandidateExplain')).toMatchObject({
      legacyArgumentAdapted: { type: 'boolean' },
    });
  });

  it('returns stable query metadata for public traffic window query results', async () => {
    const result = await queryPublicTrafficWindow(outputDir, {
      endDate: '2026-07-02',
      windowDays: 2,
      metrics: ['publicVisits'],
      filters: [{ field: 'publicVisits', operator: 'eq', value: 0 }],
    });
    expect(result).toMatchObject({ endDate: '2026-07-02', windowDays: 2, matchedCount: 1 });
    expect(result.items.map((item) => item.internalProductId)).toEqual(['101']);
  });
});
