import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAILY_MISSION_ARTIFACT_FILENAMES,
  dailyMissionArtifactPath,
  dailyMissionOutputDir,
  listDailyMissionArtifactPaths,
  operationLedgerJsonlPath,
  type DailyMissionArtifactName,
} from '../src/agentRuntime/dailyMissionArtifacts.js';

describe('daily mission artifact contract', () => {
  it('builds the dated daily mission output directory', () => {
    expect(dailyMissionOutputDir('output', '2026-07-01')).toBe(join('output', 'daily-mission', '2026-07-01'));
  });

  it('maps each required daily mission artifact to the roadmap filename', () => {
    const outputDir = 'output';
    const date = '2026-07-01';

    expect(dailyMissionArtifactPath(outputDir, date, 'missionRun')).toBe(join(outputDir, 'daily-mission', date, 'mission-run.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'collectedContext')).toBe(join(outputDir, 'daily-mission', date, 'collected-context.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'hotspotEvents')).toBe(join(outputDir, 'daily-mission', date, 'hotspot-events.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'decisions')).toBe(join(outputDir, 'daily-mission', date, 'decisions.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'approvalRequest')).toBe(join(outputDir, 'daily-mission', date, 'approval-request.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'executionResults')).toBe(join(outputDir, 'daily-mission', date, 'execution-results.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'dailyJournalJson')).toBe(join(outputDir, 'daily-mission', date, 'daily-journal.json'));
    expect(dailyMissionArtifactPath(outputDir, date, 'dailyJournalMarkdown')).toBe(join(outputDir, 'daily-mission', date, 'daily-journal.md'));
  });

  it('lists all daily mission artifacts in contract order', () => {
    const paths = listDailyMissionArtifactPaths('output', '2026-07-01');
    const names = Object.keys(DAILY_MISSION_ARTIFACT_FILENAMES) as DailyMissionArtifactName[];

    expect(paths.map((entry) => entry.name)).toEqual(names);
    expect(paths.map((entry) => entry.path)).toEqual(names.map((name) => dailyMissionArtifactPath('output', '2026-07-01', name)));
  });

  it('builds the operation ledger jsonl path from the roadmap contract', () => {
    expect(operationLedgerJsonlPath('output', '2026-07-01')).toBe(join('output', 'operation-ledger', '2026-07-01.jsonl'));
  });
});
