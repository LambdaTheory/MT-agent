# Audit Logger Daily Report Integration Implementation Plan

> 本计划供后续 agent worker coding session 独立执行。执行者必须先重新读取本计划引用的规范和当前源码，再按任务顺序采用 TDD 方式实现。本文只描述实施方案，不表示任何源代码、测试、构建、服务或线上验证已经完成。

## Goal

在不改变 MT-agent 业务结果、飞书交互、确认安全边界和既有业务审计事实的前提下，建立独立的集中式 Audit Logger 核心，并只接入选定的 Daily Report 工具。实现范围在本地 fake audit service 的 ingest、失败回放、trace 关联和业务回归验证完成后停止，不进入真实审计服务联调，也不进入 rental 集成。

完成后应具备以下能力：

1. 每条 canonical audit event 先写入本地原始 NDJSON，再以同一个完整 payload 非阻塞发送。
2. 网络错误、超时、非 2xx、malformed response、negative ack 和部分拒绝都不会改变业务结果，并能进入有界重试或隔离流程。
3. 事件在请求、Agent、工具和确认恢复之间复用同一 `trace_id`，工具 start 与 end/error 复用同一 `span_id`。
4. 只对精确的 11 个 Daily Report 工具产生工具审计跨度，不对其他工具和 rental 工具产生集中式审计事件。
5. `latest_summary` 和 `conversion_summary` 的 direct intent 旁路得到审计覆盖，同时保持当前 text/card 输出不变。
6. `runReport` 和 `refreshDashboard` 在等待确认时只产生 run 级等待事件，确认后恢复 trace 才开始真实 tool span。
7. SDK 和 HTTP confirmation/cancel callback 都能恢复或新建正确的审计 trace，历史 callback 没有 sidecar 时仍然有效。
8. 本地 fake HTTP audit service 能证明完整 trace、accepted/rejected 处理、断网入队、恢复 replay 和业务结果不变。

## Architecture

### 目标链路

```text
Feishu SDK / HTTP / 明确 Agent 请求
  -> 显式 AuditContext
  -> run.start 或已有 trace 的 run.resume
  -> runtime.handle / handleIntent
  -> direct intent wrapper 或 executeAgentToolRequest wrapper
  -> canonical tool.start
  -> 真实业务工具执行
  -> canonical tool.end 或 tool.error
  -> run.final_result 或 run.failed
  -> 本地 NDJSON first
  -> 同一原始字符串单事件 POST
  -> accepted / rejected / errors 解析
  -> retry queue 或 isolate
  -> bounded flush / replay
```

### 组件边界

`src/audit` 是新集中式审计传输模块。它负责事件契约、脱敏、大小校验、本地原始证据、重试、HTTP 发送、回放和收尾。它不负责业务授权，不负责确认校验，不负责生成日报，不负责替换 operation ledger。

`src/agentRuntime` 负责显式传递 AuditContext。它不从全局变量、自然语言、卡片文案或历史文本推断身份和权限。

`src/feishuBot/dispatcher.ts` 负责从 Feishu message 构造请求上下文。`src/feishuBot/tools.ts` 负责 direct intent 的兼容包装。`src/feishuBot/agentToolExecutor.ts` 负责中央工具执行边界。

`confirmationContextStore.ts` 只保存 non-executable sidecar。sidecar 关联确认请求和安全 trace 元数据，不保存 executable arguments，不参与 confirmationKey 计算，不参与 confirmationKey 校验。

`recordOperationEvent`、report contexts、report files、Feishu cards 和其他领域 audit 继续作为彼此独立的现有事实。它们可以为 `domainMapper.ts` 提供有限的业务摘要，但不能充当 canonical transport。

### 业务不变原则

业务函数的返回值、异常传播、text、card、metadata、确认卡 payload 和 callback action 必须保持现有语义。审计发送失败只能写入本地 logger、retry queue 或 isolate，不得让原本成功的工具变为失败，也不得让原本失败的工具变为成功。

## Tech Stack

- TypeScript ESM，严格类型检查，Node.js 20+。
- Vitest Node environment。
- Node built-in `fetch` 作为默认 HTTP client。
- 测试注入 `fetch`，不依赖真实服务、不读取 `.env`。
- Windows PowerShell 项目工作流。
- 本地 NDJSON、filesystem locking、atomic rename 和 bounded replay。
- 现有 Feishu SDK 与 HTTP callback 双入口。

## Baseline and Worktree

| 项目 | 基线 |
|---|---|
| Worktree | `C:\works\MT-agent\.worktrees\audit-log-integration` |
| Branch | `codex/audit-log-integration` |
| Base | `master @ 1f8a487` |
| 当前状态 | integration has not started |
| 当前变更 | 评估文档是当前唯一既有变更；本计划新增一个文档文件 |

实施者必须参考以下材料：

- `C:\Users\lhw\Downloads\agent-audit-log-integration-guide.md`
- `C:\works\MT-agent\.worktrees\audit-log-integration\AGENT.md`
- `C:\works\MT-agent\.worktrees\audit-log-integration\docs\worktree-governance.md`
- `C:\works\MT-agent\.worktrees\audit-log-integration\docs\audit-logger-integration-development-assessment-2026-07-21.md`

不可把 `2026-07-15-rental-bulk-price-workflow.md` 等旧计划假设当作当前 runtime 事实。当前事实以本计划引用的源码、现有测试和上述评估为准。

## Scope

### 本次包含

- 独立 `src/audit` 核心模块。
- canonical event、status、AuditContext、redaction 和 size validation。
- 跨进程安全 raw NDJSON、retry queue、isolate、replay 和 flush。
- built-in fetch、注入 fetch、timeout、single-event JSON POST 和 ack parsing。
- Agent runtime 到 dispatcher、tools、executor 的显式上下文传递。
- 选定 Daily Report 工具的 central executor audit。
- direct `latest_summary` 和 `conversion_summary` audit wrapper。
- report query、product link query、problem products、order summary、data health 的 safe summary。
- resend 和 push 的 structural outcome mapping。
- `runReport` 和 `refreshDashboard` 的 confirmation sidecar、resume、cancel 语义。
- SDK 和 HTTP confirmation/cancel callback 对称回归。
- SDK、HTTP Bot 的 bounded shutdown flush。
- PM2 `kill_timeout` 配置计划和对应测试或 source assertion，不执行 PM2。
- local fake audit service acceptance test。

### 明确停止点

最后一个实现任务是本地 fake audit service 的 contract verification。验证应证明选定日报工具的 canonical 事件和失败回放，但不得继续到真实 `/health`、`/v1/ingest`、`/query` 或生产 trace 查询。

### 本次不包含

