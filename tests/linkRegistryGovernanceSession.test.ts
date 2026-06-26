import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  handleLinkRegistryGovernanceCardAction,
  openLinkRegistryGovernancePrompt,
} from '../src/linkRegistry/governanceSession.js';
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
    expect(response?.text).toContain('发现 3 个组级治理问题');
    expect(JSON.stringify(response?.card)).toContain('开始治理');
    expect(JSON.stringify(response?.card)).toContain('同款组样本不足');
    expect(JSON.stringify(response?.card)).toContain('人工覆盖风险');
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
    expect(started.text).toContain('组级治理 1/3');
    expect(JSON.stringify(started.card)).toContain('dji-pocket-3');
    expect(JSON.stringify(started.card)).toContain('link_registry_governance_submit');

    const second = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      reviewIndex: 1,
      decision: 'resolved',
      note: 'Pocket 3 组样本已补齐，后续继续观察新增链接。',
      reviewerId: 'ou_governance',
    });
    expect(second.text).toContain('组级治理 2/3');
    expect(JSON.stringify(second.card)).toContain('instax-wide300');

    await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      reviewIndex: 2,
      decision: 'watch',
      note: 'Wide300 组先记录为观察项。',
      reviewerId: 'ou_governance',
    });

    const completed = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      reviewIndex: 3,
      decision: 'ignored',
      note: '本次 override 风险留待下轮统一处理。',
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
    expect(changed?.text).toContain('发现 4 个组级治理问题');
  });
});
