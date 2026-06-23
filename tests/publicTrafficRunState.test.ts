import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublicTrafficRunState, savePublicTrafficRunState } from '../src/publicTraffic/publicTrafficRunState.js';

describe('public traffic run state', () => {
  it('returns null for a missing state file and saves readable JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-state-'));
    const path = join(dir, 'public-traffic-run-state.json');
    try {
      await expect(loadPublicTrafficRunState(path)).resolves.toBeNull();
      await savePublicTrafficRunState(path, {
        date: '2026-06-15',
        firstReportSent: true,
        firstReportGeneratedAt: '2026-06-15T01:00:00.000Z',
        firstDashboardQuality: {
          hasMissing: false,
          notes: [],
          periods: {
            '1d': { complete: true, rowCount: 1 },
            '7d': { complete: true, rowCount: 1 },
            '30d': { complete: true, rowCount: 1 },
          },
        },
        dashboardRefreshResent: false,
      });
      const loaded = await loadPublicTrafficRunState(path);
      expect(loaded?.date).toBe('2026-06-15');
      expect(loaded?.firstDashboardQuality.hasMissing).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
