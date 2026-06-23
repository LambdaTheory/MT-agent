import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOperationsLearningLoopPreviewCli } from '../src/cli/operationsLearningLoopPreview.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

function metric(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 100,
    publicVisits: 10,
    dashboardVisits: 8,
    createdOrders: 1,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 1,
    amount: 88,
    exposureVisitRate: 0.1,
    visitCreatedOrderRate: 0.1,
    visitShipmentRate: 0.1,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

const rows = Array.from({ length: 10 }, (_, index) => ({
  productName: `测试商品${index}`,
  platformProductId: `p${index}`,
  displayProductId: `端内ID ${700 + index}`,
  custodyDays: index,
  periods: { '1d': metric({ exposure: 100 + index }), '7d': metric({ publicVisits: 70 + index }), '30d': metric({ dashboardVisits: 300 + index }) },
}));

const context: PublicTrafficDataReportContext = {
  date: '2026-06-15',
  summary: { '1d': metric(), '7d': metric(), '30d': metric() },
  conclusions: [],
  dataQualityNotes: [],
  rows,
  lowExposure: [],
  weakClick: [],
  weakConversion: rows.map((row) => ({ identifier: row.displayProductId, action: '提转化', reason: '访问有发货弱' })),
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: rows.map((row) => ({ identifier: row.displayProductId, action: '检查运营动作', reason: '建议操作池' })),
  newProductPoolItems: [],
  agentData: { removedLinks: [] },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
};

describe('operations learning loop preview CLI', () => {
  it('writes local preview artifacts from a report context file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-operations-learning-'));
    const contextPath = join(dir, 'context.json');
    await writeFile(contextPath, JSON.stringify(context), 'utf8');

    await runOperationsLearningLoopPreviewCli(['--context', contextPath, '--out-dir', dir]);

    const json = JSON.parse(await readFile(join(dir, 'operations-learning-quiz-2026-06-15.json'), 'utf8')) as { items: unknown[]; questionCard: unknown };
    const markdown = await readFile(join(dir, 'operations-learning-quiz-2026-06-15.md'), 'utf8');
    expect(json.items).toHaveLength(10);
    expect(JSON.stringify(json.questionCard)).toContain('suggested_action');
    expect(markdown).toContain('运营学习 loop 测验');
  });
});
