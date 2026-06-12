# Feishu Bot Readonly Command Agent Merge Handoff

## Branch

- Worktree: `C:\works\MT-agent\.worktrees\feishu-bot-readonly-command-agent`
- Branch: `feature/feishu-bot-readonly-command-agent`
- Base commit: `e065884 调整：精简公域卡片顶部标题`

## Scope

This branch implements phase 1 agentization through Feishu server-side APIs:

- Feishu event callback HTTP server.
- URL verification and optional request signature helper.
- Text intent parsing for help, latest summary, product query, run report, and resend report.
- Readonly report context query tools.
- Feishu message reply API wrapper.
- `npm run feishu-bot` server entrypoint.

It intentionally does not implement:

- LLM integration.
- Product mutation.
- Approval cards or card callback handling.
- Long-term memory.

## Commits

- `f6b8541 功能：新增飞书机器人意图解析`
- `68dcd44 功能：新增飞书机器人事件校验`
- `683f454 功能：新增飞书机器人只读报表工具`
- `a6414b5 功能：新增飞书消息回复接口`
- `ec06a1f 功能：新增飞书机器人事件服务`

## Main Files Added

- `src/feishuBot/types.ts`
- `src/feishuBot/intent.ts`
- `src/feishuBot/verify.ts`
- `src/feishuBot/reportStore.ts`
- `src/feishuBot/tools.ts`
- `src/feishuBot/server.ts`
- `src/cli/feishuBot.ts`
- `tests/feishuBotIntent.test.ts`
- `tests/feishuBotVerify.test.ts`
- `tests/feishuBotReportStore.test.ts`
- `tests/feishuBotTools.test.ts`
- `tests/feishuBotReply.test.ts`
- `tests/feishuBotServer.test.ts`

## Main Files Modified

- `package.json`: adds `feishu-bot` script.
- `src/notify/feishuApp.ts`: adds `replyFeishuMessageText` and broadens token config typing.
- `.env.example`: adds bot event server variables.
- `TODO.md`: records phase 1 bot scope.

## Merge Notes

Your main session has many uncommitted changes on `master`. Prefer cherry-picking or manually applying this branch after those changes are settled.

Recommended merge flow from main session:

```powershell
git fetch . feature/feishu-bot-readonly-command-agent
git log --oneline master..feature/feishu-bot-readonly-command-agent
git diff master..feature/feishu-bot-readonly-command-agent -- src/feishuBot src/cli/feishuBot.ts src/notify/feishuApp.ts package.json .env.example TODO.md tests/feishuBot*.test.ts
```

If main has diverged significantly, cherry-pick one commit at a time:

```powershell
git cherry-pick f6b8541
git cherry-pick 68dcd44
git cherry-pick 683f454
git cherry-pick a6414b5
git cherry-pick ec06a1f
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

## Verification

Run after merge:

```powershell
npm test -- tests/feishuBotIntent.test.ts tests/feishuBotVerify.test.ts tests/feishuBotReportStore.test.ts tests/feishuBotTools.test.ts tests/feishuBotReply.test.ts tests/feishuBotServer.test.ts
npm test
npm run build
```

Manual smoke test:

1. Start `npm run feishu-bot`.
2. Complete Feishu URL verification.
3. Send `帮助` to the bot.
4. Send `今日概况` after a report context exists.
5. Send `查询 565`.
6. Send `重发日报 发我`.
7. Send `跑日报` only when browser login state is ready.
