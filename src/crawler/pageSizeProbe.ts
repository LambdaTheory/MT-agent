import type { Frame, Page } from 'playwright';

type PageLike = Frame | Page;

export interface PageSizeProbeResult {
  size: number;
  ok: boolean;
  actualSize: number | null;
  rowCount: number;
  error?: string;
}

export const DEFAULT_PAGE_SIZE_CANDIDATES = [100, 50, 20, 10];

export function normalizePageSizeCandidates(preferredPageSize: number): number[] {
  return [preferredPageSize, ...DEFAULT_PAGE_SIZE_CANDIDATES].filter((size, index, array) => array.indexOf(size) === index);
}

export function chooseBestPageSizeProbe(results: PageSizeProbeResult[]): PageSizeProbeResult | null {
  return results.find((result) => result.ok) ?? null;
}

function waitForPageLikeTimeout(page: PageLike, timeout: number): Promise<void> {
  return 'page' in page ? page.page().waitForTimeout(timeout) : page.waitForTimeout(timeout);
}

export async function readCurrentPageSize(page: PageLike): Promise<number | null> {
  const text = await page.locator('.ant-pagination-options-size-changer .ant-select-selection-item').last().textContent().catch(() => '');
  const match = (text ?? '').match(/(\d+)\s*条\/页/);
  return match ? Number(match[1]) : null;
}

export async function setDashboardPageSize(page: PageLike, size: number): Promise<void> {
  const current = await readCurrentPageSize(page);
  if (current === size) {
    return;
  }

  const label = `${size} 条/页`;
  await page.locator('.ant-pagination-options-size-changer').last().click({ timeout: 10000 });
  await page.getByText(label, { exact: true }).last().click({ timeout: 10000 });
  await waitForPageLikeTimeout(page, 3000);
}

export async function probePageSizeCandidates(page: Page, candidates: number[]): Promise<PageSizeProbeResult[]> {
  const results: PageSizeProbeResult[] = [];

  for (const size of candidates) {
    try {
      if (page.isClosed()) {
        results.push({ size, ok: false, actualSize: null, rowCount: 0, error: 'page closed before probe' });
        continue;
      }

      await setDashboardPageSize(page, size);
      await page.waitForSelector('.ant-table table', { timeout: 30000 });
      const rowCount = await page.locator('.ant-table tbody tr').count();
      const actualSize = await readCurrentPageSize(page);
      results.push({ size, ok: actualSize === size && rowCount > 0, actualSize, rowCount });
    } catch (error) {
      results.push({ size, ok: false, actualSize: null, rowCount: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}
