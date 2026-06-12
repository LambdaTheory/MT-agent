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

- `788fdf4 文档：规划飞书SDK长连接实现`
- `e4d8dee 配置：接入飞书Node SDK依赖`
- `b3e0c5a 修正：飞书SDK依赖版本与脚本时机`
- `f0337c9 修正：覆盖飞书SDK传递依赖漏洞`
- `71b6dc2 功能：新增飞书消息统一分发器`
- `8d951d1 修正：飞书消息去重使用进程级状态`
- `a368d04 修正：限制飞书消息去重缓存大小`
- `4e6d4e9 重构：飞书HTTP回调复用消息分发器`
- `b3ea3d8 测试：稳定飞书HTTP异步回复断言`
- `ef3bb11 测试：确保跳过消息不会回复`
- `03e59ac 功能：新增飞书SDK长连接适配器`
- `38cad3c 修正：飞书SDK回复失败仅记录日志`
- `e733cd5 功能：新增飞书SDK机器人入口`
- `9ed675b 修正：飞书SDK机器人入口等待启动`
- `67a6b82 文档：补充飞书SDK长连接使用说明`

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
git diff master..feature/feishu-sdk-long-connection-communication -- src/feishuBot/dispatcher.ts src/feishuBot/sdkClient.ts src/feishuBot/server.ts src/cli/feishuBotSdk.ts src/cli/feishuBot.ts package.json package-lock.json .env.example tests/feishuBotDispatcher.test.ts tests/feishuBotSdkClient.test.ts tests/feishuBotServer.test.ts docs/feishu-bot-readonly-command-agent-merge-handoff.md
```

If main has diverged significantly, cherry-pick one commit at a time:

```powershell
git cherry-pick 788fdf4
git cherry-pick e4d8dee
git cherry-pick b3e0c5a
git cherry-pick f0337c9
git cherry-pick 71b6dc2
git cherry-pick 8d951d1
git cherry-pick a368d04
git cherry-pick 4e6d4e9
git cherry-pick b3ea3d8
git cherry-pick ef3bb11
git cherry-pick 03e59ac
git cherry-pick 38cad3c
git cherry-pick e733cd5
git cherry-pick 9ed675b
git cherry-pick 67a6b82
```

## Runtime Setup

Add these values to `.env`:

```text
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace-with-your-secret
FEISHU_BOT_PORT=8787
FEISHU_BOT_VERIFICATION_TOKEN=replace-with-event-verification-token
FEISHU_BOT_ENCRYPT_KEY=
MT_AGENT_OUTPUT_DIR=output
```

Phase 1 expects Feishu event callbacks as plaintext JSON. If Feishu Encrypt Key is enabled in the Open Platform, disable it or leave `FEISHU_BOT_ENCRYPT_KEY` empty until encrypted event decryption is implemented.

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
MT_AGENT_OUTPUT_DIR=output
```

In Feishu Open Platform, configure event subscription to receive events through persistent connection, and subscribe to `im.message.receive_v1`.

The SDK mode still uses deterministic command parsing. LLM intent resolving, approval buttons, and product mutation are only future extension points.
