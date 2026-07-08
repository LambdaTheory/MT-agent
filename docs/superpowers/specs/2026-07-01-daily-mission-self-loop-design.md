# Daily Mission 自循环（Plan 模式）开发设计

## 背景

Phase 1（分支 `ulw/agent-runtime-refactor`）已落地并通过审查：

- 6 个 rental 只读 daemon 工具（daemonStatus / platformSearch / platformSearchAll / batchRead / specDiscoverFull / readRaw）。
- executor 拆分为 read-only / write 两个 handler。
- Operation Ledger（JSON store + append-only JSONL）、Daily Journal、DailyMissionRun 状态机、OperationPlan 类型的**骨架和持久化**已就绪并有测试。

但这些台账类型目前是"活的骨架，无生产者"：没有任何真实操作写入 Ledger，没有编排把状态机跑起来，DecisionRecord 契约尚未定义。

本阶段目标：**把骨架激活成一个能自循环空跑的每日流程**，覆盖用户梳理的 7 步：了解数据 → 梳理近期操作 → 拉取时间节点 → 分析操作流程 → 操作商品/链接 → 获取审批 → 记录今日操作。

## 终态愿景：运营数据飞轮

MT-agent 的最终形态是一个**自主运营商品板块的数据飞轮**，而不仅仅是"每天跑一遍脚本"：

```text
真实市场价格 / 曝光 / 销售 / 热点
        ↓ 感知（Collectors）
   CollectedContext
        ↓ 判断（Decision Agent）
   DecisionRecord[]
        ↓ 操作（改价 / 上下链接）
   写操作执行
        ↓ 结果反馈（曝光/销售变化）
   后续数据
        ↓ 沉淀（Ledger / Journal）
   历史决策 + 成败
        ↓ 回边：历史效果喂回判断
   下一轮判断更准 ── 飞轮闭合
```

飞轮的关键是**最后那条回边**：今天的操作影响明天的数据，明天的数据让后天的判断更准。数据越转越多，决策质量越转越高。

本阶段（self-loop 第一圈）只负责把 **感知 → 判断 → 操作 → 沉淀** 四段在人工审批闸门下接通；飞轮回边（历史效果反哺决策）和真实市场价接入是后续阶段。但为了让飞轮将来能转起来，本阶段必须提前埋好下面这些约束，否则实现完会缺归因锚点、返工代价大。

### 飞轮回边的数据锚点要求（本阶段必须满足）

1. **操作必须可归因。** 每个 Ledger 事件必须携带 `subject`（商品/同款组/链接标识）、`decisionId`、`runId`、`at`。将来才能回答"这个决策操作之后，该 subject 的曝光/销售变了吗"。缺了 `subject`/`decisionId` 就无法把操作和后续结果关联，飞轮回边就断了。
2. **决策必须留证据引用。** `DecisionRecord.evidenceRefs` 必须指向 `CollectedContext` 里的具体数据，而非自由文本。将来复盘"上次为什么这么判断"要靠它。
3. **数据源可插拔，接口先于数据。** Collector 层是飞轮的数据入口。真实市场价格数据未来通过新增 `MarketPriceCollector` 塞进 `CollectedContext` 即可，与热点 API 是同一个扩展位——**接口不变，数据源可替换**。本阶段 `CollectedContext` 结构必须为将来新增数据源预留（用可选字段 + `missingSources` 标记，不写死字段全集）。
4. **决策记忆预留入口。** DecisionBuilder 本阶段是 single-shot（只读当天 context）。飞轮成熟后它需要读"历史决策的成败"。本阶段不实现，但 `DecisionBuilder.build` 的输入签名要允许将来注入历史效果切片（通过 context 扩展，不改契约主体）。

### 自主权的边界原则（贯穿所有阶段）

飞轮转得越自主，越要守住安全边界。终态是"自主完成商品板块运营"，但**"自主决策" ≠ "自主执行高风险写操作"**：

```text
低风险、可逆、已被历史验证的操作 → 后续可数据驱动地放开自动执行
高风险、大范围、不可逆的操作      → 永远保留人工审批闸门
```

放开自动执行的依据应是**飞轮自己积累的成败统计**，而不是一次性全自动。本阶段所有写操作一律走人工审批，不做任何自动执行放开。

