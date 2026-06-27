# Agent 指令语料表交付审计与复盘（2026-06-27）

## 范围

本轮只覆盖 `docs/agent-command-corpus-template.md` 里已经填写了真实诉求的条目：

- `M-001`：`x200u的定价情况怎么样`
- `M-002`：`x300u 含手柄的sku 都得下掉`
- `M-003`：`刷新活跃度`
- `Q-001`：`s23u最好的链接是哪条?/最好的S23U是哪条?`

空白占位行仍作为后续语料收集入口，不视为已确认需求。

## 实现结论

| 条目 | 当前入口 | 结果 |
| --- | --- | --- |
| M-001 定价快照 | `rental.priceSnapshot` | 已实现只读同款组 SKU 价格聚合；不会触发改价。 |
| M-002 规格项删除 | `rental.specRemovePlan` -> 专用确认卡 | 已实现按链接档案定位同款组，按关键词只命中规格项；确认前不删除。 |
| M-003 刷新活跃度 | `operations.refreshActivityPlan` -> `operations.refreshActivityExecute` 确认卡 | 已实现筛选 30 日零创单 active 链接、记录类型、下架并按安全源补链；确认后写审计文件。 |
| Q-001 最佳链接 | `product.rankBestSameSku` | 已实现通过链接档案解析别名/同款组，并按 7 日发货、成交额、访问等指标排序。 |

## 安全与审计

- 写操作和高风险动作仍由本地策略兜底，LLM 设置 `requiresConfirmation:false` 也不会绕过确认卡。
- `rental.specRemovePlan` 只生成预览和专用确认卡；执行时逐项调用规格删除，并由租赁客户端写规格删除审计文件。
- `operations.refreshActivityPlan` 是只读规划工具；只有候选、同款组、安全复制源、数量上限都通过时，才生成隐藏执行工具的确认卡。
- `operations.refreshActivityExecute` 不对 planner 暴露，只能由确认卡触发；执行结果写入 `output/agent-audit/refresh-activity/`。
- `rental.priceChange` 的 Agent-planned 确认卡现在带 planner 判断原因，便于后续排查误判。
- 生产飞书入口配置 LLM planner 后，未知自然语言不会再回落到旧 deterministic 路由执行。
- 共享 `handleBotIntent()` 在配置 `agentPlannerProvider` 时会拒绝旧 exact intent 直通，避免测试、适配器或后续入口绕开 planner-first 边界。
- `agent:dry-run` 默认也走 planner-first 解析；旧 deterministic 结果只作为 `legacyIntent` 对照，或通过 `--legacy` 显式查看。
- 多步骤计划的 `${...}` 占位符只允许引用已经出现过的 step id；未知、未来或自引用会在 planner 校验阶段被拒绝。
- planner schema validator 会递归校验结构化数组项和关键数量字段；多商品新链计划里的 `items` 必须是对象数组，`count` 只能是正整数或数字字符串，隐藏执行 payload 里的数量必须是真正正整数。
- 所有 `plannerVisible:false` 的内部执行工具即使存在于 runtime registry，也会被 planner validator 当作未知工具拒绝，只能由确认卡内部续跑触发；当前覆盖 `operations.refreshActivityExecute` 和 `rental.operationConfirmRequest`。
- HTTP 和 SDK 两条卡片确认通道都会把租赁客户端、关单 fetch 注入和链接档案路径继续传给剩余步骤，确认后续跑不会丢失执行上下文。
- Agent 通用确认卡现在会校验 `confirmationKey` 与请求内容是否一致；卡片 value 被改过、或隐藏工具缺少合法 key，都会拒绝执行。
- 确认卡续跑步骤继续执行前会再次拒绝隐藏工具，避免把内部执行工具塞进 future step 绕过 planner 可见性边界。
- 带 continuation 的确认卡必须有合法生成 key；普通旧卡可保留兼容，但不能携带多步骤续跑。
- planner step id 保留 `last` 和 `steps`，避免与 `${last...}`、`${steps.xxx...}` 运行时引用语义冲突。

## 测试证据

已补/已有的关键覆盖：

- `tests/feishuBotTools.test.ts`
  - 定价快照：原句 `x200u的定价情况怎么样`
  - 规格删除：原句 `x300u 含手柄的sku 都得下掉`
  - 活跃度刷新：原句 `刷新活跃度`
  - S23U 最佳链接：原句 `s23u最好的链接是哪条?`
  - 复合新链、多商品新链、确认续跑、旧 workflow 拒绝
  - exact intent 防绕路：带 planner 时 `run_public_traffic_report`、`rental_copy` 不会走旧路由
- `tests/feishuBotServer.test.ts` / `tests/feishuBotSdkCardAction.test.ts`
  - HTTP 与 SDK 卡片确认后续跑都会继续使用传入的链接档案路径，能够在确认写操作后继续执行 `product.rankBestSameSku`。
- `tests/agentRuntimeLlmPlanner.test.ts`
  - LLM prompt 不暴露 legacy workflow，并明确提示定价快照、规格删除计划。
- `tests/agentRuntimeToolRegistry.test.ts`
  - planner-visible 工具与隐藏执行工具边界。
- `tests/feishuBotRentalPriceAction.test.ts`
  - 规格删除执行链路与审计文件。
