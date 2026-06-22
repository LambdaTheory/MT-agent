# Worktree Governance

核验日期：2026-06-22

本文件记录 MT-agent 当前 worktree 盘点和后续开发规程。它的目标很简单：`master` 只做稳定集成与 PM2 运行目录，不再承载日常功能开发。

## 当前结论

- 生产 PM2 进程 `mt-feishu-bot` 的 cwd 是 `C:\works\MT-agent`，也就是主 worktree。
- 主 worktree 当前在 `master @ 079db61`，工作树干净。`master` 仍只作为稳定集成与 PM2 运行目录，不承载日常开发。
- `feature/closed-order-feedback` 功能已通过 `75d1d69 实现关单同步与观察流程` 进入 `master`，但保留 worktree 的 `dfa806a` 不是 `master` 祖先，后续只作为对照来源，不应直接 merge。
- `feature/link-registry` 仍有独立价值，服务链接档案、同款分组和关单反馈置信度，但需要先 rebase 到最新 `master` 再验证。
- `codex/public-traffic-reliability-followup` 已通过 `6a3f9ea Merge branch 'codex/public-traffic-reliability-followup'` 合入 `master`，对应 worktree 已删除。
- 后续所有功能、修复、文档治理都必须先进入独立 worktree，验证通过后再按明确指令合入 `master`。
- 不读取、打印或提交 `.env`、真实账号凭据、浏览器 profile、任何 secret。
- 不 push、不重启 PM2，除非用户明确要求。

## Worktree 分类

### 生产与集成入口

| worktree | branch | 状态 | 处理规则 |
|---|---|---|---|
| `C:\works\MT-agent` | `master` | clean，`079db61` | 只做稳定集成与 PM2 运行目录 |

### 保留对照或继续评估

| worktree | branch | 状态 | 备注 |
|---|---|---|---|
| `.worktrees/closed-order-feedback` | `feature/closed-order-feedback` | clean，1 个独立提交 | 功能已在 `master` 另行落地；保留作对照，不直接 merge |
| `.worktrees/link-registry` | `feature/link-registry` | 脏，3 个独立提交 + `.omo` 计划文档 | 链接档案覆盖与审计 CLI；建议 rebase 后继续推进 |
| `.worktrees/worktree-governance` | `codex/worktree-governance` | clean，治理文档分支 | 维护本文档，更新后可评估合入 |

### 设计参考或旧实现参考

| worktree | branch | branch ahead | 状态 | 建议 |
|---|---|---:|---|---|
| `.worktrees/feishu-bot-natural-question-routing` | `feature/feishu-bot-natural-question-routing` | 5 | clean | 自然问句旧实现；`master` 已有后续协调实现，作为参考而非整体合并来源 |
| `.worktrees/llm-routing-design-plan` | `feature/llm-routing-design-plan` | 4 | 脏，文档改动 | 文档明确说不要直接合并其中只读 registry 实现，应作为设计参考而不是合并来源 |

### 已被 master 包含或被主线替代，候选归档

这些 worktree 的 branch tip 当前不比 `master` 多提交，或功能已被主线更新实现替代。带未跟踪文件的 worktree 不能强制删除，除非用户明确同意丢弃那些文件。

```text
agent-runtime                         branch 已被 master 包含；仅剩未跟踪 .omo 草稿
public-traffic-capture-decoupling      branch 已被 master 包含；仅剩未跟踪 .omo 草稿
public-traffic-card-tables             branch 已被 master 包含；仍有 product-id-map 配置改动，需单独确认
```

`feature/goods-manager-new-products` worktree 已删除，branch 保留；该 v1 新品池接入已被 `master` 中的新品池 v2/明细实现替代。

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

## 2026-06-22 治理执行记录

### 1. 保存 master 脏现场快照

已在主 worktree 创建保护分支并提交完整脏现场：

```text
branch: codex/master-dirty-snapshot-20260622
commit: a048a6d 备份：保存master脏工作区快照
```

随后主 worktree 已切回：

```text
C:\works\MT-agent
branch: master
status: clean
```

该快照分支仅用于防丢和后续比对，不应直接合入 `master`。

### 2. 拆出公域抓取可靠性后续分支

已创建独立 worktree：

```text
worktree: C:\works\MT-agent\.worktrees\public-traffic-reliability-followup
branch: codex/public-traffic-reliability-followup
commit: 3025548 修正：拆分公域抓取可靠性后续改动
```

