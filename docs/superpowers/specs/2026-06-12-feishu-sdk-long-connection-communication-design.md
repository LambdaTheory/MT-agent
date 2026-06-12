# Feishu SDK Long Connection Communication Design

## Goal

Make Feishu the stable interaction medium for MT-agent by using the Feishu NodeJS server-side SDK long connection as the primary inbound message path. The first phase focuses on reliable message intake, command dispatch, and replies. It does not add LLM judgment, approval buttons, or product mutation, but it keeps the code boundaries ready for those future capabilities.

## Current Context

MT-agent already has a phase 1 Feishu bot implementation based on HTTP event callbacks:

- `src/feishuBot/server.ts` receives plaintext Feishu callback events.
- `src/feishuBot/intent.ts` parses deterministic text commands.
- `src/feishuBot/tools.ts` handles report summary, product query, report run, report resend, and agent data queries.
- `src/notify/feishuApp.ts` sends replies through Feishu server-side APIs.
- Daily report broadcast still uses existing `sendFeishuCard`, webhook, or app message paths.

The main operational weakness is inbound communication. HTTP callback mode requires a public HTTPS endpoint or tunnel, which makes local use and early iteration fragile. Feishu's NodeJS SDK supports long-connection event callbacks, token lifecycle management, and structured API calls, so it should become the primary communication path.

## Chosen Approach

Use SDK long connection as the primary inbound path and keep the existing HTTP callback server as a fallback.

This gives the fastest path to stable local Feishu interaction without deleting known-working callback code. The outbound daily report path remains unchanged in this phase.

Alternatives considered:

- Replace HTTP callback entirely with SDK long connection. This is cleaner but removes the fallback before SDK behavior is verified in this project.
- Keep HTTP callback and only use SDK for replies. This keeps the current public HTTPS/tunnel problem and does not solve the main communication issue.

## Architecture

The architecture is double-entry, single-dispatcher:

```text
Feishu SDK long connection
  -> unified message dispatcher
  -> intent resolver
  -> handleBotIntent
  -> SDK reply

Existing HTTP callback
  -> unified message dispatcher
  -> intent resolver
  -> handleBotIntent
  -> HTTP reply API
```

Core principles:

- SDK long connection is the primary path for receiving messages.
- HTTP callback remains available for fallback, tests, and public HTTPS deployments.
- Business command logic remains single-sourced behind the dispatcher.
- Report broadcast remains on the existing Feishu send path for now.
- Future LLM, approval, and mutation capabilities get explicit extension points but no active behavior in this phase.

## Components

### `src/feishuBot/dispatcher.ts`

The dispatcher handles one normalized incoming text message:

```text
{ messageId, text, source }
  -> dedupe by messageId
  -> resolve intent
  -> handleBotIntent(intent)
  -> return BotResponse
```

Responsibilities:

- Normalize SDK and HTTP events into the same internal message shape.
- Prevent duplicate processing within the current process.
- Call the configured intent resolver.
- Catch processing errors and convert them into user-visible failure responses.
- Keep reply transport outside the dispatcher.

### `src/feishuBot/sdkClient.ts`

The SDK client adapts Feishu NodeJS SDK behavior to MT-agent:

- Initialize the SDK client from `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
- Start long-connection event listening.
- Extract text, `messageId`, sender, and chat metadata from incoming message events.
- Call the dispatcher.
- Reply with SDK message APIs.

It should not contain MT-agent business rules.

### `src/cli/feishuBotSdk.ts`

New CLI entry for SDK long-connection mode:

```text
npm run feishu-bot:sdk
```

This is the recommended command for local and long-running Feishu interaction.

### `src/feishuBot/server.ts`

The existing HTTP callback server remains. It should be adjusted to call the same dispatcher rather than duplicating message handling logic.

## Intent Resolver Boundary

The dispatcher should depend on an intent resolver interface, not directly on one hard-coded parser. The current resolver is rule-based and should continue to use `parseBotIntent`.

Future LLM integration should fit behind the same boundary:

```text
text message
  -> IntentResolver
     -> rule resolver now
     -> LLM resolver later
  -> handleBotIntent
```

First phase behavior remains deterministic. LLM is not called, configured, or required.

The design should leave room for future intent categories such as:

- `ask_report_question`
- `suggest_operation`
- `request_approval`
- `execute_operation`

These are future concepts, not first-phase executable behavior.

## Approval And Mutation Hooks

Approval buttons and product mutation are out of scope for implementation, but the design should not block them.

Future approval callbacks should enter through the same dispatcher family as message events. Future approval cards should bind to stable action candidate data, not free-text instructions.

Future product mutation must require all of these before execution:

- Stable `actionCandidateId`.
- Platform product ID and internal management product ID when available.
- Stable action code.
- Explicit user approval from Feishu.
- Execution result record with status, timestamp, target IDs, before/after values when applicable, and error reason on failure.

This phase does not generate approval buttons, execute product changes, or call downstream mutation tools.

## Data Flow

Example SDK flow:

```text
User sends: 查询 565
  -> SDK long connection receives message event
  -> sdkClient extracts message_id and text
  -> dispatcher dedupes and resolves intent
  -> handleBotIntent queries latest report context
  -> sdkClient replies through SDK message API
```

Example HTTP fallback flow:

```text
Feishu HTTP callback sends text event
  -> server verifies callback and extracts message_id/text
  -> dispatcher dedupes and resolves intent
  -> handleBotIntent runs the same business logic
  -> server replies through existing HTTP reply API
```

## Error Handling

- SDK long connection startup failure exits the process with a clear configuration or permission error.
- Single-message processing failure returns a short Feishu reply such as `处理失败：...` and logs the full error locally.
- Feishu reply failure is logged locally and not retried automatically to avoid repeated messages.
- `run_public_traffic_report` keeps the existing in-process running lock.
- Duplicate `messageId` events are skipped in-process.

The first-phase dedupe is intentionally process-local. Persistent dedupe can be added later if real Feishu retry behavior requires it.

## Configuration

Required for SDK mode:

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
MT_AGENT_OUTPUT_DIR=output
```

Still used by HTTP callback fallback:

```text
FEISHU_BOT_VERIFICATION_TOKEN
FEISHU_BOT_PORT
```

Optional documentation flag:

```text
FEISHU_BOT_USE_SDK=true
```

`FEISHU_BOT_ENCRYPT_KEY` remains unused unless encrypted HTTP callback events are implemented later.

## Testing And Acceptance

Automated tests should cover:

- Dispatcher normal command flow.
- Dispatcher unknown command flow.
- Dispatcher duplicate `messageId` skip.
- Dispatcher processing error response.
- SDK adapter with mock SDK events and mock reply API.
- HTTP callback regression: URL verification and text message handling still work.

Manual acceptance:

- Run `npm run feishu-bot:sdk` locally.
- Send `帮助` to the bot and receive a reply.
- Send `今日概况` and receive latest report summary when report context exists.
- Send `查询 565` and receive product details when matched.
- Trigger the same message event twice in tests and confirm no duplicate business execution.
- Confirm `npm run feishu-bot` HTTP callback still works in tests.

Verification commands:

```text
npm run build
npm test -- --exclude ".worktrees/**"
```

## Out Of Scope

- LLM-based judgment or OpenAI SDK integration.
- Approval buttons or card callback workflow.
- Product mutation or downstream execution agent calls.
- Deleting the existing HTTP callback path.
- Rewriting all Feishu outbound report delivery paths.
- Persistent long-term conversation memory.
