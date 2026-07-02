import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('spec dimension client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends spec-add-dim with the requested title and verifies through spec-discover', async () => {
    const commands: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'spec-add-dim') return new Response(JSON.stringify({ status: 'ok', title: '激光险' }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [{ specId: 'dim-1', title: '激光险', items: [] }] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specAddDim!('648', '激光险');

    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      { action: 'spec-add-dim', productId: '648', itemTitle: '激光险' },
      { action: 'spec-discover', productId: '648' },
    ]);
  });

  it('sends spec-remove-dim with the requested dimension id and verifies through spec-discover', async () => {
    const commands: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'spec-remove-dim') return new Response(JSON.stringify({ status: 'ok', specDimId: 'dim-1' }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specRemoveDim!({ productId: '648', specDimId: 'dim-1' });

    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      { action: 'spec-remove-dim', productId: '648', specDimId: 'dim-1', expectedProductId: '648' },
      { action: 'spec-discover', productId: '648' },
    ]);
  });
});
