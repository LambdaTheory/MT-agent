import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import {
  handleLinkRegistryMaintenanceCardAction,
  openLinkRegistryMaintenancePrompt,
} from '../src/linkRegistry/maintenanceSession.js';

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
    productName: 'DJI Pocket3 创作者套装',
    shortName: 'Pocket3',
    status: 'active',
    firstSeenDate: '2026-06-24',
    updatedAt: '2026-06-24',
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'Wide300 + 20张相纸',
    shortName: 'Wide300',
    sameSkuGroupId: 'instax-wide300',
    status: 'active',
    firstSeenDate: '2026-06-23',
    updatedAt: '2026-06-23',
    source: ['goods_first_seen'],
  },
  {
    internalProductId: '704',
    platformProductId: 'platform-704',
    productName: 'Wide300 单机身',
    shortName: 'Wide300',
    sameSkuGroupId: 'instax-wide300',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'instant-camera',
    status: 'active',
    source: ['product_id_mapping', 'link_registry_override'],
  },
];

describe('link registry maintenance session', () => {
  it('opens a proactive reminder card and persists the maintenance session', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-'));

    const response = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      referenceDate: '2026-06-24',
      overridesPath: join(outputDir, 'config', 'link-registry-overrides.json'),
    });

    expect(response).not.toBeNull();
    expect(response?.text).toContain('发现 2 条待维护链接');
    expect(JSON.stringify(response?.card)).toContain('开始维护');
    expect(JSON.stringify(response?.card)).toContain('link_registry_maintenance_start');

    const saved = JSON.parse(await readFile(join(outputDir, '2026-06-24', 'link-registry-maintenance-session.json'), 'utf8')) as {
      queue: Array<{ internalProductId: string }>;
    };
    expect(saved.queue.map((item) => item.internalProductId)).toEqual(['702', '703']);
  });

  it('starts review from the reminder and writes accepted edits into overrides', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-review-'));
    const overridesPath = join(outputDir, 'config', 'link-registry-overrides.json');

    await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      referenceDate: '2026-06-24',
      overridesPath,
    });

    const started = await handleLinkRegistryMaintenanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'start',
    });
    expect(started.text).toContain('链接维护 1/2');
    expect(JSON.stringify(started.card)).toContain('Pocket3');
    expect(JSON.stringify(started.card)).toContain('link_registry_maintenance_submit');

    const advanced = await handleLinkRegistryMaintenanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'submit',
      internalProductId: '702',
      reviewIndex: 1,
      decision: 'accept_with_edit',
      sameSkuGroupId: 'dji-pocket-3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      shortName: 'DJI Pocket 3',
      reviewerId: 'ou_test',
    });

    expect(advanced.text).toContain('链接维护 2/2');
    expect(JSON.stringify(advanced.card)).toContain('Wide300');

    const overrides = JSON.parse(await readFile(overridesPath, 'utf8')) as {
      entries: Array<{ internalProductId: string; sameSkuGroupId?: string; categoryId?: string; productType?: string; shortName?: string }>;
    };
    expect(overrides.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        internalProductId: '702',
        sameSkuGroupId: 'dji-pocket-3',
        categoryId: 'camera',
        productType: 'gimbal-camera',
        shortName: 'DJI Pocket 3',
      }),
    ]));
  });

  it('suppresses duplicate reminders for the same maintenance signature after snooze', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-throttle-'));
    const overridesPath = join(outputDir, 'config', 'link-registry-overrides.json');

    const first = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      referenceDate: '2026-06-24',
      overridesPath,
    });
    expect(first).not.toBeNull();

    await handleLinkRegistryMaintenanceCardAction(outputDir, {
      date: '2026-06-24',
      action: 'snooze',
    });

    const second = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-25',
      registry: registryEntries,
      referenceDate: '2026-06-25',
      overridesPath,
    });
    expect(second).toBeNull();

    const changedRegistry = [
      ...registryEntries,
      {
        internalProductId: '705',
        platformProductId: 'platform-705',
        productName: 'Ace Pro 2 单机身',
        shortName: 'Ace Pro 2',
        status: 'active',
        firstSeenDate: '2026-06-26',
        updatedAt: '2026-06-26',
        source: ['goods_first_seen'],
      } satisfies LinkRegistryEntry,
    ];

    const third = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-26',
      registry: changedRegistry,
      referenceDate: '2026-06-26',
      overridesPath,
    });
    expect(third).not.toBeNull();
    expect(third?.text).toContain('发现 3 条待维护链接');
  });
});
