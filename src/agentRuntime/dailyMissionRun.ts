import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';

export type DailyMissionRunStatus =
  | 'collecting'
  | 'planning'
  | 'waiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped_stale_data';

export type DailyMissionRunTrigger = 'manual' | 'scheduled' | 'retry';

export interface DailyMissionArtifactRef {
  type: string;
  path: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface DailyMissionRun {
  runId: string;
  date: string;
  status: DailyMissionRunStatus;
  trigger: DailyMissionRunTrigger;
  startedAt: string;
  finishedAt?: string;
  artifactRefs: DailyMissionArtifactRef[];
}

export interface CreateDailyMissionRunInput {
  runId: string;
  date: string;
  trigger: DailyMissionRunTrigger;
  startedAt: string;
  artifactRefs?: DailyMissionArtifactRef[];
}

const TERMINAL_STATUSES = new Set<DailyMissionRunStatus>(['completed', 'failed', 'cancelled', 'skipped_stale_data']);

const ALLOWED_TRANSITIONS: Record<DailyMissionRunStatus, DailyMissionRunStatus[]> = {
  collecting: ['planning', 'failed', 'cancelled', 'skipped_stale_data'],
  planning: ['waiting_approval', 'failed', 'cancelled'],
  waiting_approval: ['executing', 'failed', 'cancelled'],
  executing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
  skipped_stale_data: [],
};

export function isDailyMissionTerminalStatus(status: DailyMissionRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function createDailyMissionRun(input: CreateDailyMissionRunInput): DailyMissionRun {
  return {
    runId: input.runId,
    date: input.date,
    status: 'collecting',
    trigger: input.trigger,
    startedAt: input.startedAt,
    artifactRefs: input.artifactRefs ? [...input.artifactRefs] : [],
  };
}

export function transitionDailyMissionRun(
  run: DailyMissionRun,
  nextStatus: DailyMissionRunStatus,
  at: string,
): DailyMissionRun {
  if (isDailyMissionTerminalStatus(run.status)) {
    throw new Error(`DailyMissionRun is already terminal: ${run.status}`);
  }
  if (!ALLOWED_TRANSITIONS[run.status].includes(nextStatus)) {
    throw new Error(`Invalid DailyMissionRun transition: ${run.status} -> ${nextStatus}`);
  }
  return {
    ...run,
    status: nextStatus,
    ...(isDailyMissionTerminalStatus(nextStatus) ? { finishedAt: at } : {}),
  };
}

export function addDailyMissionArtifact(
  run: DailyMissionRun,
  artifact: DailyMissionArtifactRef,
): DailyMissionRun {
  return {
    ...run,
    artifactRefs: [...run.artifactRefs, artifact],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function saveDailyMissionRun(outputDir: string, run: DailyMissionRun): Promise<DailyMissionRun> {
  const path = dailyMissionArtifactPath(outputDir, run.date, 'missionRun');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return run;
}

export async function loadDailyMissionRun(outputDir: string, date: string): Promise<DailyMissionRun | null> {
  try {
    return JSON.parse(await readFile(dailyMissionArtifactPath(outputDir, date, 'missionRun'), 'utf8')) as DailyMissionRun;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function findDailyMissionRunByRunId(outputDir: string, runId: string): Promise<DailyMissionRun | null> {
  const root = join(outputDir, 'daily-mission');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
  for (const date of entries) {
    const run = await loadDailyMissionRun(outputDir, date);
    if (run?.runId === runId) return run;
  }
  return null;
}
