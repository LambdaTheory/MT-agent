import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function clientWith(overrides: Partial<RentalPriceSkillClient>): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async read(productId) {
      return { productId, ok: true, specs: [{ specId: '3863', title: 'B' }], values: { '3863': { rent1day: '70.00' } }, lines: ['read: ok'] };
    },
    async copy() { throw new Error('copy should not run'); },
    async delist() { throw new Error('delist should not run'); },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover(productId) { return { productId, ok: true, dimensions: [], lines: ['spec-discover: ok'] }; },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    ...overrides,
  };
}

describe('rental per-spec price tools', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-per-spec-tool-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('plans a confirmation request for exact per-spec prices without applying', async () => {
    const applyPerSpec = vi.fn();
    const client = clientWith({ applyPerSpec });

    const response = await executeAgentToolRequest(
      { toolName: 'rental.perSpecPricePlan', arguments: { productId: '648', specPrices: [{ specId: '3863', fields: { rent1day: '80.00' } }] }, reason: '给 B 规格写绝对价' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(applyPerSpec).not.toHaveBeenCalled();
    expect(response.text).toContain('按规格改价预览：商品 648');
    expect(response.text).toContain('3863');
    expect(response.text).toContain('rent1day: 70.00 -> 80.00');
    expect(JSON.stringify(response.card)).toContain('rental.perSpecPriceApply');
  });

  it('applies only the specified spec values', async () => {
    const applyPerSpec = vi.fn(async () => ({ productId: '648', ok: true, lines: ['apply: ok', 'submit: ok', 'verify: ok'] }));
    const client = clientWith({ applyPerSpec });

    const response = await executeAgentToolRequest(
      { toolName: 'rental.perSpecPriceApply', arguments: { productId: '648', specFields: { '3863': { rent1day: '80.00' } } }, reason: '确认写 B 规格绝对价' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(applyPerSpec).toHaveBeenCalledWith('648', { '3863': { rent1day: '80.00' } });
    expect(response.text).toContain('按规格改价成功：商品 648');
    expect(response.metadata).toMatchObject({ toolName: 'rental.perSpecPriceApply', ok: true, productId: '648' });
  });
});
