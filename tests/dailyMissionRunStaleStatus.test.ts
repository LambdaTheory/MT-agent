import { describe, expect, it } from 'vitest';
import { createDailyMissionRun, isDailyMissionTerminalStatus, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';

describe('skipped_stale_data terminal status', () => {
  it('allows collecting -> skipped_stale_data and marks it terminal', () => {
    const run = createDailyMissionRun({ runId: 'r1', date: '2026-07-03', trigger: 'scheduled', startedAt: 'x' });
    const skipped = transitionDailyMissionRun(run, 'skipped_stale_data', 'y');
    expect(skipped.status).toBe('skipped_stale_data');
    expect(skipped.finishedAt).toBe('y');
    expect(isDailyMissionTerminalStatus('skipped_stale_data')).toBe(true);
  });

  it('cannot transition out of skipped_stale_data', () => {
    const run = createDailyMissionRun({ runId: 'r1', date: '2026-07-03', trigger: 'scheduled', startedAt: 'x' });
    const skipped = transitionDailyMissionRun(run, 'skipped_stale_data', 'y');
    expect(() => transitionDailyMissionRun(skipped, 'planning', 'z')).toThrow(/already terminal/);
  });
});
