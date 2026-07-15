import { describe, expect, it } from 'vitest';
import {
  assertDashboardDataDate,
  assessDashboardDateReadback,
  formatShanghaiDate,
  offsetShanghaiDate,
  previousShanghaiDate,
} from '../src/publicTraffic/dashboardCaptureDate.js';

const now = new Date('2026-07-14T00:30:00.000Z');

describe('formatShanghaiDate', () => {
  it('returns the Shanghai calendar date for a given UTC instant', () => {
    expect(formatShanghaiDate(now)).toBe('2026-07-14');
  });

  it('defaults to current time when no argument is passed', () => {
    const result = formatShanghaiDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('offsetShanghaiDate', () => {
  it('offsets from the Shanghai calendar day even when UTC is still the previous day', () => {
    const boundary = new Date('2026-07-14T16:30:00.000Z');
    expect(offsetShanghaiDate(-1, boundary)).toBe('2026-07-14');
    expect(offsetShanghaiDate(-2, boundary)).toBe('2026-07-13');
  });

  it('defaults to current time when no argument is passed', () => {
    const result = offsetShanghaiDate(-1);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('previousShanghaiDate', () => {
  it('returns the previous Shanghai calendar day', () => {
    expect(previousShanghaiDate(now)).toBe('2026-07-13');
  });

  it('defaults to current time when no argument is passed', () => {
    const result = previousShanghaiDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('assertDashboardDataDate', () => {
  it('returns the date when it is valid and not in the future', () => {
    expect(assertDashboardDataDate('2026-07-13', now)).toBe('2026-07-13');
  });

  it('rejects a future date', () => {
    expect(() => assertDashboardDataDate('2026-07-15', now)).toThrow(
      'dataDate must not be in the future',
    );
  });

  it('rejects an invalid calendar date', () => {
    expect(() => assertDashboardDataDate('2026-02-30', now)).toThrow(
      'dataDate must be YYYY-MM-DD',
    );
  });

  it('rejects a non-date string', () => {
    expect(() => assertDashboardDataDate('not-a-date', now)).toThrow(
      'dataDate must be YYYY-MM-DD',
    );
  });

  it('rejects an empty string', () => {
    expect(() => assertDashboardDataDate('', now)).toThrow(
      'dataDate must be YYYY-MM-DD',
    );
  });
});

describe('assessDashboardDateReadback', () => {
  it('confirms when displayed value matches MM-DD format', () => {
    const result = assessDashboardDateReadback('2026-07-12', '07-12');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '07-12',
      confirmed: true,
    });
  });

  it('confirms when displayed value uses slash format', () => {
    const result = assessDashboardDateReadback('2026-07-12', '2026/07/12');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '2026/07/12',
      confirmed: true,
    });
  });

  it('confirms a date range when the end date is the requested business cutoff', () => {
    const result = assessDashboardDateReadback('2026-07-12', '07-06 ~ 07-12');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '07-06 ~ 07-12',
      confirmed: true,
    });
  });

  it('rejects a date range whose end date does not match the requested cutoff', () => {
    const result = assessDashboardDateReadback('2026-07-12', '07-07 ~ 07-13');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '07-07 ~ 07-13',
      confirmed: false,
      reason: 'picker date range end does not match requested date',
    });
  });

  it('rejects a mismatched date with reason', () => {
    const result = assessDashboardDateReadback('2026-07-12', '07-13');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '07-13',
      confirmed: false,
      reason: 'picker date does not match requested date',
    });
  });

  it('detects range with full-width tilde', () => {
    const result = assessDashboardDateReadback('2026-07-12', '07-07～07-13');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '07-07～07-13',
      confirmed: false,
      reason: 'picker date range end does not match requested date',
    });
  });

  it('confirms when displayed value is full ISO date', () => {
    const result = assessDashboardDateReadback('2026-07-12', '2026-07-12');
    expect(result).toEqual({
      requestedDate: '2026-07-12',
      displayedValue: '2026-07-12',
      confirmed: true,
    });
  });
});
