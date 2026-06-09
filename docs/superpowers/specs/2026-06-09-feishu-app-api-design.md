# Feishu App API Delivery Design

## Goal

MT-agent should send its daily report to the user's personal Feishu chat through the Feishu server-side app API. The existing webhook path remains available as a fallback and quick debugging channel.

## Inputs

Runtime configuration comes from environment variables only. Secrets must not be committed to source files.

- `FEISHU_APP_ID`: Feishu app ID, for example `cli_...`.
- `FEISHU_APP_SECRET`: Feishu app secret.
- `FEISHU_RECEIVE_ID_TYPE`: defaults to `open_id`.
- `FEISHU_RECEIVE_ID`: personal receiver ID, currently expected to be an `ou_...` open ID.
- `FEISHU_WEBHOOK_URL`: optional fallback when app API variables are missing.

## Architecture

Add a Feishu app sender beside the existing webhook sender.

- `src/notify/feishuApp.ts` gets `tenant_access_token` and sends text messages through `im/v1/messages`.
- `src/notify/feishu.ts` chooses the delivery channel. App API is preferred when app credentials and receiver ID are present. Webhook is used only when app API configuration is incomplete.
- Existing report text builders can stay in `feishuWebhook.ts` or be reused by the unified sender without changing report content.

## Data Flow

For `npm run test-feishu`:

1. Build the test text.
2. Resolve delivery config from environment variables.
3. If app API config is complete, request `tenant_access_token` from `auth/v3/tenant_access_token/internal`.
4. Send a text message to `/im/v1/messages?receive_id_type=open_id` using the receiver ID.
5. If app API config is incomplete, fall back to webhook if configured.

For `npm run daily-report`:

1. Crawl and generate the local Markdown/XLSX reports.
2. Build the existing Feishu daily report summary text.
3. Send through the same unified delivery path.
4. Feishu delivery runs only after local report files are written. If Feishu delivery fails, the generated local files are kept and the failure is recorded in the run log.

## Error Handling

The app sender should return structured send results rather than throwing for ordinary API failures.

- Missing app config returns a clear `missing app config` reason.
- Token request failure includes HTTP status and response text.
- Message send failure includes HTTP status and response text.
- `daily-report` logs the result and continues.
- `test-feishu` throws when no delivery channel succeeds, because that command exists to verify Feishu connectivity.

## Testing

Unit tests should cover the delivery selection and app API request shape using injected `fetch`.

- App API is selected when app ID, app secret, and receiver ID are present.
- Webhook fallback is selected when app API config is incomplete and webhook exists.
- Token request sends app ID and secret to the correct endpoint.
- Message request sends `receive_id`, `msg_type=text`, and JSON string `content` to the correct endpoint.
- `daily-report` behavior remains non-blocking for Feishu failure.

## Out Of Scope

- Feishu event subscription and natural-language reply handling.
- Fixed approve/reject interactive cards.
- Any product mutation, including 上链、补链、改价.
- Persisting or printing secrets.
