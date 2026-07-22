# Audit Logger Integration 开发评估（2026-07-21）

## 1. 文档目的与状态

本文是 MT-agent 审计日志服务接入的开发评估和下一 session 交接文档，供后续编码 session 直接据此排定优先级、拆分实现和验收。

基线如下：

| 项目 | 基线 |
|---|---|
| Worktree | `C:\works\MT-agent\.worktrees\audit-log-integration` |
| Branch | `codex/audit-log-integration` |
| Base | `master @ 1f8a487` |
| 文档日期 | 2026-07-21 |
| 当前状态 | 仅完成评估，集成尚未实现 |

本文件只描述事实、建议和交接步骤。当前没有新增 `src/audit` 代码，没有新增审计传输，没有启动审计服务，也没有改变现有业务链路。

本评估必须与以下材料一起阅读：

- 接入契约原文：`C:\Users\lhw\Downloads\agent-audit-log-integration-guide.md`
- 项目开发和安全约束：`C:\works\MT-agent\.worktrees\audit-log-integration\AGENT.md`
- Worktree、分支、提交和外部副作用治理：`C:\works\MT-agent\.worktrees\audit-log-integration\docs\worktree-governance.md`
- 运行时历史审计参考：`docs/agent-runtime-refactor-development-audit-2026-07-02.md`
- 业务工具查询交接写作参考：`docs/业务流程工具查询模块开发进度.md`
- 交付说明写作参考：`docs/delivery/goods-manager-new-products-v2.md`

## 2. 评估范围与方法

### 2.1 范围

本次评估覆盖：

1. 通用 audit logger 模块和 canonical event 契约。
2. 本地 NDJSON 原始证据、重试队列、精确回放和跨进程安全。
3. Agent 请求、工具执行、确认、澄清、Daily Mission 和 CLI 的上下文传播。
4. PM2 常驻 Bot、SDK 长连接、HTTP callback 和一次性 CLI 的生命周期收尾。
5. 现有业务审计产物与新的集中式审计服务之间的边界。
6. 单事件 HTTP ingest、部分拒绝、查询和受控真实服务验收。

### 2.2 方法

评估以当前 worktree 的源码、现有测试文件名、`AGENT.md`、治理文档和外部接入指南为依据。重点采用以下方法：

- 先区分已存在的实现与建议新增的实现。
- 沿请求入口、dispatcher、runtime、工具执行器和卡片回调追踪上下文。
- 检查现有持久化实现是否适合复用，特别是锁、原子写和重写语义。
- 只把已用 Glob 核实存在的测试文件列为现有测试。
- 不读取 `.env`，不运行服务，不访问真实 `/health`、`/v1/ingest`、`/query`，不执行真实业务操作。

## 3. 执行结论

建议接入，但不建议直接在所有业务点大面积埋点。应先完成一个独立的 `src/audit` 核心模块，再以中央 `executeAgentToolRequest` 为第一条工具执行覆盖线，随后扩展到直接意图、SDK/HTTP 卡片动作、Daily Mission、高风险步骤和 CLI。

推荐的核心原则是：

1. 每条事件只构造一次 canonical 对象，并只序列化一次原始字符串。
2. 先把原始字符串追加到本地 NDJSON，再后台发送完全相同的字符串。
3. 远程发送失败、超时、非 2xx 或部分拒绝，只影响审计送达状态，不改变业务结果。
4. 重试和回放保留原始 `ts`、`trace_id`、`span_id`、事件名和业务字段，不重新生成事件。
5. Windows 多进程安全不能依赖内存 Map，必须采用文件锁、锁超时处理和原子写或追加策略。
6. `AuditContext` 必须是显式类型，不能从自然语言、确认卡展示文案或不可信历史文本反推安全身份。
7. 现有确认安全边界原样保留。审计上下文只能作为旁路元数据，不能改变 `AgentToolConfirmRequest`、`confirmationKey`、澄清 key 或卡片可执行 payload。

规划估算如下，均为 planning estimates，不是承诺或保证：

| 目标 | 估算 |
|---|---:|
| 技术核心 MVP | 4 至 6 人日 |
| Bot 范围，含确认和澄清 | 6 至 8 人日 |
| 生产全覆盖 | 9 至 14 人日 |

## 4. 当前可复用基础设施与缺失能力

### 4.1 已确认可复用的基础设施

