import { describe, expect, it } from 'vitest';
import { computeNextRunDelayMs } from '../src/cli/dailyMissionDaemon.js';

describe('computeNextRunDelayMs', () => {
  it('schedules to the next HH:MM today when target is later', () => {
    const now = new Date('2026-07-02T08:00:00.000Z').getTime();
    expect(computeNextRunDelayMs(now, '09:30', 'UTC')).toBe(90 * 60 * 1000);
  });

  it('rolls to tomorrow when target already passed', () => {
    const now = new Date('2026-07-02T10:00:00.000Z').getTime();
    const delay = computeNextRunDelayMs(now, '09:30', 'UTC');
    expect(delay).toBe(23 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });
});
