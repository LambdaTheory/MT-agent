import type { Page } from 'playwright';

const PRIMARY_SUBMIT_LABEL_SCORES: Array<[RegExp, number]> = [
  [/\u4fdd\u5b58\u5e76\u63d0\u4ea4/u, 500],
  [/^\u63d0\u4ea4$/u, 480],
  [/\u786e\u8ba4\u521b\u5efa/u, 460],
  [/\u7acb\u5373\u521b\u5efa/u, 440],
  [/^\u53d1\u5e03$/u, 420],
  [/\u63d0\u4ea4/u, 380],
  [/^\u786e\u5b9a$/u, 120],
] as const;

const MODAL_CONFIRM_LABEL_SCORES: Array<[RegExp, number]> = [
  [/\u786e\u8ba4\u63d0\u4ea4/u, 500],
  [/\u786e\u8ba4\u521b\u5efa/u, 480],
  [/^\u63d0\u4ea4$/u, 460],
  [/^\u786e\u5b9a$/u, 440],
] as const;

const SUCCESS_SUMMARY_PATTERNS = [
  /\u5df2\u521b\u5efa/u,
  /\u521b\u5efa\u6210\u529f/u,
  /\u63d0\u4ea4\u6210\u529f/u,
  /\u6d3b\u52a8\u5217\u8868/u,
  /\u6d3b\u52a8\u8be6\u60c5/u,
] as const;

const SUCCESS_CONFIRMATION_PATTERNS = [
  /\u521b\u5efa\u6210\u529f/u,
  /\u63d0\u4ea4\u6210\u529f/u,
  /\u5df2\u521b\u5efa/u,
  /\u6d3b\u52a8\u5217\u8868/u,
  /\u6d3b\u52a8\u8be6\u60c5/u,
] as const;

export interface ActivitySubmitResult {
  submittedAt: string;
  submittedUrl: string;
  clickedControlText: string;
  confirmationText?: string;
  activityId?: string;
}

export interface ActivitySubmitOutcomeAssessment {
  confirmed: boolean;
  reason: 'url_changed' | 'success_text' | 'ambiguous';
}

export interface ActivitySubmitControlCandidate {
  index: number;
  text: string;
  disabled: boolean;
  hidden: boolean;
  role: string;
  inDialog: boolean;
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function labelScore(label: string, scoreTable: ReadonlyArray<readonly [RegExp, number]>): number {
  const compactLabel = compact(label);
  for (const [pattern, score] of scoreTable) {
    if (pattern.test(compactLabel)) return score;
  }
  return -1;
}

function chooseBestControl(
  candidates: ActivitySubmitControlCandidate[],
  scoreTable: ReadonlyArray<readonly [RegExp, number]>,
  options: { requireDialog?: boolean; preferNonDialog?: boolean } = {},
): ActivitySubmitControlCandidate | null {
  const eligible = candidates.filter((candidate) => {
    if (candidate.hidden || candidate.disabled) return false;
    if (options.requireDialog && !candidate.inDialog) return false;
    return labelScore(candidate.text, scoreTable) >= 0;
  });
  if (eligible.length === 0) return null;

  return [...eligible].sort((left, right) => {
    const scoreGap = labelScore(right.text, scoreTable) - labelScore(left.text, scoreTable);
    if (scoreGap !== 0) return scoreGap;
    if (options.preferNonDialog && left.inDialog !== right.inDialog) {
      return Number(left.inDialog) - Number(right.inDialog);
    }
    return left.index - right.index;
  })[0] ?? null;
}

export function chooseActivitySubmitControl(candidates: ActivitySubmitControlCandidate[]): ActivitySubmitControlCandidate | null {
  return chooseBestControl(candidates, PRIMARY_SUBMIT_LABEL_SCORES, { preferNonDialog: true });
}

export function chooseActivitySubmitModalConfirmControl(candidates: ActivitySubmitControlCandidate[]): ActivitySubmitControlCandidate | null {
  return chooseBestControl(candidates, MODAL_CONFIRM_LABEL_SCORES, { requireDialog: true });
}

function extractActivityId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('activityId') ?? parsed.searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}

function summarizeConfirmationText(bodyText: string): string | undefined {
  const lines = bodyText
    .split('\n')
    .map((line) => normalized(line))
    .filter(Boolean);
  return lines.find((line) => SUCCESS_SUMMARY_PATTERNS.some((pattern) => pattern.test(line))) ?? lines[0];
}

function hasSuccessText(bodyText: string): boolean {
  return SUCCESS_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(compact(bodyText)));
}

