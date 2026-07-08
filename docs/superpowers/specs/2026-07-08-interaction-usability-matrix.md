# 交互可用性收口审计矩阵

生成日期：2026-07-08

本矩阵只记录当前交互可用边界，不新增业务 workflow，也不把自然语言失败误判成能力缺口。每条交互分两层看：Capability layer 直接调用工具验证系统本来会不会做；NL-routing layer 用真实话术进入 `handleBotIntent`，验证自然语言能不能稳定命中能力层。

## 判定口径

失败层级固定为：`capability`、`metadata`、`routing`、`workflow`、`data_health`、`reply_channel`。

返回形态固定为：`text`、`clarification_card`、`strategy_card`、`execute_confirm_card`、`none`。

只有 capability 层失败时，才把问题归为 `capability`。如果 capability 层通过但 NL-routing 失败，优先归为 `routing`、`metadata` 或 `workflow`。

## 当前稳定可用

| 话术 | 预期能力层 | Capability 结果 | NL-routing 结果 | 失败层级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `查956` | `product.query` | 通过，能直接查询端内 ID | 通过，`parseBotIntent` 命中 `query_product`，`handleBotIntent` 返回 `text` | - | 可依赖 |
| `日报概况` | `publicTraffic.reportQuery` | 通过，能力层可查询 summary 口径 | 通过，`parseBotIntent` 命中 `latest_summary`，`handleBotIntent` 返回 `text` | - | 可依赖，但要求日报上下文存在 |

## 边缘可用

| 话术 | 预期能力层 | Capability 结果 | NL-routing 风险 | 主要层级 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `近20天数据最好r50是哪个id` | `product.rankBestSameSku` | 通过，返回同款组最佳端内 ID metadata | `parseAgentDataIntent` 能识别，但当前 `handleBotIntent` 无 planner 时会拒答 | `routing` | 能力层可依赖，飞书 NL 入口不建议无 planner 依赖 |
| `近15天曝光为0的有哪些?` | `publicTraffic.windowAggregate` | 通过，窗口聚合能力可返回产品 ID 与覆盖情况 metadata | 当前自然语言入口不能稳定命中窗口聚合工具 | `routing` | 可直接调用能力层审计，不建议依赖自然语言直达 |
| `近20天金额为0的有哪些?` | `publicTraffic.windowAggregate` | 能力存在 | 当前自然语言入口不能稳定命中窗口聚合工具 | `routing` | 可作为能力层审计查询，不建议依赖自然语言直达 |
| `近30天订单为0的有哪些?` | `publicTraffic.windowAggregate` | 能力存在 | 订单口径可能需要 planner 正确映射 metric | `routing` | 可审计，不建议直接接执行 |
| `为什么R50一个候选都没有` | `strategy.refreshCandidateExplain` | 通过，能解释候选与跳过原因 | 需要 planner 命中解释工具而非大 workflow | `routing` | 可依赖能力层，NL 需持续审计 |
| `这个同款组能不能补链` | `strategy.safeSourceResolve` | 能力存在 | 话术缺少 sameSkuGroupId 或上下文引用 | `metadata` | 需要先解析同款组再问 |
| `安全源是谁` | `strategy.safeSourceResolve` | 能力存在 | 依赖上文中的同款组/排除 ID metadata | `metadata` | 不能脱离上下文单独依赖 |
| `帮我下架r50近30天产生订单金额为0的链接` | `operations.refreshActivityPlan` | 通过，只生成 R50 定向刷新计划和策略卡，不执行写操作 | 当前无 planner 的自然语言入口不会稳定生成该计划 | `routing` | 能力层可依赖，飞书 NL 入口需 planner 或显式工具调用 |
| `帮我下架pocket3近30天产生订单金额为0的链接` | `operations.refreshActivityPlan` | 能力存在 | 依赖别名和同款组解析 | `routing` | 可用于计划层，需看策略卡候选 |
| `帮我下架近30天产生订单金额为0的链接` | `operations.refreshActivityPlan` | 能力存在 | 全局范围可能过大，需策略卡收口 | `workflow` | 仅依赖策略卡，不直接执行 |
| `只下架近30天产生订单金额为0的链接` | `operations.refreshActivityPlan` | 能力存在 | 需要策略选择，不能绕过确认 | `workflow` | 仅作为计划入口 |
| `帮我下架所有近30天产生订单金额为0的链接,除了没有可用的安全源商品,并且下掉一个补链一个` | `operations.refreshActivityPlan` | 能力存在 | 复合执行语义必须停在策略卡/确认卡 | `workflow` | 不建议直接依赖为自动执行 |

## 暂不建议依赖

| 话术 | 预期能力层 | 主要断点 | 主要层级 | 建议 |
| --- | --- | --- | --- | --- |
| `先查一下2026013022000994654214的端内id是多少,然后根据这个id铺四条链接` | `linkRegistry.resolveProducts` -> 铺链计划 | 跨工具引用要保留解析出的端内 ID；后续写操作必须进入确认卡 | `metadata` | 先单独验证 ID 解析，再生成铺链计划 |
| `近15天曝光为0的有哪些?下架,并且补链这些id` | `publicTraffic.windowAggregate` -> 刷新计划 | 窗口聚合结果到执行候选的 metadata 接力风险高 | `metadata` | 本轮只记录断链，不直接修复 |

## 测试入口

定向运行：

```powershell
npx vitest run tests/interactionUsabilityMatrix.test.ts tests/interactionUsabilityReport.test.ts --exclude '**/.worktrees/**'
```

回归运行：

```powershell
npx vitest run tests/interactionUsabilityMatrix.test.ts tests/interactionUsabilityReport.test.ts tests/windowAggregate.test.ts tests/safeSource.test.ts tests/refreshCandidateExplain.test.ts --exclude '**/.worktrees/**'
npx tsc -p tsconfig.json --noEmit
npm run build
```