- 任何 rental 工具或 `rental.bulkPriceApply`。
- vendor 代码、vendor 审计、租赁 daemon 或商品写操作。
- Daily Mission 集成。
- standalone `public-traffic-report`、`daily-report`、rebuild CLI 的 instrumentation。
- 全部 `publicTraffic` 工具覆盖。
- batch HTTP ingest。
- UI 或 Feishu card redesign。
- 外部服务认证实现。
- 真实审计服务部署、启动、查询和生产联调。
- PM2 执行、重启、日志读取或真实业务 crawl。

## Global Constraints

### 配置基线

本阶段计划使用以下配置语义。环境变量名称在实现前由 Task 1 测试冻结，不能由各入口自行解释：

| 配置 | 本阶段语义 |
|---|---|
| `MT_AGENT_AUDIT_AGENT_ID` | 稳定生产者 ID，默认 `mt-agent`，必须通过 agent id 格式校验 |
| `AUDIT_INGEST_URL` | 完整 `/v1/ingest` 地址；空值只关闭远程发送，本地 raw NDJSON 仍强制写入 |
| `AUDIT_INGEST_TIMEOUT_MS` | 单事件 HTTP 超时，默认参考 guide 的 `1500` |
| `AUDIT_RETRY_ENABLED` | 是否允许自动 replay；关闭时远程失败事件仍写入 retry queue，只是不自动回放 |
| `AUDIT_RETRY_MAX_BATCH` | 一轮最多选择的 replay 事件数，默认参考 guide 的 `50`；HTTP 仍逐事件发送 |
| `MT_AGENT_AUDIT_LOG_DIR` | 独立、可写、可持久目录，默认建议为 `<MT_AGENT_OUTPUT_DIR>/audit` |
| `AUDIT_FLUSH_TIMEOUT_MS` | 常驻 Bot 收尾时 bounded flush 的上限，必须小于 PM2 `kill_timeout` |

这些配置属于 MT-agent 上游 producer，不是外部 audit service 自动读取的配置。实现不得在模块导入时读取真实环境，测试必须注入 env object。

### 安全和隐私

1. 不读取、打印或提交 `.env`、API key、Cookie、Token、Authorization、密码、浏览器 profile 或生产输出。
2. 不记录 report/card body、raw arguments、文件路径、hash、Feishu ID、recipient ID、token、confirmation key 或 full error。
3. 所有能够取得 actor id 的 Feishu SDK/HTTP 用户触发事件都必须填写稳定的 pseudonymized `user_id`，例如对来源命名空间和稳定上游 ID 做单向摘要。只有自治任务、未知来源或确实没有 actor 的请求可以省略。原始 Feishu ID 和摘要输入不能进入事件。
4. `llm_intent` 在本阶段省略。除非后续有明确单独决策，否则不得加入该字段。
5. aggregate facts 只能进入 redacted、bounded 的 `result_summary` 或 stable `tags`。
6. 只有在稳定值可用时才发送可选 `entity: { type: 'report', id: <business-date or generationId> }`。
7. 不在 canonical event 顶层添加 undocumented fields。所有 optional fields 必须来自接入指南允许字段。
8. 原始完整业务文件仍留在受控上游存储，集中式审计只保存短摘要和允许的 entity。

### 业务行为和确认安全

- 不修改 `AgentToolConfirmRequest` 的字段和结构。
- 不修改 `confirmationKey` 的输入、计算或验证。
- 不修改 clarification key 的输入、计算或验证。
- 不修改 executable card payload、action name 或已有 callback parser。
- confirmation sidecar/envelope 只保存安全 trace association，不保存可执行 arguments。
- 由既有 confirmationKey 派生 one-way lookup key，只用于找 sidecar，不可反向得到原 key 或 arguments。
- 没有 sidecar 的历史 callback 仍然合法，处理时创建新的 callback trace，并用 `tags: ['historical_callback']` 或等价稳定 tag 表达关联缺失。
- 取消确认不得产生 tool span。取消应产生 `run.failed`，status 为 `CANCELLED`。
- 等待确认或澄清不得产生尚未真实执行的 `tool.start`。

### 可靠性

- 事件先落地，再后台发送。
- raw event 只构造一次、序列化一次。
- retry envelope 保存 exact payload string，不重新生成 ts、trace、span、event 或业务字段。
- 使用 filesystem locking，不依赖进程内 Map 保护跨进程写入。
- compaction 使用临时文件和 atomic rename。
- replay 使用 single-flight lease，避免两个进程同时回放同一队列。
- 坏行必须隔离或跳过，不能阻断后续可读事件。
- URL 为空时只关闭远程发送，本地 raw NDJSON 仍写入。
- audit logger 不等待远程 HTTP 结果，只有 bounded flush 才允许短暂等待。
- `AuditContext` 可以在所有请求入口构造，但集中式事件采用 lazy activation：只有解析到 selected tool、selected direct intent 或 selected confirmation path 时才补发该请求的 `run.start`/`agent.start` 并开始记录。名单外请求不得只留下孤立的 run/agent 事件。

## Selected Tool Allowlist

选定 allowlist 必须精确等于以下 11 项，不增加同类工具，不把其他工具作为“顺便覆盖”：

```text
publicTraffic.latestSummary
publicTraffic.conversionSummary
publicTraffic.reportQuery
productLink.query
publicTraffic.problemProducts
publicTraffic.orderSummary
system.dataHealth
publicTraffic.resendLatestReport
publicTraffic.pushLatestReportToGroup
publicTraffic.runReport
publicTraffic.refreshDashboard
```

实现中应提供单一常量或等价不可变集合，并测试集合内容、顺序无关相等性和名单外工具不产生 tool span。allowlist 是审计覆盖范围，不是 executor 的授权名单。既有 planner、schema、确认和业务授权逻辑保持原样。

## Canonical Event and Status Rules

### 事件名称

只允许下列 canonical event names：

```text
run.start
run.resume
run.waiting_user
run.final_result
run.failed
agent.start
agent.end
agent.error
tool.start
tool.end
tool.error
```

不得发明 `tool.pending`、`tool.success`、`tool.failure`、`run.cancelled`、`agent.failed` 或任何别名。取消使用 `run.failed` 加 `CANCELLED`。等待确认或澄清使用 `run.waiting_user`。

### 状态映射

`status` 只能使用以下值。uncategorized 或 partial outcome 使用 `UNKNOWN`，不能发送 `success`、`failed`、`error`、`ok` 等小写或自定义值。

| 业务场景 | canonical status |
|---|---|
| 成功完成 | `OK` |
| 用户取消或明确拒绝确认 | `CANCELLED` |
| 参数缺失、格式非法、日期非法 | `INVALID_ARGUMENT` |
| 报表或稳定 entity 不存在 | `NOT_FOUND` |
| 执行前置条件不满足、数据质量阻断 | `FAILED_PRECONDITION` |
| 权限不足 | `PERMISSION_DENIED` |
| 远端依赖不可达 | `UNAVAILABLE` |
| 超过本地或远端 deadline | `DEADLINE_EXCEEDED` |
| 未分类内部异常 | `INTERNAL` |
| 无法分类或 partial outcome | `UNKNOWN` |

