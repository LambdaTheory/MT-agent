# Worktree Governance

核验日期：2026-06-22

本文件记录 MT-agent 当前 worktree 盘点和后续开发规程。它的目标很简单：`master` 只做稳定集成与 PM2 运行目录，不再承载日常功能开发。

## 当前结论

- 生产 PM2 进程 `mt-feishu-bot` 的 cwd 是 `C:\works\MT-agent`，也就是主 worktree。
- 主 worktree 当前在 `master @ 1b2c8a6`，但存在 22 个未提交变更。在这些变更被归类前，不应继续在 `master` 直接开发、合并或重启部署。
- `feature/closed-order-feedback` 正在开发中，且有未提交业务改动。治理动作只读观察，不清理、不合并、不回滚这条 worktree。
- 后续所有功能、修复、文档治理都必须先进入独立 worktree，验证通过后再按明确指令合入 `master`。
- 不读取、打印或提交 `.env`、真实账号凭据、浏览器 profile、任何 secret。
- 不 push、不重启 PM2，除非用户明确要求。

## Worktree 分类

### 生产与集成入口

| worktree | branch | 状态 | 处理规则 |
|---|---|---|---|
| `C:\works\MT-agent` | `master` | 脏，22 个变更 | 暂停直接开发；先做变更归类 |

### 正在开发，禁止清理

| worktree | branch | 状态 | 备注 |
|---|---|---|---|
| `.worktrees/closed-order-feedback` | `feature/closed-order-feedback` | 脏，开发中 | 关单反馈 API/provider/ingest 正在推进，治理动作不碰 |

### 仍有未合入提交，需要单独评估

| worktree | branch | branch ahead | 状态 | 建议 |
|---|---|---:|---|---|
| `.worktrees/feishu-bot-natural-question-routing` | `feature/feishu-bot-natural-question-routing` | 5 | clean | 和飞书自然问句、只读查询相关；后续如需要，应 rebase 到最新 `master` 后重新验证 |
| `.worktrees/goods-manager-new-products` | `feature/goods-manager-new-products` | 1 | clean | v1 新品池接入；可能已被 v2 覆盖，合并前先确认是否仍有价值 |
| `.worktrees/link-registry` | `feature/link-registry` | 3 | 脏，只有 `.omo` 文档 | 分类覆盖、审计 CLI 增强；与当前 ID 互查/档案能力有交叉，需谨慎重放 |
| `.worktrees/llm-routing-design-plan` | `feature/llm-routing-design-plan` | 4 | 脏，文档改动 | 文档明确说不要直接合并其中只读 registry 实现，应作为设计参考而不是合并来源 |

### 已被 master 包含或明显落后，候选归档

这些 worktree 的 branch tip 当前不比 `master` 多提交。归档前仍要确认是否有未提交文件。

```text
agent-data-understanding
agent-mvp
agent-runtime
command-analysis-tests
dashboard-refresh-modularization
differential-pricing-progress
feishu-bot-readonly-command-agent
feishu-confirmation-boundary
feishu-readonly-tool-registry
goods-manager-new-products-v2
llm-provider-contract
merge-to-master
new-link-cold-start-card
operations-learning-loop
public-traffic-capture-decoupling
public-traffic-card-tables
rental-price-agent-skill
```

`.worktrees/public-traffic-report` 不是注册 worktree，当前只看到 `output` 目录，后续可在确认无价值后清理。

## 日常开发规程

### 1. 开始前

先读：

```text
docs/worktree-governance.md
.omo/plans/project-overview.md（如果存在）
.omo/plans/integration-manager.md（如果存在）
```

然后检查：

```powershell
git worktree list --porcelain
git -c safe.directory=* status --short --branch
```

如果当前在 `master` 且任务不是只读分析，先停下来创建 worktree。

### 2. 创建 worktree

统一使用 `codex/` 前缀：

```powershell
git worktree add .worktrees/<topic> -b codex/<topic> master
```

示例：

```powershell
git worktree add .worktrees/feishu-id-lookup-fix -b codex/feishu-id-lookup-fix master
```

后续所有文件修改都在新 worktree 里进行。

### 3. 修改边界

- 不在 `master` 修改功能代码。
- 不跨 worktree 修改正在开发的 `feature/closed-order-feedback`。
- 不顺手清理老分支、老文档或未跟踪文件。
- 不运行真实外部副作用流程，除非用户明确要求。
- 飞书卡片、复制商品、改价、租期、规格、推群、跑日报等动作必须保留确认边界。

### 4. 验证

常规验证：

```powershell
npm run build
npm test -- --exclude ".worktrees/**"
```

专项验证按变更范围补跑，例如：