| 位置和符号 | 已确认事实 | 接入时的用法 |
|---|---|---|
| `src/agentRuntime/operationLedger.ts` 的 `recordOperationEvent` | 已有 operation ledger、JSONL 和 journal 读写，且会处理 JSONL 坏行 | 只能借鉴事件归因字段和读取习惯，不直接作为 canonical audit transport |
| `src/linkRegistry/persistence.ts` 的 `mutateJsonFileSerialized` | 已有进程内串行队列、跨进程目录锁、陈旧锁清理和 `writeJsonAtomic` | 推荐复用其模式，必要时抽出通用文件锁模块 |
| `src/observability/runtimeLogger.ts` 的 `formatRuntimeLog`、`summarizeError`、`textPreview` | 已有文本压缩、token 类字段脱敏和错误摘要 | 作为脱敏规则参考，不把普通 runtime log 当审计事件 |
| `src/agentRuntime/types.ts` 的 `AgentRequest` | 已有 `source`、`actor`、`channel`、`metadata` 字段 | 作为请求入口的上下文来源，补充显式 trace 传播而不是隐式全局变量 |
| `src/feishuBot/dispatcher.ts` 的 `toAgentRequest` | 已有 Feishu actor、chat、messageId、transport 元数据 | 作为 Feishu AuditContext 的输入 |
| `src/feishuBot/agentToolExecutor.ts` 的 `executeAgentToolRequest` | 目前是中央工具执行引擎，覆盖大量 planner 和 direct tool 路径 | 第一阶段在此建立统一工具 start/end/error 包装 |
| `src/agentRuntime/approvalCard.ts` | `AgentToolConfirmRequest`、`confirmationKey`、展示层中文名称和纯展示 `displayElements` 已有明确边界 | 只能旁路保存审计关联，不修改既有请求结构和可执行 payload |
| `src/feishuBot/agentToolConfirmStore.ts` | 已有确认请求 ref 的本地持久化与重新校验 | 可建立审计事件与 requestRef 的关联，但不能绕过原有 key 校验 |
| `src/feishuBot/clarificationStore.ts` | 已有澄清上下文、候选工具、澄清 key 和持久化 | 可记录澄清摘要和结果，不把澄清文本直接变成执行参数 |
| `src/feishuBot/server.ts` | 已有 HTTP callback、卡片 action、确认、澄清和 Daily Mission 处理 | 覆盖 HTTP 入口时传入原始请求上下文 |
| `src/feishuBot/sdkClient.ts` | 已有 SDK 长连接消息和卡片 action 处理 | 与 HTTP 路径并列覆盖，不能只改生产默认的 SDK 入口而遗漏 callback |
| `src/cli/feishuBotSdk.ts` | 生产 Bot 的一次启动入口，调用 `bot.start()` 并启动监控 | 需要在启动和进程退出收尾处接入 flush |
| `ecosystem.config.cjs` | PM2 运行 `mt-feishu-bot`，cwd 是项目根，日志写入 `output` | 审计目录必须是独立可持久目录，不能依赖 PM2 普通日志替代 |

### 4.2 `recordOperationEvent` 的明确限制

`src/agentRuntime/operationLedger.ts` 的 `recordOperationEvent` 不适合作为 canonical audit transport，原因是：

- 它会读取 JSONL、全局 ledger journal 和 daily journal，再用 `unionOperationEvents` 合并。
- 它会重写整份 JSONL 和 JSON journal，而不是保存一次不可变的原始 payload。
- 它的 `ledgerLocks` 是单进程内的 `Map<string, Promise<void>>`，不能保护多个 Windows 进程同时写同一个文件。
- JSONL、全局 JSON 和 daily JSON 的多份写入仍不是一个跨进程事务。
- 它的事件模型属于 MT-agent operation ledger，不能直接替代外部服务要求的 `agent_id`、`trace_id`、`span_id`、canonical `event`、canonical `status` 和 `result_summary`。

因此，operation ledger 仍然是既有业务复盘和执行归因来源，新的集中式审计事件必须拥有独立的 canonical transport 和本地原始日志。

### 4.3 可复用的持久化模式

`src/linkRegistry/persistence.ts` 提供了更适合的基础模式：

- `mkdir(lockPath)` 作为跨进程互斥信号。
- 对 `EEXIST` 进行等待和重试。
- 通过 `mtimeMs` 清理超过 `staleLockMs` 的锁。
- 用临时文件写入后 `rename`，形成原子 JSON 替换。
- 进程内 `fileQueues` 减少同一进程的竞争。

可以建议抽出通用 file lock，但这是推荐方向，不是当前已存在的通用模块，也不是本次文档声称已完成的能力。NDJSON 追加和 retry queue 仍需单独设计锁粒度、恢复和损坏处理。

### 4.4 上下文传播缺口

`src/feishuBot/dispatcher.ts` 的 `toAgentRequest` 已经取得：

