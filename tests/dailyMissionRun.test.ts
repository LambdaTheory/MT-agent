import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDailyMissionArtifact,
  createDailyMissionRun,
  isDailyMissionTerminalStatus,
  loadDailyMissionRun,
  saveDailyMissionRun,
  transitionDailyMissionRun,
  type DailyMissionArtifactRef,
} from '../src/agentRuntime/dailyMissionRun.js';
import { dailyMissionArtifactPath } from '../src/agentRuntime/dailyMissionArtifacts.js';

async function tempOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mt-agent-daily-mission-run-'));
}

describe('daily mission run state skeleton', () => {
  it('creates a collecting run with manual trigger defaults', () => {
    const run = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'manual',
      startedAt: '2026-07-01T08:00:00.000Z',
    });

    expect(run).toEqual({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      status: 'collecting',
      trigger: 'manual',
      startedAt: '2026-07-01T08:00:00.000Z',
      artifactRefs: [],
    });
  });

  it('preserves retry as creation metadata without changing the initial state', () => {
    const run = createDailyMissionRun({
      runId: 'retry-2026-07-01',
      date: '2026-07-01',
      trigger: 'retry',
      startedAt: '2026-07-01T09:00:00.000Z',
    });

    expect(run.trigger).toBe('retry');
    expect(run.status).toBe('collecting');
  });

  it('transitions through the planned non-terminal daily mission states', () => {
    const collecting = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'scheduled',
      startedAt: '2026-07-01T08:00:00.000Z',
    });

    const planning = transitionDailyMissionRun(collecting, 'planning', '2026-07-01T08:01:00.000Z');
    const waiting = transitionDailyMissionRun(planning, 'waiting_approval', '2026-07-01T08:02:00.000Z');
    const executing = transitionDailyMissionRun(waiting, 'executing', '2026-07-01T08:03:00.000Z');

    expect(planning.status).toBe('planning');
    expect(waiting.status).toBe('waiting_approval');
    expect(executing.status).toBe('executing');
    expect(executing.finishedAt).toBeUndefined();
  });

  it('marks completed, failed, and cancelled as terminal statuses with finishedAt', () => {
    const base = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'manual',
      startedAt: '2026-07-01T08:00:00.000Z',
    });

    const completed = transitionDailyMissionRun(
      transitionDailyMissionRun(
        transitionDailyMissionRun(
          transitionDailyMissionRun(base, 'planning', '2026-07-01T08:01:00.000Z'),
          'waiting_approval',
          '2026-07-01T08:02:00.000Z',
        ),
        'executing',
        '2026-07-01T08:03:00.000Z',
      ),
      'completed',
      '2026-07-01T08:04:00.000Z',
    );
    const failed = transitionDailyMissionRun(base, 'failed', '2026-07-01T08:05:00.000Z');
    const cancelled = transitionDailyMissionRun(base, 'cancelled', '2026-07-01T08:06:00.000Z');

    expect(completed.finishedAt).toBe('2026-07-01T08:04:00.000Z');
    expect(failed.finishedAt).toBe('2026-07-01T08:05:00.000Z');
    expect(cancelled.finishedAt).toBe('2026-07-01T08:06:00.000Z');
    expect(isDailyMissionTerminalStatus('completed')).toBe(true);
    expect(isDailyMissionTerminalStatus('failed')).toBe(true);
    expect(isDailyMissionTerminalStatus('cancelled')).toBe(true);
    expect(isDailyMissionTerminalStatus('executing')).toBe(false);
  });

  it('rejects skipped transitions and transitions out of terminal states', () => {
    const run = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'manual',
      startedAt: '2026-07-01T08:00:00.000Z',
    });
    const failed = transitionDailyMissionRun(run, 'failed', '2026-07-01T08:01:00.000Z');

    expect(() => transitionDailyMissionRun(run, 'executing', '2026-07-01T08:02:00.000Z')).toThrow('Invalid DailyMissionRun transition: collecting -> executing');
    expect(() => transitionDailyMissionRun(failed, 'collecting', '2026-07-01T08:03:00.000Z')).toThrow('DailyMissionRun is already terminal: failed');
  });

  it('adds artifact references without mutating the original run', () => {
    const run = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'manual',
      startedAt: '2026-07-01T08:00:00.000Z',
    });
    const artifact: DailyMissionArtifactRef = {
      type: 'collected-context',
      path: 'output/daily-mission/2026-07-01/collected-context.json',
      label: 'Collected context',
    };

    const updated = addDailyMissionArtifact(run, artifact);

    expect(run.artifactRefs).toEqual([]);
    expect(updated.artifactRefs).toEqual([artifact]);
  });

  it('saves mission-run JSON through the Daily Mission artifact contract path', async () => {
    const outputDir = await tempOutputDir();
    const run = createDailyMissionRun({
      runId: 'run-2026-07-01',
      date: '2026-07-01',
      trigger: 'scheduled',
      startedAt: '2026-07-01T08:00:00.000Z',
    });

    await saveDailyMissionRun(outputDir, run);

    const raw = await readFile(dailyMissionArtifactPath(outputDir, run.date, 'missionRun'), 'utf8');
    expect(raw).toBe(`${JSON.stringify(run, null, 2)}\n`);
  });

  it('loads a saved mission-run JSON file', async () => {
    const outputDir = await tempOutputDir();
    const run = addDailyMissionArtifact(
      createDailyMissionRun({
        runId: 'run-2026-07-01',
        date: '2026-07-01',
        trigger: 'manual',
        startedAt: '2026-07-01T08:00:00.000Z',
      }),
      { type: 'collected-context', path: 'output/daily-mission/2026-07-01/collected-context.json' },
    );

    await saveDailyMissionRun(outputDir, run);

    await expect(loadDailyMissionRun(outputDir, '2026-07-01')).resolves.toEqual(run);
  });

  it('returns null when the mission-run JSON file is missing', async () => {
    const outputDir = await tempOutputDir();
    await mkdir(join(outputDir, 'daily-mission'), { recursive: true });

    await expect(loadDailyMissionRun(outputDir, '2026-07-01')).resolves.toBeNull();
  });
});