状态映射必须由 `domainMapper.ts` 或 event 层的纯函数集中定义。不能从用户可见 text 反向猜状态。

### 字段规则

必填字段遵循 guide：`ts`、`agent_id`、`trace_id`、`span_id`、`event`、`tool_name`、`status`、`result_summary`。`result_summary` 最多 200 字符，先脱敏再截断，不能截断 JSON 以绕过大小限制。

允许的 optional fields 只包括 guide 文档中的 `parent_span_id`、`duration_ms`、`channel`、`user_id`、`entity`、`error.message` 和 `tags`。本阶段省略 `llm_intent`。

`user_id` 虽是结构上的 optional field，但对本阶段有 actor id 的 Feishu 用户请求是业务必填。同一个请求片段中的 run、agent、tool 事件必须复用该片段实际 actor 的 pseudonymized `user_id`；不得因进入 direct path 或 executor path 而丢失。确认/取消 callback 可能由不同 reviewer 触发，因此恢复同一 trace 时应记录 callback 实际 actor，而不是强制沿用原请求人。只有没有用户身份的自治或未知来源任务才允许省略。

`tool_name` 必须是稳定工具名。`run` 和 `agent` 事件也使用稳定组件名，不放自然语言、参数或随机值。`trace_id` 表示一次用户请求或自治任务，`span_id` 表示一次工具调用。工具 start 与 end/error 必须成对。

## Proposed File Structure

### 新增生产模块

| 文件 | 职责 |
|---|---|
| `src/audit/types.ts` | AuditContext、canonical event、send result、retry item、flush result 的显式类型 |
| `src/audit/config.ts` | URL、timeout、目录、retry 开关、batch 上限、agent id 读取和校验 |
| `src/audit/event.ts` | 事件构造、canonical status、脱敏、摘要限制、字段拒绝和 size validation |
| `src/audit/storage.ts` | raw NDJSON、retry queue、isolate、坏行处理、locking、atomic compaction、replay lease |
| `src/audit/http.ts` | built-in/injected fetch、timeout、single-event POST、response parsing |
| `src/audit/auditLogger.ts` | record/start/end/error、后台发送、retry、bounded flush、replay single-flight |
| `src/audit/domainMapper.ts` | selected daily-report domain outcome 到安全摘要和 status 的纯映射 |
| `src/audit/confirmationContextStore.ts` | confirmation sidecar 的 one-way lookup、保存、读取、过期和历史 callback fallback |
| `src/audit/shutdown.ts` | idempotent bounded flush hook 和 SDK/HTTP 生命周期收尾适配 |

`src/storage/fileLock.ts` 只在 storage 测试证明需要通用抽取时新增。它是 optional，不得成为先决条件。优先复用 `src/linkRegistry/persistence.ts` 已验证的模式，但不能声称已有通用 lock module。

### 需要修改的现有生产文件

- `src/agentRuntime/types.ts`
- `src/agentRuntime/runtime.ts`
- `src/feishuBot/dispatcher.ts`
- `src/feishuBot/tools.ts`
- `src/feishuBot/agentToolExecutor.ts`
- `src/feishuBot/server.ts`
- `src/feishuBot/sdkClient.ts`
- `src/cli/feishuBotSdk.ts`
- `src/cli/feishuBot.ts`
- `ecosystem.config.cjs`

确认 store 或 approval card 文件只有在不改既有协议的前提下才允许触及。优先把 sidecar 接入在 callback 入口和新 wrapper 中，避免改动 `AgentToolConfirmRequest`。

### 计划新增测试，当前不存在

以下均为 planned/nonexistent test files，实施前不得描述为现有测试：

- `tests/auditConfig.test.ts`
- `tests/auditEvent.test.ts`
- `tests/auditStorage.test.ts`
- `tests/auditHttp.test.ts`
- `tests/auditLogger.test.ts`
- `tests/auditConfirmationContext.test.ts`
- `tests/auditShutdown.test.ts`
- `tests/agentRuntimeAuditContext.test.ts`
- `tests/agentToolExecutorAudit.test.ts`
- `tests/feishuBotDailyAudit.test.ts`

## Dependency Graph

```text
Task 1 contract freeze
  -> Task 2 types/config/event
  -> Task 3 storage
  -> Task 4 HTTP/logger
  -> Task 5 explicit AuditContext
  -> Task 6 central executor wrapper
  -> Task 7 direct paths + read/query mapping
  -> Task 8 resend/push structural outcomes
  -> Task 9 confirmation sidecar and callbacks
  -> Task 10 shutdown and PM2 config
  -> Task 11 focused regression/build/security/fake-service acceptance
```

Task 1 的 RED tests 可以先失败。Task 2 到 Task 4 建立独立基础后，Task 5 才能接入运行时。Task 6 必须先于 Task 7 到 Task 9，因为 direct path、delivery path 和 confirmation resume 都要复用 logger 和 context。Task 10 依赖 logger flush contract。Task 11 是最终出口，不得在真实服务或 rental 方向继续扩展。

## Task 1: Freeze Contract, Config, and Allowlist

### 目标

先将事件名、状态、字段、配置语义和精确 allowlist 固化为测试契约，阻止后续实现自行发明别名或扩大范围。

### RED

1. 规划 `tests/auditConfig.test.ts`，断言默认 agent id 合法，URL 为空时 `remoteEnabled=false` 但 `localEnabled=true`，timeout 为有限正整数，retry batch 有上限，本地目录与普通业务日志目录分离。
2. 在 `tests/auditEvent.test.ts` 先写 canonical event name 全量断言和 status 全量断言。
3. 先写 allowlist contract test，精确比较 11 项，名单外工具必须判定为不覆盖。
4. 先写 forbidden field test，断言 `product_id`、raw arguments、file path、Feishu ID、recipient ID、confirmation key、token 和 full error 不得进入 event。
5. 运行计划中的定向命令，预期因新模块不存在而失败。记录失败原因，不把失败结果写成实现验证。

### GREEN

1. 建立内部 contract 常量，后续由 `types.ts`、`config.ts`、`event.ts` 和 mapper 复用。
2. 固化“配置基线”表中的变量、默认值和校验语义，但不要读取真实 `.env`。
3. 将 selected tool allowlist 作为唯一审计覆盖集合，不改变 planner visibility 或业务授权。
4. 让测试通过后再进入 Task 2。

### 退出标准

