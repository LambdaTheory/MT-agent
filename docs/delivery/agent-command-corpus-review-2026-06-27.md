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

## 测试证据

已补/已有的关键覆盖：

- `tests/feishuBotTools.test.ts`
  - 定价快照：原句 `x200u的定价情况怎么样`
  - 规格删除：原句 `x300u 含手柄的sku 都得下掉`
  - 活跃度刷新：原句 `刷新活跃度`
  - S23U 最佳链接：原句 `s23u最好的链接是哪条?`
  - 复合新链、多商品新链、确认续跑、旧 workflow 拒绝
  - exact intent 防绕路：带 planner 时 `run_public_traffic_report`、`rental_copy` 不会走旧路由
- `tests/agentRuntimeLlmPlanner.test.ts`
  - LLM prompt 不暴露 legacy workflow，并明确提示定价快照、规格删除计划。
- `tests/agentRuntimeToolRegistry.test.ts`
  - planner-visible 工具与隐藏执行工具边界。
- `tests/feishuBotRentalPriceAction.test.ts`
  - 规格删除执行链路与审计文件。
- `tests/agentDryRunCliSource.test.ts`
  - dry-run 默认 planner-first；`--legacy` 仅用于旧解析对照。

## 复盘

这轮不是新增固定 workflow，而是把语料诉求收敛成可组合工具：

- 查询类能力保持只读工具。
- 计划类工具只负责生成可审查计划和确认卡。
- 真正写入动作由确认卡触发，并保留审计产物。
- 多步骤目标通过 planner `steps` 和占位符传参组合，不把“工程流程”固化成业务 workflow。

剩余依赖主要是链接档案质量：别名、同款组、品类和状态越完整，LLM 选择工具后本地解析越稳定。

本轮自审结论：已填写的语料功能均有注册工具、确认边界、关键回归测试和交付说明；空白占位行仍等待业务语料，不计入本轮完成范围。