- `message.senderOpenId` 作为 actor id。
- `message.chatId` 和 `message.chatType` 作为 channel。
- `message.messageId` 和 transport 作为 metadata。

但 `src/agentRuntime/runtime.ts` 当前的 `handle(request)` 只执行 `resolveIntent(request.text)`，随后调用 `handleIntent(intent, config.outputDir)`。`handleIntent` 没有接收 `request`，所以 actor、channel、messageId、source 等上下文没有继续传播到 `handleIntent` 或工具执行器。

建议通过显式类型参数传递 `AuditContext`，不要把请求上下文放入可变全局状态，也不要把它拼入确认卡的可执行 value。

## 5. 推荐目标架构

### 5.1 模块边界

建议新增以下模块，名称和职责如下：

| 建议文件 | 主要职责 |
|---|---|
| `src/audit/types.ts` | `AuditContext`、canonical event、发送结果、retry item、flush 结果等显式类型 |
| `src/audit/config.ts` | ingest URL、超时、目录、重试开关、批次上限、agent id 的配置读取和校验 |
| `src/audit/event.ts` | 事件构造、字段规范化、状态映射、摘要限制、敏感字段拒绝或脱敏 |
| `src/audit/storage.ts` | 原始 NDJSON、retry queue、隔离失败项、文件锁、原子写和读取 |
| `src/audit/http.ts` | 单事件 POST、超时、Content-Type、HTTP 响应解析、`accepted/rejected/errors` 逐条处理 |
| `src/audit/auditLogger.ts` | 对外的 `start`、`end`、`error`、`record`、`flush` 和有限回放协调器 |
| `src/audit/domainMapper.ts` | 只把 allowlisted 的 domain audit artifact 映射为短摘要事件，不复制完整业务产物 |

可选新增一个通用 file lock 文件，例如 `src/storage/fileLock.ts`，但应先确认是否已有同类抽象，避免为了审计做无必要重构。

### 5.2 事件生命周期

```text
显式 AuditContext
  -> 构造 canonical event
  -> 校验并序列化一次
  -> 追加本地 audit-YYYY-MM-DD.jsonl
  -> 后台 POST 完全相同的原始字符串
  -> 解析 accepted/rejected/errors
  -> 未确认事件进入 retry queue 或隔离区
  -> 下一事件前或生命周期收尾时有限 flush/replay
```

业务调用不等待远程审计结果。推荐顺序是：

```text
tool.start 本地落盘并后台发送
  -> 执行业务工具
  -> tool.end 或 tool.error 本地落盘并后台发送
```

进程退出、批处理结束和一次性 CLI 收尾时，可以在有界时间内调用 `flush()`。flush 失败不得覆盖业务成功、失败、取消或澄清结果。

### 5.3 Canonical event 建议

最小字段必须与接入指南一致：

| 字段 | 要求 |
|---|---|
| `ts` | 创建时生成一次，重试不得改变 |
| `agent_id` | 稳定生产者标识，不能含路径片段 |
| `trace_id` | 一次用户请求或自治任务全链路复用 |
| `span_id` | 一次工具调用的 start 与 end/error 复用 |
| `event` | 使用 `tool.start`、`tool.end`、`tool.error` 等 canonical 名称 |
| `tool_name` | 稳定工具名，不放自然语言和随机值 |
| `status` | 使用全大写 canonical gRPC code |
| `result_summary` | 已脱敏短摘要，最多 200 字符 |

可选字段按需使用 `parent_span_id`、`duration_ms`、`channel`、脱敏 `user_id`、`entity`、脱敏 `llm_intent`、`error.message` 和稳定 `tags`。

禁止发送 API key、Cookie、Token、Authorization、密码、完整请求体、完整响应体、HTML、截图原文和未经脱敏的个人信息。不要把 `product_id` 作为顶层字段，应使用符合契约的 `entity`。

### 5.4 AuditContext 设计

建议最小结构包含：

```ts
interface AuditContext {
  traceId: string;
  source: 'feishu' | 'cli' | 'api' | 'agent' | 'scheduler';
  actorId?: string;
  channelId?: string;
  channelType?: 'direct' | 'group' | 'unknown';
  messageId?: string;
  parentSpanId?: string;
  requestRef?: string;
  clarificationRef?: string;
  runId?: string;
  decisionId?: string;
}
```

这是目标设计示意，不代表当前类型已经存在。实际字段应由 `src/audit/types.ts` 固化，并通过参数显式传递。

确认和澄清边界必须保持：

