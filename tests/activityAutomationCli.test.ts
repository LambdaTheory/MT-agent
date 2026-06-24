import { describe, expect, it } from 'vitest';
import { parseActivityAutomationCliOptions } from '../src/cli/activityAutomation.js';

describe('activity automation cli', () => {
  it('parses product picking and date range options', () => {
    expect(parseActivityAutomationCliOptions(['--pick-products', '--confirm-submit', '--starts-at', '2026-06-23', '--ends-at', '2026-06-30'])).toEqual({
      confirmSubmit: true,
      pickProducts: true,
      startsAt: '2026-06-23',
      endsAt: '2026-06-30',
    });
  });

  it('keeps submission disabled unless confirm-submit is present', () => {
    expect(parseActivityAutomationCliOptions([])).toEqual({
      confirmSubmit: false,
      pickProducts: false,
      startsAt: undefined,
      endsAt: undefined,
    });
  });

  it('rejects incomplete date ranges', () => {
    expect(() => parseActivityAutomationCliOptions(['--starts-at', '2026-06-23'])).toThrow(/starts-at/i);
    expect(() => parseActivityAutomationCliOptions(['--ends-at', '2026-06-30'])).toThrow(/ends-at/i);
  });
});