## 目标

交付一个可用固定指令触发的 Daily Mission，能自动完成：

```text
collect（收集数据 + 近期操作 + 热点）
  → plan（生成结构化决策）
  → approval（汇总审批卡）
  → [人工点确认]
  → execute（复用现有写操作链路）
  → journal（写台账和复盘）
```

同时提供一个只读审计/报表查询入口。

## 非目标（本阶段明确不做）

- 不做无人值守的高风险写操作。**执行必须人工点审批**；自动化只跑到"生成审批卡"为止。
- 不接入真实热点 API（用文件 provider 占位；API adapter 后续阶段）。
- 不把决策 agent 做成多轮自主 tool-calling loop（本阶段是单次结构化调用）。
- 不重写现有 planner；planner 继续服务旧的飞书自然语言命令。

## 核心安全边界（继承自既有系统，不得削弱）

- 写操作仍全部走现有确认卡 + confirmationKey + apply→submit→readback 验真 + 审计/回滚。
- 循环驱动是确定性状态机（Orchestrator），不是自由 agent。
- LLM 只产出候选决策；本地代码做 schema 校验、风险分类、工具参数复核。
- 每个写操作带 `runId + decisionId` 幂等键，避免重复执行。

---

## 架构

```text
Scheduler / CLI 指令
      ↓
DailyMissionOrchestrator（确定性状态机）
      ↓
Collectors（确定性）
  - ExposureCollector      读曝光/公域数据
  - SalesCollector         读订单/销售
  - RecentOperationsCollector  读 Operation Ledger 近 3-7 天
  - HotspotCollector       读 HotspotEventProvider
      ↓ collected-context.json
DecisionBuilder（唯一的智能点，单次结构化 LLM 调用）
  - 输入：collected context
  - 输出：DecisionRecord[]（schema 校验）
      ↓ decisions.json
DecisionPolicy（确定性）
  - 风险分类
  - 工具参数复核
  - observe / approve_to_execute / skip 分流
      ↓ approval-request.json
ApprovalSummaryCard（飞书）
      ↓ [人工确认]
ExecutionHarness
  - 复用现有 rental 写工具
  - 每步写 Ledger 事件
      ↓ execution-results.json
JournalWriter
  - daily-journal.json / daily-journal.md
```

---

## 组件设计

### 1. Ledger 生产者（先做，激活台账）

在现有写操作执行路径接入事件记录，事件类型：

```text
decision_created
approval_requested
approval_accepted
approval_rejected
execution_started
execution_succeeded
execution_failed
journal_written
```

接入点：`executeRentalWriteOperationHandler`、priceApply、delist、specRemove 等执行成功/失败处，调用已有的 `appendOperationLedgerJsonlEntry` 和 `appendOperationPlanJournalEntry`。

要点：

- 只追加，不改执行逻辑，不改确认边界。
- 事件带 `runId?`（手动单操作时可为空）、`decisionId?`、`toolName`、`subject`、`at`。
- 这是"记录今日操作"（步骤7）和"梳理近期操作"（步骤2a）的共同数据源。

### 2. HotspotEventProvider（接口 + 文件实现）

```ts
interface HotspotEvent {
  eventId: string;
  source: 'manual' | 'feishu' | 'api';
  title: string;
  startsAt: string;
  endsAt?: string;
  city?: string;
  venue?: string;
  affectedCategories: string[];
  heatScore?: number;
  confidence: 'low' | 'medium' | 'high';
  rawRef?: string;
}

interface HotspotEventProvider {
  listEvents(input: { date: string; lookaheadDays: number }): Promise<HotspotEvent[]>;
}
```

本阶段实现 `FileHotspotEventProvider`（读 `config/hotspot-events.json` 或 `output/daily-mission/<date>/hotspot-events.json`）。未来 `ApiHotspotEventProvider` 替换实现，`HotspotEvent` 结构不变。API 不可用时降级为"无热点上下文"，不阻断流程。

### 3. Collectors（确定性）

每个 collector 只读、无副作用，输出结构化片段，汇总成 `collected-context.json`：

