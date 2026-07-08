import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('rental atomization integration', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-atomization-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('composes spec read, dimension add, and per-spec absolute price apply as separate atomic tools', async () => {
    const calls: unknown[] = [];
    const client: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async read() { throw new Error('read should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover(productId) {
        calls.push({ action: 'specDiscover', productId });
        return { productId, ok: true, dimensions: [{ specId: 'laser', title: '激光险', items: [{ id: '3863', title: '含激光险' }] }], lines: ['spec-discover: ok'] };
      },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
      async specAddDim(productId, title) {
        calls.push({ action: 'specAddDim', productId, title });
        return { productId, ok: true, itemTitle: title, lines: ['spec-add-dim: ok', 'spec-discover: ok'] };
      },
      async applyPerSpec(productId, specFields) {
        calls.push({ action: 'applyPerSpec', productId, specFields });
        return { productId, ok: true, lines: ['apply: ok', 'submit: ok', 'verify: ok'] };
      },
    };
    const ledgerContext = { outputDir, runId: 'run-1', decisionId: 'decision-1', subject: 'rental:648' };

    const read = await executeAgentToolRequest(
      { toolName: 'rental.specDiscover', arguments: { productId: '648' }, reason: '先读规格' },
      outputDir,
      { rentalPriceClient: client },
    );
    const add = await executeAgentToolRequest(
      { toolName: 'rental.specDimApply', arguments: { productId: '648', action: 'add', title: '激光险' }, reason: '确认添加激光险维度' },
      outputDir,
      { rentalPriceClient: client, ledgerContext },
    );
    const price = await executeAgentToolRequest(
      { toolName: 'rental.perSpecPriceApply', arguments: { productId: '648', specFields: { '3863': { rent1day: '110.00' } } }, reason: '把母价+30后的绝对值写入新规格' },
      outputDir,
      { rentalPriceClient: client, ledgerContext },
    );

    expect(read.text).toContain('规格查看成功');
    expect(calls).toEqual([
      { action: 'specDiscover', productId: '648' },
      { action: 'specAddDim', productId: '648', title: '激光险' },
      { action: 'applyPerSpec', productId: '648', specFields: { '3863': { rent1day: '110.00' } } },
    ]);
    expect(add.metadata).toMatchObject({ toolName: 'rental.specDimApply', ok: true, ledgerContext });
    expect(price.metadata).toMatchObject({ toolName: 'rental.perSpecPriceApply', ok: true, ledgerContext });
    expect(add.metadata?.executionEvent).toMatchObject({ type: 'execution', toolName: 'rental.specDimApply', productId: '648', ok: true, action: 'add', ...ledgerContext });
    expect(price.metadata?.executionEvent).toMatchObject({ type: 'execution', toolName: 'rental.perSpecPriceApply', productId: '648', ok: true, ...ledgerContext });
  });
});
