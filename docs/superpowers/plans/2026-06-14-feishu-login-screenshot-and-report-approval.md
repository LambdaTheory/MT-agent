# Feishu Login Screenshot and Report Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send Alipay login QR screenshots privately to the operator and let the operator command the bot with `推送日报到群` to push the latest checked public traffic report to the group.

**Architecture:** Add Feishu image upload/message support in the existing app notifier, then build a best-effort login notification helper used by crawler login branches. Extend the bot intent parser with a dedicated group resend command that reuses the existing latest-report resend path without re-crawling.

**Tech Stack:** TypeScript, Node.js, Playwright `Page.screenshot()`, Feishu app OpenAPI, Vitest, existing `tsx` scripts.

---

## File Structure

- Modify `src/notify/feishuApp.ts`: expose Feishu image upload and image-message sending using the existing tenant token helper.
- Modify `src/notify/feishu.ts`: add `sendFeishuPersonalImage()` and personal-recipient config resolution.
- Create `src/crawler/loginNotification.ts`: best-effort screenshot capture, dedupe by stage, and private Feishu text/image notification.
- Modify `src/crawler/goodsExportCrawler.ts`: notify when goods export reaches login page.
- Modify `src/crawler/exposureCrawler.ts`: notify when exposure crawl reaches login page.
- Modify `src/crawler/dashboardCrawler.ts`: notify when dashboard crawl reaches login page.
- Modify `src/cli/probePageSize.ts` and `src/crawler/exposurePageProbe.ts`: use the helper for probe login pages.
- Modify `src/feishuBot/types.ts`: add `push_latest_report_to_group` intent.
- Modify `src/feishuBot/intent.ts`: parse `推送日报到群`.
- Modify `src/feishuBot/tools.ts`: handle `push_latest_report_to_group` by forcing group delivery.
- Add/modify tests in `tests/feishuApp.test.ts`, `tests/feishuDelivery.test.ts`, `tests/loginNotification.test.ts`, `tests/loginNotificationWiring.test.ts`, `tests/feishuBotIntent.test.ts`, `tests/feishuBotTools.test.ts`, and `tests/feishuBotPushGroup.test.ts`.

---

### Task 1: Feishu App Image API

**Files:**
- Modify: `src/notify/feishuApp.ts`
- Test: `tests/feishuApp.test.ts`

- [ ] **Step 1: Write the failing image upload/message tests**

Append this to `tests/feishuApp.test.ts`:

```ts
import { sendFeishuAppImage, uploadFeishuAppImage } from '../src/notify/feishuApp.js';

describe('Feishu app image messages', () => {
  it('uploads an image and returns the image key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      }
      return jsonResponse({ code: 0, data: { image_key: 'img_v3_test' } });
    };

    const result = await uploadFeishuAppImage(
      { appId: 'cli_test', appSecret: 'secret' },
      new Uint8Array([1, 2, 3]),
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ uploaded: true, imageKey: 'img_v3_test' });
    expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/images');
    expect(calls[1].init.method).toBe('POST');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(calls[1].init.body).toBeInstanceOf(FormData);
  });

  it('sends an image message to a personal receiver', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      }
      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await sendFeishuAppImage(
      { appId: 'cli_test', appSecret: 'secret', receiveIdType: 'open_id', receiveId: 'ou_test' },
      'img_v3_test',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      receive_id: 'ou_test',
      msg_type: 'image',
      content: JSON.stringify({ image_key: 'img_v3_test' }),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- tests/feishuApp.test.ts
```

Expected: FAIL because `uploadFeishuAppImage` and `sendFeishuAppImage` are not exported.

- [ ] **Step 3: Implement image upload and image send**

In `src/notify/feishuApp.ts`, add result type and functions near the existing app send functions:

```ts
export type FeishuAppImageUploadResult = { uploaded: true; imageKey: string } | { uploaded: false; reason: string };

export async function uploadFeishuAppImage(
  config: FeishuTokenConfig,
  image: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuAppImageUploadResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) {
    return { uploaded: false, reason: token.reason };
  }

  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([image], { type: 'image/png' }), 'login.png');

  const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}` },
    body: form,
  });

  const body = await response.text();
  if (!response.ok) return { uploaded: false, reason: `image upload failed: http ${response.status}: ${body}` };

  const parsed = JSON.parse(body) as { code?: number; data?: { image_key?: string } };
  if (parsed.code !== 0 || !parsed.data?.image_key) return { uploaded: false, reason: `image upload failed: ${body}` };
  return { uploaded: true, imageKey: parsed.data.image_key };
}

