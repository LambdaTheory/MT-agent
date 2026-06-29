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
    expect(JSON.stringify(response?.card)).toContain('link_registry_maintenance_start_submit');
    const promptForms = ((response?.card as { body?: { elements?: Array<{ tag?: string; name?: string; elements?: Array<Record<string, unknown>> }> } }).body?.elements ?? [])
      .filter((element) => element.tag === 'form');
    const promptButtons = promptForms.flatMap((form) => form.elements ?? []);
    expect(promptForms.map((form) => form.name)).toEqual([
      'link_registry_maintenance_start_form',
      'link_registry_maintenance_snooze_form',
      'link_registry_maintenance_ignore_form',
    ]);
    expect(promptButtons.every((button) => button.form_action_type === 'submit')).toBe(true);

    const saved = JSON.parse(await readFile(join(outputDir, '2026-06-24', 'link-registry-maintenance-session.json'), 'utf8')) as {
      queue: Array<{ internalProductId: string }>;
    };
    expect(saved.queue.map((item) => item.internalProductId)).toEqual(['702', '703']);
  });

  it('shows refresh summary before manual maintenance when prompt summary is provided', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-summary-'));

    const response = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-24',
      registry: registryEntries,
      referenceDate: '2026-06-24',
      overridesPath: join(outputDir, 'config', 'link-registry-overrides.json'),
      promptSummary: {
        referenceDate: '2026-06-24',
        refreshMode: 'default',
        goodsExportRefreshed: true,
        daemonRefreshed: true,
        newLinkCount: 5,
        autoReadyCount: 3,
        pendingCount: 2,
        grouped: [
          { label: 'Action 5 Pro', totalCount: 2, pendingCount: 1, autoReadyCount: 1 },
          { label: 'Pocket 3', totalCount: 3, pendingCount: 1, autoReadyCount: 2 },
        ],
        warnings: [],
      },
    });

    const cardText = JSON.stringify(response?.card);
    expect(cardText).toContain('本次刷新结果');
    expect(cardText).toContain('新增链接 5 条');
    expect(cardText).toContain('Action 5 Pro 2 条');
    expect(cardText).toContain('Pocket 3 3 条');
    expect(cardText).toContain('开始维护');
  });

  it('can show a summary-only card when new links are auto-archived and no manual queue remains', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-auto-ready-'));

    const response = await openLinkRegistryMaintenancePrompt(outputDir, {
      date: '2026-06-24',
      registry: [registryEntries[0]!, registryEntries[3]!],
      referenceDate: '2026-06-24',
      overridesPath: join(outputDir, 'config', 'link-registry-overrides.json'),
      promptSummary: {
        referenceDate: '2026-06-24',
        refreshMode: 'daemon_only',
        goodsExportRefreshed: true,
        daemonRefreshed: false,
        newLinkCount: 2,
        autoReadyCount: 2,
        pendingCount: 0,
        grouped: [
          { label: 'Pocket 3', totalCount: 1, pendingCount: 0, autoReadyCount: 1 },
          { label: 'Wide300', totalCount: 1, pendingCount: 0, autoReadyCount: 1 },
        ],
        warnings: ['daemon 链接目录刷新失败：network timeout'],
      },
    });

    expect(response?.text).toContain('已自动归档');
    const cardText = JSON.stringify(response?.card);
    expect(cardText).toContain('本次刷新结果');
    expect(cardText).toContain('新增链接 2 条');
    expect(cardText).toContain('不需要人工补录');
    expect(cardText).not.toContain('link_registry_maintenance_start_submit');
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
    expect(JSON.stringify(started.card)).toContain('link_registry_maintenance_exit_submit');

    const startedFormButtons = ((((started.card as { body?: { elements?: Array<{ tag?: string; elements?: Array<Record<string, unknown>> }> } }).body?.elements ?? [])
      .find((element) => element.tag === 'form'))?.elements ?? [])
      .filter((element) => element.tag === 'button');
    expect(startedFormButtons).toHaveLength(2);
    expect(startedFormButtons.every((button) => button.form_action_type === 'submit')).toBe(true);

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
