import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const expectedWiring = [
  { file: '../src/cli/probePageSize.ts', stage: 'page-size-probe' },
  { file: '../src/crawler/exposurePageProbe.ts', stage: 'exposure-page-probe' },
];

const expectedSessionEntrypoints = [
  { file: '../src/crawler/goodsExportCrawler.ts', stage: 'goods-export' },
  { file: '../src/crawler/exposureCrawler.ts', stage: 'exposure' },
  { file: '../src/crawler/dashboardCrawler.ts', stage: 'dashboard' },
  { file: '../src/crawler/publicTrafficCrawler.ts', stage: 'public-traffic-full' },
];

describe('login notification wiring', () => {
  it('merchant session helper awaits notifyLoginRequired with the configured stage and output directory', async () => {
    const source = await readFile(new URL('../src/crawler/merchantSession.ts', import.meta.url), 'utf8');

    expect(source).toContain("await notifyLoginRequired({ page, stage: options.stage ?? 'merchant-session', outputDir: config.outputDir, log });");
  });

  it.each(expectedWiring)('$file awaits notifyLoginRequired with the correct stage and output directory', async ({ file, stage }) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');

    expect(source).toMatch(new RegExp(`await\\s+notifyLoginRequired\\(\\{[^}]*stage:\\s*'${stage}'[^}]*outputDir:\\s*config\\.outputDir`, 's'));
  });

  it.each(expectedSessionEntrypoints)('$file passes stage $stage to the merchant session helper', async ({ file, stage }) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');

    expect(source).toContain(`stage: '${stage}'`);
    expect(source).toContain('ensureAuthenticatedMerchantSession(config');
  });
});