export async function sendFeishuAppImage(
  config: FeishuAppConfig,
  imageKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuAppSendResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) {
    return { sent: false, channel: 'app', reason: token.reason };
  }

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.token}`,
    },
    body: JSON.stringify({
      receive_id: config.receiveId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    }),
  });

  const messageText = await messageResponse.text();
  if (!messageResponse.ok) return { sent: false, channel: 'app', reason: `image message send failed: http ${messageResponse.status}: ${messageText}` };

  const messageBody = JSON.parse(messageText) as { code?: number };
  if (messageBody.code !== 0) return { sent: false, channel: 'app', reason: `image message send failed: ${messageText}` };
  return { sent: true, channel: 'app' };
}
```

- [ ] **Step 4: Run image tests**

Run:

```bash
npm test -- tests/feishuApp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/notify/feishuApp.ts tests/feishuApp.test.ts
git commit -m "功能：飞书应用支持图片消息"
```

---

### Task 2: Personal Feishu Image Delivery Wrapper

**Files:**
- Modify: `src/notify/feishu.ts`
- Test: `tests/feishuDelivery.test.ts`

- [ ] **Step 1: Write failing wrapper tests**

Append this to `tests/feishuDelivery.test.ts`:

```ts
import { sendFeishuPersonalImage } from '../src/notify/feishu.js';

describe('sendFeishuPersonalImage', () => {
  it('uploads and sends an image to the personal recipient only', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      if (String(url).includes('/im/v1/images')) return jsonResponse({ code: 0, data: { image_key: 'img_v3_test' } });
      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await sendFeishuPersonalImage(
      {
        FEISHU_APP_ID: 'cli_test',
        FEISHU_APP_SECRET: 'secret',
        FEISHU_PERSONAL_RECEIVE_ID_TYPE: 'open_id',
        FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
        FEISHU_GROUP_RECEIVE_ID_TYPE: 'chat_id',
        FEISHU_GROUP_RECEIVE_ID: 'oc_group',
      },
      new Uint8Array([1, 2, 3]),
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    const messageBody = JSON.parse(String(calls[3].init.body));
    expect(messageBody.receive_id).toBe('ou_personal');
    expect(messageBody.receive_id).not.toBe('oc_group');
  });

  it('returns missing config when personal recipient is absent', async () => {
    const result = await sendFeishuPersonalImage({ FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'secret' }, new Uint8Array([1]));
    expect(result).toEqual({ sent: false, channel: 'none', reason: 'missing Feishu personal app config' });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/feishuDelivery.test.ts
```

Expected: FAIL because `sendFeishuPersonalImage` is not exported.

- [ ] **Step 3: Implement personal image wrapper**

In `src/notify/feishu.ts`, update the import and add the function:

```ts
import { sendFeishuAppCard, sendFeishuAppImage, sendFeishuAppText, uploadFeishuAppImage, type FeishuAppConfig, type FeishuCardPayload } from './feishuApp.js';
```

Add after `sendFeishuText()`:

```ts
export async function sendFeishuPersonalImage(env: FeishuEnv, image: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  const base = baseAppConfig(env);
  const recipient = personalRecipient(env);
  if (!base || !recipient) return { sent: false, channel: 'none', reason: 'missing Feishu personal app config' };

  const upload = await uploadFeishuAppImage(base, image, fetchImpl);
  if (!upload.uploaded) return { sent: false, channel: 'app', reason: upload.reason };

  return sendFeishuAppImage({ ...base, ...recipient }, upload.imageKey, fetchImpl);
}
```

- [ ] **Step 4: Run wrapper tests**

Run:

```bash
npm test -- tests/feishuDelivery.test.ts tests/feishuApp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/notify/feishu.ts tests/feishuDelivery.test.ts
git commit -m "功能：飞书个人图片发送封装"
```

---

### Task 3: Login Screenshot Notification Helper

