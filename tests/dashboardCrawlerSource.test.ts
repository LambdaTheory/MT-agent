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

  it('waits 3 seconds before skipping the visits page empty state', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('confirmDashboardEmptyState');
    expect(source).toContain('.emptyTxt-LkXGcaGA');
    expect(source).toContain('waitForDashboardTargetTimeout(page, 3000)');
  });

  it('checks the visits page empty state before collecting each period tab', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');
    const collectDashboardPageStart = source.indexOf('export async function collectDashboardPage');
    const initialEmptyStateCheck = source.indexOf('if (await confirmDashboardEmptyState(dashboardTarget))', collectDashboardPageStart);
    const periodLoop = source.indexOf('for (const period of periods)', collectDashboardPageStart);

    expect(initialEmptyStateCheck).toBeGreaterThan(collectDashboardPageStart);
    expect(periodLoop).toBeGreaterThan(collectDashboardPageStart);
    expect(initialEmptyStateCheck).toBeLessThan(periodLoop);
  });

  it('waits for a visible visits table and reports timeout context', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('.ant-table table, table, [role="table"]');
    expect(source).toContain('dashboardTimeoutMessage');
    expect(source).toContain('url=');
    expect(source).toContain('title=');
    expect(source).toContain('frames=');
    expect(source).not.toContain('Complete QR login in the opened browser window.');
  });

  it('resolves the frame that contains the visits table before collecting periods', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('type DashboardTarget = Frame | Page');
    expect(source).toContain('page.frames()');
    expect(source).toContain('dashboardTargetState');
    expect(source).toContain('dashboardTarget = await waitForTableOrEmptyState(page, 180000);');
    expect(source).toContain('collectPeriodWithAdaptivePageSize(dashboardTarget');
  });

  it('selects and verifies the requested page date before collecting periods', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');
    const collectStart = source.indexOf('export async function collectDashboardPage');
    const dateSelection = source.indexOf('selectDashboardDataDate', collectStart);
    const periodLoop = source.indexOf('for (const period of periods)', collectStart);

    expect(source).toContain('input[placeholder="请选择日期"]');
    expect(source).toContain('assessDashboardDateReadback');
    expect(dateSelection).toBeGreaterThan(collectStart);
    expect(dateSelection).toBeLessThan(periodLoop);
  });

  it('guards against stale pre-selection dashboard state after date readback', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');
    const selectStart = source.indexOf('export async function selectDashboardDataDate');
    const readbackWait = source.indexOf('waitForDashboardDateReadback(input, target, requestedDate)', selectStart);
    const staleGuardStart = source.indexOf('waitForDashboardRefreshAfterDateSelection', selectStart);
    const staleGuardAwait = source.indexOf('await refreshAfterSelection', readbackWait);
    const staleFingerprint = source.indexOf('captureDashboardObservableState', selectStart);

    expect(source).toContain('captureDashboardObservableState');
    expect(source).toContain('waitForDashboardRefreshAfterDateSelection');
    expect(source).toContain('loadingTransitionObserved');
    expect(source).toContain('Dashboard did not refresh after selecting requested dataDate');
    expect(staleFingerprint).toBeGreaterThan(selectStart);
    expect(staleFingerprint).toBeLessThan(staleGuardStart);
    expect(staleGuardStart).toBeGreaterThan(staleFingerprint);
    expect(staleGuardStart).toBeLessThan(readbackWait);
    expect(staleGuardAwait).toBeGreaterThan(readbackWait);
  });

  it('keeps automatic merchant sub-account selection in the dashboard flow', async () => {
    const source = await readFile(new URL('../src/crawler/dashboardCrawler.ts', import.meta.url), 'utf8');
    expect(source).toContain('await selectSubAccountIfNeeded(page);');
  });
});
