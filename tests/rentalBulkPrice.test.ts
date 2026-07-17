import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('rental bulk price workflow', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-bulk-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('registers planner-visible plan and hidden apply tools', () => {
    expect(findAgentTool('rental.bulkPricePlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.bulkPricePlan')?.plannerVisible).not.toBe(false);
    expect(findAgentTool('rental.bulkPriceApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
  });

  it('persists a normalized plan but does not return an executable apply confirmation card', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88, rent10day: '199.5' } }] },
      reason: '批量设置租赁价',
    }, outputDir, {});

    expect(response.text).toContain('批量租赁改价计划');
    expect(response.text).toContain('批量改价确认执行入口已停用');
    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: false, productCount: 1, disabled: true });
    const planId = String(response.metadata?.planId);
    const planPath = String(response.metadata?.planPath);
    expect(planId).toMatch(/^bulk_price_/);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as { items: Array<{ productId: string; fields: Record<string, string> }> };
    expect(plan.items).toEqual([{ productId: '648', fields: { rent1day: '88.00', rent10day: '199.50' } }]);
    expect(response.text).toContain('影响商品：648');
    expect(response.text).toContain('rent1day=88.00');
    expect(response.text).toContain('rent10day=199.50');
  });

  it('blocks invalid and conflicting items before confirmation', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [
        { productId: '../648', fields: { rent1day: 88 } },
        { productId: '649', fields: { nope: 1 } },
        { productId: '651', fields: { rent1day: 88, nope: 1 } },
        { productId: '652', fields: { rent1day: Number.POSITIVE_INFINITY } },
        { productId: '650', fields: { rent1day: 88 } },
        { productId: '650', fields: { rent1day: 99 } },
      ] },
      reason: 'invalid bulk plan',
    }, outputDir, {});

    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: false, blockedCount: 5 });
  });

  it('accepts identical duplicate fields regardless of input key order', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [
        { productId: '648', fields: { rent1day: 88, rent10day: 199.5 } },
        { productId: '648', fields: { rent10day: '199.50', rent1day: '88.00' } },
      ] },
      reason: 'duplicate order should collapse',
    }, outputDir, {});

    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: false, productCount: 1, disabled: true });
  });

  it('rejects the persisted plan by planId before client execution', async () => {
    const execute = vi.fn(async (request) => ({
      productId: request.productId,
      ok: true,
      lines: ['apply: ok', 'submit: ok', 'verify: ok'],
      audit: { resultFile: `verify-${request.productId}.json`, rollbackFile: `rollback-${request.productId}.json` },
    }));
    const client = { async preview() { throw new Error('preview should not run'); }, execute } as unknown as RentalPriceSkillClient;
    const plan = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88 } }, { productId: '649', fields: { rent3day: '66' } }] },
      reason: 'bulk apply',
    }, outputDir, { rentalPriceClient: client });

    await expect(executeAgentToolRequest({
      toolName: 'rental.bulkPriceApply',
      arguments: { planId: plan.metadata?.planId },
      reason: 'confirmed bulk apply',
    }, outputDir, { rentalPriceClient: client, ledgerContext: { outputDir, runId: 'run-1', decisionId: 'decision-1', missionDate: '2026-07-15' } })).rejects.toThrow('批量改价执行入口已停用');

    expect(execute).not.toHaveBeenCalled();
  });

  it('does not call client.execute even when it would have failed per item', async () => {
    const execute = vi.fn(async (request) => {
      if (request.productId === '648') throw new Error('daemon apply failed');
      return { productId: request.productId, ok: true, lines: ['apply: ok', 'submit: ok', 'verify: ok'] };
    });
    const client = { async preview() { throw new Error('preview should not run'); }, execute } as unknown as RentalPriceSkillClient;
    const plan = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88 } }, { productId: '649', fields: { rent3day: '66' } }] },
      reason: 'bulk partial failure',
    }, outputDir, { rentalPriceClient: client });

    await expect(executeAgentToolRequest({
      toolName: 'rental.bulkPriceApply',
      arguments: { planId: plan.metadata?.planId },
      reason: 'confirmed bulk partial failure',
    }, outputDir, { rentalPriceClient: client, ledgerContext: { outputDir, runId: 'run-2', decisionId: 'decision-2', missionDate: '2026-07-15' } })).rejects.toThrow('批量改价执行入口已停用');

    expect(execute).not.toHaveBeenCalled();
  });
});