```ts
interface CollectedContext {
  runId: string;
  date: string;
  exposure: ExposureSummary;        // 复用 publicTraffic 聚合
  sales: SalesSummary;              // 复用 orderAnalysis / closedOrderFeedback
  recentOperations: OperationPlanJournalEntry[];  // 读 Ledger 近 3-7 天
  hotspots: HotspotEvent[];
  collectedAt: string;
  missingSources: string[];         // 记录哪些数据源缺失，不静默
}
```

要点：任一数据源失败只标记 `missingSources`，不抛断整个 run。

### 4. DecisionRecord 契约（先定死，agent 后插）

```ts
type DecisionRecommendation = 'observe' | 'approve_to_execute' | 'skip';
type DecisionRisk = 'read' | 'write' | 'high';

interface DecisionSubject {
  kind: 'product' | 'sameSkuGroup' | 'link';
  id: string;
  displayName?: string;
}

interface DecisionRecord {
  decisionId: string;
  runId: string;
  title: string;
  subjects: DecisionSubject[];
  operationType: 'price_up' | 'price_down' | 'new_link' | 'delist' | 'observe';
  recommendation: DecisionRecommendation;
  risk: DecisionRisk;
  rationale: string[];
  evidenceRefs: string[];           // 指向 collected-context 的字段/数据
  proposedTool?: {
    toolName: string;
    arguments: Record<string, unknown>;
  };
  uncertainties: string[];
  blockedReason?: string;
}
```

这个契约是 agent 与 harness 的唯一边界。agent 实现可替换，契约不变。

### 5. DecisionBuilder（单次结构化 LLM 调用）

- 复用现有 `LlmProvider` 抽象（`src/llm/provider.ts`），**不引入新的 agent 框架、不绑定具体厂商**。
- 输入 `CollectedContext`，prompt 要求输出 `DecisionRecord[]`。
- 强制 JSON schema；解析失败或字段不合法则该条决策降级为 `observe` 并记 `uncertainties`，绝不静默执行错误动作。
- 提供一个**确定性回退实现** `RuleBasedDecisionBuilder`：无 LLM 或 LLM 不可用时，用简单规则（如"曝光骤降且库存充足→建议观察"）产出决策，保证循环在没有 LLM 时也能空跑。

```ts
interface DecisionBuilder {
  build(context: CollectedContext): Promise<DecisionRecord[]>;
}
```

### 6. DecisionPolicy（确定性复核）

- 校验 `proposedTool.arguments` 是否合法、是否越权。
- 高风险动作强制 `requiresApproval`。
- 证据不足（`uncertainties` 非空或 `evidenceRefs` 为空）的执行项降级为观察项。
- 输出分组：观察项（只展示）/ 可审批执行项。

### 7. ApprovalSummaryCard

- 复用现有确认卡体系。
- 按风险分组展示：观察项、中风险写操作（可分项审批）、高风险（单项审批，保留既有确认卡边界）。
- 审批结果写 Ledger（`approval_accepted` / `approval_rejected`），不把飞书卡片状态当唯一记录。

### 8. DailyMissionOrchestrator（确定性状态机）

用已有的 `DailyMissionRun` 串联，推进 status：

```text
collecting → planning → waiting_approval → executing → completed
                                   ↘ failed / cancelled
```

- 每步产出对应产物文件（`dailyMissionArtifactPath`）并 `addDailyMissionArtifact`。
- 每步写 Ledger 事件。
- 失败时写失败 Journal，记录停在哪一步和可恢复入口。
- 本阶段 `--mode=plan`：跑到 `waiting_approval` 就停，执行由人工审批回调触发（复用现有 continuation 机制）。

### 9. JournalWriter

从 Ledger + decisions + execution-results 生成：

- `daily-journal.json`（机器可读）
- `daily-journal.md`（人可读）：今天看了哪些数据、参考了哪些热点、提了哪些建议、批/拒/跳过、实际执行了什么、明天继续观察什么。

### 10. 触发与实时查询

- CLI 指令：`dailyMission.run --date=YYYY-MM-DD --mode=plan`（可被固定指令/定时器调用）。
- Scheduler：复用现有 daemon 模式或 PM2/外部 cron，每天固定时间触发 plan。本阶段可先只做 CLI + 手动触发，cron 作为可选。
- 实时审计入口：一个只读飞书指令/CLI，查询某日的 Ledger 和 Journal（`dailyMission.audit --date=YYYY-MM-DD`），返回当日决策、审批、执行摘要。