**Files:**
- Create: `src/crawler/loginNotification.ts`
- Test: `tests/loginNotification.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/loginNotification.test.ts`:

```ts
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLoginRequired, resetLoginNotificationDedupeForTests } from '../src/crawler/loginNotification.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('notifyLoginRequired', () => {
  beforeEach(() => resetLoginNotificationDedupeForTests());

  it('captures a screenshot and sends private text and image once per stage', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-login-notify-'));
    await mkdir(outputDir, { recursive: true });
    const page = { screenshot: vi.fn(async () => Buffer.from([1, 2, 3])) };
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      if (String(url).includes('/im/v1/images')) return jsonResponse({ code: 0, data: { image_key: 'img_v3_test' } });
      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await notifyLoginRequired({
      page,
      stage: 'goods-export',
      outputDir,
      env: { FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'secret', FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal' },
      fetchImpl: fetchImpl as typeof fetch,
      log: () => undefined,
    });

    const second = await notifyLoginRequired({
      page,
      stage: 'goods-export',
      outputDir,
      env: { FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'secret', FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal' },
      fetchImpl: fetchImpl as typeof fetch,
      log: () => undefined,
    });

    expect(result.notified).toBe(true);
    expect(second).toEqual({ notified: false, reason: 'already notified for stage goods-export' });
    expect(page.screenshot).toHaveBeenCalledTimes(1);
    expect(urls.some((url) => url.includes('/im/v1/images'))).toBe(true);
    const filesDir = join(outputDir, 'state', 'login-screenshots');
    const saved = await readFile(join(filesDir, result.fileName ?? ''));
    expect([...saved]).toEqual([1, 2, 3]);
  });

  it('does not throw when notification delivery fails', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-login-notify-'));
    const logs: string[] = [];
    const page = { screenshot: vi.fn(async () => Buffer.from([1, 2, 3])) };
    const result = await notifyLoginRequired({
      page,
      stage: 'dashboard',
      outputDir,
      env: {},
      fetchImpl: fetch,
      log: (message) => logs.push(message),
    });

    expect(result.notified).toBe(false);
    expect(result.reason).toContain('missing Feishu personal app config');
    expect(logs.join('\n')).toContain('支付宝登录截图通知跳过');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/loginNotification.test.ts
```

Expected: FAIL because `src/crawler/loginNotification.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/crawler/loginNotification.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sendFeishuPersonalImage, sendFeishuText, type FeishuEnv } from '../notify/feishu.js';

type ScreenshotPage = {
  screenshot(options?: { fullPage?: boolean; type?: 'png' }): Promise<Buffer | Uint8Array>;
};

export interface LoginNotificationOptions {
  page: ScreenshotPage;
  stage: string;
  outputDir: string;
  env?: FeishuEnv;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export type LoginNotificationResult =
  | { notified: true; fileName: string }
  | { notified: false; reason: string };

const notifiedStages = new Set<string>();

function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeStage(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'login';
}

export function resetLoginNotificationDedupeForTests(): void {
  notifiedStages.clear();
}

export async function notifyLoginRequired(options: LoginNotificationOptions): Promise<LoginNotificationResult> {
  if (notifiedStages.has(options.stage)) return { notified: false, reason: `already notified for stage ${options.stage}` };
  notifiedStages.add(options.stage);

  const log = options.log ?? (() => undefined);
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const image = await options.page.screenshot({ type: 'png', fullPage: false });
    const dir = join(options.outputDir, 'state', 'login-screenshots');
    await mkdir(dir, { recursive: true });
    const fileName = `${timestampForFile()}-${safeStage(options.stage)}.png`;
    await writeFile(join(dir, fileName), image);

    await sendFeishuText({ ...env, FEISHU_SEND_TO: 'personal' }, `检测到支付宝需要扫码登录。阶段：${options.stage}。请扫码后等待流程自动继续。`, fetchImpl);
    const result = await sendFeishuPersonalImage(env, image, fetchImpl);
    if (!result.sent) {
      log(`支付宝登录截图通知跳过: ${result.reason}`);
      return { notified: false, reason: result.reason };
    }

    log(`支付宝登录截图已发送到个人飞书: ${options.stage}`);
    return { notified: true, fileName };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`支付宝登录截图通知失败: ${reason}`);
    return { notified: false, reason };
  }
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- tests/loginNotification.test.ts tests/feishuDelivery.test.ts tests/feishuApp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/crawler/loginNotification.ts tests/loginNotification.test.ts
git commit -m "功能：支付宝登录截图私信通知"
```

