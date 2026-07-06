import { describe, expect, it } from 'vitest';
import { decideRefreshHealth } from '../src/linkRegistry/refreshHealth.js';

describe('decideRefreshHealth', () => {
  it('suppresses lifecycle drop when daemon count is zero', () => {
    const result = decideRefreshHealth({
      previousSnapshotCount: 556,
      currentMergedSnapshotCount: 447,
      daemonCount: 0,
      daemonExcludedCount: 0,
      daemonPagesScraped: 0,
      daemonFetchMode: 'live',
    });

    expect(result).toEqual(expect.objectContaining({
      daemonHealthy: false,
      suppressLifecycleDrop: true,
      reason: 'daemon_empty',
    }));
    expect(result.warnings[0]).toMatch(/daemon/i);
  });

  it('keeps healthy refreshes unsuppressed', () => {
    const result = decideRefreshHealth({
      previousSnapshotCount: 556,
      currentMergedSnapshotCount: 552,
      daemonCount: 480,
      daemonExcludedCount: 4,
      daemonPagesScraped: 10,
      daemonFetchMode: 'live',
    });

    expect(result).toEqual(expect.objectContaining({
      daemonHealthy: true,
      suppressLifecycleDrop: false,
      reason: 'ok',
    }));
  });
});
