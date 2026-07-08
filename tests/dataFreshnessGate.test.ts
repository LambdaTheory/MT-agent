import { describe, expect, it } from 'vitest';
import { assessDataFreshness } from '../src/agentRuntime/dataFreshnessGate.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';

function baseContext(patch: Partial<CollectedContext> = {}): CollectedContext {
  return {
    runId: 'run-1',
    date: '2026-07-03',
    outputDir: 'output',
    collectedAt: 'x',
    missingSources: [],
    ...patch,
  };
}

function exposureWith(date: string, rows: number) {
  return {
    date,
    source: 'publicTraffic',
    context: { date, rows: Array.from({ length: rows }, (_, index) => ({ id: String(index) })) },
  };
}

describe('assessDataFreshness', () => {
  it('fresh when exposure+sales present, date matches, rows above min', () => {
    const ctx = baseContext({ exposure: exposureWith('2026-07-03', 5), sales: { date: '2026-07-03' } });
    expect(assessDataFreshness(ctx, { minExposureRows: 1 })).toEqual({ fresh: true, reasons: [] });
  });

  it('stale when exposure missing', () => {
    const ctx = baseContext({ missingSources: ['exposure'], sales: { date: '2026-07-03' } });
    const v = assessDataFreshness(ctx);
    expect(v.fresh).toBe(false);
    expect(v.reasons).toContain('exposure_missing');
  });

  it('stale when exposure date does not match mission date', () => {
    const ctx = baseContext({ exposure: exposureWith('2026-07-02', 5), sales: { date: '2026-07-03' } });
    const v = assessDataFreshness(ctx);
    expect(v.fresh).toBe(false);
    expect(v.reasons).toContain('exposure_date_mismatch');
  });

  it('stale when exposure rows below configured minimum', () => {
    const ctx = baseContext({ exposure: exposureWith('2026-07-03', 2), sales: { date: '2026-07-03' } });
    const v = assessDataFreshness(ctx, { minExposureRows: 5 });
    expect(v.fresh).toBe(false);
    expect(v.reasons).toContain('exposure_rows_below_min');
  });

  it('treats unreadable exposure as missing without throwing', () => {
    const ctx = baseContext({ exposure: 42, sales: { date: '2026-07-03' } });
    const v = assessDataFreshness(ctx);
    expect(v.fresh).toBe(false);
    expect(v.reasons).toContain('exposure_unreadable');
  });

  it('ignores sales when requireSales is false', () => {
    const ctx = baseContext({ exposure: exposureWith('2026-07-03', 5), missingSources: ['sales'] });
    expect(assessDataFreshness(ctx, { requireSales: false }).fresh).toBe(true);
  });
});
