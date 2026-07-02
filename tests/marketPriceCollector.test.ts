import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectDailyMissionContext } from '../src/agentRuntime/dailyMissionContext.js';
import { createMarketPriceCollector } from '../src/agentRuntime/marketPriceCollector.js';

describe('createMarketPriceCollector', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-market-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads dated market-price JSON into context without stripping fields', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'market-price.json'), JSON.stringify({ items: [{ productId: '648', price: 12, vendor: 'x' }] }), 'utf8');

    const context = await collectDailyMissionContext([createMarketPriceCollector(dir)], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(context.marketPrice).toEqual({ items: [{ productId: '648', price: 12, vendor: 'x' }] });
    expect(context.missingSources).toEqual([]);
  });

  it('marks market price as missing when JSON is unavailable', async () => {
    const context = await collectDailyMissionContext([createMarketPriceCollector(dir)], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(context.marketPrice).toBeUndefined();
    expect(context.missingSources).toEqual(['marketPrice']);
  });
});
