# Agent Runtime Refactor / Daily Mission 开发审计（2026-07-02）

## 审计范围

- Worktree：`C:\works\MT-agent\.worktrees\agent-runtime-refactor-ulw`
- 分支：`ulw/agent-runtime-refactor`
- 对比范围：`git diff master...HEAD`，当前审计时工作树无未提交代码改动。
- 重点文档：
  - `docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md`
  - `docs/superpowers/plans/2026-07-01-daily-mission-self-loop.md`
  - `docs/superpowers/plans/2026-07-02-daily-mission-execution-closure.md`
  - `docs/llm-agent-runtime.md`

## 验证方式

- 静态审计：逐项检查 Daily Mission collect → plan → approval → execute → journal 链路、确认卡边界、ledger 归因、run 状态、CLI 和测试覆盖。
- 多角度复核：按 line-by-line、removed behavior、cross-file tracer、reuse/simplification/efficiency/altitude 角度查找候选问题，并对关键候选做独立复核。
- 实际运行：
  - `npx tsc -p tsconfig.json --noEmit`：通过。
  - `npx vitest run tests/dailyMissionApprovalCallback.test.ts tests/dailyMissionExecution.test.ts tests/dailyMissionExecutionIntegration.test.ts tests/dailyMissionOrchestrator.test.ts tests/decisionPolicyToolValidation.test.ts --exclude '**/.worktrees/**'`：通过。
  - `npx vitest run tests/agentToolExecutorLedger.test.ts tests/rentalWriteLedger.test.ts tests/dailyMissionAudit.test.ts tests/dailyMissionRun.test.ts tests/dailyMissionIntegration.test.ts --exclude '**/.worktrees/**'`：通过。

结论：当前类型检查和现有相关测试均通过，但测试主要覆盖 happy path，未覆盖审批执行闭环、持久化幂等、二次确认卡、同日多 run、post-execution journal、ledger 原子性等关键边界。

## 总体结论

Daily Mission 的 plan 模式骨架已成型，CLI、collector、DecisionBuilder、DecisionPolicy、approval card、execution result、ledger attribution 等模块均有基础实现；但“审批后真实执行闭环”仍存在多处高风险缺口。最需要优先处理的是：

1. 审批回调没有校验请求是否属于当前 run 的待审批决策，且没有持久化幂等保护。
2. 可被 LLM 审批的工具边界过宽，可能直接执行 hidden/runtime 工具或吞掉二次确认卡。
3. 执行后的 run 状态、journal、audit 视图没有闭环，导致运营侧看到的状态与实际执行不一致。
4. ledger 的日期归档、原子性、坏行处理和覆盖范围不足，会破坏后续飞轮归因。

## 问题清单

### P0：写操作安全与审批边界

#### 1. Daily Mission 审批回调不校验 run 状态与持久化审批内容

- 位置：`src/agentRuntime/dailyMissionApprovalCallback.ts:21`
- 证据：回调只通过 `findDailyMissionRunByRunId` 判断 run 存在，然后在 `src/agentRuntime/dailyMissionApprovalCallback.ts:23-35` 根据卡片 request 重构新的 `DecisionRecord`。
- 影响：旧卡片或有效但不属于该 run 的确认请求，只要带现存 `runId` 和合法 `confirmationKey`，就能触发商品写操作。它不校验：
  - run 是否仍处于 `waiting_approval`；
  - `decisionId` 是否存在于该 run 的 `decisions.json` / `approval-request.json`；
  - `toolName` / `arguments` 是否等于原审批卡内容。
- 建议：审批回调必须加载 run 对应的 persisted decisions/approval-request，只允许执行仍处于待审批集合中的决策；终态 run、取消 run、已执行 decision 应拒绝。

#### 2. 缺少持久化幂等检查，重复确认可能重复执行同一决策

