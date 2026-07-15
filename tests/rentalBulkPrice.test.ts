import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
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

  it('persists a normalized plan and returns a hidden apply confirmation card', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88, rent10day: '199.5' } }] },
      reason: '批量设置租赁价',
    }, outputDir, {});

    expect(response.text).toContain('批量租赁改价计划');
    expect(response.card).toBeDefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: true, productCount: 1 });
    const planId = String(response.metadata?.planId);
    const planPath = String(response.metadata?.planPath);
    expect(planId).toMatch(/^bulk_price_/);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as { items: Array<{ productId: string; fields: Record<string, string> }> };
    expect(plan.items).toEqual([{ productId: '648', fields: { rent1day: '88.00', rent10day: '199.50' } }]);
    expect(JSON.stringify(response.card)).toContain('rental.bulkPriceApply');
    expect(JSON.stringify(response.card)).toContain(planId);
  });

  it('blocks invalid and conflicting items before confirmation', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [
        { productId: '../648', fields: { rent1day: 88 } },
        { productId: '649', fields: { nope: 1 } },
        { productId: '650', fields: { rent1day: 88 } },
        { productId: '650', fields: { rent1day: 99 } },
      ] },
      reason: 'invalid bulk plan',
    }, outputDir, {});

    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: false, blockedCount: 3 });
  });

  it('applies the persisted plan by planId, writes a report, and records ledger events', async () => {
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

    const apply = await executeAgentToolRequest({
      toolName: 'rental.bulkPriceApply',
      arguments: { planId: plan.metadata?.planId },
      reason: 'confirmed bulk apply',
    }, outputDir, { rentalPriceClient: client, ledgerContext: { outputDir, runId: 'run-1', decisionId: 'decision-1', missionDate: '2026-07-15' } });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([request]) => request)).toEqual([
      { mode: 'explicit_fields', productId: '648', fields: { rent1day: '88.00' } },
      { mode: 'explicit_fields', productId: '649', fields: { rent3day: '66.00' } },
    ]);
    expect(apply.metadata).toMatchObject({ toolName: 'rental.bulkPriceApply', ok: true, planId: plan.metadata?.planId, status: 'completed' });
    const report = JSON.parse(await readFile(String(apply.metadata?.reportPath), 'utf8')) as { results: Array<{ productId: string; ok: boolean }> };
    expect(report.results.map((item) => item.productId)).toEqual(['648', '649']);
    const events = await loadOperationLedgerJsonlEntries(outputDir, '2026-07-15');
    expect(events.some((event) => event.event === 'execution_started' && event.toolName === 'rental.bulkPriceApply')).toBe(true);
    expect(events.some((event) => event.event === 'execution_succeeded' && event.toolName === 'rental.bulkPriceApply')).toBe(true);
  });

  it('continues remaining products and reports completed_with_failures when one item throws', async () => {
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

    const apply = await executeAgentToolRequest({
      toolName: 'rental.bulkPriceApply',
      arguments: { planId: plan.metadata?.planId },
      reason: 'confirmed bulk partial failure',
    }, outputDir, { rentalPriceClient: client, ledgerContext: { outputDir, runId: 'run-2', decisionId: 'decision-2', missionDate: '2026-07-15' } });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(apply.metadata).toMatchObject({ toolName: 'rental.bulkPriceApply', ok: false, planId: plan.metadata?.planId, status: 'completed_with_failures' });
    const report = JSON.parse(await readFile(String(apply.metadata?.reportPath), 'utf8')) as { status: string; results: Array<{ productId: string; ok: boolean; lines: string[] }> };
    expect(report.status).toBe('completed_with_failures');
    expect(report.results).toEqual([
      { productId: '648', ok: false, lines: ['error: daemon apply failed'] },
      { productId: '649', ok: true, lines: ['apply: ok', 'submit: ok', 'verify: ok'] },
    ]);
    const events = await loadOperationLedgerJsonlEntries(outputDir, '2026-07-15');
    expect(events.some((event) => event.event === 'execution_failed' && event.toolName === 'rental.bulkPriceApply')).toBe(true);
  });
});
