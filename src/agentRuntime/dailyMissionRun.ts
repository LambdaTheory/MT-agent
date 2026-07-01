export type DailyMissionRunStatus =
  | 'collecting'
  | 'planning'
  | 'waiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

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

const TERMINAL_STATUSES = new Set<DailyMissionRunStatus>(['completed', 'failed', 'cancelled']);

const ALLOWED_TRANSITIONS: Record<DailyMissionRunStatus, DailyMissionRunStatus[]> = {
  collecting: ['planning', 'failed', 'cancelled'],
  planning: ['waiting_approval', 'failed', 'cancelled'],
  waiting_approval: ['executing', 'failed', 'cancelled'],
  executing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
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