- 位置：`src/agentRuntime/dailyMissionExecution.ts:21`
- 证据：`executeApprovedDecision` 先记录 `approval_accepted`，再直接调用 `executeAgentToolRequest`；`appendExecutionResult` 在执行后才按 `decisionId` 覆盖结果，不能阻止副作用。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:84` 要求每个写操作带 `runId + decisionId` 幂等键，避免重复执行。
- 影响：进程重启后内存 claim 丢失，或重复有效确认请求进入回调时，同一 decision 可能二次下架/改价/复制。
- 建议：执行前以 `runId + decisionId` 查询 execution-results/ledger/专门 idempotency store；已成功或处理中则拒绝重复执行并返回已有结果。

#### 3. DecisionPolicy 允许 LLM 直接审批 hidden/runtime 执行工具

- 位置：`src/agentRuntime/decisionPolicy.ts:10`
- 证据：`toolArgumentsValid` 只检查 `findAgentTool` 和 `schemaAllowsArguments`；`rental.priceApply`、`rental.operationConfirmRequest`、`operations.refreshActivityExecute` 在 `src/agentRuntime/toolRegistry.ts:680-685`、`src/agentRuntime/toolRegistry.ts:827-840` 中为 `plannerVisible: false`，但仍会被 `findAgentTool` 找到。
- 影响：LLM 若产出 hidden tool 且参数合法，会进入 approvals，生成通用确认卡后直接执行底层 runtime 工具，绕过预览/专用确认流程。
- 建议：Daily Mission policy 应拒绝 `plannerVisible === false` 的工具，并显式维护允许的决策工具白名单；对高风险工具还应要求走对应 preview/plan 工具，而不是底层 execute/apply 工具。

#### 4. 二次确认卡被丢弃，并被记录为执行成功

- 位置：`src/agentRuntime/dailyMissionExecution.ts:31`
- 证据：`executeApprovedDecision` 只返回 `{ decisionId, ok, text }`，丢弃 `executeAgentToolRequest` 的 `card`；`server.ts:542-558` 对 Daily Mission 结果只包装文本和 ok。
- 可达场景：`rental.pricePreview` 在 `src/feishuBot/agentToolExecutor.ts:714-729` 会生成 `rental.priceApply` 专用确认卡并设置 `metadata.ok: true`。Daily Mission 审批后该卡不会展示给用户，`execution-results.json` 却记录成功。
- 影响：需要二次确认的真实写操作既没有执行，也没有给用户继续确认入口，审计结果却显示成功。
- 建议：Daily Mission execution result 应保留 `card` / `pendingConfirmation` 状态；遇到返回 card 的工具不得记为执行成功，应进入等待二次确认状态，并继续透传 runId/decisionId。

#### 5. `ledgerContext` 只覆盖部分 rental 写路径

- 位置：`src/feishuBot/agentToolExecutor.ts:1650`
- 证据：`ledgerContext` 只透传到 simple rental write 和 `rental.operationConfirmRequest`；`operations.refreshActivityExecute`、`rental.priceApply` 等真实写分支没有透传到实际执行函数。
- 影响：即使 Daily Mission 传入 `ledgerContext`，部分真实写操作也不会产生带 `runId/decisionId/subject` 的 `execution_*` ledger 事件，破坏飞轮归因。
- 建议：所有可能写商品/链接的最终执行函数统一接收 execution attribution，或在更底层执行 harness 统一记录 `execution_started/succeeded/failed`。

#### 6. Daily Mission 审批取消不会记录 `approval_rejected`

- 位置：`src/feishuBot/server.ts:562`，SDK 同类路径在 `src/feishuBot/sdkClient.ts:866`
- 证据：取消按钮只带 `action/toolName/confirmationKey`，不带完整 request；取消路径只设置卡片状态和 agent learning，没有解析 Daily Mission `runId/decisionId`，也没有 `approval_rejected` ledger 事件。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:126-137` 和 `:243-247` 要求 `approval_accepted / approval_rejected` 都写 Ledger。
- 影响：拒绝审批不会进入 Daily Mission 审计/Journal，后续无法区分“未处理”和“已拒绝”。
- 建议：取消按钮保留 requestRef 或 dailyMission tag；取消路径记录 `approval_rejected` 并更新 approval artifact / run 状态。

### P1：状态闭环、Journal、Audit 与数据一致性

#### 7. 审批执行后不会推进 DailyMissionRun 状态

- 位置：`src/agentRuntime/dailyMissionApprovalCallback.ts:36`
- 证据：`runDailyMissionPlan` 在 `src/agentRuntime/dailyMissionOrchestrator.ts:121` 保存 `waiting_approval`；审批回调只执行并 append result，不调用 `transitionDailyMissionRun` / `saveDailyMissionRun`。
- 影响：执行成功后 `daily-mission-audit` 仍显示 `waiting_approval`，无法区分仍待审批、部分执行、全部完成或失败。
- 建议：审批回调应维护 run-level execution state：至少 `waiting_approval -> executing -> completed/failed`，多审批项需支持 partial state 或 pending count。

#### 8. 审批执行后不会重新生成 Journal

