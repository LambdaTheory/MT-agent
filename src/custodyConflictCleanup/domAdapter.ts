import type { Page } from 'playwright';
import {
  CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS,
  type CustodyConflictCancelResult,
  type CustodyConflictCleanupAdapter,
  type CustodyConflictRow,
  type CustodyConflictTableSnapshot,
} from './models.js';

const DEFAULT_CUSTODY_URL = 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
const TABLE_HEADERS = ['商品信息', '曝光次数', '商品访问次数', '交易金额', '托管状态', '操作'];
const PAGE_TRANSITION_TIMEOUT_MS = 15000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeBrowserArgument(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Unable to serialize browser evaluation argument.');
  return serialized.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function rowSignature(row: CustodyConflictRow): string {
  return [row.productName, row.productStatusLabel, row.custodyStatusLabel].map(normalizeText).join('|');
}

async function waitForTableToSettle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  await page.waitForFunction(
    `(() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return !Array.from(document.querySelectorAll('.ant-spin-spinning, .ant-spin-dot-spin')).some((element) => visible(element));
    })()`,
    undefined,
    { timeout: 10000 },
  ).catch(() => undefined);
  await page.waitForTimeout(500);
}

export class PlaywrightCustodyConflictAdapter implements CustodyConflictCleanupAdapter {
  constructor(private readonly page: Page, private readonly custodyUrl = DEFAULT_CUSTODY_URL) {}

  async openCustodyPage(): Promise<void> {
    await this.page.goto(this.custodyUrl, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('.ant-table-tbody tr, table tbody tr', { timeout: 30000 }).catch(() => undefined);
    await waitForTableToSettle(this.page);
  }

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    await waitForTableToSettle(this.page);
    return this.page.evaluate(
      String.raw`(() => {
        const expectedHeaders = ${JSON.stringify(TABLE_HEADERS)};
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const tables = Array.from(document.querySelectorAll('table')).filter((table) => {
          if (!visible(table)) return false;
          const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => normalize(cell.textContent));
          return expectedHeaders.every((header) => headers.some((value) => value.includes(header)));
        });
        const table = tables[0];
        if (!table) throw new Error('Missing custody exposure table: expected visible exposure table with custody and operation columns.');
        const wrapper = table.closest('.ant-table-wrapper');
        const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => normalize(cell.textContent));
        const findHeaderIndex = (header) => headers.findIndex((value) => value.includes(header));
        const infoIndex = findHeaderIndex('商品信息');
        const custodyStatusIndex = findHeaderIndex('托管状态');
        const actionIndex = findHeaderIndex('操作');
        if (infoIndex < 0 || custodyStatusIndex < 0 || actionIndex < 0) {
          throw new Error('Missing custody exposure table columns. Actual headers: ' + headers.join(', '));
        }
        const titleFromInfoCell = (cell) => {
          const preferred = cell?.querySelector('div > div:nth-child(2) > div:first-child');
          const preferredText = normalize(preferred?.textContent);
          if (preferredText && preferredText !== '预览') return preferredText;
          const candidates = Array.from(cell?.querySelectorAll('div, span, a') ?? [])
            .map((element) => normalize(element.textContent))
            .filter((text) => text && text !== '预览' && !text.includes('商品ID') && !text.includes('平台商品ID') && !text.includes('元/日') && !text.includes('出售中') && !text.includes('已下架'));
          return candidates.sort((left, right) => right.length - left.length)[0] ?? '';
        };
        const statusFromInfoCell = (cell) => {
          const candidates = Array.from(cell?.querySelectorAll('div, span, a') ?? [])
            .map((element) => normalize(element.textContent))
            .filter((text) => text === '出售中' || text === '已下架');
          return candidates[0] ?? '';
        };
        const productIdFromText = (text) => {
          const normalized = normalize(text);
          return normalized.match(/(?:商品ID|平台商品ID|ID)\s*[:：]?\s*(20\d{20,})/)?.[1]
            ?? normalized.match(/^(20\d{20,})$/)?.[1]
            ?? '';
        };
        const pageItem = wrapper?.querySelector('.ant-pagination-item-active');
        const pageNumber = Number.parseInt(normalize(pageItem?.textContent), 10);
        const pageNumbers = Array.from(wrapper?.querySelectorAll('.ant-pagination-item') ?? [])
          .map((item) => Number.parseInt(normalize(item.textContent), 10))
          .filter((value) => Number.isFinite(value));
        const rows = Array.from(table.querySelectorAll('tbody tr'))
          .filter((row) => visible(row))
          .map((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const infoCell = infoIndex >= 0 ? cells[infoIndex] : undefined;
            const actionCell = actionIndex >= 0 ? cells[actionIndex] : undefined;
            const rowKey = row.getAttribute('data-row-key') ?? '';
            const rowText = normalize(row.textContent);
            const platformProductId = productIdFromText(rowKey) || productIdFromText(normalize(infoCell?.textContent) || rowText);
            const actionLabels = Array.from(actionCell?.querySelectorAll('button, a, [role="button"]') ?? [])
              .filter((element) => visible(element))
              .map((element) => normalize(element.textContent))
              .filter(Boolean);
            return {
              rowId: rowKey || platformProductId || String(pageNumber || 1) + ':' + String(rowIndex) + ':' + rowText,
              rowIndex,
              productName: infoCell ? titleFromInfoCell(infoCell) : '',
              ...(platformProductId ? { platformProductId } : {}),
              productStatusLabel: infoCell ? statusFromInfoCell(infoCell) : '',
              custodyStatusLabel: custodyStatusIndex >= 0 ? normalize(cells[custodyStatusIndex]?.textContent) : '',
              actionLabels,
            };
          });
        return {
          pageNumber: Number.isFinite(pageNumber) ? pageNumber : 1,
          totalPages: pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1,
          rows,
          signature: rows.map((row) => row.rowId + ':' + row.productStatusLabel + ':' + row.custodyStatusLabel + ':' + row.actionLabels.join(',')).join('|'),
        };
      })()`,
    );
  }

