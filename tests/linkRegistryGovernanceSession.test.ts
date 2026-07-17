import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  handleLinkRegistryGovernanceCardAction,
  openLinkRegistryGovernancePrompt,
} from '../src/linkRegistry/governanceSession.js';
import { loadLinkRegistryReminderState, saveLinkRegistryReminderState } from '../src/linkRegistry/reminderState.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const registryEntries: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'DJI Pocket 3 标准版',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'active',
    source: ['product_id_mapping', 'link_registry_override'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'DJI Pocket 3 创作者套装',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'removed',
    source: ['goods_link_lifecycle'],
  },
  {
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'Wide300 单机身',
    shortName: 'Wide300',
    sameSkuGroupId: 'instax-wide300',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'instant-camera',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '704',
    platformProductId: 'platform-704',
    productName: 'DJI Pocket 3 镜头配件',
    shortName: 'Pocket 3 Lens',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'lens',
    categoryName: '镜头',
    productType: 'lens-accessory',
    status: 'active',
    source: ['product_id_mapping'],
  },
];

const overrideRisks: LinkRegistryOverrideRisk[] = [
  { type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' },
];

describe('link registry governance session', () => {
  it('opens a separate governance reminder for group-level and override risks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-'));

    const response = await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      overrideRisks,
    });

    expect(response).not.toBeNull();
    expect(response?.text).toContain('发现 2 个组级治理问题');
    expect(JSON.stringify(response?.card)).toContain('开始治理');
    expect(JSON.stringify(response?.card)).toContain('组内混类');
    expect(JSON.stringify(response?.card)).toContain('人工覆盖风险');
    const promptForms = ((response?.card as { body?: { elements?: Array<{ tag?: string; name?: string; elements?: Array<Record<string, unknown>> }> } }).body?.elements ?? [])
      .filter((element) => element.tag === 'form');
    const promptButtons = promptForms.flatMap((form) => form.elements ?? []);
    expect(promptForms.map((form) => form.name)).toEqual([
      'link_registry_governance_start_form',
      'link_registry_governance_snooze_form',
      'link_registry_governance_ignore_form',
    ]);
    expect(promptButtons.every((button) => button.form_action_type === 'submit')).toBe(true);
  });

  it('submits governance decisions, persists records, and suppresses duplicate reminders for the same signature', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-review-'));
    await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      overrideRisks,
    });

    const started = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'start',
    });
    expect(started.text).toContain('组级治理 1/2');
    expect(JSON.stringify(started.card)).toContain('dji-pocket-3');
    expect(JSON.stringify(started.card)).toContain('link_registry_governance_submit');
    expect(JSON.stringify(started.card)).toContain('link_registry_governance_exit_submit');

    const startedFormButtons = ((((started.card as { body?: { elements?: Array<{ tag?: string; elements?: Array<Record<string, unknown>> }> } }).body?.elements ?? [])
      .find((element) => element.tag === 'form'))?.elements ?? [])
      .filter((element) => element.tag === 'button');
    expect(startedFormButtons).toHaveLength(2);
    expect(startedFormButtons.every((button) => button.form_action_type === 'submit')).toBe(true);

    const second = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      reviewIndex: 1,
      decision: 'resolved',
      note: 'Pocket 3 组样本已补齐，后续继续观察新增链接。',
      reviewerId: 'ou_governance',
    });
    expect(second.text).toContain('组级治理 2/2');
    expect(JSON.stringify(second.card)).toContain('人工覆盖风险 999');

    const completed = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      reviewIndex: 2,
      decision: 'watch',
      note: 'Override 风险先记录为观察项。',
      reviewerId: 'ou_governance',
    });
    expect(completed.text).toContain('组级治理已处理完成');

    const records = JSON.parse(
      await readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8'),
    ) as {
      reviewRecords: Array<{ decision: string; note?: string; reviewerId?: string }>;
    };
    expect(records.reviewRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        decision: 'resolved',
        note: 'Pocket 3 组样本已补齐，后续继续观察新增链接。',
        reviewerId: 'ou_governance',
      }),
    ]));

    const duplicated = await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-25',
      registry: registryEntries,
      overrideRisks,
    });
    expect(duplicated).toBeNull();

    const changedRisks: LinkRegistryOverrideRisk[] = [
      ...overrideRisks,
      { type: 'unknown_internal_product_id', message: 'Override target not found: 888', internalProductId: '888' },
    ];
    const changed = await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-26',
      registry: registryEntries,
      overrideRisks: changedRisks,
    });
    expect(changed).not.toBeNull();
    expect(changed?.text).toContain('发现 3 个组级治理问题');
  });

  it('serializes concurrent governance submissions without losing review records', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-serialized-'));
    await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      overrideRisks,
    });
    await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'start',
    });

    await Promise.all([
      handleLinkRegistryGovernanceCardAction(outputDir, {
        date: '2026-06-24',
        action: 'submit',
        reviewIndex: 1,
        decision: 'resolved',
        note: 'Pocket 3 done.',
        reviewerId: 'ou_governance_1',
      }),
      handleLinkRegistryGovernanceCardAction(outputDir, {
        date: '2026-06-24',
        action: 'submit',
        reviewIndex: 2,
        decision: 'watch',
        note: 'Wide300 watch.',
        reviewerId: 'ou_governance_2',
      }),
    ]);

    const session = JSON.parse(
      await readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8'),
    ) as { status: string; reviewRecords: Array<{ reviewIndex: number; decision: string }> };
    expect(session.status).toBe('completed');
    expect(session.reviewRecords.map((record) => record.reviewIndex).sort()).toEqual([1, 2]);
    expect(session.reviewRecords.map((record) => record.decision).sort()).toEqual(['resolved', 'watch']);
  });

  it('treats duplicate governance submissions for one review index as idempotent', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-idempotent-'));
    await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      overrideRisks,
    });
    await handleLinkRegistryGovernanceCardAction(outputDir, { date: '2026-06-24', action: 'start' });

    const action = {
      date: '2026-06-24',
      action: 'submit' as const,
      reviewIndex: 1,
      decision: 'resolved' as const,
      note: 'Pocket 3 done.',
      reviewerId: 'ou_governance_duplicate',
    };
    await Promise.all([
      handleLinkRegistryGovernanceCardAction(outputDir, action),
      handleLinkRegistryGovernanceCardAction(outputDir, action),
    ]);

    const session = JSON.parse(
      await readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8'),
    ) as { reviewRecords: Array<{ reviewIndex: number }> };
    expect(session.reviewRecords.map((record) => record.reviewIndex)).toEqual([1]);
  });

  it('does not let a forced prompt reset overwrite an active governance review', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-force-race-'));
    await openLinkRegistryGovernancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      overrideRisks,
    });
    await handleLinkRegistryGovernanceCardAction(outputDir, { date: '2026-06-24', action: 'start' });

    const changedRisks: LinkRegistryOverrideRisk[] = [
      ...overrideRisks,
      { type: 'unknown_internal_product_id', message: 'Override target not found: 888', internalProductId: '888' },
    ];
    await Promise.all([
      openLinkRegistryGovernancePrompt(outputDir, {
        date: '2026-06-24',
        registry: registryEntries,
        overrideRisks: changedRisks,
        force: true,
      }),
      handleLinkRegistryGovernanceCardAction(outputDir, {
        date: '2026-06-24',
        action: 'submit',
        reviewIndex: 1,
        decision: 'resolved',
        note: 'Pocket 3 done.',
        reviewerId: 'ou_governance_force_race',
      }),
    ]);

    const session = JSON.parse(
      await readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8'),
    ) as { status: string; queue: unknown[]; reviewRecords: Array<{ reviewIndex: number }> };
    expect(session.status).toBe('reviewing');
    expect(session.queue).toHaveLength(2);
    expect(session.reviewRecords.map((record) => record.reviewIndex)).toEqual([1]);
  });

  it('serializes concurrent reminder state updates for one state file', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-reminder-state-'));

    await Promise.all([
      saveLinkRegistryReminderState(outputDir, 'maintenance', {
        signature: 'maintenance-signature',
        status: 'prompted',
        sessionDate: '2026-06-24',
        updatedAt: '2026-06-24T10:00:00.000Z',
      }),
      saveLinkRegistryReminderState(outputDir, 'governance', {
        signature: 'governance-signature',
        status: 'reviewing',
        sessionDate: '2026-06-24',
        updatedAt: '2026-06-24T10:01:00.000Z',
      }),
    ]);

    await expect(loadLinkRegistryReminderState(outputDir, 'maintenance')).resolves.toMatchObject({
      signature: 'maintenance-signature',
      status: 'prompted',
    });
    await expect(loadLinkRegistryReminderState(outputDir, 'governance')).resolves.toMatchObject({
      signature: 'governance-signature',
      status: 'reviewing',
    });
  });
});