只恢复并提交以下 8 个文件：

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

验证结果：

```text
vitest focused:
  tests/dashboardCrawlerSource.test.ts
  tests/exposureCrawlerSource.test.ts
  tests/publicTrafficCliSource.test.ts
  -> 3 files / 26 tests passed

tsc -p tsconfig.json -> passed
```

说明：系统 `npm` 当前指向缺失的全局 npm-cli，因此验证使用主 worktree 的本地依赖入口：

```text
C:\works\MT-agent\node_modules\.bin\vitest.cmd
C:\works\MT-agent\node_modules\.bin\tsc.cmd
```

### 3. 关单反馈开发线核对

已只读比较 `codex/master-dirty-snapshot-20260622` 中的关单反馈相关改动与当前：

```text
worktree: C:\works\MT-agent\.worktrees\closed-order-feedback
branch: feature/closed-order-feedback
```

结论：

- `src/closedOrderFeedback/feedback.ts` 和 `tests/closedOrderFeedback.test.ts` 与快照内容一致。
- `feature/closed-order-feedback` 当前还有自己的新增文件：
  - `src/closedOrderFeedback/ingest.ts`
  - `tests/closedOrderFeedbackIngest.test.ts`
- `apiProvider`、`preview CLI`、部分类型和 linkRegistry/productDisplayName 相关改动不能从快照直接覆盖，因为该开发 worktree 已经形成自己的未提交现场。

处理规则：

- 不自动合并、不覆盖、不清理 `feature/closed-order-feedback`。
- 关单反馈线后续应自己在该 worktree 内完成收口、验证和提交。
- 快照分支 `codex/master-dirty-snapshot-20260622` 保留作为对照来源。

### 4. 当前安全状态

```text
master: clean
codex/worktree-governance: clean after latest governance commit
codex/public-traffic-reliability-followup: clean after commit 3025548
feature/closed-order-feedback: dirty, intentionally preserved
```

### 5. 2026-06-22 二次复核与清理

复核后当前主线状态：

```text
C:\works\MT-agent
branch: master
head: 079db61 Merge branch 'codex/rental-price-agent-skill-vendor'
status: clean
```

已删除 worktree：

```text
.worktrees/goods-manager-new-products
```

说明：该 worktree 对应的是 goods-manager 新品池 v1 接入，后续主线已有新品池 v2/明细实现；本次只删除 worktree，不删除 `feature/goods-manager-new-products` branch。

暂缓删除：

```text
.worktrees/agent-runtime
.worktrees/public-traffic-capture-decoupling
```

说明：这两条 branch tip 已被 `master` 包含，但 worktree 内仍有未跟踪 `.omo` 交接草稿。除非用户明确同意丢弃这些草稿，否则不使用 `git worktree remove --force`。

继续保留并评估：

```text
.worktrees/link-registry
.worktrees/worktree-governance
.worktrees/closed-order-feedback
.worktrees/feishu-bot-natural-question-routing
.worktrees/llm-routing-design-plan
.worktrees/public-traffic-card-tables
```

下一步建议：

- 将 `feature/link-registry` rebase 到最新 `master` 后重新跑 link registry 相关测试。
- 单独确认 `public-traffic-card-tables` 中的 `config/product-id-map*.json` 改动是要吸收、备份还是丢弃。

### 6. 公域抓取可靠性后续合入

已将 `codex/public-traffic-reliability-followup` 合入主线：

```text
master commit: 6a3f9ea Merge branch 'codex/public-traffic-reliability-followup'
worktree removed: .worktrees/public-traffic-reliability-followup
branch retained: codex/public-traffic-reliability-followup
```

验证结果：

```text
vitest root focused:
  tests/dashboardCrawlerSource.test.ts
  tests/exposureCrawlerSource.test.ts
  tests/publicTrafficCliSource.test.ts
  -> 3 files / 26 tests passed

tsc -p tsconfig.json -> passed
```

后续当前优先级调整为：

- rebase 并评估 `feature/link-registry`。
- 单独处理 `public-traffic-card-tables` 的 `config/product-id-map*.json` 映射现场。
- 如确认可丢弃 `.omo` 交接草稿，再删除 `agent-runtime` 和 `public-traffic-capture-decoupling` 两个已被主线包含的 worktree。
