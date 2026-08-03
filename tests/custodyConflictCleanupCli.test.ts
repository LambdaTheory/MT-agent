import { describe, expect, it } from 'vitest';
import { parseCustodyConflictCleanupCliOptions } from '../src/cli/custodyConflictCleanup.js';

describe('custody conflict cleanup cli', () => {
  it('defaults to preview-only mode', () => {
    expect(parseCustodyConflictCleanupCliOptions([])).toEqual({
      execute: false,
    });
  });

  it('rejects mutation flags because real cancellation requires a Feishu confirmation card', () => {
    expect(() => parseCustodyConflictCleanupCliOptions(['--execute'])).toThrow(/preview-only|飞书确认卡/i);
    expect(() => parseCustodyConflictCleanupCliOptions(['--confirm-cancel-custody'])).toThrow(/preview-only|飞书确认卡/i);
    expect(() => parseCustodyConflictCleanupCliOptions(['--execute', '--confirm-cancel-custody'])).toThrow(/preview-only|飞书确认卡/i);
  });

  it('rejects unknown flags instead of guessing', () => {
    expect(() => parseCustodyConflictCleanupCliOptions(['--force'])).toThrow(/preview-only|飞书确认卡/i);
  });
});
