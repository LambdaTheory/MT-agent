import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runAgentDryRun } from '../src/cli/agentDryRun.js';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('agent dry-run CLI', () => {
  it('exposes a package script', async () => {
    const pkg = JSON.parse(await source('../package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['agent:dry-run']).toBe('tsx src/cli/agentDryRun.ts');
  });

  it('uses runtime with a fake handler and no production side-effect imports', async () => {
    const text = await source('../src/cli/agentDryRun.ts');
    expect(text).toContain("import { createAgentRuntime } from '../agentRuntime/runtime.js';");
    expect(text).toContain('parseAgentFirstBotIntent');
    expect(text).toContain('parseBotIntent');
    expect(text).toContain('DRY RUN: would handle intent ${intent.type}');
    expect(text).not.toContain('handleBotIntent');
    expect(text).not.toContain('loadEnv');
    expect(text).not.toContain('sendFeishu');
    expect(text).not.toContain('createRentalPriceSkillClient');
  });

  it('keeps product queries local-direct by default without executing real tools', async () => {
    await expect(runAgentDryRun('查询 565')).resolves.toEqual({
      source: 'cli',
      text: '查询 565',
      mode: 'planner-first',
      intentType: 'query_product',
      intent: { type: 'query_product', keyword: '565' },
      legacyIntent: { type: 'query_product', keyword: '565' },
      dryRun: true,
      response: { text: 'DRY RUN: would handle intent query_product' },
    });
  });

  it('keeps risky rental operations planner-first by default', async () => {
    await expect(runAgentDryRun('改价 761 1天22')).resolves.toMatchObject({
      source: 'cli',
      text: '改价 761 1天22',
      mode: 'planner-first',
      intentType: 'unknown',
      intent: { type: 'unknown', text: '改价 761 1天22' },
      legacyIntent: { type: 'rental_price_change' },
      dryRun: true,
      response: { text: 'DRY RUN: would handle intent unknown' },
    });
  });

  it('can explicitly show legacy deterministic resolving for comparison', async () => {
    await expect(runAgentDryRun('查询 565', { mode: 'legacy' })).resolves.toEqual({
      source: 'cli',
      text: '查询 565',
      mode: 'legacy',
      intentType: 'query_product',
      intent: { type: 'query_product', keyword: '565' },
      dryRun: true,
      response: { text: 'DRY RUN: would handle intent query_product' },
    });
  });
});