---

## 存储布局

```text
output/daily-mission/YYYY-MM-DD/
  mission-run.json
  collected-context.json
  hotspot-events.json
  decisions.json
  approval-request.json
  execution-results.json
  daily-journal.json
  daily-journal.md

output/operation-ledger/
  YYYY-MM-DD.jsonl        # append-only 事实来源
```

（这些路径 Phase 1 的 `dailyMissionArtifacts.ts` 已定义，直接复用。）

---

## 数据流（一次完整 plan run）

```text
1. Orchestrator 创建 DailyMissionRun(runId, date, status=collecting)
2. Collectors 并行读数据 → collected-context.json；写 data_collected 事件
3. status → planning；DecisionBuilder(context) → DecisionRecord[]；写 decision_created 事件
4. DecisionPolicy 复核分组 → approval-request.json
5. status → waiting_approval；发 ApprovalSummaryCard；写 approval_requested 事件
6. [人工审批] 回调 → approved decisions
7. status → executing；对每个 approved decision 调现有写工具；每步写 execution_* 事件
8. status → completed；JournalWriter 写 journal；写 journal_written 事件
```

无审批时不执行任何写操作（停在第 5 步）。

---

## 分步实施顺序（依赖顺序）

```text
Step 1  Ledger 生产者接入现有写操作            —— 激活台账，最低风险
Step 2  HotspotEventProvider 接口 + File 实现
Step 3  Collectors（exposure / sales / recentOps / hotspot）
Step 4  DecisionRecord 契约 + DecisionPolicy
Step 5  RuleBasedDecisionBuilder（确定性回退，先让循环能空跑）
Step 6  DailyMissionOrchestrator（串起 collect→plan→approval，plan 模式）
Step 7  ApprovalSummaryCard + 审批回调接入 execute
Step 8  JournalWriter
Step 9  dailyMission.run / dailyMission.audit CLI 指令
Step 10 LlmDecisionBuilder（把智能点插进 Step 5 的槽）
Step 11 （可选）Scheduler 定时触发
```

要点：Step 1-9 全是 harness，跑完就有一个"用规则决策的自循环空跑版本"。Step 10 才把真正的决策 agent 插进去。agent 是最后一块拼图。

---

## 测试策略

- Ledger append 测试：追加、读取、按日期过滤、坏行跳过。
- Collectors 测试：数据源缺失时标记 missingSources 而不抛断。
- HotspotProvider 测试：文件源、空源、缺失降级。
- DecisionPolicy 测试：高风险强制审批、证据不足降级为观察、非法工具参数拒绝。
- DecisionBuilder schema 测试：LLM 输出不合法时降级为 observe，绝不生成执行请求。
- Orchestrator 状态机测试：collect→plan→waiting_approval 成功路径；任一步失败写失败 journal；无审批不执行写操作。
- 集成测试：用 RuleBasedDecisionBuilder 模拟一整天 plan run，断言产物齐全、无写操作被自动执行。

---

## 验收标准

- 可用一条 CLI 指令跑通一次 Daily Mission plan run，生成 mission-run / collected-context / decisions / approval-request / journal 全套产物。
- 没有人工审批时，不执行任何写操作。
- 现有高风险确认卡边界保持不变。
- 每个真实写操作在 Ledger 留有 execution_* 事件。
- 第二天的 RecentOperationsCollector 能读到前一天的 Ledger 事件。
- 热点 API 未接入时，流程仍能完成，只标记热点上下文缺失。
- 决策 agent（LlmDecisionBuilder）可被 RuleBasedDecisionBuilder 无缝替换，契约不变。

---

## 关于决策 agent 的实现决定（记录在案）

- 步骤 3 是"先收集后分析"的单次结构化调用，不是多轮 tool-calling agent，因此**不包现成 agent 框架**。
- 复用现有 `LlmProvider` 抽象，强制 DecisionRecord schema，本地做校验/风险/参数复核。
- 通过 DecisionRecord 契约保持 agent 可插拔：未来若需要"边分析边拉数据"，可升级为调用 Phase 1 只读工具的 tool-use agent，契约不变。
- 先实现 RuleBasedDecisionBuilder 保证循环在无 LLM 时也能空跑，再插 LlmDecisionBuilder。
