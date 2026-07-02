import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';
import { runDailyMissionPlan } from '../src/agentRuntime/dailyMissionOrchestrator.js';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FileHotspotEventProvider } from '../src/agentRuntime/hotspotEvents.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { main as runDailyMissionCli } from '../src/cli/dailyMissionRun.js';

describe('daily mission integration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-int-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a full plan cycle without executing any write op', async () => {
    const hotspotDir = join(dir, 'daily-mission', '2026-07-01');
    await mkdir(hotspotDir, { recursive: true });
    await writeFile(join(hotspotDir, 'hotspot-events.json'), JSON.stringify([
      {
        eventId: 'e1',
        source: 'manual',
        title: '演唱会A',
        startsAt: '2026-07-03T00:00:00.000Z',
        affectedCategories: ['相机'],
        confidence: 'high',
      },
    ]), 'utf8');

    const provider = new FileHotspotEventProvider({ path: join(hotspotDir, 'hotspot-events.json') });
    const collectors: ContextCollector[] = [
      { name: 'hotspots', collect: async () => ({ hotspots: await provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 }) }) },
    ];
    const result = await runDailyMissionPlan({
      outputDir: dir,
      date: '2026-07-01',
      runId: 'run-1',
      trigger: 'scheduled',
      collectors,
      decisionBuilder: new RuleBasedDecisionBuilder(),
    });
    await writeDailyJournal({
      outputDir: dir,
      date: '2026-07-01',
      runId: 'run-1',
      context: result.context,
      decisions: result.decisions,
      classified: result.classified,
    });

    expect(result.run.status).toBe('waiting_approval');
    expect(result.decisions).toHaveLength(1);
    await readFile(join(hotspotDir, 'mission-run.json'), 'utf8');
    await readFile(join(hotspotDir, 'collected-context.json'), 'utf8');
    await readFile(join(hotspotDir, 'decisions.json'), 'utf8');
    await readFile(join(hotspotDir, 'approval-request.json'), 'utf8');
    await readFile(join(hotspotDir, 'daily-journal.json'), 'utf8');
    const events = (await loadOperationLedgerJsonlEntries(dir, '2026-07-01')).map((entry) => entry.event);
    expect(events).toContain('data_collected');
    expect(events).toContain('journal_written');
    expect(events).not.toContain('approval_requested');
    expect(events).not.toContain('execution_started');
    const markdown = await readFile(join(hotspotDir, 'daily-journal.md'), 'utf8');
    expect(markdown).toContain('演唱会A');
  });

  it('CLI collects exposure, sales, recent operations, and hotspots from report context', async () => {
    const date = '2026-07-01';
    const missionDir = join(dir, 'daily-mission', date);
    const reportDir = join(dir, date);
    await mkdir(missionDir, { recursive: true });
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, 'report-context.json'), JSON.stringify({ date, summary: { '1d': { exposure: 1 } }, rows: [], orderAnalysis: { pages: {} } }), 'utf8');
    await writeFile(join(missionDir, 'outcomes.json'), JSON.stringify([{
      decisionId: 'dec-history',
      runId: 'run-history',
      operationType: 'price_down',
      subject: { kind: 'product', id: '648' },
      executedAt: '2026-07-01T00:00:00.000Z',
      measuredAt: '2026-07-01T00:00:00.000Z',
      before: { exposure: 10 },
      after: { exposure: 20 },
      outcome: 'positive',
    }]), 'utf8');
    await writeFile(join(missionDir, 'hotspot-events.json'), JSON.stringify([
      {
        eventId: 'e1',
        source: 'manual',
        title: '演唱会A',
        startsAt: '2026-07-03T00:00:00.000Z',
        affectedCategories: ['相机'],
        confidence: 'high',
      },
    ]), 'utf8');

    await runDailyMissionCli(['--output-dir', dir, '--date', date, '--run-id', 'run-cli', '--trigger', 'scheduled']);

    const context = JSON.parse(await readFile(join(missionDir, 'collected-context.json'), 'utf8')) as {
      exposure?: { date: string; source: string; context: { date: string } };
      sales?: { date: string; source: string; context: { date: string } };
      recentOperations?: unknown[];
      trackRecord?: unknown[];
      hotspots?: unknown[];
    };
    expect(context.exposure).toEqual({ date, source: 'publicTraffic', context: expect.objectContaining({ date }) });
    expect(context.sales).toEqual({ date, source: 'orderAnalysis', context: expect.objectContaining({ date }) });
    expect(context.recentOperations).toEqual([]);
    expect(context.trackRecord).toEqual([expect.objectContaining({ key: 'price_down', samples: 1, positive: 1 })]);
    expect(context.hotspots).toHaveLength(1);
    const run = JSON.parse(await readFile(join(missionDir, 'mission-run.json'), 'utf8')) as { trigger: string };
    expect(run.trigger).toBe('scheduled');
  });
});