- 事件名称和状态值只有 canonical 集合。
- `UNKNOWN` 明确用于 uncategorized 或 partial outcome。
- URL 为空仍保留本地记录。
- allowlist 只有精确 11 项。
- 不存在 undocumented top-level field 的设计空间。

## Task 2: Implement Types, Config, Event, Redaction, and Size Validation

### 目标文件

`src/audit/types.ts`、`src/audit/config.ts`、`src/audit/event.ts`，以及 `tests/auditConfig.test.ts`、`tests/auditEvent.test.ts`。

### RED

1. 先补 `AuditContext` 构造测试，覆盖 source、actor、channel、message、requestRef、runId、decisionId、clarificationRef 和 inherited trace。
2. 先写 event builder 测试，要求每个 event 具备 guide 必填字段，并拒绝非法 agent id、空 trace、空 span、未知 event 和未知 status。
3. 先写 `result_summary` 200 字符上限、敏感 token 替换、路径和 HTML 清理、raw error 摘要限制测试。
4. 先写 `entity` 只允许 stable report business date 或 generationId 的测试。无稳定值时必须省略。
5. 先写 `user_id` pseudonymization 测试：同一 Feishu actor 在 SDK/HTTP 路径得到稳定值，不同 actor 不碰撞；原始 ID 不出现在事件；有 actor 的用户触发事件缺少 `user_id` 时构造失败或被阻断发送；自治/无 actor 请求可以省略。
6. 先写单事件 byte size 上限测试，超限必须拒绝而不是截断 JSON。

### GREEN

1. 在 `types.ts` 定义 `AuditContext`、`CanonicalAuditEvent`、`AuditEventInput`、`RetryItem`、`SendResult`、`FlushResult` 等显式类型。
2. 在 `config.ts` 读取注入的 env object，避免模块导入时读取 process environment。校验 URL、timeout、目录、retry 开关和 batch 上限。
3. 在 `event.ts` 集中构造事件，生成 ts、trace 和 span 只发生在调用层一次，重试不调用 builder。
4. 对 error 只保留脱敏短 message，不发送 error code、stack、full response 或 request body。
5. event builder 接收来源类型和 actor availability；Feishu 用户触发事件必须带 pseudonymized `user_id`，自治/未知来源才允许省略。
6. 对日报聚合事实提供 bounded mapper input，不接受整个 report/card/body 作为 event field。
7. 保持 `llm_intent` 缺省，不实现后续决定前的兼容字段。

### 退出标准

所有事件 builder、字段拒绝、status mapping、pseudonymization、size validation 测试通过，且类型不依赖业务执行器。

## Task 3: Implement Cross Process Raw NDJSON and Retry Storage

### 目标文件

`src/audit/storage.ts`，必要时才新增 `src/storage/fileLock.ts`，以及 `tests/auditStorage.test.ts`。

### RED

1. 写 raw append test，验证一行一个完整 payload，并保留写入顺序。
2. 写 exact payload test，断言 retry envelope 的 `payload` 字符串与首次序列化结果 byte-for-byte 相同。
3. 写坏行容忍 test，raw 和 queue 中的坏 JSON 行不阻断后续合法行读取；坏行进入 isolate 或得到可观察的计数。
4. 写 lock contention test，模拟两个 writer，断言不会交错写一行，也不会丢写。
5. 写 stale lock test，陈旧锁可在安全条件下清理，活动锁不能被立即抢占。
6. 写 atomic compaction test，模拟 compaction 中断时旧 queue 仍可读，新 queue 只有完整文件。
7. 写 replay single-flight test，两个 replay 调用只能有一个持 lease。
8. 写 queue bounded read、isolate 400/413/415 item 和目录创建测试。

### GREEN

1. raw 文件按日期写入 `audit-YYYY-MM-DD.jsonl`，每行写入已经生成的原始 payload，不再次 JSON.stringify。
2. retry queue 保存 exact payload string、reason、attempt metadata 和 safe local hash。hash 只用于 queue identity，不进入远端事件，也不作为业务字段。
3. 使用目录 lock 或等价 filesystem lock 保护跨进程 append、queue compaction 和 replay lease。不要只使用 `Map<string, Promise<void>>`。
4. queue 删除采用读取、确认、atomic temp write、rename；任何失败都保留旧文件。
5. replay 一轮最多处理 `AUDIT_RETRY_MAX_BATCH`，单一 lease 到期后可恢复。
6. 对坏行保留隔离证据，但隔离文件也不得复制完整秘密或业务 body 到普通日志。
7. storage 层不发 HTTP，不生成 event，不知道业务工具语义。

### 退出标准

raw evidence、retry queue、isolate、locking、atomic compaction、bad-line tolerance 和 single-flight lease 均有直接测试。跨进程行为至少用可控的临时目录和并发 test fixture 证明，不能只断言内存队列。

## Task 4: Implement HTTP Sender and Audit Logger

### 目标文件

`src/audit/http.ts`、`src/audit/auditLogger.ts`，以及 `tests/auditHttp.test.ts`、`tests/auditLogger.test.ts`。

### RED

1. 写 injected fetch test，断言每次 POST 只有一个 JSON event，`Content-Type` 为 `application/json`，body 等于 raw payload。
2. 写 success ack test，只有 `accepted=1,rejected=0,errors=[]` 才确认单事件送达。
3. 写 202 negative-ack test：单事件 POST 返回 `accepted=0`、`rejected=1` 或 `errors[].index=0` 时，当前完整 payload 不得被确认，必须原样进入 queue 或 isolate。首版不实现批量请求中的逐项确认。
4. 写 malformed JSON、missing accepted/rejected、negative ack、400、413、415、500、network throw 和 timeout test。
5. 写 blank URL local-only test，确认没有 fetch 调用但 raw event 可读。
6. 写 logger non-blocking test，业务 promise 不等待 fetch 完成；fetch hang 不能阻塞工具结果。
7. 写 start/end/error span test，成功、异常和 status 映射都生成正确 pair。
8. 写 flush bounded test，超时后返回失败摘要但不抛业务异常。

### GREEN

1. `http.ts` 使用 Node built-in fetch，测试通过依赖注入 fetch。每个事件单独 POST，不实现 batch HTTP ingest。
2. timeout 使用 AbortController 或等价有限机制。网络错误、timeout、非 2xx、malformed response、negative ack 都交给 queue policy。
3. 对 400、413、415 做 isolate，避免快速无限重试。仍保留本地 raw evidence 和安全失败计数。
4. `auditLogger.ts` 的 record 流程为 build、validate、serialize once、append raw、schedule send。
5. `start` 返回 span handle 或稳定 span id，`end/error` 复用该 span id。logger 异常不能覆盖业务异常。
6. `flush` 等待已发起发送和有限 replay，但有明确 deadline、single-flight 和幂等结果。
7. retry envelope 直接发送保存的 payload string，不调用 event builder。

