# Feishu Bot Readonly Command Agent Merge Handoff

## Branch

- Original HTTP callback branch: `feature/feishu-bot-readonly-command-agent` (already merged into `master`).
- Current SDK long-connection worktree: `C:\works\MT-agent\.worktrees\feishu-sdk-long-connection-communication`
- Current SDK long-connection branch: `feature/feishu-sdk-long-connection-communication`
- Current branch base: `master`

## Scope

This branch implements phase 1 agentization through Feishu server-side APIs:

- Feishu event callback HTTP server.
- URL verification with Feishu Verification Token.
- Text intent parsing for help, latest summary, product query, run report, and resend report.
- Readonly report context query tools.
- `src/agentData/` deterministic data understanding layer for overview, product, problem products, new product pool, and task pool queries.
- Feishu message reply API wrapper.
- `npm run feishu-bot` server entrypoint.

The current SDK long-connection branch adds a primary SDK persistent-connection entrypoint and shared message dispatcher on top of the already-merged HTTP callback implementation.

It intentionally does not implement:

- LLM integration.
- Product mutation.
- Approval cards or card callback handling.
- Long-term memory.
- Encrypted event payload decryption. Keep Feishu Encrypt Key empty for phase 1.

## Original HTTP Callback Commits

- `f6b8541 功能：新增飞书机器人意图解析`
- `68dcd44 功能：新增飞书机器人事件校验`
- `683f454 功能：新增飞书机器人只读报表工具`
- `a6414b5 功能：新增飞书消息回复接口`
- `ec06a1f 功能：新增飞书机器人事件服务`
- `31c7caf 文档：补充飞书机器人配置与合并说明`
- `1aaeb59 测试：覆盖飞书机器人 HTTP 回调链路`
- `26a5037 文档：更新飞书机器人联调验证说明`
- `a2af5ba 修复：飞书机器人不将 Encrypt Key 用作签名密钥`

## SDK Long Connection Commits

Use `git log --oneline master..feature/feishu-sdk-long-connection-communication` to inspect the current SDK branch commit range. Do not maintain a copied SHA list in this document; it becomes stale whenever the handoff docs are updated.

## Main Files Added

- `src/feishuBot/types.ts`
- `src/feishuBot/intent.ts`
- `src/feishuBot/verify.ts`
- `src/feishuBot/reportStore.ts`
- `src/feishuBot/tools.ts`
- `src/feishuBot/dispatcher.ts`
- `src/feishuBot/sdkClient.ts`
- `src/feishuBot/server.ts`
- `src/cli/feishuBot.ts`
- `src/cli/feishuBotSdk.ts`
- `src/agentData/types.ts`
- `src/agentData/publicTrafficQueries.ts`
- `src/agentData/taskPool.ts`
- `src/agentData/intent.ts`
- `tests/feishuBotIntent.test.ts`
- `tests/feishuBotVerify.test.ts`
- `tests/feishuBotReportStore.test.ts`
- `tests/feishuBotTools.test.ts`
- `tests/feishuBotDispatcher.test.ts`
- `tests/feishuBotSdkClient.test.ts`
- `tests/feishuBotReply.test.ts`
- `tests/feishuBotServer.test.ts`
- `tests/agentDataTypesSource.test.ts`
- `tests/agentDataPublicTrafficQueries.test.ts`
- `tests/agentDataTaskPool.test.ts`
- `tests/agentDataIntent.test.ts`

## Main Files Modified

- `package.json`: adds Feishu bot scripts and Feishu SDK dependency.
- `package-lock.json`: locks Feishu SDK dependency graph and overrides.
- `src/notify/feishuApp.ts`: adds `replyFeishuMessageText` and broadens token config typing.
- `.env.example`: adds bot event server variables.
- `TODO.md`: records phase 1 bot scope.

## Merge Notes

The original readonly HTTP callback branch is already merged into `master`. This handoff now covers the SDK long-connection branch that builds on top of `master` and keeps the HTTP callback server as fallback.

If your main session has uncommitted changes on `master`, settle or stash them before merging, cherry-picking, or manually applying this branch.

Recommended merge flow from main session:

```powershell
git fetch . feature/feishu-sdk-long-connection-communication
git log --oneline master..feature/feishu-sdk-long-connection-communication
git diff master..feature/feishu-sdk-long-connection-communication -- package.json package-lock.json .env.example src/feishuBot src/cli/feishuBotSdk.ts tests/feishuBot*.test.ts tests/cliLoadEnvSource.test.ts docs/feishu-bot-readonly-command-agent-merge-handoff.md docs/superpowers/plans/2026-06-12-feishu-sdk-long-connection-communication.md
git merge --no-ff feature/feishu-sdk-long-connection-communication
```

