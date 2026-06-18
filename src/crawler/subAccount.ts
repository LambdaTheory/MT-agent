import type { Locator, Page } from 'playwright';

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export async function selectSubAccountIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes('select-identity')) {
    return;
  }

  const matchers = [/深圳.*米奇/, /米奇.*租赁/];
  const fallbackMatchers = [/米奇/];
  const accountRows = page.locator('.ant-table-tbody tr');

  try {
    await accountRows.first().waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    const bodyText = normalize(await page.locator('body').textContent().catch(() => ''));
    throw new Error(`Reached the account selection page, but account rows did not appear. Visible text: ${bodyText.slice(0, 1000)}`);
  }

  const count = await accountRows.count();

  async function clickAndNavigate(row: Locator): Promise<boolean> {
    await row.locator('h3').first().click();
    await page.waitForTimeout(2000);

    try {
      await page.waitForURL((url) => !url.toString().includes('select-identity'), { timeout: 30000 });
      await page.waitForTimeout(2000);
      return true;
    } catch {
      return false;
    }
  }

  for (let index = 0; index < count; index += 1) {
    const row = accountRows.nth(index);
    const text = normalize(await row.textContent());
    if (matchers.some((matcher) => matcher.test(text)) || fallbackMatchers.some((matcher) => matcher.test(text))) {
      if (await clickAndNavigate(row)) {
        return;
      }

      await row.click();
      try {
        await page.waitForSelector('.ant-table table', { timeout: 10000 });
        return;
      } catch {
        // continue to error
      }
    }
  }

  const visibleAccounts = await accountRows.evaluateAll((rows) => rows.map((row) => String(row.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  throw new Error(`Reached the account selection page, but could not find the 深圳市米奇租赁有限责任公司 sub-account. Visible accounts: ${visibleAccounts.join(' | ')}`);
}
