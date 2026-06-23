import type { Page } from 'playwright';

function pattern(source: string): RegExp {
  return new RegExp(source, 'u');
}

const MUTATING_CONTROL_PATTERNS = [
  pattern('\\u63d0\\u4ea4'),
  pattern('\\u53d1\\u5e03'),
  pattern('\\u786e\\u8ba4\\u521b\\u5efa'),
  pattern('\\u7acb\\u5373\\u521b\\u5efa'),
  pattern('\\u4fdd\\u5b58\\u5e76\\u63d0\\u4ea4'),
  pattern('\\u786e\\u5b9a'),
];

const READY_SIGNAL_GROUP_SOURCES = [
  ['\\u6d3b\\u52a8\\u540d\\u79f0', '\\u6d3b\\u52a8\\u6807\\u9898'],
  ['\\u9009\\u62e9\\u5546\\u54c1', '\\u5546\\u54c1\\u8303\\u56f4', '\\u6dfb\\u52a0\\u5546\\u54c1', '\\u5df2\\u9009\\u5546\\u54c1'],
  ['\\u4f18\\u60e0\\u91d1\\u989d', '\\u5dee\\u5f02\\u5316\\u5b9a\\u4ef7', '\\u4ef7\\u683c', '\\u51cf\\u514d', '\\u6298\\u6263'],
  ['\\u6d3b\\u52a8\\u65f6\\u95f4', '\\u5f00\\u59cb\\u65f6\\u95f4', '\\u7ed3\\u675f\\u65f6\\u95f4', '\\u6709\\u6548\\u671f'],
] as const;

const READY_SIGNAL_GROUPS = READY_SIGNAL_GROUP_SOURCES.map((group) => group.map((source) => pattern(source)));
const PRODUCT_SIGNAL_PATTERN = pattern('\\u9009\\u62e9\\u5546\\u54c1|\\u5546\\u54c1\\u8303\\u56f4|\\u6dfb\\u52a0\\u5546\\u54c1|\\u5df2\\u9009\\u5546\\u54c1');
const PRICING_SIGNAL_PATTERN = pattern('\\u4f18\\u60e0\\u91d1\\u989d|\\u5dee\\u5f02\\u5316\\u5b9a\\u4ef7|\\u4ef7\\u683c|\\u51cf\\u514d|\\u6298\\u6263');

export interface ActivityControlSummary {
  text: string;
  tagName: string;
  mutating: boolean;
}

export function isKnownMutatingControlText(text: string): boolean {
  return MUTATING_CONTROL_PATTERNS.some((currentPattern) => currentPattern.test(text.replace(/\s+/g, ' ').trim()));
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function matchedReadySignalGroupCount(text: string): number {
  const compact = normalized(text);
  return READY_SIGNAL_GROUPS.filter((patterns) => patterns.some((currentPattern) => currentPattern.test(compact))).length;
}

export function hasDifferentialPricingFormReadySignals(text: string): boolean {
  const compact = normalized(text);
  const matchedGroups = matchedReadySignalGroupCount(compact);
  return matchedGroups >= 3 || (matchedGroups >= 2 && PRODUCT_SIGNAL_PATTERN.test(compact) && PRICING_SIGNAL_PATTERN.test(compact));
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

  if (hasDifferentialPricingFormReadySignals(await page.locator('body').innerText({ timeout: 1000 }).catch(() => ''))) return;

  await page.waitForFunction(
    ({ readySignalGroups, productSignal, pricingSignal }) => {
      const text = document.body.innerText.replace(/\s+/g, ' ').trim();
      const matchedGroups = readySignalGroups.filter((group) => group.some((currentPattern) => new RegExp(currentPattern, 'u').test(text))).length;
      return matchedGroups >= 3 || (matchedGroups >= 2 && new RegExp(productSignal, 'u').test(text) && new RegExp(pricingSignal, 'u').test(text));
    },
    {
      readySignalGroups: READY_SIGNAL_GROUP_SOURCES,
      productSignal: PRODUCT_SIGNAL_PATTERN.source,
      pricingSignal: PRICING_SIGNAL_PATTERN.source,
    },
    { timeout: 180000 },
  );
}