- 不修改 `AgentToolConfirmRequest` 的字段和结构。
- 不修改 `confirmationKey` 计算输入或校验逻辑。
- 不修改 clarification key 的计算输入或校验逻辑。
- 不把 trace、actor、requestRef 或 clarificationRef 塞入卡片 executable payload，除非既有协议本身已经有受校验的旁路字段。
- 可以把审计上下文写入非执行 confirmation/clarification envelope 或 sidecar，用于回调恢复和审计关联。
- 卡片展示文案、LLM reason 和历史学习 hints 不是安全上下文来源。

### 5.5 业务域产物边界

链接档案 audit、rental audit、Daily Mission journal、operation ledger 和各类执行产物仍是各自领域的事实来源。它们不能被描述为集中式 audit service integration。

集中式 audit logger 只允许发送 allowlisted 摘要，例如工具名、状态、实体稳定 ID、确认状态和结果类别。不要把完整 xlsx、Markdown、HTML、页面响应或业务原始文件复制到审计服务。

`vendor/rental-price-agent` 保持未来独立 producer 范围。本次 MT-agent 接入不修改 vendor 代码，不把 vendor 内部事件假设为 MT-agent 已接入。

## 6. 开发难度与工作量评估

| 工作包 | 难度 | 主要原因 | 规划估算 |
|---|---|---|---:|
| 契约和配置冻结 | 中 | 要统一 agent id、URL、状态、目录和脱敏边界 | 0.5 至 1 人日 |
| Canonical event 和 AuditContext | 中高 | 需要同时满足 trace、span、状态和安全边界 | 0.5 至 1 人日 |
| 本地 NDJSON、retry、Windows 锁 | 高 | 需要跨进程、崩溃恢复、精确 payload 和有界回放 | 1.5 至 2.5 人日 |
| HTTP ingest 和部分拒绝 | 中高 | 202 不等于全量接受，必须逐条解析错误索引 | 0.5 至 1 人日 |
| 中央工具包装 | 中高 | 需覆盖 success、throw、card/waiting_user 和 continuation；等待确认或澄清不得产生 tool span | 1 至 1.5 人日 |
| Bot 确认与澄清关联 | 高 | 不能破坏既有 payload、key、HTTP/SDK 对称性 | 1 至 2 人日 |
| Daily Mission 和 CLI 生命周期 | 高 | 涉及 run、decision、resume、flush 和一次性进程退出 | 1 至 2 人日 |
| 领域摘要和监控 | 中 | 需避免把业务 artifact 当集中式事实源 | 1 至 2 人日 |
| 受控真实服务验收 | 中高 | 需要服务端、网络边界、故障注入和查询复核 | 0.5 至 1 人日 |

综合估算见执行结论中的 4 至 6、6 至 8、9 至 14 人日区间。区间会受现有 runtime 改造深度、审计服务可用性和测试夹具质量影响。

## 7. P0、P1、P2 优先级

### 7.1 P0，广泛埋点前必须解决

1. **契约和配置冻结**
   - 固化 agent id、canonical 事件名、canonical 状态码、摘要长度和禁止字段。
   - 固化 ingest URL、超时、本地目录、retry 开关和批次上限。
   - URL 为空时只关闭远程发送，本地原始日志仍保留。
2. **持久本地存储和重试**
   - 先写本地 NDJSON，再远程发送。
   - 保存原始序列化字符串或等效 byte-exact payload。
   - 处理网络错误、超时、非 2xx、部分拒绝、坏行、隔离和有限 replay。
   - Windows 多进程使用文件锁或 spool，不依赖只在单进程有效的内存锁。
3. **AuditContext 和安全保持**
   - 显式传递 source、actor、channel、message、trace、span、requestRef 和 run/decision 关联。
   - confirmation/clarification 只通过非执行 envelope 或 sidecar 关联，绝不改变既有安全 key 和 executable payload。
4. **中央 wrapper 不改变业务结果**
   - 包装 `executeAgentToolRequest`，只在工具真实开始执行后记录成对的 `tool.start` 与 `tool.end`/`tool.error`。
   - 工具尚未执行、正在等待确认或澄清时使用 `run.waiting_user` 等 canonical run 事件表达，不新增未定义的 `tool.pending` 事件。
   - 审计异常只能进入日志和告警，不能改变业务工具返回结果。

### 7.2 P1，核心 MVP 后补齐

- direct intent 和 CLI 覆盖。
- SDK 长连接与 HTTP callback 对称覆盖。
- confirmation、clarification、continuation 和 Daily Mission 生命周期。
- PM2 常驻进程 flush、one-shot CLI bounded flush。
- domain artifact allowlist 和摘要映射。
- 队列长度、最早待发送时间、失败率、磁盘空间和最后 flush 状态监控。
- 受控部署方式、私网边界和审计服务配置协作。

