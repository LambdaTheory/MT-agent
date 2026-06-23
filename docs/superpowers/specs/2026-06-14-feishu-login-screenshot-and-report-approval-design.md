# Feishu Login Screenshot and Report Approval Design

## Goal

When MT-agent reaches an Alipay login or QR-code page during crawler execution, notify the operator privately in Feishu with a screenshot so they can scan and let the run continue. Separately, allow the operator to review the latest generated public traffic report in a private chat and then command the bot to push that report to the configured group.

## Scope

- Send login/QR screenshots only to the personal Feishu recipient.
- Do not send login screenshots to the group.
- Keep the crawler waiting for login after notification; notification failure must not abort the run.
- Add the private chat command `推送日报到群` to resend the latest generated public traffic report to the group.
- Reuse the existing report context and card builder. Do not re-crawl when pushing an already checked report.

## Non-Goals

- No remote browser control from Feishu.
- No approval buttons in this phase.
- No change to the normal daily report generation pipeline.
- No image storage in git.

## Current System

- Login detection is centralized in `src/crawler/loginState.ts` through `waitForSettledLoginState()` and `waitForDashboardAfterLogin()`.
- Crawlers call login detection in `goodsExportCrawler.ts`, `exposureCrawler.ts`, `dashboardCrawler.ts`, and probe CLIs.
- Feishu notification currently supports app text/card sending in `src/notify/feishu.ts` and `src/notify/feishuApp.ts`.
- The bot already supports `resend_latest_report` through `src/feishuBot/tools.ts`, using `findLatestReportContext()` and `sendFeishuCard()`.

## Design

### Login Screenshot Notification

Add a small notification layer for login-required events:

- Detect `login-page` after the existing 10 second grace period.
- Capture the current browser viewport screenshot from the Playwright page so the QR code and login prompt match what the operator sees.
- Save it under an ignored runtime path such as `output/state/login-screenshots/YYYY-MM-DDTHH-mm-ss-<stage>.png`.
- Upload the image to Feishu using the app image upload API.
- Send a private message to `FEISHU_PERSONAL_RECEIVE_ID` with:
  - A short text warning that Alipay login is required.
  - The crawler stage, if available.
  - The screenshot image.

Notification should be best-effort. If screenshot capture, upload, or message sending fails, the crawler logs the reason and continues waiting for manual login in the browser.

### Duplicate Control

Avoid repeated screenshot spam during one CLI run:

- Track notified login stages in memory.
- Send at most one screenshot per stage per process run.
- Suggested stages: `goods-export`, `exposure`, `dashboard`, `probe`.

This keeps separate phases visible while preventing repeated notifications from polling loops.

### Feishu Image Support

Extend the Feishu app notifier with image support:

- Reuse tenant access token acquisition.
- Add image upload for PNG screenshots.
- Add image message sending to the personal recipient.
- Keep the existing text/card APIs unchanged.

The first implementation can send a text message followed by an image message. A card with embedded image is unnecessary for this phase.

### Private Approval Command

Add the command `推送日报到群` to the bot intent resolver.

Behavior:

- Resolve the command text `推送日报到群` from bot messages. This phase does not enforce chat type because the current normalized message model does not carry a reliable private/group flag.
- Build the latest report card from `findLatestReportContext()`.
- Force `FEISHU_SEND_TO=group` for this command.
- Reply privately with success or failure.
- Do not run `runPublicTrafficReportCli()` and do not trigger browser automation.

The command is intended for the operator's personal bot conversation. The group-send target is still explicit and does not depend on the sender's message context.

## Data Flow

### Login Screenshot

1. Crawler navigates to an Alipay page.
2. `waitForSettledLoginState()` returns `login-page` after the grace period.
3. Caller invokes login notification with the Playwright `page` and stage name.
4. Notification captures screenshot and uploads it to Feishu.
5. Personal recipient receives text and screenshot.
6. Crawler continues waiting for login completion.

### Checked Report Push

1. Operator reviews the latest report privately.
2. Operator sends `推送日报到群` to the bot.
3. Bot resolves the intent to resend latest report to group.
4. Bot loads the latest report context from `output`.
5. Bot sends the report card to the configured group recipient.
6. Bot replies privately with the result.

## Error Handling

- Missing personal Feishu recipient: log and skip screenshot notification.
- Missing image upload permission: log/send text fallback if possible.
- Screenshot capture failure: log and continue waiting for login.
- Latest report missing: reply `还没有找到可推送的公域日报。`.
- Group send failure: reply with the Feishu error reason.

## Security

- QR screenshots are sent only to the personal recipient.
- Screenshots are runtime artifacts under `output/`, already outside source control.
- Do not print app secrets, tokens, or `.env` values.
- Do not include local screenshot paths in group messages.

## Tests

- Unit test image upload and image message request bodies with mocked fetch.
- Unit test login notification skips when personal recipient config is missing.
- Unit test notification failure does not throw to the crawler.
- Unit test `推送日报到群` resolves to group resend.
- Unit test report push command calls latest report resend with `sendTo: group`.

## Acceptance Criteria

- When a login/QR page is detected, the personal Feishu recipient gets a text notice and screenshot.
- The crawler still waits for login and continues after manual scan.
- The group never receives login screenshots.
- Sending `推送日报到群` to the bot pushes the latest generated public traffic report to the configured group without re-crawling.
- Existing daily report generation and normal group push behavior remain unchanged.
