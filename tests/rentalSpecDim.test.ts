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
    async copy() { throw new Error('copy should not run'); },
    async delist() { throw new Error('delist should not run'); },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover(productId) { return { productId, ok: true, dimensions: [{ specId: 'dim-1', title: '颜色', items: [] }], lines: ['spec-discover: ok'] }; },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    ...overrides,
  };
}

describe('rental spec dimension tools', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-spec-dim-tool-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('plans a spec dimension add confirmation without applying', async () => {
    const specAddDim = vi.fn();
    const client = clientWith({ specAddDim });

    const response = await executeAgentToolRequest(
      { toolName: 'rental.specDimPlan', arguments: { productId: '648', action: 'add', title: '激光险' }, reason: '添加激光险维度' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(specAddDim).not.toHaveBeenCalled();
    expect(response.text).toContain('规格维度变更预览：商品 648');
    expect(response.text).toContain('添加维度：激光险');
    expect(JSON.stringify(response.card)).toContain('rental.specDimApply');
  });

  it('applies spec dimension add and remove through atomic client methods', async () => {
    const specAddDim = vi.fn(async () => ({ productId: '648', ok: true, itemTitle: '激光险', lines: ['spec-add-dim: ok'] }));
    const specRemoveDim = vi.fn(async () => ({ productId: '648', ok: true, specDimId: 'dim-1', itemTitle: 'dim-1', lines: ['spec-remove-dim: ok'] }));
    const client = clientWith({ specAddDim, specRemoveDim });

    const add = await executeAgentToolRequest(
      { toolName: 'rental.specDimApply', arguments: { productId: '648', action: 'add', title: '激光险' }, reason: '确认添加激光险维度' },
      outputDir,
      { rentalPriceClient: client },
    );
    const remove = await executeAgentToolRequest(
      { toolName: 'rental.specDimApply', arguments: { productId: '648', action: 'remove', specDimId: 'dim-1' }, reason: '确认删除颜色维度' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(specAddDim).toHaveBeenCalledWith('648', '激光险');
    expect(specRemoveDim).toHaveBeenCalledWith({ productId: '648', specDimId: 'dim-1' });
    expect(add.metadata).toMatchObject({ toolName: 'rental.specDimApply', ok: true, productId: '648', action: 'add' });
    expect(remove.metadata).toMatchObject({ toolName: 'rental.specDimApply', ok: true, productId: '648', action: 'remove' });
  });
});
