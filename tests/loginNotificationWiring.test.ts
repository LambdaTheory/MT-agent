import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const files = [
  '../src/crawler/goodsExportCrawler.ts',
  '../src/crawler/exposureCrawler.ts',
  '../src/crawler/dashboardCrawler.ts',
  '../src/cli/probePageSize.ts',
  '../src/crawler/exposurePageProbe.ts',
];

describe('login notification wiring', () => {
  it.each(files)('%s calls notifyLoginRequired', async (file) => {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');

    expect(source).toContain('notifyLoginRequired');
  });
});
