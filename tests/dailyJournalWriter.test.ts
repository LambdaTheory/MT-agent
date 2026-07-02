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
        collectedAt: '2026-07-01T00:00:00.000Z',
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
    expect(events[0].decisionId).toBe('run-1:journal_written');
    expect(events[0].subject).toEqual({ kind: 'link', id: 'daily-mission:2026-07-01' });
  });

  it('renders actual execution results into json and markdown journals', async () => {
    const { jsonPath, markdownPath } = await writeDailyJournal({
      outputDir: dir,
      date: '2026-07-02',
      runId: 'run-1',
      context: {
        runId: 'run-1',
        date: '2026-07-02',
        outputDir: dir,
        collectedAt: '2026-07-02T00:00:00.000Z',
        missingSources: [],
      },
      decisions: [],
      classified: { approvals: [], observations: [] },
      executionResults: [{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '已下架 648' }],
    });

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('实际执行');
    expect(markdown).toContain('dec-1');
    expect(markdown).toContain('已下架 648');
    const json = JSON.parse(await readFile(jsonPath, 'utf8')) as { executionResults?: Array<{ decisionId: string }> };
    expect(json.executionResults?.[0]?.decisionId).toBe('dec-1');
  });
});
