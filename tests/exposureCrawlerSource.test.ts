import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('exposureCrawler Playwright evaluation', () => {
  it('does not pass a bundled function object into locator.evaluate for table extraction', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("locator('table').first().evaluate(");
  });

  it('scopes current table and pagination instead of using global selectors', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("document.querySelector('table')");
    expect(source).not.toContain("page.locator('.ant-pagination-next:not(.ant-pagination-disabled)')");
  });
});