---

### Task 4: Wire Login Notifications Into Crawlers

**Files:**
- Modify: `src/crawler/goodsExportCrawler.ts`
- Modify: `src/crawler/exposureCrawler.ts`
- Modify: `src/crawler/dashboardCrawler.ts`
- Modify: `src/cli/probePageSize.ts`
- Modify: `src/crawler/exposurePageProbe.ts`
- Test: `tests/loginNotificationWiring.test.ts`

- [ ] **Step 1: Write failing source coverage test**

Append this to `tests/dashboardCrawlerSource.test.ts` or create `tests/loginNotificationWiring.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('login notification wiring', () => {
  it('wires login screenshot notification into crawler login branches', async () => {
    const files = [
      '../src/crawler/goodsExportCrawler.ts',
      '../src/crawler/exposureCrawler.ts',
      '../src/crawler/dashboardCrawler.ts',
      '../src/cli/probePageSize.ts',
      '../src/crawler/exposurePageProbe.ts',
    ];

    for (const file of files) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      expect(source).toContain("notifyLoginRequired");
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- tests/loginNotificationWiring.test.ts
```

Expected: FAIL for files not yet importing or calling `notifyLoginRequired`.

- [ ] **Step 3: Implement crawler wiring**

In each target file, import the helper:

```ts
import { notifyLoginRequired } from './loginNotification.js';
```

For `src/cli/probePageSize.ts`, use:

```ts
import { notifyLoginRequired } from '../crawler/loginNotification.js';
```

Call it in every `if (loginState === 'login-page')` branch before waiting for login completion. Example for `goodsExportCrawler.ts`:

```ts
if (loginState === 'login-page') {
  console.log('检测到支付宝登录页，请在打开的浏览器窗口扫码登录；登录成功后程序会自动继续下载商品总表。');
  await notifyLoginRequired({ page, stage: 'goods-export', outputDir: config.outputDir, log: (message) => console.log(message) });
  await page.waitForURL((currentUrl) => !/auth\.alipay\.com|login/i.test(currentUrl.toString()), { timeout: 300000 });
  loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
}
```

Use these stage names:

- `goods-export` in `goodsExportCrawler.ts`
- `exposure` in `exposureCrawler.ts`
- `dashboard` in `dashboardCrawler.ts`
- `page-size-probe` in `src/cli/probePageSize.ts`
- `exposure-page-probe` in `src/crawler/exposurePageProbe.ts`

- [ ] **Step 4: Run wiring and build checks**

Run:

```bash
npm test -- tests/loginNotificationWiring.test.ts tests/loginNotification.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/crawler/goodsExportCrawler.ts src/crawler/exposureCrawler.ts src/crawler/dashboardCrawler.ts src/cli/probePageSize.ts src/crawler/exposurePageProbe.ts tests/loginNotificationWiring.test.ts
git commit -m "功能：抓取登录页触发飞书截图通知"
```

---

### Task 5: Private Command `推送日报到群`

**Files:**
- Modify: `src/feishuBot/types.ts`
- Modify: `src/feishuBot/intent.ts`
- Modify: `src/feishuBot/tools.ts`
- Test: `tests/feishuBotIntent.test.ts`
- Test: `tests/feishuBotTools.test.ts`

- [ ] **Step 1: Write failing intent test**

Add this to `tests/feishuBotIntent.test.ts`:

```ts
it('parses checked report push to group intent', () => {
  expect(parseBotIntent('推送日报到群')).toEqual({ type: 'push_latest_report_to_group' });
});
```

- [ ] **Step 2: Write failing tool behavior test**

In `tests/feishuBotTools.test.ts`, mock `sendFeishuCard` before importing `handleBotIntent`. If the current file structure makes top-level mock awkward, create `tests/feishuBotPushGroup.test.ts` with this content:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const sendFeishuCard = vi.fn(async () => ({ sent: true, channel: 'app' as const }));

vi.mock('../src/notify/feishu.js', () => ({ sendFeishuCard }));