### 7.3 P2，稳定后优化

- 批量 POST 和批量 retry 的性能优化，前提是保留逐条 accepted/rejected 语义。
- 更丰富的指标、span 层级和运行面板字段。
- 独立的 `vendor/rental-price-agent` producer 接入。
- 更细的领域映射、采样和低风险事件降噪。

## 8. 分阶段实施计划

### Phase 0，冻结契约和边界

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/audit/types.ts`、`src/audit/config.ts`、必要时 `.env.example`、相关 docs |
| 工作内容 | 固化 agent id、字段、事件名、状态映射、URL、超时、目录、retry 策略、脱敏规则 |
| 依赖 | 接入指南、`AGENT.md`、worktree governance、安全评审 |
| 估算 | 0.5 至 1 人日 |
| 退出标准 | 类型契约和配置表评审通过，明确何时只本地记录、何时远程发送 |

### Phase 1，本地可靠核心

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/audit/event.ts`、`src/audit/storage.ts`、`src/audit/http.ts`、`src/audit/auditLogger.ts` |
| 工作内容 | canonical event、一次序列化、本地 NDJSON、retry queue、隔离区、跨进程锁、原子写、有限 flush/replay |
| 依赖 | Phase 0；可参考 `src/linkRegistry/persistence.ts` |
| 估算 | 1.5 至 2.5 人日 |
| 退出标准 | 成功、网络失败、超时、非 2xx、部分拒绝和重复 replay 的定向测试全部通过；业务调用不等待远程结果 |

### Phase 2，中央工具执行 MVP

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/feishuBot/agentToolExecutor.ts`、`src/agentRuntime/runtime.ts`、`src/agentRuntime/types.ts`、`src/audit/domainMapper.ts` |
| 工作内容 | 在 `executeAgentToolRequest` 周围记录真实执行的 start/end/error，传播显式 AuditContext；确认卡或澄清卡返回时记录 `run.waiting_user`，不提前产生未闭合的 tool span |
| 依赖 | Phase 1；确认 `AgentToolExecutionOptions` 和 continuation 传递点 |
| 估算 | 1 至 1.5 人日 |
| 退出标准 | 只读成功和工具异常产生正确的成对 tool 事件；确认卡、澄清和业务拒绝不伪造工具已执行，业务 response 保持一致 |

### Phase 3，Bot 入口和安全关联

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/feishuBot/dispatcher.ts`、`src/feishuBot/tools.ts`、`src/feishuBot/server.ts`、`src/feishuBot/sdkClient.ts`、`src/feishuBot/agentToolConfirmStore.ts`、`src/feishuBot/clarificationStore.ts` |
| 工作内容 | SDK/HTTP 双路径传递 actor、channel、message、trace；确认和澄清使用 envelope 或 sidecar 关联；覆盖取消、拒绝和 continuation |
| 依赖 | Phase 2；不得修改既有 key 和执行 payload |
| 估算 | 1 至 2 人日 |
| 退出标准 | 同一请求 trace 可串联 direct intent、planner、确认、澄清和最终工具事件；SDK 与 HTTP 行为一致 |