### 退出标准

所有 HTTP response path 和 logger lifecycle tests 通过。业务返回值和异常语义在 fake sender 下保持原样。

## Task 5: Add Explicit AuditContext and Request Run/Agent Lifecycle

### 目标文件

`src/agentRuntime/types.ts`、`src/agentRuntime/runtime.ts`、`src/feishuBot/dispatcher.ts`、`src/feishuBot/tools.ts`、`AgentToolExecutionOptions` 所在的 `src/feishuBot/agentToolExecutor.ts`，以及 `tests/agentRuntimeAuditContext.test.ts`。

### RED

1. 先写 `AgentRequest` 到 `handleIntent` 的 propagation test，断言 source、actor、channel、messageId、transport 和 trace 都可见，并能派生稳定 pseudonymized `user_id`。
2. 写 selected request lifecycle success test，要求一次命中 allowlist 的请求形成 `run.start -> agent.start -> agent.end -> run.final_result`，并保持同一 trace。
3. 写 request lifecycle error test，要求未处理异常形成 `agent.error -> run.failed`，原异常和 BotResponse 语义不被审计覆盖。
4. 写 waiting lifecycle test，要求确认卡或澄清卡返回时形成 `run.waiting_user`，不产生 `run.final_result`，Agent 本次处理正常收尾。
5. 写 Feishu identity test：SDK/HTTP 有 actor 的 selected workflow 在同一请求片段内所有 run/agent/tool 事件都带同一 pseudonymized `user_id`，原始 actor id 从未进入 payload；确认 callback 由不同 reviewer 触发时使用 reviewer 的 pseudonymized 值；缺 actor 的自治请求允许省略。
6. 写 lazy activation test，名单外请求不产生孤立的 run/agent 事件；selected direct、executor 或 confirmation path 激活后，`run.start` 使用请求入口时已固定的时间和 trace。
7. 写 no-global test，两个并发 request 的 actor、channel、trace 不交叉。
8. 写 direct handler test，`handleBotIntent` 的 options 收到同一 AuditContext。
9. 写 executor options test，central executor 可收到 context，但已有 options 字段和调用方不被破坏。

### GREEN

1. 在 `agentRuntime/types.ts` 引入或引用显式 `AuditContext`，保留现有 `AgentRequest` source、actor、channel、metadata 兼容结构。
2. 修改 runtime config 的 `handleIntent` 签名，使 intent、outputDir 和 context 由参数显式传递。
3. 在 request/runtime 边界建立 lazy lifecycle handle：入口先固定 trace 和开始时间，只有命中 selected workflow 时才按原时间补发 `run.start`、`agent.start`，随后负责 `agent.end`/`agent.error` 和 `run.final_result`/`run.failed`；等待确认的响应改为 `run.waiting_user`，不得同时发 final result。
4. `dispatcher.toAgentRequest()` 继续使用现有 Feishu actor、chat、message 和 transport 事实，不把 display text 当身份；actor id 只在内存中进入 pseudonymization，不作为远端字段或摘要文本。
5. 在 `tools.ts` 的 options 传递 context，所有 central executor 调用点显式携带 options。
6. `AgentToolExecutionOptions` 增加可选 audit context 和 logger dependency injection，不引入 global mutable context。
7. run、agent、tool builder 从当前请求片段的 AuditContext 读取 pseudonymized `user_id`。initial/direct/executor 片段使用请求 actor；callback resume/cancel 片段使用实际 reviewer，并继续复用原 trace。
8. 对 CLI、api、agent、scheduler 缺少 actor/channel 的场景使用明确 source 和可选字段省略规则。

### 退出标准

上下文在 dispatcher、runtime、direct intent 和 executor 之间可追踪；selected workflow 的普通、异常和 waiting response 都有闭合且不冲突的 run/agent 生命周期；名单外请求没有孤立审计事件；任何并发请求都不会互相污染，原有 BotResponse 和调用签名行为保持兼容。

## Task 6: Wrap Central Executor for Exact 11 Tools

### 目标文件

`src/feishuBot/agentToolExecutor.ts`，必要时抽出内部 implementation，但保留导出的 `executeAgentToolRequest` 行为兼容，以及 `tests/agentToolExecutorAudit.test.ts`。

### RED

1. 写 selected tool success test，要求真实执行前有 `tool.start`，完成后有同 span 的 `tool.end`。
2. 写 selected tool throw test，要求 `tool.error` 使用结构化 status mapping，原异常仍按现有业务语义返回或抛出。
3. 写 non-allowlisted tool test，要求不产生集中式 tool span。
4. 写 pre-executor confirmation/clarification test，要求被 policy 或 direct confirmation helper 截停的请求没有 tool span，只产生 run waiting event。
5. 写 executor behavior snapshot or explicit response assertions，证明 text、card、metadata 不因 wrapper 改变。
6. 写 attempted-call closure test：一旦 allowlisted tool 已进入 executor implementation，即使参数校验失败、report missing 或 already running，也必须形成 `tool.start` 与 `tool.error`/`tool.end` 的闭合配对，并映射为 `INVALID_ARGUMENT`、`NOT_FOUND` 或 `FAILED_PRECONDITION`。只有 executor 之前的确认等待不得产生 tool span。

### GREEN

1. 将当前 switch 作为内部 implementation，外部 wrapper 负责决定是否覆盖、创建 span、记录 start/end/error；进入 implementation 即代表一次工具调用尝试。
2. 不要把 wrapper 放在会把 executor 之前的“确认卡生成”误判成真实执行的位置。确认请求返回只能由 run layer 表达等待用户。
3. `publicTraffic.runReport` 和 `publicTraffic.refreshDashboard` 的 confirmed callback 才进入 central wrapper。
4. selected 11 tools 使用 `domainMapper.ts` 生成 bounded result summary、entity 和 tags。不得把 `response.text`、card 或 metadata 整体送入 event。
5. 其他工具保留现有业务执行，不产生 canonical tool event。
6. audit logger 的失败只进入 queue/isolate，不能改变 executor response。

### 退出标准

11 个工具各有至少一条 success、failure 或 missing/blocked 路径断言，工具跨度完整且名单外无跨度。既有 `tests/agentToolExecutorPublicTraffic.test.ts` 等回归仍可运行。

## Task 7: Cover Direct Latest/Conversion Paths and Daily Read/Query Tools

### 目标文件

`src/feishuBot/tools.ts`、`src/audit/domainMapper.ts`、必要时 `src/feishuBot/dispatcher.ts`，以及 `tests/feishuBotDailyAudit.test.ts`。

### RED

