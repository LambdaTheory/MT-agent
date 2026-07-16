import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

interface RentalFormStateClient extends RentalPriceSkillClient {
  specAddItem(productId: string, specDimId: string, itemTitle: string): Promise<{ productId: string; ok: boolean; itemTitle: string; lines: string[] }>;
  specRefresh(productId: string): Promise<{ productId: string; ok: boolean; lines: string[] }>;
}

function clientWith(overrides: Partial<RentalFormStateClient>): RentalFormStateClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy() { throw new Error('copy should not run'); },
    async delist() { throw new Error('delist should not run'); },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    async specAddItem() { throw new Error('specAddItem should be overridden'); },
    async specRefresh() { throw new Error('specRefresh should be overridden'); },
    ...overrides,
  };
}

describe('rental form-state tools', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-form-state-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(outputDir, { recursive: true, force: true });
  });

  it('registers specAddItem and specRefresh as confirmed advanced form-state tools', () => {
    expect(findAgentTool('rental.specAddItem')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      inputSchema: {
        properties: {
          productId: { type: 'string' },
          specDimId: { type: 'string' },
          itemTitle: { type: 'string' },
        },
        required: ['productId', 'specDimId', 'itemTitle'],
        additionalProperties: false,
      },
    });
    expect(findAgentTool('rental.specRefresh')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      inputSchema: {
        properties: { productId: { type: 'string' } },
        required: ['productId'],
        additionalProperties: false,
      },
    });
  });

  it('sends native spec-add-item and spec-refresh daemon actions', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetch);

    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' }) as RentalFormStateClient;
    await client.specAddItem('648', '1355', '128G');
    await client.specRefresh('648');

    const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit | undefined)?.body)) as Record<string, unknown>);
    expect(bodies.filter((body) => body.action === 'hello')).toHaveLength(2);
    expect(bodies.find((body) => body.action === 'spec-add-item')).toMatchObject({ productId: '648', specDimId: '1355', itemTitle: '128G', _negotiation: { actionClass: 'mutation' } });
    expect(bodies.find((body) => body.action === 'spec-refresh')).toMatchObject({ productId: '648', _negotiation: { actionClass: 'mutation' } });
  });

  it('dispatches confirmed form-state tools to the rental client', async () => {
    const specAddItem = vi.fn(async () => ({ productId: '648', ok: true, itemTitle: '128G', lines: ['spec-add-item: ok'] }));
    const specRefresh = vi.fn(async () => ({ productId: '648', ok: true, lines: ['spec-refresh: ok'] }));
    const client = clientWith({ specAddItem, specRefresh });

    const add = await executeAgentToolRequest(
      { toolName: 'rental.specAddItem', arguments: { productId: '648', specDimId: '1355', itemTitle: '128G' }, reason: 'confirmed add item' },
      outputDir,
      { rentalPriceClient: client },
    );
    const refresh = await executeAgentToolRequest(
      { toolName: 'rental.specRefresh', arguments: { productId: '648' }, reason: 'confirmed refresh' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(specAddItem).toHaveBeenCalledWith('648', '1355', '128G');
    expect(specRefresh).toHaveBeenCalledWith('648');
    expect(add.metadata).toMatchObject({ toolName: 'rental.specAddItem', ok: true, productId: '648' });
    expect(refresh.metadata).toMatchObject({ toolName: 'rental.specRefresh', ok: true, productId: '648' });
  });
});