### Phase 4，Daily Mission、CLI 和生命周期

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/agentRuntime/dailyMission*` 相关实现、`src/cli/feishuBotSdk.ts`、其他已选 CLI、`ecosystem.config.cjs` 仅在需要配置时 |
| 工作内容 | run/decision attribution、等待用户、恢复、拒绝、执行结果、PM2 flush、one-shot CLI bounded flush |
| 依赖 | Phase 3；先明确 Daily Mission 现有审批状态和历史审计缺口 |
| 估算 | 1 至 2 人日 |
| 退出标准 | 重启和历史回调不丢 trace；CLI 退出有界等待；flush 失败不改写业务退出语义 |

### Phase 5，领域映射和生产验收

| 项目 | 计划 |
|---|---|
| 可能文件 | `src/audit/domainMapper.ts`、监控或部署文档、必要的配置样例 |
| 工作内容 | 只映射 allowlisted domain audit summaries，补监控、服务端 agent displayName 和工具 allowlist 协作，执行受控真实服务验收 |
| 依赖 | Phase 1 至 4 全部完成，审计服务可在受控网络提供 |
| 估算 | 1 至 2 人日 |
| 退出标准 | `/health`、ingest、`/query`、失败回放和重复查询均有实证记录，且没有读取或提交 secrets |

## 9. MVP 与完整指南的边界

### 9.1 技术核心 MVP

MVP 应包含：

- `src/audit` 独立模块。
- canonical event 和显式 AuditContext。
- 本地 NDJSON first。
- identical original string POST。
- 单事件 POST first，不先引入批量复杂度。
- 解析 `accepted`、`rejected`、`errors`。
- durable exact-payload retry/replay。
- Windows 跨进程安全锁或 spool。
- 中央 `executeAgentToolRequest` 的 start/end/error 覆盖，以及等待确认/澄清时的 canonical `run.waiting_user` 表达。
- 单元测试和本地 fake fetch，不需要真实服务。

MVP 不应声称已完成 Bot 全覆盖、Daily Mission 全覆盖、生产部署或真实服务查询。

### 9.2 Bot 范围

Bot 范围在 MVP 核心之上增加：

- `dispatcher.ts` 的 Feishu actor/channel/message metadata。
- `runtime.ts` 到 `handleIntent` 的显式上下文传递。
- direct intents。
- SDK 长连接消息和卡片 action。
- HTTP callback 消息和卡片 action。
- confirmation、clarification、cancel、resume 和 continuation。
- `agentToolConfirmStore.ts` 与 `clarificationStore.ts` 的 sidecar 关联。

### 9.3 完整指南范围

完整指南范围还包括：

- `agent.start`、`agent.end`、`agent.error`。
- run.start、run.resume、run.waiting_user、run.final_result、run.failed。
- Daily Mission 的 decision、approval、execution、journal 和 audit 关联。
- 所有相关 CLI 的生命周期 flush。
- PM2 生产运行下的目录、监控和故障恢复。
- 领域摘要映射。
- 受控真实服务 `/health`、`/v1/ingest`、`/query`、回放和端到端 trace 验收。

## 10. 测试与验证矩阵

下面区分当前已存在的测试与计划新增测试。计划新增的测试文件不能在实现前被描述为已存在。

### 10.1 现有测试，可作为回归入口

以下文件名已在当前 worktree 中核实存在：

| 关注面 | 现有测试文件 |
|---|---|
| operation ledger | `tests/operationLedger.test.ts`、`tests/operationLedgerAttribution.test.ts`、`tests/operationLedgerBadLine.test.ts` |
| agent tool executor | `tests/agentToolExecutorLedger.test.ts`、`tests/agentToolExecutorLedgerCoverage.test.ts`、`tests/agentToolExecutorPublicTraffic.test.ts` |
| tool continuation | `tests/agentToolContinuation.test.ts` |
| confirmation store | `tests/agentToolConfirmStore.test.ts` |
| Feishu dispatcher | `tests/feishuBotDispatcher.test.ts` |
| Feishu tools and intent | `tests/feishuBotTools.test.ts`、`tests/feishuBotIntent.test.ts` |
| HTTP Bot | `tests/feishuBotServer.test.ts` |
| SDK Bot | `tests/feishuBotSdkClient.test.ts`、`tests/feishuBotSdkCardAction.test.ts` |
| Daily Mission | `tests/dailyMissionApprovalCallback.test.ts`、`tests/dailyMissionApprovalCallbackGuard.test.ts`、`tests/dailyMissionExecution.test.ts`、`tests/dailyMissionExecutionIntegration.test.ts`、`tests/dailyMissionIdempotency.test.ts`、`tests/dailyMissionAudit.test.ts`、`tests/dailyMissionAuditSummary.test.ts` |

这些测试只能证明其当前已有领域行为，不证明新的 audit logger 已实现。

### 10.2 计划新增测试，文件名可在实现时调整

| 测试主题 | 计划覆盖 |
|---|---|
| `tests/auditEvent.test.ts` | canonical 字段、状态映射、摘要长度、禁止字段和一次序列化 |
| `tests/auditStorage.test.ts` | NDJSON 追加、retry queue、坏行、隔离和原始 payload 保持 |
| `tests/auditHttp.test.ts` | 2xx、非 2xx、超时、网络错误、202 部分拒绝和 `errors[].index` |
| `tests/auditLogger.test.ts` | start/end/error、后台发送、flush、有限 replay 和业务结果不变 |
| `tests/auditFileLock.test.ts` | 同进程并发、跨进程锁、陈旧锁和原子替换 |
| `tests/agentRuntimeAuditContext.test.ts` | request 到 handleIntent 的上下文显式传播 |
| `tests/feishuBotAuditContext.test.ts` | SDK/HTTP actor、channel、message、trace 和 sidecar 关联 |
| `tests/agentToolExecutorAudit.test.ts` | 中央 wrapper 的成功、异常、card、clarification，以及未执行工具不得产生未闭合 span |
| `tests/auditCliFlush.test.ts` | one-shot CLI 有界 flush 和失败不改退出语义 |

### 10.3 验证层级

| 层级 | 验证目标 | 当前状态 |
|---|---|---|
| 静态类型 | `src/audit` 与调用点类型一致 | 尚未运行，待实现后验证 |
| 单元测试 | event、storage、HTTP response、retry 和 flush | 尚未新增，待实现后验证 |
| 定向回归 | dispatcher、executor、确认、澄清、Daily Mission | 现有文件可回归，尚无新的审计断言 |
| 构建 | TypeScript build | 本评估未运行 |
| 本地 fake service | 不依赖真实服务验证 ingest response 和 replay | 待实现 |
| 真实受控服务 | health、ingest、query、回放和 trace 链路 | 未来工作，未执行 |

## 11. 受控真实服务验收

真实服务验收必须在实现、定向测试和构建通过后，由有权限的 session 在受控环境执行。本文没有执行以下任何动作：启动服务、请求 `/health`、POST `/v1/ingest`、GET `/query`、故障注入、运行真实 Bot 或访问生产输出。

建议顺序：

1. 由服务端运维确认审计服务监听地址、数据库可写和网络边界。
2. 同机优先使用 `http://127.0.0.1:9320/v1/ingest`。
3. 跨主机只使用受控私网、反向代理认证、VPN、mTLS 或等效边界，不能直接暴露公网。
4. 使用一个临时 trace id 发送最小 `tool.end` 事件。
5. 必须检查响应中的 `accepted === 1`、`rejected === 0` 和空 errors，而不能只看 HTTP 202。
6. 使用同一 trace id 查询 `/query?trace_id=...`，确认事件可见。
7. 让真实 Agent 执行一次无业务副作用或已获准的最小工具调用，确认同一 trace 下有成对 start/end 或 start/error。
8. 临时指向不可达 URL，执行不影响真实业务的调用，确认本地 NDJSON 和 retry queue 均有原始事件，业务结果不变。
9. 恢复 URL，触发有限 replay 或收尾 flush，再通过 `/query` 确认原始 trace 被接收且无重复语义问题。
10. 记录 agent id、部署方式、日志目录、retry 策略、验证 trace id、工具 allowlist 和未配置的网络认证项。

