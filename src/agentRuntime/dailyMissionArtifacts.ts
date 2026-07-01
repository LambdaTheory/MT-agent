import { join } from 'node:path';

export const DAILY_MISSION_ARTIFACT_FILENAMES = {
  missionRun: 'mission-run.json',
  collectedContext: 'collected-context.json',
  hotspotEvents: 'hotspot-events.json',
  decisions: 'decisions.json',
  approvalRequest: 'approval-request.json',
  executionResults: 'execution-results.json',
  dailyJournalJson: 'daily-journal.json',
  dailyJournalMarkdown: 'daily-journal.md',
} as const;

export type DailyMissionArtifactName = keyof typeof DAILY_MISSION_ARTIFACT_FILENAMES;

export interface DailyMissionArtifactPath {
  name: DailyMissionArtifactName;
  path: string;
}

export function dailyMissionOutputDir(outputDir: string, date: string): string {
  return join(outputDir, 'daily-mission', date);
}

export function dailyMissionArtifactPath(
  outputDir: string,
  date: string,
  artifactName: DailyMissionArtifactName,
): string {
  return join(dailyMissionOutputDir(outputDir, date), DAILY_MISSION_ARTIFACT_FILENAMES[artifactName]);
}

export function listDailyMissionArtifactPaths(outputDir: string, date: string): DailyMissionArtifactPath[] {
  return (Object.keys(DAILY_MISSION_ARTIFACT_FILENAMES) as DailyMissionArtifactName[]).map((name) => ({
    name,
    path: dailyMissionArtifactPath(outputDir, date, name),
  }));
}

export function operationLedgerJsonlPath(outputDir: string, date: string): string {
  return join(outputDir, 'operation-ledger', `${date}.jsonl`);
}
