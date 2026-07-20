import { describe, expect, it } from 'vitest';
import { canApproveInactiveRefresh, parseInactiveRefreshApproverIds } from '../src/feishuBot/inactiveRefreshAuthorization.js';

describe('inactive refresh authorization', () => {
  it('keeps empty allowlists fail-closed', () => {
    expect(canApproveInactiveRefresh('ou_actor', [])).toBe(false);
    expect(canApproveInactiveRefresh('ou_actor', undefined)).toBe(false);
  });

  it('allows any actor when the allowlist contains wildcard', () => {
    expect(parseInactiveRefreshApproverIds('*')).toEqual(['*']);
    expect(canApproveInactiveRefresh('ou_anyone', ['*'])).toBe(true);
    expect(canApproveInactiveRefresh(['ou_anyone', 'user_anyone'], ['*'])).toBe(true);
  });
});