1. 写 `latest_summary` direct branch test，断言当前 text 与 card 行为完全保持，且生成 `publicTraffic.latestSummary` 的 run/tool 事实。
2. 写 `conversion_summary` direct branch test，断言当前 text 行为保持，且生成 `publicTraffic.conversionSummary` 的 bounded summary。
3. 写 direct missing report test，精确映射 `NOT_FOUND`，不得从用户 text 解析成功/失败，也不得用 `UNKNOWN` 掩盖明确的缺失语义。
4. 写 selected read/query tools test，覆盖 `reportQuery`、`productLink.query`、`problemProducts`、`orderSummary`、`dataHealth` 的 safe summary、stable report entity 和 tags。
5. 写 report body leak test，构造含敏感值和长正文的 fake context，断言 event 不包含 report/card body、路径和原始参数。

### GREEN

1. 不把 direct latest/conversion reroute 到 `executeAgentToolRequest`，除非实现能证明 text/card 行为完全相同。优先新增共享 audited direct-intent wrapper，在原 direct branch 外围记录审计。
2. wrapper 接收稳定 tool name、AuditContext 和一个返回 response 的 callback，只提取结构化结果类别，不复制 response body。
3. report query 和 product query 的 entity 只在 context 提供稳定 business date 或 generationId 时设置。
4. aggregate counts、quality category、result kind 等事实进入 bounded `result_summary` 或 stable tags。
5. invalid argument、missing context、precondition failure 和 internal exception 统一经过 central status mapper。
6. 保持 direct path 当前的 text/card、fallback 和 missing context 文案。

### 退出标准

两条 direct bypass 明确被覆盖且行为不变，选定 read/query 工具全部只发安全摘要，测试证明集中式事件不含业务正文。

## Task 8: Cover Resend and Push Structural Outcomes

### 目标文件

`src/feishuBot/agentToolExecutor.ts`、`src/audit/domainMapper.ts`，以及 `tests/feishuBotDailyAudit.test.ts`。

### RED

1. 写 resend success/failure test，fake Feishu sender 返回结构化结果，断言 status 来自 `sent` 或结构化 failure kind，而不是用户 text。
2. 写 push success/failure test，断言 recipient ID、card content、fallback text 不进入 event。
3. 写 sender result partial/unknown test，断言不确定情况为 `UNKNOWN`，不会因为 text 包含“失败”而误分类。
4. 写 no-report test，断言 `NOT_FOUND`，并保持当前用户可见文案。

### GREEN

1. 在发送层增加 safe internal metadata，或为现有 result 增加 domain mapper。该 metadata 只表达 `sent`, `not_found`, `provider_error`, `unknown` 等安全类别。
2. 结构化 result 必须在业务发送函数返回时产生，audit mapper 只读取 metadata，不解析 text。
3. `publicTraffic.resendLatestReport` 和 `publicTraffic.pushLatestReportToGroup` 事件只包含工具名、状态、report entity、bounded summary 和稳定 tags。
4. 不发送 recipient ID、sendTo 原值、card JSON、Markdown、路径或报告内容。
5. 既有 sender 行为、目标选择和用户文案保持不变。

### 退出标准

success/failure/unknown 都由结构化结果决定，resend/push 不泄露收件人和卡片内容，既有发送测试保持通过。

## Task 9: Persist and Restore Confirmation Trace for runReport and refreshDashboard

### 目标文件

`src/audit/confirmationContextStore.ts`、`src/feishuBot/tools.ts`、`src/feishuBot/server.ts`、`src/feishuBot/sdkClient.ts`、必要时 `src/feishuBot/agentToolConfirmStore.ts`，以及 `tests/auditConfirmationContext.test.ts`、`tests/feishuBotDailyAudit.test.ts`。

### RED

1. 写 initial confirmation test：`runReport` 和 `refreshDashboard` 请求产生 request/run/agent 事件和 `run.waiting_user`，没有 tool span。
2. 写 confirm restore test：合法 callback 从 sidecar 恢复原 trace，先产生 `run.resume` 且 tag 为 `confirmed`，再产生 tool.start。
3. 写 cancel test：取消产生 `run.failed` 加 `CANCELLED`，没有 tool.start。
4. 写 invalid key test：既有 callback 校验失败语义保持不变，不从 sidecar 绕过 key validation。
5. 写 historical callback test：没有 sidecar 时 callback 仍执行原有逻辑，并新建 callback trace，不伪造旧 trace。
6. 写 SDK/HTTP symmetry test：同一类 confirmation 和 cancellation 的审计序列一致，既有 response/card 行为一致。
7. 写 payload immutability test：确认前后 `AgentToolConfirmRequest`、confirmationKey 和 executable payload byte/content 不变。
8. 写 actor attribution test：sidecar 记录 pseudonymized initiator；同一 reviewer 确认时 callback 事件保持同值，不同 reviewer 确认时 `run.resume` 和后续 tool 事件使用 reviewer 的 pseudonymized `user_id`，并可使用稳定 `delegated_confirmation` tag；原始 actor/reviewer ID 均不得进入 payload。

### GREEN

1. 初始请求在确认卡生成前建立 trace，记录 `run.start`、必要的 `agent.start` 和 `run.waiting_user`，不产生 tool span。
2. sidecar keyed by one-way lookup derived from existing confirmation key。sidecar 内容只包含 trace association、tool name、可选 requestRef、createdAt、safe source、可选 report entity 和 pseudonymized initiator user id；direct inline confirmation 没有 requestRef 时不得伪造，sidecar 永远不保存 raw actor id。
3. sidecar 不保存 executable arguments，不改变 `AgentToolConfirmRequest`，不进入 `confirmationKey` JSON 输入。
4. SDK 和 HTTP callback 在既有 key/requestRef 校验成功后读取 sidecar。读取成功时复用 trace，但 `user_id` 来自 callback 实际 reviewer 的 pseudonymized 值；与 initiator 不同时可增加稳定 `delegated_confirmation` tag。随后发 `run.resume`，tags 包含 `confirmed`，再调用中央 executor。
5. cancel callback 读取 sidecar 仅用于关联；使用实际 reviewer 的 pseudonymized `user_id`，记录状态为 `CANCELLED` 的 `run.failed`，不调用 executor。
6. callback actor 缺失但 sidecar 有 initiator 时，可以使用 initiator pseudonym 作为显式 `initiator_fallback`，并添加稳定 tag，不能把它表述为确认人；两者都缺失时按未知来源规则省略 `user_id`。
7. sidecar 缺失、损坏或过期时，历史 callback 按原行为继续。新 trace 优先使用 callback actor 的 pseudonymized `user_id`，并用安全 tag 表明无历史 sidecar，不能从 card 文案恢复身份。
8. confirmation、clarification 及其他工具不得被此阶段顺带扩大覆盖。只实现 runReport 和 refreshDashboard 的指定路径。

### 退出标准