If main has diverged significantly and a merge is not appropriate, inspect the current range and cherry-pick the complete ordered SDK branch range rather than copying a fixed SHA list into this document:

```powershell
git log --reverse --oneline master..feature/feishu-sdk-long-connection-communication
git cherry-pick <oldest-sdk-commit>^..<newest-sdk-commit>
```

## Runtime Setup

Add these values to `.env`:

```text
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace-with-your-secret
FEISHU_BOT_PORT=8787
FEISHU_BOT_VERIFICATION_TOKEN=replace-with-event-verification-token
FEISHU_BOT_ENCRYPT_KEY=
FEISHU_BOT_CALLBACK_SIGNATURE_SECRET=replace-with-card-action-signature-secret
MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS=ou_allowed_1,ou_allowed_2
MT_AGENT_OUTPUT_DIR=output
```

Phase 1 expects Feishu event callbacks as plaintext JSON. If Feishu Encrypt Key is enabled in the Open Platform, disable it or leave `FEISHU_BOT_ENCRYPT_KEY` empty until encrypted event decryption is implemented.

For HTTP callback mode, sensitive card actions fail closed unless `FEISHU_BOT_CALLBACK_SIGNATURE_SECRET` is configured with the Feishu request-signature secret. Do not use `FEISHU_BOT_ENCRYPT_KEY` for this value.

For executable inactive-refresh approval cards, configure `MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS` with the Feishu `open_id` or `user_id` values that may approve execution. Values may be comma, semicolon, or whitespace separated. If this variable is empty, inactive-refresh execution approval fails closed and nobody can approve execution.

Start locally:

```powershell
npm run feishu-bot
```

Then expose `http://localhost:8787` through HTTPS and configure the Feishu bot event subscription URL to that HTTPS endpoint.

## Supported Commands

- `帮助`
- `今日概况`
- `今天数据`
- `查询 565`
- `商品 iPhone`
- `跑日报`
- `生成公域日报 发群`
- `重发日报`
- `重发公域日报 发全部`
- `今天要处理哪些`
- `转化差的有哪些`

## Verification

Run after merge:

```powershell
npm test -- tests/feishuBotIntent.test.ts tests/feishuBotVerify.test.ts tests/feishuBotReportStore.test.ts tests/feishuBotTools.test.ts tests/feishuBotReply.test.ts tests/feishuBotServer.test.ts
npm test -- tests/feishuBotDispatcher.test.ts tests/feishuBotSdkClient.test.ts tests/feishuBotServer.test.ts
npm test -- tests/agentDataTypesSource.test.ts tests/agentDataPublicTrafficQueries.test.ts tests/agentDataTaskPool.test.ts tests/agentDataIntent.test.ts
npm test
npm run build
```

Latest worktree verification:

- `npm test -- tests/feishuBotIntent.test.ts tests/feishuBotVerify.test.ts tests/feishuBotReportStore.test.ts tests/feishuBotTools.test.ts tests/feishuBotReply.test.ts tests/feishuBotServer.test.ts`: 6 files, 21 tests passed.
- `npm test`: 53 files, 236 tests passed.
- `npm run build`: passed.
- Local `.env` URL verification smoke test: passed with `local feishu bot verification ok`.

Manual smoke test:

1. Start `npm run feishu-bot`.
2. Complete Feishu URL verification.
3. Send `帮助` to the bot.
4. Send `今日概况` after a report context exists.
5. Send `查询 565`.
6. Send `重发日报 发我`.
7. Send `跑日报` only when browser login state is ready.

## SDK Long Connection Mode

`feature/feishu-sdk-long-connection-communication` adds a primary Feishu SDK long-connection entrypoint while keeping the HTTP callback server as fallback.

Start SDK mode locally:

```powershell
npm run feishu-bot:sdk
```

Required environment:

```text
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace-with-your-secret
FEISHU_BOT_USE_SDK=true
MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS=ou_allowed_1,ou_allowed_2
MT_AGENT_OUTPUT_DIR=output
```

In Feishu Open Platform, configure event subscription to receive events through persistent connection, and subscribe to `im.message.receive_v1`.

The SDK mode still uses deterministic command parsing. LLM intent resolving, approval buttons, and product mutation are only future extension points.

SDK card-action events are received over the authenticated Feishu long connection. `MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS` still applies to executable inactive-refresh approval cards in SDK mode; leave it empty only when you intentionally want inactive-refresh execution approval to be disabled.
