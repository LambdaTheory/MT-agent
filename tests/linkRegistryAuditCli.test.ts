import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLinkRegistryAuditCli } from '../src/cli/linkRegistryAudit.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70 B', sameSkuGroupId: 'canon-sx70', status: 'removed', source: ['product_id_mapping'] },
  { internalProductId: '703', shortName: 'Unclassified', status: 'unknown', source: ['product_id_mapping'] },
];

describe('link registry audit CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a local console summary without sending external messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-'));
    const registryPath = join(dir, 'registry.json');
    await writeFile(registryPath, JSON.stringify(entries), 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runLinkRegistryAuditCli(['--registry', registryPath, '--overrides', join(dir, 'missing-overrides.json')]);

    expect(log.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('现有链接档案盘点: total=3 active=1 removed=1 unknown=1');
    expect(log.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('- camera 相机: active=1 removed=1 unknown=0 total=2');
  });

  it('prints audit JSON when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-json-'));
    const registryPath = join(dir, 'registry.json');
    await writeFile(registryPath, JSON.stringify(entries), 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runLinkRegistryAuditCli(['--registry', registryPath, '--overrides', join(dir, 'missing-overrides.json'), '--json']);

    const audit = JSON.parse(String(log.mock.calls[0]?.[0])) as { total: number; categories: unknown[]; unknownEntries: unknown[] };
    expect(audit.total).toBe(3);
    expect(audit.categories).toHaveLength(2);
    expect(audit.unknownEntries).toHaveLength(1);
  });
});