  async goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot> {
    const before = await this.readCurrentPage();
    if (pageNumber < 1) return before;
    const effectiveTargetPage = (requestedPage: number, latest: CustodyConflictTableSnapshot): number => (requestedPage > latest.totalPages ? latest.totalPages : requestedPage);
    let targetPage = effectiveTargetPage(pageNumber, before);
    if (before.pageNumber === targetPage) return before;
    const directClicked = await this.page.evaluate(
      String.raw`((requestedPage) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const tables = Array.from(document.querySelectorAll('table')).filter((table) => visible(table));
        const table = tables.find((candidate) => {
          const headers = Array.from(candidate.querySelectorAll('thead th')).map((cell) => normalize(cell.textContent));
          return headers.some((header) => header.includes('商品信息'))
            && headers.some((header) => header.includes('曝光次数'))
            && headers.some((header) => header.includes('商品访问次数'))
            && headers.some((header) => header.includes('交易金额'))
            && headers.some((header) => header.includes('托管状态'))
            && headers.some((header) => header.includes('操作'));
        });
        const wrapper = table?.closest('.ant-table-wrapper');
        const items = Array.from(wrapper?.querySelectorAll('.ant-pagination-item') ?? []);
        const item = items.find((candidate) => Number.parseInt(normalize(candidate.textContent), 10) === requestedPage);
        if (item instanceof HTMLElement && visible(item)) {
          const pageControl = item.querySelector('a, button') ?? item;
          if (!(pageControl instanceof HTMLElement) || !visible(pageControl)) return false;
          pageControl.click();
          return true;
        }
        return false;
      })(${serializeBrowserArgument(targetPage)})`,
    );
    let directTransitionError: Error | null = null;
    if (directClicked) {
      try {
        const directSnapshot = await this.waitForPageTransition(before, PAGE_TRANSITION_TIMEOUT_MS, targetPage);
        targetPage = effectiveTargetPage(pageNumber, directSnapshot);
        if (directSnapshot.pageNumber === targetPage) return directSnapshot;
      } catch (error) {
        directTransitionError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Direct custody pagination click did not settle; falling back to step pagination: ${directTransitionError.message}`);
      }
    }

    let snapshot = directTransitionError ? await this.readCurrentPage() : before;
    targetPage = effectiveTargetPage(pageNumber, snapshot);
    for (let attempts = 0; attempts < 300 && snapshot.pageNumber !== targetPage; attempts += 1) {
      const direction = snapshot.pageNumber < targetPage ? 'next' : 'prev';
      if (!(await this.clickPagerStep(direction))) break;
      const expectedStepPage = snapshot.pageNumber + (direction === 'next' ? 1 : -1);
      const nextSnapshot = await this.waitForPageTransition(snapshot, PAGE_TRANSITION_TIMEOUT_MS, expectedStepPage);
      snapshot = nextSnapshot;
      targetPage = effectiveTargetPage(pageNumber, snapshot);
    }
    targetPage = effectiveTargetPage(pageNumber, snapshot);
    const latest = snapshot;
    if (latest.pageNumber === targetPage && pageNumber > latest.totalPages) return latest;
    if (snapshot.pageNumber !== targetPage) {
      throw new Error(`Unable to restore custody table page ${pageNumber}; current page is ${snapshot.pageNumber}.`);
    }
    return snapshot;
  }

  async cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<CustodyConflictCancelResult> {
    if (!CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS.some((allowed) => allowed === actionLabel)) {
      throw new Error(`Refusing unsupported custody action label: ${actionLabel}`);
    }
    const markerToken = `custody-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await this.markExistingConfirmationDialogs(markerToken);
    try {
      const clicked = await this.clickRowAction(row, actionLabel);
      if (!clicked) throw new Error(`Custody action ${actionLabel} was not visible for row ${row.rowId}.`);
      const confirmationLabel = await this.confirmVisibleDialog(markerToken, row.platformProductId ?? '');
      if (!confirmationLabel) throw new Error(`No safe Ant confirmation dialog was visible for row ${row.rowId}.`);
      await waitForTableToSettle(this.page);
      return { confirmed: true, confirmationLabel };
    } finally {
      await this.clearConfirmationDialogMarkers(markerToken);
    }
  }

  private async markExistingConfirmationDialogs(markerToken: string): Promise<void> {
    await this.page.evaluate(
      String.raw`((token) => {
        const markerAttribute = 'data-custody-cleanup-existing-dialog';
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        Array.from(document.querySelectorAll('.ant-modal, [role="dialog"], .ant-popover, .ant-popconfirm'))
          .filter((dialog) => visible(dialog))
          .forEach((dialog) => dialog.setAttribute(markerAttribute, token));
      })(${serializeBrowserArgument(markerToken)})`,
    );
  }

  private async clearConfirmationDialogMarkers(markerToken: string): Promise<void> {
    await this.page.evaluate(
      String.raw`((token) => {
        const markerAttribute = 'data-custody-cleanup-existing-dialog';
        Array.from(document.querySelectorAll('[' + markerAttribute + '="' + token + '"]'))
          .forEach((dialog) => dialog.removeAttribute(markerAttribute));
      })(${serializeBrowserArgument(markerToken)})`,
    );
  }

  private async clickRowAction(row: CustodyConflictRow, actionLabel: string): Promise<boolean> {
    const actionInput = {
      rowId: row.rowId,
      platformProductId: row.platformProductId ?? '',
      productName: row.productName,
      productStatusLabel: row.productStatusLabel,
      custodyStatusLabel: row.custodyStatusLabel,
      rowSignature: rowSignature(row),
      actionLabel,
    };
    return this.page.evaluate(
      String.raw`((input) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const isExplicitCustodyStatus = (value) => /^(?:已托管(?:\s*\d+(?:\.\d+)?\s*天)?|(?:托管中|托管异常)\s+已托管(?:\s*\d+(?:\.\d+)?\s*天)?)$/u.test(normalize(value));
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
          if (!visible(candidate)) return false;
          const headers = Array.from(candidate.querySelectorAll('thead th')).map((cell) => normalize(cell.textContent));
          return headers.some((header) => header.includes('商品信息'))
            && headers.some((header) => header.includes('曝光次数'))
            && headers.some((header) => header.includes('商品访问次数'))
            && headers.some((header) => header.includes('交易金额'))
            && headers.some((header) => header.includes('托管状态'))
            && headers.some((header) => header.includes('操作'));
        });
        const headers = Array.from(table?.querySelectorAll('thead th') ?? []).map((cell) => normalize(cell.textContent));
        const findHeaderIndex = (header) => headers.findIndex((value) => value.includes(header));
        const infoIndex = findHeaderIndex('商品信息');
        const custodyStatusIndex = findHeaderIndex('托管状态');
        const productIdFromText = (text) => {
          const normalized = normalize(text);
          return normalized.match(/(?:商品ID|平台商品ID|ID)\s*[:：]?\s*(20\d{20,})/)?.[1]
            ?? normalized.match(/^(20\d{20,})$/)?.[1]
            ?? '';
        };
        const statusFromInfoCell = (cell) => Array.from(cell?.querySelectorAll('div, span, a') ?? [])
          .map((element) => normalize(element.textContent))
          .filter((text) => text === '出售中' || text === '已下架')[0] ?? '';
        const titleFromInfoCell = (cell) => {
          const preferred = cell?.querySelector('div > div:nth-child(2) > div:first-child');
          const preferredText = normalize(preferred?.textContent);
          if (preferredText && preferredText !== '预览') return preferredText;
          return Array.from(cell?.querySelectorAll('div, span, a') ?? [])
            .map((element) => normalize(element.textContent))
            .filter((text) => text && text !== '预览' && !text.includes('商品ID') && !text.includes('平台商品ID') && !text.includes('元/日') && !text.includes('出售中') && !text.includes('已下架'))
            .sort((left, right) => right.length - left.length)[0] ?? '';
        };
        const rowSignature = (row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const infoCell = infoIndex >= 0 ? cells[infoIndex] : undefined;
          const productName = infoCell ? titleFromInfoCell(infoCell) : '';
          const productStatusLabel = infoCell ? statusFromInfoCell(infoCell) : '';
          const custodyStatusLabel = custodyStatusIndex >= 0 ? normalize(cells[custodyStatusIndex]?.textContent) : '';
          return [productName, productStatusLabel, custodyStatusLabel].map(normalize).join('|');
        };
        const matchesStableRowIdentity = (row) => {
          const rowKey = row.getAttribute('data-row-key') ?? '';
          const rowText = normalize(row.textContent);
          const platformProductId = productIdFromText(rowKey) || productIdFromText(rowText);
          if (input.platformProductId) return platformProductId === input.platformProductId || rowText.includes(input.platformProductId);
          if (rowKey && input.rowId && rowKey === input.rowId) return true;
          return rowSignature(row) === input.rowSignature;
        };
        const liveRowStillConflict = (row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const infoCell = infoIndex >= 0 ? cells[infoIndex] : undefined;
          const productStatusLabel = infoCell ? statusFromInfoCell(infoCell) : '';
          const custodyStatusLabel = custodyStatusIndex >= 0 ? normalize(cells[custodyStatusIndex]?.textContent) : '';
          return productStatusLabel === '已下架' && isExplicitCustodyStatus(custodyStatusLabel);
        };
        const rows = Array.from(table?.querySelectorAll('tbody tr') ?? []);
        const matchingRows = rows.filter((candidate) => visible(candidate) && matchesStableRowIdentity(candidate) && liveRowStillConflict(candidate));
        if (matchingRows.length !== 1) return false;
        const target = matchingRows[0];
        const control = Array.from(target?.querySelectorAll('button, a, [role="button"]') ?? [])
          .filter((element) => visible(element))
          .find((element) => normalize(element.textContent) === input.actionLabel);
        if (!(control instanceof HTMLElement)) return false;
        control.click();
        return true;
      })(${serializeBrowserArgument(actionInput)})`,
    );
  }

  private async waitForPageTransition(previous: CustodyConflictTableSnapshot, timeoutMs: number, expectedActivePage: number): Promise<CustodyConflictTableSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let latest = previous;
    while (Date.now() < deadline) {
      await waitForTableToSettle(this.page);
      latest = await this.readCurrentPage();
      if (latest.pageNumber === expectedActivePage) return latest;
      await this.page.waitForTimeout(300);
    }
    throw new Error(`Custody table pagination did not reach page ${expectedActivePage} from page ${previous.pageNumber} within ${timeoutMs}ms.`);
  }

  private async clickPagerStep(direction: 'next' | 'prev'): Promise<boolean> {
    return this.page.evaluate(
      String.raw`((requestedDirection) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
          if (!visible(candidate)) return false;
          const headers = Array.from(candidate.querySelectorAll('thead th')).map((cell) => normalize(cell.textContent));
          return headers.some((header) => header.includes('商品信息'))
            && headers.some((header) => header.includes('曝光次数'))
            && headers.some((header) => header.includes('商品访问次数'))
            && headers.some((header) => header.includes('交易金额'))
            && headers.some((header) => header.includes('托管状态'))
            && headers.some((header) => header.includes('操作'));
        });
        const wrapper = table?.closest('.ant-table-wrapper');
        const selector = requestedDirection === 'next'
          ? '.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)'
          : '.ant-pagination-prev:not(.ant-pagination-disabled) button, .ant-pagination-prev:not(.ant-pagination-disabled)';
        const control = wrapper?.querySelector(selector);
        if (!(control instanceof HTMLElement) || !visible(control)) return false;
        control.click();
        return true;
      })(${serializeBrowserArgument(direction)})`,
    );
  }

  private async confirmVisibleDialog(markerToken: string, targetPlatformProductId: string): Promise<string | null> {
    const deadline = Date.now() + 10000;
    const confirmationInput = { markerToken, targetPlatformProductId };
    while (Date.now() < deadline) {
      const clickedLabel = await this.page.evaluate(
        String.raw`((input) => {
          const markerAttribute = 'data-custody-cleanup-existing-dialog';
          const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
          const visible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const dialogConcernsCustodyCancellation = (dialog) => {
            const text = normalize(dialog.textContent);
            return /(?:取消|解除)\s*托管/u.test(text);
          };
          const dialogMatchesTargetProduct = (dialog) => {
            const text = normalize(dialog.textContent);
            const productIds = Array.from(text.matchAll(/(?:商品ID|平台商品ID|ID)\s*[:：]?\s*(20\d{20,})/g)).map((match) => match[1]);
            if (productIds.length === 0) return true;
            if (!input.targetPlatformProductId) return false;
            return productIds.every((productId) => productId === input.targetPlatformProductId);
          };
          const allowedLabels = ['确认取消托管', '确认解除托管', '确认取消', '确认解除', '取消托管', '解除托管', '确定', '确认'];
          const dialogs = Array.from(document.querySelectorAll('.ant-modal, [role="dialog"], .ant-popover, .ant-popconfirm'))
            .filter((dialog) => visible(dialog)
              && dialog.getAttribute(markerAttribute) !== input.markerToken
              && dialogConcernsCustodyCancellation(dialog)
              && dialogMatchesTargetProduct(dialog));
          for (const dialog of dialogs) {
            const buttons = Array.from(dialog.querySelectorAll('button, a, [role="button"]')).filter((button) => visible(button));
            for (const label of allowedLabels) {
              const button = buttons.find((candidate) => normalize(candidate.textContent) === label);
              if (button instanceof HTMLElement) {
                button.click();
                return label;
              }
            }
          }
          return null;
        })(${serializeBrowserArgument(confirmationInput)})`,
      );
      if (typeof clickedLabel === 'string' && clickedLabel) return clickedLabel;
      await this.page.waitForTimeout(500);
    }
    return null;
  }
}

export { DEFAULT_CUSTODY_URL };
