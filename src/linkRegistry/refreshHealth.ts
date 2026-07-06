export interface RefreshHealthInput {
  previousSnapshotCount: number;
  currentMergedSnapshotCount: number;
  daemonCount: number | null;
  daemonExcludedCount?: number;
  daemonPagesScraped?: number;
  daemonFetchMode: 'live' | 'fallback' | 'missing';
}

export interface RefreshHealthDecision {
  daemonHealthy: boolean;
  suppressLifecycleDrop: boolean;
  warnings: string[];
  reason: 'ok' | 'daemon_empty' | 'daemon_low_count' | 'snapshot_drop';
}

const SNAPSHOT_DROP_RATIO = 0.2;

export function decideRefreshHealth(input: RefreshHealthInput): RefreshHealthDecision {
  if (input.daemonFetchMode !== 'missing' && input.daemonCount === 0) {
    return {
      daemonHealthy: false,
      suppressLifecycleDrop: true,
      reason: 'daemon_empty',
      warnings: ['daemon snapshot is empty; suppress destructive lifecycle transitions'],
    };
  }

  const dropRatio = input.previousSnapshotCount > 0
    ? (input.previousSnapshotCount - input.currentMergedSnapshotCount) / input.previousSnapshotCount
    : 0;

  if (dropRatio > SNAPSHOT_DROP_RATIO) {
    return {
      daemonHealthy: true,
      suppressLifecycleDrop: true,
      reason: 'snapshot_drop',
      warnings: [`goods snapshot dropped by ${Math.round(dropRatio * 100)}%; suppress destructive lifecycle transitions`],
    };
  }

  return {
    daemonHealthy: true,
    suppressLifecycleDrop: false,
    reason: 'ok',
    warnings: [],
  };
}