const { handleBotIntent } = await import('../src/feishuBot/tools.js');

const summary = {
  exposure: 1000,
  publicVisits: 50,
  dashboardVisits: 40,
  createdOrders: 3,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.05,
  visitCreatedOrderRate: 0.075,
  visitShipmentRate: 0.025,
};

describe('push latest report to group command', () => {
  it('forces latest report delivery to group without crawling', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-push-group-'));
    await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
    await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
      date: '2026-06-11',
      summary: { '1d': summary, '7d': summary, '30d': summary },
      conclusions: [],
      rows: [],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await handleBotIntent({ type: 'push_latest_report_to_group' }, outputDir);

    expect(response.text).toBe('最新公域日报已推送到群。');
    expect(sendFeishuCard).toHaveBeenCalledTimes(1);
    expect(sendFeishuCard.mock.calls[0][0]).toMatchObject({ FEISHU_SEND_TO: 'group' });
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/feishuBotIntent.test.ts tests/feishuBotPushGroup.test.ts
```

Expected: FAIL because `push_latest_report_to_group` is not a known intent.

- [ ] **Step 4: Implement intent and tool handling**

In `src/feishuBot/types.ts`, add to `BotIntent`:

```ts
  | { type: 'push_latest_report_to_group' }
```

In `src/feishuBot/intent.ts`, add before the generic resend rule:

```ts
  if (/^推送(日报|公域日报)到群$/.test(text)) return { type: 'push_latest_report_to_group' };
```

In `src/feishuBot/tools.ts`, update help text:

```ts
return { text: '可用命令：今日概况｜查询 565｜跑日报｜重发日报｜推送日报到群｜帮助' };
```

Then add a branch before `resend_latest_report`:

```ts
if (intent.type === 'push_latest_report_to_group') {
  const latest = await findLatestReportContext(outputDir);
  if (!latest) return { text: '还没有找到可推送的公域日报。' };
  const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
  const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
  const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
  return { text: result.sent ? '最新公域日报已推送到群。' : `公域日报推送到群失败：${result.reason}` };
}
```

- [ ] **Step 5: Run bot tests**

Run:

```bash
npm test -- tests/feishuBotIntent.test.ts tests/feishuBotPushGroup.test.ts tests/feishuBotTools.test.ts
```

Expected: PASS. If the help text assertion in `tests/feishuBotTools.test.ts` fails, update its expected string to include `推送日报到群`.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/feishuBot/types.ts src/feishuBot/intent.ts src/feishuBot/tools.ts tests/feishuBotIntent.test.ts tests/feishuBotTools.test.ts tests/feishuBotPushGroup.test.ts
git commit -m "功能：飞书私聊推送日报到群"
```

---

### Task 6: Final Verification and Push

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/feishuApp.test.ts tests/feishuDelivery.test.ts tests/loginNotification.test.ts tests/loginNotificationWiring.test.ts tests/feishuBotIntent.test.ts tests/feishuBotPushGroup.test.ts tests/feishuBotTools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS. If `.worktrees/` causes duplicate stale tests to run, record that and rerun targeted tests plus the root test files explicitly.

- [ ] **Step 4: Inspect status and commits**

Run:

```bash
git status -sb
git log --oneline -10
```

Expected: only intentional changes are committed; working tree is clean.

- [ ] **Step 5: Push**

Run:

```bash
git push origin master
```

Expected: push succeeds.

- [ ] **Step 6: Manual smoke test without re-crawling**

Send this message to the Feishu bot in the personal chat:

```text
推送日报到群
```

Expected: bot replies privately `最新公域日报已推送到群。` and the group receives the latest public traffic report card. This command must not open a browser or trigger Alipay login.

---

## Plan Self-Review

- Spec coverage: Task 1 and Task 2 cover image upload/private delivery. Task 3 covers screenshot capture, storage, failure handling, and dedupe. Task 4 wires detection into crawler login branches. Task 5 covers `推送日报到群` without re-crawling. Task 6 covers verification and smoke testing.
- Placeholder scan: no unfinished placeholders remain; all tasks include exact files, commands, and expected outcomes.
- Type consistency: `sendFeishuPersonalImage`, `notifyLoginRequired`, `push_latest_report_to_group`, and result shapes are used consistently across tasks.