- `tests/agentDryRunCliSource.test.ts`
  - dry-run 默认 planner-first；`--legacy` 仅用于旧解析对照。
- `tests/cliLoadEnvSource.test.ts`
  - SDK 与 HTTP 两个生产 bot CLI 都只接入 `agentPlannerProvider`，不再接旧 read-only tool selector。
- `tests/agentRuntimePlanner.test.ts`
  - 多步骤占位符引用必须指向前序步骤；未知、未来、自引用均拒绝。
  - 所有隐藏执行工具不能被原子计划或多步骤计划直接选择。
  - 多步骤 step id 拒绝 `last` / `steps` 等运行时保留字。
- `tests/agentRuntimeApprovalCard.test.ts`
  - 通用确认卡真实 payload 可解析；篡改 request 后 key 不匹配会拒绝。
  - 隐藏当前工具必须带系统生成的合法 key；隐藏工具不能作为续跑步骤出现。
  - 带续跑步骤的确认卡必须来自真实生成卡片；无 key continuation 或保留字 currentStepId 会拒绝。

本轮自测结果：

- `tsc -p tsconfig.json --noEmit`：通过。
- `vitest run tests/agentRuntimeApprovalCard.test.ts tests/agentRuntimePlanner.test.ts tests/feishuBotTools.test.ts tests/feishuBotSdkCardAction.test.ts tests/feishuBotServer.test.ts`：5 个文件、141 个测试通过。
- `vitest run tests/agentRuntimePlanner.test.ts tests/agentRuntimeToolRegistry.test.ts tests/agentRuntimeLlmPlanner.test.ts tests/feishuBotTools.test.ts`：4 个文件、88 个测试通过。
- `vitest run tests/feishuBotServer.test.ts tests/feishuBotSdkCardAction.test.ts tests/feishuBotDispatcher.test.ts tests/feishuBotSdkClient.test.ts tests/agentRuntime.test.ts tests/feishuBotTools.test.ts`：6 个文件、146 个测试通过。
- `vitest run tests/cliLoadEnvSource.test.ts tests/agentRuntime.test.ts tests/feishuBotDispatcher.test.ts`：3 个文件、23 个测试通过。
- `vitest run --exclude "**/.worktrees/**"`：142 个文件、965 个测试通过。
- 全量测试中的 stderr 来自既有用例：坏同款组跳过库存快照、飞书卡片 patch 失败回退；均为测试故意覆盖的异常路径。

## Review 结论

- 本轮新增边界很窄，只改 planner validator、工具 schema、planner 测试和交付审计文档。
- planner 可见工具列表已经过滤隐藏工具；validator 现在也会二次拒绝隐藏工具，避免恶意或错误 LLM 输出绕过列表直接点名内部执行工具。
- 写类工具仍由本地 policy 与专用确认卡兜底；语料表里的 M-002、M-003 不会因为 LLM 置信度高而直接产生副作用。
- 已填写语料的实现路径都落在注册工具上，没有再依赖旧 workflow 直通。
- 多步骤续跑已经覆盖普通确认卡和专用确认卡；确认后的执行上下文现在与原始 planner 执行上下文一致。

## 复盘

这轮不是新增固定 workflow，而是把语料诉求收敛成可组合工具：

- 查询类能力保持只读工具。
- 计划类工具只负责生成可审查计划和确认卡。
- 真正写入动作由确认卡触发，并保留审计产物。
- 多步骤目标通过 planner `steps` 和占位符传参组合，不把“工程流程”固化成业务 workflow。

剩余依赖主要是链接档案质量：别名、同款组、品类和状态越完整，LLM 选择工具后本地解析越稳定。

本轮自审结论：已填写的语料功能均有注册工具、确认边界、关键回归测试和交付说明；空白占位行仍等待业务语料，不计入本轮完成范围。

## Additional Safety Review

Dedicated high-risk cards now validate `confirmationKey` before parsing the callback payload. Covered card families: `rental_price_confirm`, `rental_operation_confirm`, `new_link_batch_confirm`, `new_link_batch_multi_confirm`, `activity_automation_confirm`, `activity_price_callback_*`, and `cancel_differential_pricing_*`. Tampered request payloads and unsigned legacy payloads are rejected before side effects.

Current verification after this hardening pass: `tsc -p tsconfig.json --noEmit` passed, focused planner/tool/card tests passed with 4 files / 95 tests, and `vitest run --exclude "**/.worktrees/**"` passed with 142 files / 971 tests.

## Result Metadata Review

Planner-visible tools now expose `resultMetadataSchema` when their execution result is intended for later steps. This lets the LLM compose plans from tool outputs instead of guessing field names: `product.rankBestSameSku.bestProductId` can feed `rental.newLinkBatchPlan.sourceProductId`, `rental.copy.newProductId` can feed a follow-up query, and `rental.priceChange.taskId` / `rollbackFile` can feed rollback planning.

The schema is copied defensively from the tool registry and hidden execution tools remain filtered from planner-visible metadata. Confirmed `rental.copy` execution now returns `newProductId` in response metadata, so a continuation can resolve `${copy.newProductId}` after the user approves the copy card.

Current verification after this metadata pass: `tsc -p tsconfig.json --noEmit` passed, focused planner/tool tests passed with 4 files / 84 tests, and `vitest run --exclude "**/.worktrees/**"` passed with 142 files / 974 tests.