SDK 和 HTTP 双路径都能覆盖 initial、confirm、cancel、historical callback。现有 key、payload、callback 和 card tests 无行为回归。

## Task 10: Add Bounded Shutdown Flush and PM2 Kill Timeout

### 目标文件

`src/audit/shutdown.ts`、`src/cli/feishuBotSdk.ts`、`src/cli/feishuBot.ts`、`ecosystem.config.cjs`，以及 `tests/auditShutdown.test.ts`。

### RED

1. 写 idempotent shutdown test，重复 signal 或重复 close 只能触发一次 flush。
2. 写 timeout test，flush 超时后进程收尾继续，不改变已有 error/exit semantics。
3. 写 SDK startup/shutdown wiring test，验证 logger lifecycle 注入但不启动真实 Feishu SDK。
4. 写 HTTP server close test，验证 close path 有 bounded flush hook。
5. 写 PM2 source/config test，断言 `kill_timeout` 严格大于 flush timeout。

### GREEN

1. `shutdown.ts` 提供一次性、有限 deadline 的 flush adapter，捕获 logger failure，不把审计故障变成业务成功路径异常。
2. 在 `feishuBotSdk.ts` 和 `feishuBot.ts` 连接 logger 和 close/signal lifecycle。不要在本任务运行实际 server 或 SDK。
3. 选择明确 flush timeout，例如 1000ms 或与 config 一致，并在计划实现时让 PM2 `kill_timeout` 大于该值，具体数值必须由测试固定。
4. PM2 只调整配置字段，不执行 PM2，不重启，不读取运行日志。
5. 不给 standalone public traffic CLI 和 daily-report CLI 加 instrumentation，符合 scope stop。

### 退出标准

常驻 Bot 在正常收尾和受控 signal 收尾都有 bounded flush 设计，PM2 kill timeout 留出余量，shutdown 失败不改变业务语义。

## Task 11: Focused Regression, Build, Payload Review, and Local Fake Service

### RED

1. 先运行新增 tests 和现有相关回归，记录预期缺失实现的失败，不修改测试来掩盖失败。
2. 先写 local fake audit service acceptance fixture，支持 accepted、single-event negative ack、network unavailable、恢复后 replay 四种模式。
3. 先写 acceptance assertions：同一 trace 可见 run、agent、tool start/end 或 error，重试 payload 与初次 raw payload 完全相同。

### GREEN

按以下顺序执行，命令只用于后续实现 session，不声称本计划已执行：

1. 新增审计核心定向测试：

```powershell
npx vitest run --dir tests tests/auditConfig.test.ts tests/auditEvent.test.ts tests/auditStorage.test.ts tests/auditHttp.test.ts tests/auditLogger.test.ts tests/auditConfirmationContext.test.ts tests/auditShutdown.test.ts
```

2. 上下文、executor 和 Daily Report 定向测试：

```powershell
npx vitest run --dir tests tests/agentRuntimeAuditContext.test.ts tests/agentToolExecutorAudit.test.ts tests/feishuBotDailyAudit.test.ts
```

3. 既有确认、dispatcher、tools、server、SDK 和 report 回归：

```powershell
npx vitest run --dir tests tests/agentToolConfirmStore.test.ts tests/feishuBotDispatcher.test.ts tests/feishuBotTools.test.ts tests/feishuBotServer.test.ts tests/feishuBotSdkClient.test.ts tests/feishuBotSdkCardAction.test.ts tests/feishuBotReportStore.test.ts tests/feishuBotPushGroup.test.ts
```

4. 既有日报、查询、刷新、executor 和 CLI source 回归：

```powershell
npx vitest run --dir tests tests/reportQuery.test.ts tests/dashboardRefresh.test.ts tests/agentToolExecutorPublicTraffic.test.ts tests/publicTrafficReportCliBehavior.test.ts tests/cliLoadEnvSource.test.ts tests/runtimeLogger.test.ts
```

5. 构建：

```powershell
npm run build
```

6. local fake service acceptance test 必须由测试 fixture 或本地 test server 驱动，不启动真实审计服务，不访问真实 URL。需要证明：

- local-only mode 写 raw NDJSON。
- fake service 以 2xx 全量 accepted 时 queue 清理或不入队。
- fake service 对单事件返回 negative ack 或 `rejected=1` 时，原始 payload 完整入队并在恢复后回放；不实现批量请求的逐项确认。
- network/timeout 后业务 response 与原行为一致。
- retry queue 保存 exact payload string。
- 恢复 URL 后 bounded replay 送达，trace、span、ts 不变。
- duplicate replay 不产生新的事件对象或新的业务 trace。
- fake service 收到的事件没有 raw report/card/arguments/path/Feishu IDs/token/key；有 actor 的 Feishu selected workflow 事件必须存在稳定 pseudonymized `user_id`。

7. 做静态 payload leak review，逐项 grep 或测试断言以下禁止项不会出现在发送 body：`product_id`、`confirmationKey`、`recipient`、`token`、`Authorization`、完整 `arguments`、完整 card、Markdown body、文件路径和 full error。

### 退出标准

只有新增测试、相关回归、build、payload leak review 和 local fake service acceptance 全部通过，才算本计划结束。不得把真实 service、rental、Daily Mission、standalone CLI 或生产输出验证加入同一出口。

## Final Verification Matrix

| 验证面 | 目标 | 证据 | 失败处理 |
|---|---|---|---|
| Contract | canonical events、statuses、allowlist 精确 | audit config/event tests | 修正契约，不扩大兼容别名 |
| Redaction | 禁止字段、摘要、用户触发事件必填 pseudonymized `user_id`、entity | event/domain mapper/context tests | 阻断发送，不截断绕过 |
| Local durability | raw NDJSON、exact payload、bad line、isolate | storage tests | 保留旧文件和本地证据 |
| Cross process | filesystem lock、atomic compaction、lease | storage concurrency tests | 不依赖内存 Map |
| HTTP | fetch injection、timeout、non-2xx、malformed、negative ack | auditHttp tests | queue 或 isolate |
| Logger | non-blocking start/end/error、bounded flush | auditLogger/shutdown tests | 不改业务结果 |
| Context | dispatcher 到 runtime 到 executor | agentRuntimeAuditContext test | 禁止 global context |
| Executor | exact 11 selected tools、no tool span before execute | executor audit tests | 回退 wrapper，不改 switch 语义 |
| Direct intent | latest/conversion text/card unchanged | Daily Audit test and existing tools test | 不 reroute 业务分支 |
| Read/query | bounded summary、stable report entity | Daily Audit test | 不发送 report body |
| Delivery | resend/push structural result | Daily Audit and push tests | 不解析用户 text |
| Confirmation | initial wait、confirmed resume、cancel failed | confirmation tests | 不改 key/payload |
| Historical callback | sidecar 缺失仍合法 | SDK/HTTP tests | 新 callback trace |
| Shutdown | bounded and idempotent flush | shutdown tests | 不改变 exit semantics |
| Regression | existing behavior | focused Vitest commands | 只修本次引入回归 |
| Build | TypeScript compile | `npm run build` | 修正类型或停止并报告 blocker |
| Fake service | ingest/replay/trace contract | local fake service acceptance | 不进入真实服务 |