```powershell
npm test -- tests/feishuBot*.test.ts
npm test -- tests/linkRegistry*.test.ts
npm test -- tests/publicTraffic*.test.ts
```

如果命令需要网络、PM2、真实飞书、支付宝、goods-manager 或外部 API，必须先说明原因并得到确认。

### 5. 合并回 master

只在用户明确要求时合并。合并前要求：

- 目标 worktree 干净。
- `master` 的未提交变更已归类并处理。
- `git diff master..<branch>` 只包含预期文件。
- build 和相关测试通过。
- 如果 PM2 需要生效，合并后再执行明确的 PM2 重启和日志检查。

建议在主 worktree `C:\works\MT-agent` 执行合并：

```powershell
cd C:\works\MT-agent
git merge --no-ff <branch>
npm run build
npm test -- --exclude ".worktrees/**"
```

## 当前治理 Todo

1. 归类主 worktree 的 22 个未提交变更：哪些属于关单反馈，哪些属于抓取/公域，哪些是配置或历史残留。
2. 保留 `feature/closed-order-feedback` 开发现场，不做清理。
3. 对 4 条未合入分支逐条出评估：保留、重放、废弃或仅留文档。
4. 对已合入/落后 worktree 做归档候选清单，确认后再删除。
5. 更新项目主索引，让 `docs/worktree-governance.md` 成为新 session 的必读入口之一。

## Master 脏变更初步归类

以下为 2026-06-22 只读归类结果。不要直接 `reset`、`checkout`、`stash --all` 或跨 worktree 搬运这些文件；每一类都要先确认归属。

### A. 关单反馈开发相关

这些变更和 `feature/closed-order-feedback` 当前开发方向一致，但主 worktree 与该 feature worktree 并不完全相同，应由关单反馈开发线自己收口。

```text
.env.example
package.json
src/closedOrderFeedback/feedback.ts
src/closedOrderFeedback/types.ts
src/closedOrderFeedback/apiProvider.ts
src/cli/closedOrderFeedbackPreview.ts
src/linkRegistry/buildRegistry.ts
src/publicTraffic/productDisplayName.ts
tests/closedOrderFeedback.test.ts
tests/closedOrderApiProvider.test.ts
tests/closedOrderFeedbackPreviewCli.test.ts
tests/linkRegistryBuild.test.ts
```

观察到的意图：

- 增加关单备注 API provider 与 `closed-order-feedback:preview` CLI。
- 增加 `orderNo`、`merchant`、近期反馈 provider 类型。
- 解析商户备注时忽略后缀风控模板文本，避免把模板误判成真实商户原因。
- 通过商品名 hint 推断 `sameSkuGroupId`，服务关单反馈置信度。

处理建议：

- 不在 `master` 继续改这组文件。
- 由 `feature/closed-order-feedback` 开发线决定是否吸收这些变更。
- 该线当前另有 `src/closedOrderFeedback/ingest.ts` 和 `tests/closedOrderFeedbackIngest.test.ts`，主 worktree 没有这两个文件，说明两边已经出现开发现场分叉。

### B. 公域抓取可靠性相关

这些变更不属于关单反馈，像是一次未固化的抓取可靠性修复。

```text
src/cli/publicTrafficReport.ts
src/crawler/dashboardCrawler.ts
src/crawler/exposureCrawler.ts
src/crawler/pageSizeProbe.ts
src/publicTraffic/paths.ts
tests/dashboardCrawlerSource.test.ts
tests/exposureCrawlerSource.test.ts
tests/publicTrafficCliSource.test.ts
```

观察到的意图：

- 访问页 crawler 支持 iframe/frame 中的表格，并在超时时输出 url/title/body/frame 上下文。
- 曝光 crawler 等待当前表格 spinner 结束；最后一次仍不可靠时直接报错。
- 日报 CLI 拒绝使用过小的昨日曝光快照计算日增量。
- 增加 latest 运行日志路径 `output/latest/公域数据运行日志_latest.log`。

处理建议：

- 应拆到独立 worktree，例如 `codex/public-traffic-reliability-followup`。
- 和 `closed-order-feedback` 解耦验证，避免两个主题混在同一个 master 脏现场。
- 需要至少跑 publicTraffic/crawler 相关 source tests 和 `npm run build`。

### C. 治理底稿相关

```text
.omo/plans/project-overview.md
.omo/plans/integration-manager.md
```

观察到的意图：

- 这两份是跨 session 统筹与集成底稿，但内容基线已落后于当前 `master @ 1b2c8a6`。

处理建议：

- 不直接把旧内容当作权威。
- 后续应以本文件为新治理入口，再决定是否把 `.omo` 底稿更新或替换。
