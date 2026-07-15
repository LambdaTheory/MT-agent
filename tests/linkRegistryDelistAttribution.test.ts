import { describe, expect, it } from 'vitest';
import { attributeDelist } from '../src/linkRegistry/delistAttribution.js';

const delisted = { listingState: 'delisted' as const, statusObservedAt: '2026-07-14T10:00:00.000Z' };

describe('attributeDelist', () => {
  it('maps review, frozen, and other platform restrictions as confirmed causes', () => {
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ restriction: { kind: 'review_rejected', reasonText: '资质不足', observedAt: '2026-07-14T09:00:00.000Z' }, listingState: 'delisted', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_review_rejected', confidence: 'confirmed' });
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ restriction: { kind: 'frozen', reasonText: '涉嫌违规', observedAt: '2026-07-14T09:00:00.000Z' }, listingState: 'delisted', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_frozen', confidence: 'confirmed' });
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ restriction: { kind: 'other', reasonText: '平台限制', observedAt: '2026-07-14T09:00:00.000Z' }, listingState: 'delisted', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_restricted', confidence: 'confirmed' });
  });

  it('makes platform restriction win over a matching agent event', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{ restriction: { kind: 'frozen', reasonText: '冻结', observedAt: '2026-07-14T09:00:00.000Z' }, listingState: 'delisted', observedAt: '2026-07-14T09:00:00.000Z' }],
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'platform_frozen', confidence: 'confirmed' });
  });

  it('confirms agent delist only after a later delisted readback', () => {
    expect(attributeDelist({
      ...delisted,
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist', runId: 'run-1' }],
    })).toMatchObject({ cause: 'agent_confirmed_manual_off_shelf', confidence: 'confirmed' });

    expect(attributeDelist({
      ...delisted,
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T10:00:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });

    expect(attributeDelist({
      ...delisted,
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T10:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });

  it('rejects an on-sale restriction from an older snapshot when daemon later reports delisted', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'review_rejected', reasonText: '旧审核原因', observedAt: '2026-07-14T09:00:00.000Z' },
        listingState: 'on_sale',
        observedAt: '2026-07-14T09:00:00.000Z',
      }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });

  it('rejects a stale restriction when a newer daemon reports delisted', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'frozen', reasonText: '过期冻结', observedAt: '2026-07-12T09:00:00.000Z' },
        listingState: 'delisted',
        observedAt: '2026-07-14T10:00:00.000Z',
      }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });


  it('rejects stale outer platform snapshots even when nested restriction time is fresh', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'frozen', reasonText: 'nested fresh restriction', observedAt: '2026-07-14T09:00:00.000Z' },
        listingState: 'delisted',
        observedAt: '2026-07-12T09:00:00.000Z',
      }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });

  it('rejects future outer platform snapshots even when nested restriction time is before final status', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'frozen', reasonText: 'future outer restriction', observedAt: '2026-07-14T09:00:00.000Z' },
        listingState: 'delisted',
        observedAt: '2026-07-14T10:30:00.000Z',
      }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });

  it('accepts current platform restrictions only when outer and nested observation times match', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'frozen', reasonText: 'current restriction', observedAt: '2026-07-14T09:00:00.000Z' },
        listingState: 'delisted',
        observedAt: '2026-07-14T09:00:00.000Z',
      }],
    })).toMatchObject({
      cause: 'platform_frozen',
      confidence: 'confirmed',
      evidence: [{ observedAt: '2026-07-14T09:00:00.000Z', reasonText: 'current restriction' }],
    });
  });

  it('includes listingStatusText in platform restriction evidence when nonblank', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{
        restriction: { kind: 'frozen', reasonText: '冻结', observedAt: '2026-07-14T09:00:00.000Z' },
        listingState: 'delisted',
        listingStatusText: '已下架',
        observedAt: '2026-07-14T09:00:00.000Z',
      }],
    })).toMatchObject({
      cause: 'platform_frozen',
      confidence: 'confirmed',
      evidence: [{ observedAt: '2026-07-14T09:00:00.000Z', reasonText: '冻结', listingStatusText: '已下架' }],
    });
  });

  it('suppresses all attribution when the source health gate requires it', () => {
    expect(attributeDelist({
      ...delisted,
      suppressDelistAttribution: true,
      platformRestrictions: [{ restriction: { kind: 'frozen', reasonText: '涉嫌违规', observedAt: '2026-07-14T09:00:00.000Z' }, listingState: 'delisted', observedAt: '2026-07-14T09:00:00.000Z' }],
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist' }],
    })).toBeNull();
  });

  it('uses external pending confirmation only for a delisted current state with no accepted evidence', () => {
    expect(attributeDelist(delisted)).toEqual({
      cause: 'external_manual_off_shelf_pending_confirmation',
      confidence: 'suspected',
      evidence: [],
    });
    expect(attributeDelist({ ...delisted, listingState: 'on_sale' })).toBeNull();
    expect(attributeDelist({ listingState: 'unknown' })).toBeNull();
    expect(attributeDelist({ listingState: 'gone' })).toBeNull();
  });

  it('does not confirm an agent event when final delisted observation has no valid time', () => {
    expect(attributeDelist({
      listingState: 'delisted',
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });
});
