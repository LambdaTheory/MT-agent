import { describe, expect, it } from 'vitest';
import { computeNextRunDelayMs } from '../src/cli/dailyMissionDaemon.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as runDailyMissionDaemon } from '../src/cli/dailyMissionDaemon.js';

describe('computeNextRunDelayMs', () => {
  it('schedules to the next HH:MM today when target is later', () => {
    const now = new Date('2026-07-02T08:00:00.000Z').getTime();
    expect(computeNextRunDelayMs(now, '09:30', 'UTC')).toBe(90 * 60 * 1000);
  });

  it('rolls to tomorrow when target already passed', () => {
    const now = new Date('2026-07-02T10:00:00.000Z').getTime();
    const delay = computeNextRunDelayMs(now, '09:30', 'UTC');
    expect(delay).toBe(23 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it('writes last-run metadata when run once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-dmd-test-'));
    try {
      await runDailyMissionDaemon(['--once', '--date', '2026-07-02', '--output-dir', dir, '--run-id', 'run-scheduled']);
      const state = JSON.parse(await readFile(join(dir, 'state', 'daily-mission-daemon-last-run.json'), 'utf8')) as { runId: string; trigger: string };
      expect(state.runId).toBe('run-scheduled');
      expect(state.trigger).toBe('scheduled');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
