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
      if (command.action === 'submit') return new Response(JSON.stringify({ status: 'ok', submitted: true }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [{ specId: 'dim-1', title: '激光险', items: [] }] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specAddDim!('648', '激光险');

    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      { action: 'spec-add-dim', productId: '648', itemTitle: '激光险' },
      { action: 'submit' },
      { action: 'spec-discover', productId: '648' },
    ]);
  });

  it('fails spec-add-dim when readback does not include the added title', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (command.action === 'spec-add-dim') return new Response(JSON.stringify({ status: 'ok', title: '激光险' }));
      if (command.action === 'submit') return new Response(JSON.stringify({ status: 'ok', submitted: true }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [{ specId: 'dim-1', title: '颜色', items: [] }] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specAddDim!('648', '激光险');

    expect(result.ok).toBe(false);
    expect(result.lines).toContain('verified: false');
  });

  it('rejects non-numeric product ids before spec-add-dim daemon calls', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    await expect(client.specAddDim!('../648', '激光险')).rejects.toThrow('productId');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends spec-remove-dim with the requested dimension id and verifies through spec-discover', async () => {
    const commands: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'spec-remove-dim') return new Response(JSON.stringify({ status: 'ok', specDimId: 'dim-1' }));
      if (command.action === 'submit') return new Response(JSON.stringify({ status: 'ok', submitted: true }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specRemoveDim!({ productId: '648', specDimId: 'dim-1' });

    expect(result.ok).toBe(true);
    expect(commands).toEqual([
      { action: 'spec-remove-dim', productId: '648', specDimId: 'dim-1', expectedProductId: '648' },
      { action: 'submit' },
      { action: 'spec-discover', productId: '648' },
    ]);
  });

  it('fails spec-remove-dim when readback still includes the removed dimension id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const command = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (command.action === 'spec-remove-dim') return new Response(JSON.stringify({ status: 'ok', specDimId: 'dim-1' }));
      if (command.action === 'submit') return new Response(JSON.stringify({ status: 'ok', submitted: true }));
      if (command.action === 'spec-discover') return new Response(JSON.stringify({ status: 'ok', dimensions: [{ specId: 'dim-1', title: '颜色', items: [] }] }));
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    const result = await client.specRemoveDim!({ productId: '648', specDimId: 'dim-1' });

    expect(result.ok).toBe(false);
    expect(result.lines).toContain('verified: false');
  });

  it('rejects non-numeric product ids before spec-remove-dim daemon calls', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });

    await expect(client.specRemoveDim!({ productId: '../648', specDimId: 'dim-1' })).rejects.toThrow('productId');

    expect(fetch).not.toHaveBeenCalled();
  });
});
