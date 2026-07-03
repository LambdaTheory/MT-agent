import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('specAddAndRefresh alignment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards specDimId to native spec-add-and-refresh action', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetch);

    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223' });
    await client.specAddAndRefresh('648', '1355', '128G');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9223',
      expect.objectContaining({
        body: JSON.stringify({ action: 'spec-add-and-refresh', productId: '648', specDimId: '1355', itemTitle: '128G' }),
      }),
    );
  });

  it('requires specDimId in the MT tool schema', () => {
    expect(findAgentTool('rental.specAddAndRefresh')?.inputSchema).toMatchObject({
      properties: {
        productId: { type: 'string' },
        specDimId: { type: 'string' },
        itemTitle: { type: 'string' },
      },
      required: ['productId', 'specDimId', 'itemTitle'],
      additionalProperties: false,
    });
  });
});