export function assessActivitySubmitOutcome(input: {
  beforeUrl: string;
  afterUrl: string;
  beforeText: string;
  afterText: string;
}): ActivitySubmitOutcomeAssessment {
  if (input.afterUrl !== input.beforeUrl) return { confirmed: true, reason: 'url_changed' };
  if (hasSuccessText(input.afterText) && compact(input.afterText) !== compact(input.beforeText)) {
    return { confirmed: true, reason: 'success_text' };
  }
  return { confirmed: false, reason: 'ambiguous' };
}

async function collectSubmitControlCandidates(page: Page): Promise<ActivitySubmitControlCandidate[]> {
  return page.locator('button, [role="button"], .ant-btn').evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const element = node as HTMLElement;
      const text = String(node.textContent ?? node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
      const disabled = node instanceof HTMLButtonElement
        ? node.disabled
        : node.getAttribute('aria-disabled') === 'true' || node.getAttribute('disabled') !== null;
      const hidden = element.offsetParent === null || getComputedStyle(element).visibility === 'hidden';
      return {
        index,
        text,
        disabled,
        hidden,
        role: node.getAttribute('role') ?? node.tagName.toLowerCase(),
        inDialog: Boolean(node.closest('.ant-modal, .ant-popover, .ant-popconfirm, [role="dialog"]')),
      };
    }),
  );
}

async function clickControl(page: Page, index: number): Promise<void> {
  const control = page.locator('button, [role="button"], .ant-btn').nth(index);
  await control.scrollIntoViewIfNeeded().catch(() => undefined);
  await control.click({ force: true, timeout: 15000 });
}

async function waitForSubmitOutcome(page: Page, beforeUrl: string, beforeText: string): Promise<void> {
  await Promise.race([
    page.waitForURL((currentUrl) => currentUrl.toString() !== beforeUrl, { timeout: 30000 }),
    page.waitForFunction(
      ({ expectedUrl, previousText, successPatterns }) => {
        const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim();
        return window.location.href !== expectedUrl
          || bodyText !== previousText
          || successPatterns.some((pattern) => new RegExp(pattern, 'u').test(bodyText));
      },
      {
        expectedUrl: beforeUrl,
        previousText: normalized(beforeText),
        successPatterns: SUCCESS_CONFIRMATION_PATTERNS.map((pattern) => pattern.source),
      },
      { timeout: 30000 },
    ),
  ]).catch(() => undefined);

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
}

async function confirmSubmitModalIfPresent(page: Page): Promise<void> {
  await page.waitForFunction(
    ({ confirmPatterns }) => {
      const controls = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn'));
      return controls.some((node) => {
        const element = node as HTMLElement;
        if (element.offsetParent === null || getComputedStyle(element).visibility === 'hidden') return false;
        if (!node.closest('.ant-modal, .ant-popover, .ant-popconfirm, [role="dialog"]')) return false;
        const text = String(node.textContent ?? node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
        return confirmPatterns.some((pattern) => new RegExp(pattern, 'u').test(text));
      });
    },
    { confirmPatterns: MODAL_CONFIRM_LABEL_SCORES.map(([pattern]) => pattern.source) },
    { timeout: 3000 },
  ).catch(() => undefined);

  const confirmControl = chooseActivitySubmitModalConfirmControl(await collectSubmitControlCandidates(page));
  if (!confirmControl) return;
  await clickControl(page, confirmControl.index);
}

export async function submitDifferentialPricingActivity(page: Page): Promise<ActivitySubmitResult> {
  const beforeUrl = page.url();
  const beforeText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const submitControl = chooseActivitySubmitControl(await collectSubmitControlCandidates(page));
  if (!submitControl) {
    throw new Error('Unable to locate a visible submit control on the differential pricing form.');
  }

  await clickControl(page, submitControl.index);
  await confirmSubmitModalIfPresent(page);
  await waitForSubmitOutcome(page, beforeUrl, beforeText);

  const afterUrl = page.url();
  const afterText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const outcome = assessActivitySubmitOutcome({ beforeUrl, afterUrl, beforeText, afterText });
  if (!outcome.confirmed) {
    throw new Error(`Submit outcome is ambiguous: url stayed at ${afterUrl} and no success signal was detected.`);
  }
  return {
    submittedAt: new Date().toISOString(),
    submittedUrl: afterUrl,
    clickedControlText: submitControl.text,
    confirmationText: summarizeConfirmationText(afterText),
    activityId: extractActivityId(afterUrl),
  };
}
