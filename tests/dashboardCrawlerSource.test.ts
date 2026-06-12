import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('dashboard crawler source', () => {
  it('does not convert period collection failures into empty stats', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('results.push(emptyStats(period))');
    expect(source).not.toContain('function emptyStats(');
  });

  it('writes latest debug output under configured output directory', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('const rawDir = `${config.outputDir}/latest`;');
    expect(source).not.toContain("const rawDir = 'output/latest';");
  });

  it('waits 10 seconds before skipping the visits page empty state', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('confirmDashboardEmptyState');
    expect(source).toContain('.emptyTxt-LkXGcaGA');
    expect(source).toContain('waitForTimeout(10000)');
  });
});
