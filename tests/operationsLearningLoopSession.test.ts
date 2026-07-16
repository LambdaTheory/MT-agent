import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleOperationsLearningFeedback, handleOperationsLearningStop, startOperationsLearningSession, summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../src/operationsLearningLoop/session.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

const metric: PublicTrafficPeriodMetrics = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 8,
  createdOrders: 1,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 20,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.1,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

function context(): PublicTrafficDataReportContext {
  const rows = [1, 2].map((id) => ({
    productName: `测试商品${id}`,
    platformProductId: `p${id}`,
    displayProductId: `端内ID ${700 + id}`,
    custodyDays: id,
    periods: { '1d': metric, '7d': metric, '30d': metric },
  }));
  return {
    date: '2026-06-16',
    generationId: 'operations-learning-session-2026-06-16',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    dataQualityNotes: [],
    rows,
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: rows.map((row) => ({ identifier: row.displayProductId, action: `操作${row.displayProductId}`, reason: '建议操作池', priority: 'high' as const })),
    agentData: { removedLinks: [] },
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
  };
}

describe('operations learning session', () => {
  it('starts a persisted session and advances to the next question after feedback', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-session-'));
    const started = await startOperationsLearningSession(outputDir, context());

    expect(started.text).toContain('第 1/2 题');
    expect(JSON.stringify(started.card)).toContain('运营学习 loop 测验 1/2');

    const advanced = await handleOperationsLearningFeedback(outputDir, {
      date: '2026-06-16',
      productId: '701',
      feedback: 'reasonable',
      questionIndex: 1,
      suggestion: undefined,
      reviewerId: 'ou_1',
    });

    expect(advanced.text).toContain('第 2/2 题');
    expect(JSON.stringify(advanced.card)).toContain('运营学习 loop 测验 2/2');

    const stored = JSON.parse(await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')) as { feedbacks: Array<{ productId: string; feedback: string; reviewerId?: string; questionIndex: number; submittedAt: string }> };
    expect(stored.feedbacks).toMatchObject([{ productId: '701', feedback: 'reasonable', reviewerId: 'ou_1', questionIndex: 1 }]);
    expect(stored.feedbacks[0]?.submittedAt).toEqual(expect.any(String));
  });

  it('returns a completion summary after the final feedback and stores suggestions', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-complete-'));
    await startOperationsLearningSession(outputDir, context());
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1 });

    const completed = await handleOperationsLearningFeedback(outputDir, {
      date: '2026-06-16',
      productId: '702',
      feedback: 'suggested_action',
      questionIndex: 2,
      suggestion: '先检查库存再放量',
    });

    expect(completed.card).toBeUndefined();
    expect(completed.text).toContain('运营学习反馈完成');
    expect(completed.text).toContain('已答 2/2');
    expect(completed.text).toContain('改写建议 1');

    const summary = await summarizeOperationsLearningSession(outputDir, '2026-06-16');
    expect(summary).toContain('701 reasonable');
    expect(summary).toContain('702 suggested_action');
    expect(summary).toContain('先检查库存再放量');
    expect(summary).toContain('评审人 0');
  });

  it('resumes the same-day session without overwriting saved feedback', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-resume-'));
    await startOperationsLearningSession(outputDir, context());
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_resume' });

    const resumed = await startOperationsLearningSession(outputDir, context());

    expect(resumed.text).toContain('第 2/2 题');
    expect(JSON.stringify(resumed.card)).toContain('运营学习 loop 测验 2/2');
    await expect(readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_resume');
  });

  it('ignores stale duplicate card actions without overwriting completed feedback', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-stale-'));
    await startOperationsLearningSession(outputDir, context());
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_first' });
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '702', feedback: 'suggested_action', questionIndex: 2, suggestion: '保持当前策略', reviewerId: 'ou_second' });

    const stale = await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'unreasonable', questionIndex: 1, reviewerId: 'ou_stale' });

    expect(stale.card).toBeUndefined();
    expect(stale.text).toBe('这道题已经记录过反馈，请继续处理当前题卡。');
    const stored = await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8');
    expect(stored).toContain('ou_first');
    expect(stored).not.toContain('ou_stale');
    expect(stored).toContain('reasonable');
  });

  it('serializes concurrent duplicate feedback without last-write-wins overwrite', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-concurrent-'));
    await startOperationsLearningSession(outputDir, context());

    await Promise.all([
      handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_first' }),
      handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'unreasonable', questionIndex: 1, reviewerId: 'ou_second' }),
    ]);

    const stored = JSON.parse(await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')) as { feedbacks: Array<{ productId: string; feedback: string; reviewerId?: string }> };
    expect(stored.feedbacks).toEqual([{ productId: '701', feedback: 'reasonable', reviewerId: 'ou_first', questionIndex: 1, submittedAt: expect.any(String) }]);
  });

  it('rejects unknown feedback values without corrupting persisted signals', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-invalid-'));
    await startOperationsLearningSession(outputDir, context());

    const response = await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'bad_value', questionIndex: 1, reviewerId: 'ou_bad' });

    expect(response).toEqual({ text: '无法识别的运营学习反馈：bad_value。' });
    const stored = JSON.parse(await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')) as { feedbacks: unknown[]; learnedSignals: { rejectedReasons: Record<string, number> } };
    expect(stored.feedbacks).toEqual([]);
    expect(stored.learnedSignals.rejectedReasons).toEqual({});
  });

  it('stops the session and ignores later feedback from old cards', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-stop-'));
    await startOperationsLearningSession(outputDir, context());

    const stopped = await handleOperationsLearningStop(outputDir, { date: '2026-06-16', reviewerId: 'ou_stop' });
    const staleFeedback = await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_late' });

    expect(stopped.card).toBeUndefined();
    expect(stopped.text).toContain('运营学习已停止');
    expect(stopped.text).toContain('已答 0/2');
    expect(staleFeedback.text).toContain('运营学习已停止');
    const stored = JSON.parse(await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')) as { stoppedAt?: string; stoppedBy?: string; feedbacks: unknown[] };
    expect(stored.stoppedAt).toEqual(expect.any(String));
    expect(stored.stoppedBy).toBe('ou_stop');
    expect(stored.feedbacks).toEqual([]);
  });

  it('restarts a stopped same-day session and returns the next question card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-restart-'));
    await startOperationsLearningSession(outputDir, context());
    await handleOperationsLearningStop(outputDir, { date: '2026-06-16', reviewerId: 'ou_stop' });

    const restarted = await startOperationsLearningSession(outputDir, context());

    expect(restarted.text).toContain('第 1/2 题');
    expect(JSON.stringify(restarted.card)).toContain('运营学习 loop 测验 1/2');
    const storedAfterRestart = JSON.parse(await readFile(join(outputDir, '2026-06-16', 'operations-learning-session.json'), 'utf8')) as { stoppedAt?: string; stoppedBy?: string; feedbacks: unknown[] };
    expect(storedAfterRestart.stoppedAt).toBeUndefined();
    expect(storedAfterRestart.stoppedBy).toBeUndefined();
    expect(storedAfterRestart.feedbacks).toEqual([]);

    const next = await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_restart' });
    expect(next.text).toContain('第 2/2 题');
    expect(JSON.stringify(next.card)).toContain('运营学习 loop 测验 2/2');
  });

  it('summarizes cross-day history and per-reviewer stats', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-history-'));
    await startOperationsLearningSession(outputDir, context());
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_a' });
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '702', feedback: 'not_representative', questionIndex: 2, reviewerId: 'ou_b' });

    const nextContext = { ...context(), date: '2026-06-17' };
    await startOperationsLearningSession(outputDir, nextContext);
    await handleOperationsLearningFeedback(outputDir, { date: '2026-06-17', productId: '701', feedback: 'reasonable', questionIndex: 1, reviewerId: 'ou_a' });

    const summary = await summarizeOperationsLearningHistory(outputDir);

    expect(summary).toContain('运营学习历史汇总');
    expect(summary).toContain('会话 2');
    expect(summary).toContain('已答 3/4');
    expect(summary).toContain('ou_a 2');
    expect(summary).toContain('ou_b 1');
  });

  it('reports missing sessions without creating feedback files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-missing-'));
    const response = await handleOperationsLearningFeedback(outputDir, { date: '2026-06-16', productId: '701', feedback: 'reasonable', questionIndex: 1 });

    expect(response).toEqual({ text: '还没有找到运营学习测验会话，请先发送“运营学习”。' });
  });
});
