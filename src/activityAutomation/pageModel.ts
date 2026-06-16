import type { Page } from 'playwright';

const MUTATING_CONTROL_PATTERNS = [/提交/, /发布/, /确认创建/, /立即创建/, /保存并提交/, /确定/];

export interface ActivityControlSummary {
  text: string;
  tagName: string;
  mutating: boolean;
}

export function isKnownMutatingControlText(text: string): boolean {
  return MUTATING_CONTROL_PATTERNS.some((pattern) => pattern.test(text.replace(/\s+/g, ' ').trim()));
}

export async function collectVisibleActivityControls(page: Page): Promise<ActivityControlSummary[]> {
  const controls = await page.locator('button, a, input, textarea, [role="button"], .ant-btn, .ant-select-selector, .ant-radio-wrapper, .ant-checkbox-wrapper').evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        text: String(node.textContent ?? node.getAttribute('placeholder') ?? node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim(),
        tagName: node.tagName.toLowerCase(),
      }))
      .filter((control) => control.text.length > 0),
  );

  return controls.map((control) => ({ ...control, mutating: isKnownMutatingControlText(control.text) }));
}

export async function waitForActivityFormShell(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('form, .ant-form, input, textarea, button', { timeout: 180000 }),
    page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 180000 }),
  ]);
}
