import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('applyPerSpec', () => {
  let rootDir: string;
  let dataRoot: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-apply-per-spec-'));
    dataRoot = join(dirname(rootDir), `.${basename(rootDir)}-data`);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(rootDir, { recursive: true, force: true });
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('rejects direct per-spec writes before daemon apply', async () => {
    const commands: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      commands.push(command);
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    await expect(client.applyPerSpec!('648', {
      '3862': { rent1day: '50.00' },
      '3863': { rent1day: '80' },
    })).rejects.toThrow('逐规格直接写入已停用');

    expect(commands.filter((command) => command.action === 'apply')).toHaveLength(0);
  });

  it('rejects non-numeric product ids before writing changes files', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    await expect(client.applyPerSpec!('../648', { '3862': { rent1day: '50.00' } })).rejects.toThrow('productId');

    expect(fetch).not.toHaveBeenCalled();
  });
});
