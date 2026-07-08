import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRefreshActivityPlan,
  refreshActivityPlanConfirmationKey,
  saveRefreshActivityPlan,
  verifyRefreshActivityPlanKey,
} from '../src/feishuBot/refreshActivityPlanStore.js';

describe('refreshActivityPlanStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-ra-plan-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips plan by ref', async () => {
    const plan = { date: '2026-07-07', delistProductIds: ['683', '686'], newLinkItemsForRefill: [], skippedGroups: [], canRefill: false };
    const ref = await saveRefreshActivityPlan(dir, plan);

    expect(ref).toMatch(/^refresh_plan_\d+_[a-f0-9]{16}$/);
    const loaded = await loadRefreshActivityPlan(dir, ref);
    expect(loaded?.delistProductIds).toEqual(['683', '686']);
  });

  it('returns null for unknown ref', async () => {
    await expect(loadRefreshActivityPlan(dir, 'refresh_plan_1_deadbeef1234dead')).resolves.toBeNull();
  });

  it('confirms key matches plan+strategy', () => {
    const plan = { date: '2026-07-07', delistProductIds: ['683'], newLinkItemsForRefill: [], skippedGroups: [], canRefill: true };
    const key = refreshActivityPlanConfirmationKey(plan, 'delist_only');

    expect(verifyRefreshActivityPlanKey(plan, 'delist_only', key)).toBe(true);
    expect(verifyRefreshActivityPlanKey(plan, 'delist_and_refill', key)).toBe(false);
  });
});
