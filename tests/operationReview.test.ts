import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { buildOperationReview } from '../src/operations/operationReview.js';
import { buildOperationReviewCard, formatOperationReviewText } from '../src/feishuBot/operationReviewCard.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

let outputDir = '';

async function freshOutputDir(): Promise<string> {
  outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-operation-review-'));
  return outputDir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function writeObservationStore(dir: string): Promise<void> {
  await writeJson(join(dir, 'latest', 'operation-observations.json'), {
    version: 1,
    observations: [
      {
        observationId: 'opobs_price_change_841_task',
        operationType: 'price_change',
        status: 'observing',
        createdAt: '2026-07-19T00:00:00.000Z',
        observeUntil: '2026-08-02T00:00:00.000Z',
        source: { toolName: 'rental.priceApply', taskId: 'task_841' },
        subjects: [{ role: 'price_changed_product', productId: '841' }],
        metricsToWatch: ['visits', 'orders', 'amount'],
      },
      {
        observationId: 'opobs_price_change_842_task',
        operationType: 'price_change',
        status: 'observing',
        createdAt: '2026-07-19T00:00:00.000Z',
        observeUntil: '2026-08-02T00:00:00.000Z',
        source: { toolName: 'rental.priceApply', taskId: 'task_842' },
        subjects: [{ role: 'price_changed_product', productId: '842' }],
        metricsToWatch: ['visits', 'orders', 'amount'],
      },
      {
        observationId: 'opobs_price_change_843_task',
        operationType: 'price_change',
        status: 'observing',
        createdAt: '2026-07-19T00:00:00.000Z',
        observeUntil: '2026-08-02T00:00:00.000Z',
        source: { toolName: 'rental.priceApply', taskId: 'task_843' },
        subjects: [{ role: 'price_changed_product', productId: '843' }],
        metricsToWatch: ['visits', 'orders', 'amount'],
      },
      {
        observationId: 'opobs_price_change_844_task',
        operationType: 'price_change',
        status: 'observing',
        createdAt: '2026-07-19T00:00:00.000Z',
        observeUntil: '2026-08-02T00:00:00.000Z',
        source: { toolName: 'rental.priceApply', taskId: 'task_844' },
        subjects: [{ role: 'price_changed_product', productId: '844' }],
        metricsToWatch: ['visits', 'orders', 'amount'],
      },
    ],
  });
}

function metric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

function row(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  const seven = metric(overrides);
  return {
    productName: `测试商品 ${id}`,
    platformProductId: `p-${id}`,
    displayProductId: `端内ID ${id}`,
    custodyDays: 10,
    periods: { '1d': metric(), '7d': seven, '30d': seven },
  };
}

async function writeLatestReportContext(dir: string): Promise<void> {
  await writeJson(join(dir, '2026-07-20', 'report-context.json'), {
    generationId: 'test-generation',
    date: '2026-07-20',
    summary: { '1d': {}, '7d': {}, '30d': {} },
    conclusions: [],
    rows: [
      row('841', { amount: 99, createdOrders: 1 }),
      row('842', { exposure: 100, publicVisits: 10 }),
      row('843', {}),
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
  });
}

async function writePartialInactiveRefreshAudit(dir: string): Promise<string> {
  const auditPath = join(dir, 'latest', 'inactive-refresh-audits', 'inactive_refresh_1784465103486_c04ee610b8738e8b.json');
  await writeJson(auditPath, {
    plan: {
      date: '2026-07-19',
      delistProductIds: ['253', '507'],
      newLinkItems: [{ count: 2, sourceProductId: '840', sourceProductName: 'R50 source', keyword: 'R50' }],
    },
    copyResults: [
      { productId: '840', ok: true, status: 'ok', newProductId: '1049' },
      { productId: '840', ok: true, status: 'ok', newProductId: '1050' },
    ],
    delistResults: [
      { productId: '253', ok: false, status: 'error', message: '租赁套餐自定义租期不允许修改', lines: ['delist: error', '租赁套餐自定义租期不允许修改'] },
    ],
    ok: false,
  });
  return auditPath;
}

describe('operation review', () => {
  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    outputDir = '';
  });

  it('summarizes observations and surfaces copied inactive-refresh links missing from operation observations', async () => {
    const dir = await freshOutputDir();
    await writeObservationStore(dir);
    await writeLatestReportContext(dir);
    const auditPath = await writePartialInactiveRefreshAudit(dir);

    const review = await buildOperationReview(dir, new Date('2026-07-20T00:00:00.000Z'));

    expect(review.observations).toMatchObject({ total: 4, observing: 4, expiredObserving: 0 });
    expect(review.observations.byType.price_change).toBe(4);
    expect(review.observations.byType.inactive_refresh).toBe(0);
    expect(review.observations.outcomeMetricDate).toBe('2026-07-20');
    expect(review.observations.outcomeMetricPeriod).toBe('7d');
    expect(review.observations.outcomeHealth).toEqual({ positive: 1, neutral: 1, negative: 1, insufficient_data: 1 });
    expect(review.inactiveRefreshAuditGaps).toHaveLength(1);
    expect(review.inactiveRefreshAuditGaps[0]).toMatchObject({
      auditPath,
      date: '2026-07-19',
      copiedNewProductIds: ['1049', '1050'],
      missingObservationNewProductIds: ['1049', '1050'],
      plannedDelistProductIds: ['253', '507'],
      attemptedDelistProductIds: ['253'],
      failedDelistProductIds: ['253'],
      firstFailureReason: '租赁套餐自定义租期不允许修改',
    });
  });

  it('builds a bounded read-only Feishu card for operation review gaps', async () => {
    const dir = await freshOutputDir();
    await writeObservationStore(dir);
    await writeLatestReportContext(dir);
    await writePartialInactiveRefreshAudit(dir);
    const review = await buildOperationReview(dir, new Date('2026-07-20T00:00:00.000Z'));

    const card = buildOperationReviewCard(review);
    const text = formatOperationReviewText(review);
    const serialized = JSON.stringify(card);

    expect(card.schema).toBe('2.0');
    expect(serialized).toContain('运营操作复盘');
    expect(serialized).toContain('operation_review_observation_type_chart');
    expect(serialized).toContain('operation_review_outcome_health_chart');
    expect(serialized).toContain('operation_review_inactive_refresh_gap_chart');
    expect(serialized).toContain('观察类型分布');
    expect(serialized).toContain('表现健康度');
    expect(serialized).toContain('表现好');
    expect(serialized).toContain('有效曝光');
    expect(serialized).toContain('未达标');
    expect(serialized).toContain('数据不足');
    expect(serialized).toContain('失活刷新补链观察覆盖');
    expect(serialized.match(/"tag":"chart"/g)).toHaveLength(3);
    expect(serialized).toContain('1049、1050');
    expect(serialized).toContain('租赁套餐自定义租期不允许修改');
    expect(serialized).not.toContain('callback');
    expect(text).toContain('表现健康度：表现好 1 条，有效曝光 1 条，未达标 1 条，数据不足 1 条');
    expect(text).toContain('失活刷新补链观察缺口：2 条');
  });

  it('registers operation review as a read-only tool and direct bot command', async () => {
    const dir = await freshOutputDir();
    await writeObservationStore(dir);
    await writeLatestReportContext(dir);
    await writePartialInactiveRefreshAudit(dir);

    expect(findAgentTool('operations.operationReview')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(parseBotIntent('操作回顾')).toEqual({ type: 'operation_review' });

    const response = await handleBotIntent({ type: 'operation_review' }, dir);
    expect(response.card).toBeDefined();
    expect(response.text).toContain('失活刷新补链观察缺口：2 条');
    expect(response.metadata).toMatchObject({
      toolName: 'operations.operationReview',
      ok: true,
      observationCount: 4,
      inactiveRefreshAuditGapCount: 1,
      missingObservationNewProductIds: ['1049', '1050'],
    });
  });
});
