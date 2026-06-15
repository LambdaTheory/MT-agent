import { describe, expect, it } from 'vitest';
import type { DashboardQualitySummary } from '../src/publicTraffic/dashboardQuality.js';
import { decideDashboardRefreshAction } from '../src/publicTraffic/dashboardRefresh.js';

const complete: DashboardQualitySummary = {
  hasMissing: false,
  notes: [],
  periods: {
    '1d': { complete: true, rowCount: 1 },
    '7d': { complete: true, rowCount: 1 },
    '30d': { complete: true, rowCount: 1 },
  },
};

const missing: DashboardQualitySummary = {
  hasMissing: true,
  notes: ['后链路数据缺失'],
  periods: {
    '1d': { complete: false, rowCount: 0 },
    '7d': { complete: true, rowCount: 1 },
    '30d': { complete: true, rowCount: 1 },
  },
};

describe('decideDashboardRefreshAction', () => {
  it('saves raw only when first report is complete', () => {
    expect(decideDashboardRefreshAction({ firstQuality: complete, refreshQuality: complete, alreadyResent: false })).toBe('first_report_complete');
  });

  it('saves raw only when refresh is still missing', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: missing, alreadyResent: false })).toBe('refresh_still_missing');
  });

  it('rebuilds and resends when first report is missing and refresh is complete', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: complete, alreadyResent: false })).toBe('rebuilt_and_resent');
  });

  it('does not resend again after a successful refresh resend', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: complete, alreadyResent: true })).toBe('already_resent');
  });
});
