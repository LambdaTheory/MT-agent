import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const expectedWiring = [
  { file: '../src/crawler/goodsExportCrawler.ts', stage: 'goods-export' },
  { file: '../src/crawler/exposureCrawler.ts', stage: 'exposure' },
  { file: '../src/crawler/dashboardCrawler.ts', stage: 'dashboard' },
  { file: '../src/cli/probePageSize.ts', stage: 'page-size-probe' },
  { file: '../src/crawler/exposurePageProbe.ts', stage: 'exposure-page-probe' },
];

describe('login notification wiring', () => {
  it.each(expectedWiring)('$file awaits notifyLoginRequired with the correct stage and output directory', async ({ file, stage }) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');

    expect(source).toMatch(new RegExp(`await\\s+notifyLoginRequired\\(\\{[^}]*stage:\\s*'${stage}'[^}]*outputDir:\\s*config\\.outputDir`, 's'));
  });
});
