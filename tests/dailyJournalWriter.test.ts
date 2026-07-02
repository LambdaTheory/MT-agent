import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

describe('writeDailyJournal', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-journal-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes json and markdown journals plus a journal_written event', async () => {
    const { jsonPath, markdownPath } = await writeDailyJournal({
      outputDir: dir,
      date: '2026-07-01',
      runId: 'run-1',
      context: {
        runId: 'run-1',
        date: '2026-07-01',
        outputDir: dir,
        missingSources: ['sales'],
      },
      decisions: [],
      classified: { approvals: [], observations: [] },
    });

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('2026-07-01');
    expect(markdown).toContain('缺失数据源');
    const json = JSON.parse(await readFile(jsonPath, 'utf8')) as { runId: string };
    expect(json.runId).toBe('run-1');
    const events = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    expect(events.map((entry) => entry.event)).toContain('journal_written');
  });
});