服务端 Dashboard 认证不等于 ingest 认证，不能用 Dashboard Token 代替网络隔离。真实验收前不得读取或打印 `.env`、API key、Cookie、token、浏览器 profile 或生产输出。

## 12. Worktree、分支与原子提交计划

本任务已经位于专用 worktree 和分支，不应在 `master` 直接开发。后续 session 应继续遵守 `docs/worktree-governance.md`：不跨 worktree 搬运未确认现场，不重启 PM2，不 push，不在未获明确指令时合并。

建议拆成以下原子提交，每个实现提交都必须配套直接测试，不能创建一个包含所有入口和部署调整的巨型提交：

| 提交主题 | 代码范围 | 必须配套的直接测试 |
|---|---|---|
| `新增审计事件契约与配置` | `src/audit/types.ts`、`config.ts`、event 基础 | event/config 定向测试 |
| `增加审计本地持久化与重试队列` | storage、file lock、retry queue | storage、lock、replay 测试 |
| `增加审计投递与收尾机制` | HTTP sender、response parser、flush | HTTP response 和 timeout 测试 |
| `接入中央工具审计上下文` | runtime context、executor wrapper | executor audit、runtime context 测试 |
| `持久化飞书确认与澄清审计链路` | dispatcher、server、sdk、confirm/clarification sidecar | HTTP/SDK card action 和 key 保持测试 |
| `补齐 Daily Mission 与 CLI 生命周期审计` | Daily Mission、CLI、PM2 flush 边界 | Daily Mission 和 CLI flush 测试 |
| `增加领域摘要与部署说明` | domainMapper、监控、部署说明 | allowlist、脱敏和验收 fixture 测试 |

每个提交完成后应先跑直接测试，再运行相关回归和 build。文档更新如果只改变评估内容，可以单独提交，避免与源代码提交混淆。

## 13. 风险与非目标

### 13.1 主要风险

- 远程审计服务不可用时，如果业务调用等待 HTTP，会放大用户请求延迟，必须坚持后台发送。
- Windows 多进程同时追加 NDJSON 可能造成交错、丢写或锁死，不能只依赖 `Map` 锁。
- 202 响应可能包含部分拒绝，若只判断状态码会误报送达。
- 重试时重新生成事件会破坏 trace、span 和业务时间线，必须保存原始字符串。
- 在确认卡 payload 中加入审计字段可能改变 key 或扩大客户端可篡改面。
- `runtime.ts` 当前不传播 request context，直接在底层读取全局消息会导致 CLI、SDK、HTTP 行为不一致。
- operation ledger、链接 audit、rental audit 与集中式 audit service 若混为一谈，会造成事实源和查询语义冲突。
- PM2 自动重启和 one-shot CLI 退出时可能丢掉尚未完成的后台发送，需要 bounded flush 和本地持久证据。

