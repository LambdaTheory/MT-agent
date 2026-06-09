# Feishu App API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send MT-agent test messages and daily report summaries to the user's personal Feishu chat through the Feishu server-side app API.

**Architecture:** Add a focused app API sender that gets `tenant_access_token` and sends text messages. Add a unified Feishu delivery module that prefers app API when configured and falls back to the existing webhook sender. Keep report generation first; Feishu delivery runs only after local files are written and failures are logged.

**Tech Stack:** Node.js, TypeScript, native `fetch`, Vitest, Feishu Open Platform server-side APIs.

---

## File Structure

- Create `src/notify/feishuApp.ts`: app API config, token request, text message send.
- Create `src/notify/feishu.ts`: unified delivery selection and report/test wrappers.
- Modify `src/notify/feishuWebhook.ts`: export the webhook text send helper so the unified module can reuse it.
- Modify `src/cli/testFeishu.ts`: call unified delivery instead of webhook-only delivery.
- Modify `src/cli/dailyReport.ts`: call unified delivery instead of webhook-only delivery.
- Create `tests/feishuApp.test.ts`: request-shape and failure tests for app API sender.
- Create `tests/feishuDelivery.test.ts`: channel selection tests for unified delivery.

## Task 1: Feishu App API Sender

**Files:**
- Create: `src/notify/feishuApp.ts`
- Test: `tests/feishuApp.test.ts`

- [ ] **Step 1: Write failing tests for app API request shape**

Create `tests/feishuApp.test.ts` with tests that inject `fetch` and verify:

```ts
import { describe, expect, it } from 'vitest';
import { sendFeishuAppText } from '../src/notify/feishuApp.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sendFeishuAppText', () => {
  it('gets tenant token and sends text message to open_id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
        return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
      }

      return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
    };

    const result = await sendFeishuAppText(
      {
        appId: 'cli_test',
        appSecret: 'secret',
        receiveIdType: 'open_id',
        receiveId: 'ou_test',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(calls[0].url).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ app_id: 'cli_test', app_secret: 'secret' });
    expect(calls[1].url).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      receive_id: 'ou_test',
      msg_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
    });
  });

  it('returns a token failure reason when token request fails', async () => {
    const fetchImpl = async () => jsonResponse({ code: 999, msg: 'bad secret' }, 400);

    const result = await sendFeishuAppText(
      {
        appId: 'cli_test',
        appSecret: 'secret',
        receiveIdType: 'open_id',
        receiveId: 'ou_test',
      },
      'hello',
      fetchImpl as typeof fetch,
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('token request failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishuApp.test.ts`

Expected: FAIL because `src/notify/feishuApp.ts` does not exist.

- [ ] **Step 3: Implement minimal app sender**

Create `src/notify/feishuApp.ts`:

