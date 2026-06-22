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