### 13.2 非目标

- 不修改 `AgentToolConfirmRequest`、`confirmationKey`、clarification key 或现有确认安全边界。
- 不把审计服务作为业务授权、审批或执行控制器。
- 不把审计服务不可用转换成业务失败，除非未来另有明确产品决策。
- 不替换 operation ledger、link registry audit、rental audit 或 Daily Mission domain artifacts。
- 不把完整请求、响应、HTML、截图、Markdown、xlsx 或秘密发送到集中式服务。
- 不在本次范围修改 `vendor/rental-price-agent`。
- 不在本次评估中启动服务、访问真实生产、修改 `.env`、提交 secrets、运行有外部副作用的 CLI。

## 14. 下一 session 接手清单

1. 确认当前 worktree 仍为 `C:\works\MT-agent\.worktrees\audit-log-integration`，分支仍为 `codex/audit-log-integration`，基线仍按任务记录为 `master @ 1f8a487`。
2. 重读 `AGENT.md` 和 `docs/worktree-governance.md`，特别是 secrets、PM2、worktree 和外部副作用规则。
3. 重读 `C:\Users\lhw\Downloads\agent-audit-log-integration-guide.md` 的事件、HTTP、回放和验收章节。
4. 先建立或更新 P0 设计，冻结 agent id、目录、URL、超时、状态和脱敏规则。
5. 检查 `src/linkRegistry/persistence.ts` 是否足以支持审计 storage，决定是否提出通用 file-lock 抽取，不能直接声称已有抽象。
6. 新建 `src/audit/types.ts`、`config.ts`、`event.ts`、`storage.ts`、`http.ts`、`auditLogger.ts`，保持模块独立。
7. 先写 event、storage、HTTP response 和 retry 的直接测试，再接入业务调用点。
8. 在 `src/agentRuntime/runtime.ts` 和 `src/feishuBot/dispatcher.ts` 之间建立显式 AuditContext 传播，不使用全局变量。
9. 在 `src/feishuBot/agentToolExecutor.ts` 的 `executeAgentToolRequest` 周围接入真实工具执行的 `tool.start` 与 `tool.end`/`tool.error`；确认卡或澄清卡返回只记录 `run.waiting_user`，并确认 response 和异常语义不变。
10. 对照 `src/feishuBot/server.ts` 与 `src/feishuBot/sdkClient.ts`，逐一覆盖 SDK 和 HTTP 的消息、确认、取消、澄清和 continuation。
11. 核对 `src/agentRuntime/approvalCard.ts`、`agentToolConfirmStore.ts`、`clarificationStore.ts`，确保审计 trace 只进入非执行 envelope 或 sidecar。
12. 单独评估 Daily Mission 的 run、decision、approval、execution、journal 和历史查询，不把已有 operation ledger 当作集中式接入完成。
13. 为 `src/cli/feishuBotSdk.ts` 和一次性 CLI 设计 bounded flush，确认 PM2 长连接退出和正常重启的行为。
14. 先跑现有相关测试文件，再跑新增直接测试和 `npm run build`。本评估没有替后续 session 执行这些验证。
15. 只在本地 fake service 验证通过后，申请受控真实服务验收。真实验收需要明确权限、网络边界和不影响业务的测试工具。
16. 按原子提交计划提交，每个实现提交必须包含直接测试，不创建巨型 commit。
17. 合并、PM2 重启、push 和生产发布都必须等待明确指令。

## 15. 最终建议

建议批准该接入方向，但按 P0、P1、P2 分阶段推进。第一开发目标不是“把每个模块都加一条日志”，而是建立可靠、可恢复、不会改变业务结果的 `src/audit` 技术核心。只有本地原始证据、精确回放、跨进程安全、canonical 契约和显式安全上下文稳定后，才扩大到 Bot、Daily Mission、CLI 和领域摘要。

在完成 P0 和定向测试前，不建议广泛 instrumentation，不建议宣称生产可追溯，也不建议启动真实服务联调。完成技术核心 MVP 后，可按 Bot 范围和生产全覆盖估算继续推进。真实 `/health`、ingest、`/query`、失败回放和端到端 trace 查询均属于未来验收工作，本评估未执行。
