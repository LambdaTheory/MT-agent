import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';

describe('failure journal', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-fail-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('marks the failing stage in markdown and json', async () => {
    const { jsonPath, markdownPath } = await writeDailyJournal({
      outputDir: dir,
      date: '2026-07-02',
      runId: 'run-1',
      context: { runId: 'run-1', date: '2026-07-02', outputDir: dir, collectedAt: 'x', missingSources: [] },
      decisions: [],
      classified: { approvals: [], observations: [] },
      failure: { stage: 'planning', message: 'boom' },
    });

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('任务失败');
    expect(markdown).toContain('planning');
    const json = JSON.parse(await readFile(jsonPath, 'utf8')) as { failure: { stage: string; message: string } | null };
    expect(json.failure).toEqual({ stage: 'planning', message: 'boom' });
  });
});