## Atomic Commit Boundaries

建议使用多个 plain-Chinese atomic commits。每个实现提交必须同时包含其直接测试，不能先提交无测试实现，也不能创建一个包含所有入口和部署调整的巨型提交。以下是建议边界，不代表本计划执行 commit：

1. `冻结审计契约与日报工具白名单`
   - 范围：Task 1 的 contract tests、types/config/event 基础。
   - 直接测试：`auditConfig.test.ts`、`auditEvent.test.ts`。
2. `增加审计本地原始存储与重试队列`
   - 范围：Task 3 storage、必要的 file lock。
   - 直接测试：`auditStorage.test.ts`。
3. `增加审计 HTTP 投递与失败回放`
   - 范围：Task 4 `http.ts`、`auditLogger.ts`。
   - 直接测试：`auditHttp.test.ts`、`auditLogger.test.ts`。
4. `接入显式审计上下文与中央日报工具`
   - 范围：Task 5、Task 6 runtime context 和 executor wrapper。
   - 直接测试：`agentRuntimeAuditContext.test.ts`、`agentToolExecutorAudit.test.ts`。
5. `接入日报直达查询与投递结果审计`
   - 范围：Task 7、Task 8 direct path、domain mapper、resend/push metadata。
   - 直接测试：`feishuBotDailyAudit.test.ts`。
6. `持久化日报确认恢复与取消审计`
   - 范围：Task 9 sidecar、server、SDK callback。
   - 直接测试：`auditConfirmationContext.test.ts`、`feishuBotDailyAudit.test.ts` 和既有 card tests。
7. `增加 Bot 有界收尾与 PM2 超时配置`
   - 范围：Task 10 shutdown、CLI wiring、ecosystem config。
   - 直接测试：`auditShutdown.test.ts`。
8. `完成日报审计本地 fake 服务验收`
   - 范围：Task 11 acceptance fixture、payload review test、必要的文档说明。
   - 直接测试：local fake service acceptance 和全部 focused regression。

每次提交后先运行直接测试，再运行受影响回归，最后在 Task 11 运行 build。不要提交 secrets、`.env`、生产输出、真实 trace 或真实服务配置。

## Non Goals

- 不接入 rental 工具、`rental.bulkPriceApply`、vendor daemon 或 vendor 产物。
- 不接入 Daily Mission、decision journal、Daily Mission CLI 或 daemon。
- 不给所有 publicTraffic 工具埋点，只覆盖精确 allowlist。
- 不给 standalone `public-traffic-report`、`daily-report`、`rebuild-latest` CLI 增加集中式审计。
- 不替换 `recordOperationEvent`、operation ledger、report context、report files、Feishu cards 或领域 audit。
- 不把 audit service 变成授权、审批、确认或执行控制器。
- 不修改 `AgentToolConfirmRequest`、confirmationKey、clarification keys 或 executable card payload。
- 不发送完整请求、响应、card、Markdown、XLSX、HTML、截图、路径、hash、Feishu ID、recipient ID、token 或 full error。
- 不实现 batch HTTP ingest、外部服务认证、Dashboard 认证或跨机器部署。
- 不启动真实 audit service，不访问真实 `/health`、`/v1/ingest`、`/query`，不运行真实 report crawl，不发送 Feishu 消息。
- 不执行 PM2，不重启服务，不合并分支，不 push。
- 不把本阶段的 local fake service 验证描述为生产或真实服务验证。

## Estimate

整体规划估算约 **6 至 8 人日**，仅为 non-binding planning estimate，不是承诺或保证。粗略分配如下：

| 工作包 | 估算 |
|---|---:|
| 契约、配置、事件和脱敏 | 0.5 至 1 人日 |
| NDJSON、锁、队列、隔离和回放 | 1.5 至 2 人日 |
| HTTP、logger、flush | 0.75 至 1 人日 |
| context、central executor 和 direct path | 1 至 1.5 人日 |
| delivery mapper 和 confirmation sidecar | 1 至 1.5 人日 |
| shutdown、回归、build、fake service | 1 至 1.5 人日 |

实际耗时会受 runtime wrapper 复杂度、现有测试 fixture、Windows 文件锁行为和 fake service fixture 质量影响。该估算不包含真实服务部署、网络边界配置、生产监控或 rental work。

## Implementation Handoff Checklist

下一 coding session 开始前：

- [ ] 确认 worktree、branch、base 与 Baseline 表一致。
- [ ] 重读 `AGENT.md`、`docs/worktree-governance.md`、外部 guide 和 assessment。
- [ ] 确认没有读取 `.env`、生产输出或真实服务。
- [ ] 确认本计划是唯一新增文档目标，不编辑其他文档。
- [ ] 先执行 Task 1 RED，保存失败原因。
- [ ] 固化 canonical event、status 和精确 11 项 allowlist。
- [ ] 明确 local-only URL 语义和持久目录。
- [ ] 明确 raw payload 只序列化一次，retry 保存 exact string。
- [ ] 明确 filesystem lock、atomic compaction、bad-line tolerance 和 replay lease 测试策略。
- [ ] 明确 `AuditContext` 只通过参数传播，不使用 global mutable context。
- [ ] 明确 direct latest/conversion wrapper 不改变 text/card。
- [ ] 明确 runReport/refreshDashboard 的 initial wait、confirmed resume、cancel failed 序列。
- [ ] 明确 sidecar 不含 executable arguments，历史 callback 无 sidecar 仍合法。
- [ ] 明确 resend/push 使用 structural metadata，不解析用户 text。
- [ ] 明确不覆盖 rental、Daily Mission、standalone CLI 和 all-publicTraffic。

实现结束前：

- [ ] 每个任务都有 RED 和 GREEN 证据。
- [ ] 计划新增测试仍被准确描述为新增测试，未冒充既有测试。
- [ ] 现有 regression files 已按范围运行，且未修复无关失败。
- [ ] `npm run build` 通过，未声称本计划期间已提前运行。
- [ ] payload leak review 通过。
- [ ] local fake audit service acceptance 通过。
- [ ] 没有启动真实 audit service、PM2 或业务 crawler。
- [ ] 没有发送 Feishu message，没有读取 production output。
- [ ] 最终报告明确指出验证止于 local fake service。
- [ ] 只有完成本矩阵后才结束本计划，不继续扩展到 rental 或真实服务。