- 位置：`src/agentRuntime/dailyMissionApprovalCallback.ts:36`
- 证据：CLI 在 `src/cli/dailyMissionRun.ts:40` 于 plan 完成后写 journal；审批回调只写 `execution-results.json`。`WriteDailyJournalInput` 在 `src/agentRuntime/dailyJournalWriter.ts:10-18` 也没有 execution results 输入。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:263-268` 要求 JournalWriter 从 Ledger + decisions + execution-results 生成“实际执行了什么”。
- 影响：`daily-journal.json/md` 永远停留在审批前视图，不记录审批接受/拒绝和实际执行结果。
- 建议：执行结果变更后重写或追加 final journal；JournalWriter 输入应包含 execution-results / approval decisions / ledger summary。

#### 9. 审批/执行 Ledger 事件按墙钟日期写入，不按 mission date

- 位置：`src/agentRuntime/dailyMissionExecution.ts:23`，`src/feishuBot/rentalWriteOperationHandlers.ts:73`
- 证据：事件 `at` 使用 `new Date().toISOString()`；`operationLedgerJsonlPath` 在 `src/agentRuntime/dailyMissionArtifacts.ts:40-42` 按 `entry.at.slice(0, 10)` 分区。
- 影响：审批昨天或历史 mission 时，执行事件写入今天的 `operation-ledger/<today>.jsonl`，而 execution-results 写在 mission date 目录。审计 mission date 会漏掉真实执行。
- 建议：Daily Mission execution ledger 应明确 mission date 与 event time：可用 mission date 分区并在 metadata 记录真实 executedAt，或审计入口同时按 runId 聚合跨日事件。

#### 10. 同日多 run 会覆盖 mission-run 和 artifacts

- 位置：`src/agentRuntime/dailyMissionRun.ts:100`，`src/agentRuntime/dailyMissionArtifacts.ts:21-30`
- 证据：所有产物路径为 `daily-mission/<date>/<fixed filename>`，不含 `runId`。
- 影响：同一天 retry 或第二次运行会覆盖前一次 `mission-run.json`、`decisions.json`、`approval-request.json`。旧审批卡按旧 runId 回调时可能找不到 run，或与新产物错配。
- 建议：产物路径引入 `runId` 层级，或建立 date index + active run 概念；审批卡必须引用不可变 run artifact。

#### 11. `appendExecutionResult` 无锁读改写，并发审批会丢结果

- 位置：`src/agentRuntime/dailyMissionExecution.ts:57`
- 证据：函数读取整个 `execution-results.json`，过滤后 `writeFile` 覆盖，没有锁或原子 merge。
- 影响：两个审批卡同时确认时，后写入者可能覆盖先写入者的 result，导致已执行决策从 execution-results 丢失。
- 建议：使用与 ledger 类似的 per-file lock；或改成 append-only JSONL，再由 audit/journal 聚合。

#### 12. `recordOperationEvent` 的 JSONL 与 JSON journal/store 写入不是原子操作

- 位置：`src/agentRuntime/operationLedger.ts:145`
- 证据：先 `appendOperationLedgerJsonlEntry`，再 `appendOperationPlanJournalEntry`，两个 helper 各自加锁。
- 影响：JSONL 追加成功后第二步失败会造成 JSONL 与 state/runtime journal 不一致；重试会重复 JSONL。
- 建议：定义单一事实来源；若仍双写，需要同一锁内完成并具备 idempotency key / dedupe，或让 JSON journal 从 JSONL 重建。

#### 13. JSONL 坏行会中断 recent operations / audit

- 位置：`src/agentRuntime/operationLedger.ts:154`
- 证据：`loadOperationLedgerJsonlEntries` 对每个非空行直接 `JSON.parse`。一个坏行会抛错。
- 影响：`collectRecentOperations` 在 `src/agentRuntime/dailyMissionContext.ts:52-59` 会因任一历史 ledger 坏行失败，导致 recentOperations 整个数据源缺失；audit CLI 也会失败。
- 文档/计划期望：ledger 测试策略提到坏行跳过，RecentOperationsCollector 需要稳定读取近 3-7 天 ledger。
- 建议：逐行 parse，坏行记录 warning/metadata 并跳过；audit 输出坏行计数。

#### 14. `dailyMission.audit` 信息量不足，没有读取 Journal/decisions/execution-results

- 位置：`src/cli/dailyMissionAudit.ts:22`
- 证据：当前只加载 ledger JSONL 和 mission run status，统计 event counts；未读取 `daily-journal.json/md`、`decisions.json`、`approval-request.json`、`execution-results.json`。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:270-274` 要求只读审计入口查询某日 Ledger 和 Journal，返回当日决策、审批、执行摘要。
- 影响：审计命令无法回答“具体哪些决策、哪些通过/拒绝、实际执行什么、失败原因是什么”。
- 建议：audit summary 聚合 run/artifacts/ledger/journal/execution-results，并支持按 runId 查询。

### P2：数据契约与可观测性缺口

#### 15. DecisionRecord 允许空 subjects，Ledger 事件缺少 subject 归因

