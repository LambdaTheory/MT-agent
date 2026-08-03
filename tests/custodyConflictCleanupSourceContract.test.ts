import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('custody conflict cleanup source contract', () => {
  it('targets the existing exposure custody table and does not require a separate product-status header', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain("'商品信息'");
    expect(text).toContain("'曝光次数'");
    expect(text).toContain("'商品访问次数'");
    expect(text).toContain("'交易金额'");
    expect(text).toContain("'托管状态'");
    expect(text).not.toContain("'商品状态'");
    expect(text).toContain('statusFromInfoCell');
  });

  it('fails closed when the expected table or required headers are missing', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('Missing custody exposure table');
    expect(text).toContain('Missing custody exposure table columns');
    expect(text).not.toContain("return { pageNumber: 1, totalPages: 1, rows: [], signature: '' }");
  });

  it('keeps exposure crawler and public traffic report paths read-only from cleanup', async () => {
    const cli = await source('../src/cli/custodyConflictCleanup.ts');
    const adapter = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(cli).not.toContain('collectExposurePage');
    expect(cli).not.toContain('crawlExposurePage');
    expect(adapter).not.toContain('collectExposurePage');
    expect(adapter).not.toContain('publicTraffic');
  });

  it('uses scoped Ant pagination and row actions from the nearest table wrapper', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain("table.closest('.ant-table-wrapper')");
    expect(text).toContain('.ant-pagination-next:not(.ant-pagination-disabled)');
    expect(text).toContain('.ant-pagination-prev:not(.ant-pagination-disabled)');
    expect(text).toContain("item.querySelector('a, button')");
    expect(text).toContain('pageControl.click()');
    expect(text).not.toContain('item.click();');
    expect(text).toContain('CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS');
  });

  it('waits for the requested active page instead of accepting signature-only page changes', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('waitForPageTransition(before, PAGE_TRANSITION_TIMEOUT_MS, targetPage)');
    expect(text).toContain('expectedActivePage');
    expect(text).toContain('latest.pageNumber === expectedActivePage');
    expect(text).not.toContain('latest.pageNumber !== previous.pageNumber || latest.signature !== previous.signature');
  });

  it('preserves regular-expression escapes inside browser-evaluated scripts', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).not.toMatch(/this\.page\.evaluate\(\s*`/g);
    expect(text.match(/this\.page\.evaluate\(\s*String\.raw`/g)).toHaveLength(7);
  });

  it('self-invokes parameterized browser scripts instead of passing ignored string arguments', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('})(${serializeBrowserArgument(targetPage)})`');
    expect(text).toContain('})(${serializeBrowserArgument(markerToken)})`');
    expect(text).toContain('})(${serializeBrowserArgument(actionInput)})`');
    expect(text).toContain('})(${serializeBrowserArgument(direction)})`');
    expect(text).toContain('})(${serializeBrowserArgument(confirmationInput)})`');
    expect(text).not.toMatch(/String\.raw`\(\([^`]+\}\)`,\s*[a-zA-Z{]/s);
  });

  it('extracts product-like data-row-key values as platform product IDs', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('const rowKey = row.getAttribute(\'data-row-key\')');
    expect(text).toContain("normalized.match(/^(20\\d{20,})$/)?.[1]");
    expect(text).toContain('productIdFromText(rowKey)');
    expect(text).toContain('const platformProductId = productIdFromText(rowKey) || productIdFromText(normalize(infoCell?.textContent) || rowText)');
  });

  it('does not accept preferred title text when it is only the preview link label', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain("if (preferredText && preferredText !== '预览') return preferredText;");
    expect(text).not.toContain('if (preferredText) return preferredText;');
  });

  it('does not use stale row-index fallback when clicking custody row actions', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('rowSignature');
    expect(text).toContain('matchesStableRowIdentity');
    expect(text).toContain('matchingRows.length !== 1');
    expect(text).toContain('liveRowStillConflict');
    expect(text).toContain("productStatusLabel === '已下架'");
    expect(text).toContain('isExplicitCustodyStatus(custodyStatusLabel)');
    expect(text).not.toContain('?? rows[input.rowIndex]');
    expect(text).not.toContain('rows.find((candidate) => visible(candidate) && matchesStableRowIdentity(candidate))');
  });

  it('requires explicit custody cancellation context before clicking confirmation buttons', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('dialogConcernsCustodyCancellation');
    expect(text).toContain('取消托管');
    expect(text).toContain('解除托管');
    expect(text).not.toContain("const allowed = ['确定', '确认'");
  });

  it('polls for page number or signature changes after pagination clicks and fails closed if unreachable', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('waitForPageTransition');
    expect(text).toContain('Date.now() + timeoutMs');
    expect(text).toContain('Unable to restore custody table page');
  });

  it('distinguishes page-count shrink recovery from genuine navigation failure', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('effectiveTargetPage');
    expect(text).toContain('requestedPage > latest.totalPages');
    expect(text).toContain('return latest');
  });

  it('accepts exact custody-specific affirmative confirmation labels', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('确认取消托管');
    expect(text).toContain('确认解除托管');
  });

  it('marks pre-existing dialogs and confirms only newly produced custody dialogs for the target row', async () => {
    const text = await source('../src/custodyConflictCleanup/domAdapter.ts');

    expect(text).toContain('markExistingConfirmationDialogs');
    expect(text).toContain('clearConfirmationDialogMarkers');
    expect(text).toContain('data-custody-cleanup-existing-dialog');
    expect(text).toContain('dialog.getAttribute(markerAttribute) !== input.markerToken');
    expect(text).toContain('dialogMatchesTargetProduct');
  });

  it('creates audit writer before opening merchant browser session', async () => {
    const text = await source('../src/cli/custodyConflictCleanup.ts');
    const functionStart = text.indexOf('export async function runCustodyConflictCleanupCli');
    const functionBody = text.slice(functionStart);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionBody.indexOf('JsonCustodyConflictAuditWriter.create')).toBeGreaterThanOrEqual(0);
    expect(functionBody.indexOf('ensureAuthenticatedMerchantSession')).toBeGreaterThanOrEqual(0);
    expect(functionBody.indexOf('JsonCustodyConflictAuditWriter.create')).toBeLessThan(functionBody.indexOf('ensureAuthenticatedMerchantSession'));
  });

  it('keeps the standalone CLI preview-only so writes cannot bypass Feishu confirmation cards', async () => {
    const text = await source('../src/cli/custodyConflictCleanup.ts');

    expect(text).not.toContain("allowed = new Set(['--execute'");
    expect(text).not.toContain('confirmCancelCustody');
    expect(text).toContain('execute: false');
    expect(text).toContain('飞书确认卡');
  });
});
