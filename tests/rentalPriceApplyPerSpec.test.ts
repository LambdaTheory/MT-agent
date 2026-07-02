import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('applyPerSpec', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-apply-per-spec-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('sends nested per-spec changes to daemon apply and does not broadcast', async () => {
    const commands: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'apply') return new Response(JSON.stringify({ status: 'ok', appliedCount: 2 }));
      if (command.action === 'submit') return new Response(JSON.stringify({ status: 'ok', submitted: true }));
      if (command.action === 'read') {
        return new Response(JSON.stringify({
          status: 'ok',
          productId: '648',
          specs: [{ specId: '3862', title: 'A' }, { specId: '3863', title: 'B' }],
          values: {
            '3862': { rent1day: '50.00' },
            '3863': { rent1day: '80.00' },
          },
        }));
      }
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.applyPerSpec!('648', {
      '3862': { rent1day: '50.00' },
      '3863': { rent1day: '80' },
    });

    expect(result.ok).toBe(true);
    const applyCall = commands.find((command) => command.action === 'apply');
    expect(applyCall).toMatchObject({ action: 'apply', productId: '648' });
    expect(typeof applyCall?.changesFile).toBe('string');
    const changes = JSON.parse(await readFile(String(applyCall?.changesFile), 'utf8')) as Record<string, unknown>;
    expect(changes).toEqual({
      '3862': { rent1day: '50.00' },
      '3863': { rent1day: '80.00' },
    });
    expect(changes).not.toHaveProperty('__broadcast');
    expect(commands.map((command) => command.action)).toEqual(['apply', 'submit', 'read']);
  });

  it('rejects non-numeric product ids before writing changes files', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    await expect(client.applyPerSpec!('../648', { '3862': { rent1day: '50.00' } })).rejects.toThrow('productId');

    expect(fetch).not.toHaveBeenCalled();
  });
});
