import { describe, expect, it } from 'vitest';
import { parseActivityAutomationCliOptions } from '../src/cli/activityAutomation.js';

describe('activity automation cli', () => {
  it('parses product picking and date range options', () => {
    expect(parseActivityAutomationCliOptions(['--pick-products', '--starts-at', '2026-06-23', '--ends-at', '2026-06-30'])).toEqual({
      pickProducts: true,
      startsAt: '2026-06-23',
      endsAt: '2026-06-30',
    });
  });

  it('rejects incomplete date ranges', () => {
    expect(() => parseActivityAutomationCliOptions(['--starts-at', '2026-06-23'])).toThrow(/starts-at/i);
    expect(() => parseActivityAutomationCliOptions(['--ends-at', '2026-06-30'])).toThrow(/ends-at/i);
  });
});