```ts
export interface FeishuAppConfig {
  appId: string;
  appSecret: string;
  receiveIdType: string;
  receiveId: string;
}

export type FeishuAppSendResult = { sent: true; channel: 'app' } | { sent: false; channel: 'app'; reason: string };

async function readResponseText(response: Response): Promise<string> {
  return await response.text();
}

export async function sendFeishuAppText(config: FeishuAppConfig, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuAppSendResult> {
  const tokenResponse = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });

  const tokenText = await readResponseText(tokenResponse);
  if (!tokenResponse.ok) {
    return { sent: false, channel: 'app', reason: `token request failed: http ${tokenResponse.status}: ${tokenText}` };
  }

  const tokenBody = JSON.parse(tokenText) as { code?: number; msg?: string; tenant_access_token?: string };
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) {
    return { sent: false, channel: 'app', reason: `token request failed: ${tokenText}` };
  }

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenBody.tenant_access_token}`,
    },
    body: JSON.stringify({
      receive_id: config.receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  const messageText = await readResponseText(messageResponse);
  if (!messageResponse.ok) {
    return { sent: false, channel: 'app', reason: `message send failed: http ${messageResponse.status}: ${messageText}` };
  }

  const messageBody = JSON.parse(messageText) as { code?: number; msg?: string };
  if (messageBody.code !== 0) {
    return { sent: false, channel: 'app', reason: `message send failed: ${messageText}` };
  }

  return { sent: true, channel: 'app' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishuApp.test.ts`

Expected: PASS.

## Task 2: Unified Feishu Delivery

**Files:**
- Create: `src/notify/feishu.ts`
- Modify: `src/notify/feishuWebhook.ts`
- Test: `tests/feishuDelivery.test.ts`

- [ ] **Step 1: Write failing tests for channel selection**

Create `tests/feishuDelivery.test.ts` with tests that verify app API is preferred and webhook fallback remains available.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishuDelivery.test.ts`

Expected: FAIL because `src/notify/feishu.ts` does not exist.

- [ ] **Step 3: Export webhook text sender**

In `src/notify/feishuWebhook.ts`, change `async function sendFeishuText` to `export async function sendFeishuWebhookText` and update internal calls to use the new name.

- [ ] **Step 4: Implement unified delivery module**

Create `src/notify/feishu.ts` with:

```ts
import type { DailyReportData } from '../domain/types.js';
import { sendFeishuAppText, type FeishuAppConfig } from './feishuApp.js';
import { buildFeishuReportText, buildFeishuTestText, sendFeishuWebhookText, type FeishuReportPaths } from './feishuWebhook.js';

export type FeishuDeliveryResult =
  | { sent: true; channel: 'app' | 'webhook' }
  | { sent: false; channel: 'app' | 'webhook' | 'none'; reason: string };

export interface FeishuEnv {
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_RECEIVE_ID_TYPE?: string;
  FEISHU_RECEIVE_ID?: string;
  FEISHU_WEBHOOK_URL?: string;
}

function appConfigFromEnv(env: FeishuEnv): FeishuAppConfig | null {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_RECEIVE_ID) {
    return null;
  }

  return {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    receiveIdType: env.FEISHU_RECEIVE_ID_TYPE ?? 'open_id',
    receiveId: env.FEISHU_RECEIVE_ID,
  };
}

export async function sendFeishuText(env: FeishuEnv, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  const appConfig = appConfigFromEnv(env);
  if (appConfig) {
    return sendFeishuAppText(appConfig, text, fetchImpl);
  }

  if (env.FEISHU_WEBHOOK_URL) {
    const result = await sendFeishuWebhookText(env.FEISHU_WEBHOOK_URL, text, fetchImpl);
    return result.sent ? { sent: true, channel: 'webhook' } : { sent: false, channel: 'webhook', reason: result.reason };
  }

  return { sent: false, channel: 'none', reason: 'missing Feishu app config and webhook url' };
}

export async function maybeSendFeishuReport(data: DailyReportData, paths: FeishuReportPaths, env: FeishuEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  return sendFeishuText(env, buildFeishuReportText(data, paths), fetchImpl);
}

export async function maybeSendFeishuTestMessage(env: FeishuEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<FeishuDeliveryResult> {
  return sendFeishuText(env, buildFeishuTestText(), fetchImpl);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/feishuDelivery.test.ts`

Expected: PASS.

## Task 3: CLI Integration

**Files:**
- Modify: `src/cli/testFeishu.ts`
- Modify: `src/cli/dailyReport.ts`

- [ ] **Step 1: Update test CLI import and call**

Change `src/cli/testFeishu.ts` to import `maybeSendFeishuTestMessage` from `../notify/feishu.js` and call it without passing only `FEISHU_WEBHOOK_URL`.

- [ ] **Step 2: Update daily report import and call**

Change `src/cli/dailyReport.ts` to import `maybeSendFeishuReport` from `../notify/feishu.js` and call it as `maybeSendFeishuReport(report, { markdownPath: paths.markdown, workbookPath: paths.workbook })` after local files are written.

- [ ] **Step 3: Run focused tests and build**

Run: `npm test -- tests/feishuApp.test.ts tests/feishuDelivery.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

## Task 4: Live Feishu Verification

**Files:**
- No source changes required unless API errors reveal a verified issue.

- [ ] **Step 1: Set environment variables in PowerShell**

Run:

```powershell
$env:FEISHU_APP_ID="cli_aaac356831239cfa"
$env:FEISHU_APP_SECRET="<new secret from Feishu console>"
$env:FEISHU_RECEIVE_ID_TYPE="open_id"
$env:FEISHU_RECEIVE_ID="ou_82de490b121a09a8c88229be29757659"
```

- [ ] **Step 2: Send test message**

Run: `npm run test-feishu`

Expected: console prints `Feishu test message sent.` and the personal Feishu chat receives the message.

- [ ] **Step 3: Verify daily report integration after report generation path is healthy**

Run: `npm run daily-report`

Expected: local report files are written first, then the run log records `Sent Feishu notification` or a clear Feishu failure reason.

## Self-Review

- Spec coverage: app API, webhook fallback, env-only secrets, local-first report flow, and failure logging are covered.
- Placeholder scan: no implementation placeholders are required for execution; the only placeholder is the live secret value, which must not be written into source.
- Type consistency: `FeishuDeliveryResult`, `FeishuAppConfig`, and sender function names are consistent across tasks.