- 位置：`src/agentRuntime/decisionRecord.ts:52`
- 证据：`subjects` 只检查 `Array.isArray` 和 `every`，空数组通过；`runDailyMissionPlan` 在 `src/agentRuntime/dailyMissionOrchestrator.ts:110` / `:130` 写 `subject: decision.subjects[0]`。
- 影响：生成 subject 缺失的 `decision_created` / `approval_requested` ledger 事件，违反 `subject/decisionId/runId/at` 归因锚点要求。
- 建议：`DecisionRecord.subjects` 必须 `minItems: 1`；无法归因的决策降级为 observe，并使用明确的 run-level subject 或 blockedReason。

#### 16. LlmDecisionBuilder 静默丢弃非法 LLM 决策

- 位置：`src/agentRuntime/decisionBuilder.ts:51`
- 证据：实现对 `result.json.decisions` 使用 `.filter(isValidDecisionRecord)`，非法记录直接消失。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:225-228` 要求字段不合法时降级为 observe 并记录 uncertainties。
- 影响：运营侧看不到 LLM 提出过哪些被拦截动作，也缺少后续调参和安全复盘证据。
- 建议：为非法记录生成 blocked observation，保留原始错误摘要、uncertainties 和 evidenceRef（如 `llm.validation`），但绝不带可执行 proposedTool。

#### 17. 热点文件缺失或损坏被静默当作空热点

- 位置：`src/agentRuntime/hotspotEvents.ts:36`
- 证据：`FileHotspotEventProvider.listEvents` 对读取/解析失败直接返回 `[]`；collector 因此成功返回 `{ hotspots: [] }`，`missingSources` 不会包含 `hotspots`。
- 文档约束：`docs/superpowers/specs/2026-07-01-daily-mission-self-loop-design.md:176-188` 要求缺失数据源用 `missingSources` 标记，不静默。
- 影响：运营日报会显示“热点事件：无”，但实际可能是热点源文件缺失或损坏。
- 建议：区分“源正常但无事件”和“源不可用”；不可用时让 collector reject 或返回显式 missing marker。

#### 18. CLI 输出目录环境变量与旧计划示例不一致

- 位置：`src/cli/dailyMissionRun.ts:19`，`src/cli/dailyMissionAudit.ts:50`
- 证据：代码使用 `MT_AGENT_OUTPUT_DIR`；旧计划中仍存在 `MT_OUTPUT_DIR` 示例。
- 影响：按旧 smoke 命令设置 `MT_OUTPUT_DIR=$(mktemp -d)` 时，CLI 会写默认 `output`，造成审计目录为空或误写真实输出目录。
- 建议：统一文档为 `MT_AGENT_OUTPUT_DIR`；为兼容可短期支持 `MT_OUTPUT_DIR` fallback，并在启动日志打印 resolved outputDir。

## 建议修复顺序

1. P0-1 / P0-2 / P0-3：先收紧审批回调与工具白名单，增加持久化幂等，避免重复或越权写操作。
2. P0-4 / P0-5：处理返回二次确认卡的工具状态，并统一 ledgerContext 覆盖所有真实写路径。
3. P1-7 / P1-8 / P1-14：补齐 run 状态、post-execution journal、audit 汇总，让执行闭环可观察。
4. P1-9 / P1-10 / P1-11 / P1-12 / P1-13：修复持久化一致性、同日多 run、并发写和 JSONL 容错。
5. P2-15 / P2-16 / P2-17 / P2-18：补齐数据契约、LLM validation 可观测性、热点缺失标记和文档/env 一致性。

## 建议补充测试

- Daily Mission 审批回调：
  - run 已 completed/cancelled 时拒绝执行。
  - decisionId 不存在于 approval-request 时拒绝执行。
  - toolName/arguments 与 persisted approval 不一致时拒绝执行。
  - 同一 `runId+decisionId` 重复确认不重复调用 client。
- 二次确认卡：
  - `rental.pricePreview` 审批后返回 pending/card，不写 ok=true execution result。
  - `rental.priceApply` / `operations.refreshActivityExecute` 执行时写带 attribution 的 execution events。
- Run 与 artifacts：
  - 同日两个 run 不互相覆盖。
  - 历史 date 的审批事件能被该 mission audit 查到。
- Journal/Audit：
  - 审批接受/拒绝后 daily-journal 更新。
  - audit 输出 decisions、approvals、rejections、execution-results 和 failure 摘要。
- Ledger：
  - `recordOperationEvent` 第二阶段失败不造成重复/分叉。
  - JSONL 中有坏行时读取跳过坏行并返回其余事件。
- Data contract：
  - empty subjects 被拒绝或降级。
  - invalid LLM decision 变成 blocked observation。
  - hotspot 文件缺失进入 `missingSources`。

## 当前状态

本审计只写入本文件，未修改实现代码。当前分支可编译、相关现有测试通过，但按上述问题看，Daily Mission 完成体尚不建议进入真实运营执行路径。