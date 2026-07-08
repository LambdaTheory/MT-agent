# Agent Brain 阶段实施计划（补齐所有可写代码的进度）

> **执行说明：** 逐任务 checkbox。本计划覆盖当前所有"不依赖真实数据/外部接口、纯靠写代码就能补上"的进度。**不含 M4 自主治理**（依赖累积数据 + 需人工设计护栏），也不含市场价/热点等外部数据接入（等你提供）。

**Goal:** 补齐飞轮记账闭环、把决策/交互从"一次性规划"升级为"探索型 agentic loop"、补齐支撑复杂指令的只读数据工具、搭好飞轮回边(M3)的成绩单与决策读历史骨架。

**Architecture:** 全程在 master 之上增量。agentic loop 复用现有 `LlmProvider.generateJson`（OpenAI 兼容），做多轮"调只读工具→看结果→再决策"，写操作仍走确认卡；决策契约仍是 `DecisionRecord`，agent 只在这个槽里。写操作归因统一进 `operationLedger`。

**Tech Stack:** TypeScript (ESM, `.js` 后缀), vitest。复用 LlmProvider、operationLedger、DecisionRecord、rental 只读工具、toolRegistry、agentToolExecutor。

## Global Constraints

- 所有 import 用 `.js` 后缀。
- **写操作永远走确认卡 + 验真 + ledger 归因**；agentic loop 只在**只读工具**上自主探索，绝不自主执行写操作。
- loop 有硬上限（最大迭代数、最大 token），防失控。
- LLM 只产结构化输出（工具选择 / DecisionRecord）；非法输出降级为观察/终止，不执行。
- 每个写事件带 `runId?/decisionId?/subject/at`。
- 接线勘察为阻塞前置：标注"grep 定位/以实际为准"的步骤先读真实代码，签名不符以真实为准。
- 测试：`npx vitest run <file> --exclude '**/.worktrees/**'`；类型检查 `npx tsc -p tsconfig.json --noEmit` exit 0。
- 测试用 `FakeLlmProvider`，不调真实 LLM/daemon。

## 现有接口（已核验）

- `LlmProvider.generateJson({ messages: {role,content}[], temperature?, maxTokens? }): Promise<{ text, json: Record<string,unknown>, model? }>`（`src/llm/provider.js`）；`FakeLlmProvider`（`src/llm/fakeProvider.js`）。
- `recordOperationEvent(outputDir, entry)`、`OperationPlanJournalEntry{ planId, at, event, runId?, decisionId?, toolName?, subject?, metadata? }`（`operationLedger.js`）。
- `RentalWriteLedgerContext { outputDir: string; runId?: string; decisionId?: string }`（`rentalWriteOperationHandlers.js`）——已是 `AgentToolExecutionOptions.ledgerContext` 的类型。
- 原子写 handler：`rentalPerSpecPriceApplyResponse(args, client, ledgerContext?)`、`rentalSpecDimApplyResponse(args, client, ledgerContext?)`（当前把 executionEvent 塞 metadata）。
- 只读工具：`rental.daemonStatus/platformSearch/platformSearchAll/batchRead/specDiscoverFull/readRaw`、`publicTraffic.reportQuery`、`product.query`、`linkRegistry.resolveProducts` 等（toolRegistry，`plannerVisible!==false`、`risk:'read'`）。
- `listAgentTools()` / `findAgentTool(name)` / `listPlannerVisibleTools()`（`toolRegistry.js`）。
- `OutcomeRecord`、`attributeOutcomes(outputDir, missionDate, lookaheadDays)`、`dailyMissionArtifactPath(outputDir,date,'outcomes')`（`outcomeAttribution.js`）。
- `CollectedContext`（可选 `trackRecord?` 待加）、`ContextCollector`（`dailyMissionContext.js`）。
- `DecisionBuilder`、`RuleBasedDecisionBuilder`、`LlmDecisionBuilder`（`decisionBuilder.js`）。

---

# 里程碑 L：飞轮记账闭环（原子写工具接入真实 ledger）

原子化的 perSpecPrice/specDim apply 目前把 executionEvent 塞进 metadata（当时 off master 无 ledger）。现在 master 有 ledger 了，让它们像 flywheel 的写 handler 一样记真实 `execution_*` 事件。

### Task L-1: 原子写工具记真实 ledger 事件

**Files:**
- Modify: `src/feishuBot/rentalPerSpecPriceHandlers.ts`、`src/feishuBot/rentalSpecDimHandlers.ts`
- Test: `tests/rentalAtomizationLedger.test.ts`

**Interfaces:**
- Consumes: `recordOperationEvent`、`RentalWriteLedgerContext`。
- Produces: `rentalPerSpecPriceApplyResponse` / `rentalSpecDimApplyResponse` 在有 `ledgerContext.outputDir` 时，执行前后写 `execution_started` / `execution_succeeded` / `execution_failed` 到 ledger（带 runId/decisionId/subject），而非仅塞 metadata。无 outputDir 时行为不变（保留 metadata 兜底）。

- [ ] **Step 1: 勘察现有写 handler 的记账方式（阻塞前置）**

Run: `grep -n "recordWriteEvent\|recordOperationEvent\|execution_started" src/feishuBot/rentalWriteOperationHandlers.ts`
复用其 `recordWriteEvent` 模式（同一套事件名 + 归因字段），保持与 flywheel 写路径一致，勿另造。

- [ ] **Step 2: 写失败测试**

Create `tests/rentalAtomizationLedger.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rentalPerSpecPriceApplyResponse } from '../src/feishuBot/rentalPerSpecPriceHandlers.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function client(): RentalPriceSkillClient {
  return { applyPerSpec: async () => ({ productId: '648', ok: true, lines: ['done'] }) } as unknown as RentalPriceSkillClient;
}

describe('atomization write ledger', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-atled-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records execution events with attribution when ledgerContext has outputDir', async () => {
    await rentalPerSpecPriceApplyResponse(
      { productId: '648', specFields: { '3863': { rent1day: '80.00' } } },
      client(),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    );
    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date)).filter((e) => e.decisionId === 'dec-1').map((e) => e.event);
    expect(events).toContain('execution_started');
    expect(events).toContain('execution_succeeded');
  });
});
```

- [ ] **Step 3: 运行确认失败** → **Step 4: 实现**（在两个 apply handler 中，当 `ledgerContext?.outputDir` 存在时调 `recordOperationEvent` 记 started/succeeded/failed，subject 用 `{kind:'product', id:productId}`；try/catch 记 failed）→ **Step 5: 通过 + 回归 `rentalPerSpecPrice`/`rentalSpecDim`/`rentalAtomizationIntegration`** → **Step 6: Commit** `git commit -m "原子写工具接入真实 ledger 归因事件"`。

---

# 里程碑 A：探索型 Agent Loop（核心：让复杂自然语言指令自主完成）

把决策/交互从"一次性规划"升级为迭代 loop：LLM 拿指令 + 只读工具清单 → 调一个只读工具 → 看结果 → 决定继续查还是给结论/决策。**只读探索放开，写操作仍走确认卡。**

### Task A-1: AgentExploreLoop 内核（纯函数，可测）

**Files:**
- Create: `src/agentRuntime/agentExploreLoop.ts`
- Test: `tests/agentExploreLoop.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ExploreTool { name: string; description: string; run(args: Record<string, unknown>): Promise<unknown>; }
  interface ExploreResult { steps: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>; answer: string; decisions?: DecisionRecord[]; stopReason: 'answered' | 'max_steps' | 'invalid'; }
  runAgentExploreLoop(input: { provider: LlmProvider; instruction: string; tools: ExploreTool[]; maxSteps?: number }): Promise<ExploreResult>;
  ```
- 每轮：把"指令 + 可用工具 + 已执行步骤及结果"喂给 `provider.generateJson`，要求返回 `{ action: 'call_tool', tool, args }` 或 `{ action: 'finish', answer, decisions? }`。call_tool → 执行该只读工具、把结果加入 steps、继续；finish → 返回；超过 `maxSteps`（默认 6）→ stopReason='max_steps' 强制结束；LLM 返回非法 action → stopReason='invalid' 结束。**loop 内只允许 ExploreTool（调用方只传只读工具），不碰写操作。**

- [ ] **Step 1: 写失败测试**

Create `tests/agentExploreLoop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAgentExploreLoop, type ExploreTool } from '../src/agentRuntime/agentExploreLoop.js';
import type { LlmProvider, LlmGenerateJsonInput, LlmProviderResult } from '../src/llm/provider.js';

class ScriptedProvider implements LlmProvider {
  private i = 0;
  constructor(private readonly scripts: string[]) {}
  async generateJson(_input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const text = this.scripts[Math.min(this.i++, this.scripts.length - 1)];
    return { text, json: JSON.parse(text), model: 'fake' };
  }
}

const tools: ExploreTool[] = [
  { name: 'read', description: '读商品', run: async (a) => ({ productId: a.productId, exposure: 100 }) },
];

describe('runAgentExploreLoop', () => {
  it('calls a tool then finishes with an answer', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: '648' } }),
      JSON.stringify({ action: 'finish', answer: '648 曝光 100' }),
    ]);
    const result = await runAgentExploreLoop({ provider, instruction: '查648曝光', tools });
    expect(result.stopReason).toBe('answered');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe('read');
    expect(result.answer).toContain('100');
  });

  it('stops at maxSteps if the model never finishes', async () => {
    const provider = new ScriptedProvider([JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: '648' } })]);
    const result = await runAgentExploreLoop({ provider, instruction: 'loop', tools, maxSteps: 3 });
    expect(result.stopReason).toBe('max_steps');
    expect(result.steps.length).toBe(3);
  });

  it('stops as invalid when the model requests an unknown tool', async () => {
    const provider = new ScriptedProvider([JSON.stringify({ action: 'call_tool', tool: 'nope', args: {} })]);
    const result = await runAgentExploreLoop({ provider, instruction: 'x', tools });
    expect(result.stopReason).toBe('invalid');
  });
});
```

- [ ] **Step 2: 运行确认失败** → **Step 3: 实现 `agentExploreLoop.ts`**（system prompt 说明可用工具 + 输出协议；循环调 generateJson、解析 action、执行工具、累积 steps；未知工具/非法 JSON → invalid；到 maxSteps → 强制 finish）→ **Step 4: 通过** → **Step 5: Commit** `git commit -m "新增 AgentExploreLoop 迭代探索内核"`。

### Task A-2: 只读工具适配为 ExploreTool

**Files:**
- Create: `src/agentRuntime/exploreToolset.ts`
- Test: `tests/exploreToolset.test.ts`

**Interfaces:**
- Produces: `buildReadOnlyExploreTools(outputDir, options): ExploreTool[]`——把注册表里 `risk:'read' && plannerVisible!==false` 的工具包成 ExploreTool，每个 `run` 通过 `executeAgentToolRequest` 调用（只读，无副作用），返回其 `metadata`/文本摘要。**只纳入只读工具**；写工具一律不入 explore 集。

- [ ] **Step 1: 写失败测试**（断言 buildReadOnlyExploreTools 只含 read 工具、不含 rental.delist/priceApply 等写工具）→ **Step 2-5**: 失败 → 实现（`listAgentTools().filter(t => t.risk==='read' && t.plannerVisible!==false)` 映射；run 调 executeAgentToolRequest）→ 通过 → Commit `git commit -m "只读工具适配为 explore 工具集"`。

### Task A-3: 飞书入口接入探索 loop（新指令，不改旧 planner）

**Files:**
- Modify: 飞书 intent 分发（先 `grep -rn "agentPlannerResponse\|handleBotIntent" src/feishuBot/tools.ts`）
- Create: `src/feishuBot/agentExploreResponse.ts`
- Test: `tests/agentExploreResponse.test.ts`

**Interfaces:**
- Produces: `agentExploreResponse(instruction, outputDir, options): Promise<BotResponse>`——建只读 explore 工具集 + provider（`resolveLlmProviderFromEnv`），跑 `runAgentExploreLoop`，把 answer + 步骤摘要组成回复；若 loop 产出 `decisions`（DecisionRecord[]），经 `classifyDecisions` → 对可执行项发确认卡（复用现有审批链路，**不自动执行**）。
- 接入方式：新增触发（如"探索/分析 <指令>"或作为 planner unknown 分支的可选增强），**保留现有 planner 路径不动**，新旧并存。

- [ ] **Step 1: 勘察 planner 分发入口（阻塞前置）** → **Step 2: 写失败测试**（FakeLlm 脚本化：调只读工具→finish；断言回复含结果、无写操作执行）→ **Step 3-5**: 实现 + 接入触发 + 通过 → **Step 6: 回归** `feishuBotTools`/`feishuBotServer` → Commit `git commit -m "飞书接入探索型 agent loop（只读自主、写走确认）"`。

---

# 里程碑 D：支撑复杂指令的只读数据工具

补两个之前复杂场景暴露的数据层只读缺口（属 MT-agent 数据层，非 rental skill），让 explore loop 能查到。

### Task D-1: `product.rankByCategory`（同品类按指标排名）

**Files:** Create `src/agentData/categoryRanking.ts`；Modify `toolRegistry.ts`（追加只读工具）、`agentToolExecutor.ts`（dispatch）；Test `tests/categoryRanking.test.ts`。

**Interfaces:**
- `rankProductsByCategory(context, { category?, metric, periodDays, limit })`——从 report context / 销售数据按品类聚合、按指标（销量/金额/曝光）排序返回 topN。
- 工具 `product.rankByCategory`（risk:'read'），dispatch 复用现有 read 工具模式。
- **勘察前置**：`grep -n "category\|品类\|categoryOf" src/publicTraffic/types.ts src/agentData/productRanking.ts` 确认品类字段来源；以实际数据模型为准（无显式品类字段则以同款组/名称归类，或标注 limitation）。

- [ ] TDD：失败测试（给定多商品context，按品类+30天销量返回最佳）→ 实现 → 通过 → Commit。

### Task D-2: `publicTraffic.windowedFindings`（跨天窗口筛选发现）

**Files:** Create `src/agentData/windowedFindings.ts`；Modify toolRegistry/executor；Test。

**Interfaces:**
- `findWindowedProducts(outputDir, { lookbackDays, predicate })`——读近 N 天 report context，按谓词（如"有曝光但订单金额=0"）筛选商品，跨天聚合。
- 工具 `publicTraffic.windowedFindings`（risk:'read'）。
- **勘察前置**：`grep -n "findReportContextByDate\|rows" src/feishuBot/reportStore.ts` 确认按日读取与行字段；坏日/缺日跳过不抛断。

- [ ] TDD：失败测试（构造 3 天 report context，筛"有曝光无订单"）→ 实现 → 通过 → Commit。

---

# 里程碑 T：飞轮回边骨架（M3，代码可建，价值待数据）

### Task T-1: TrackRecord 成绩单聚合

**Files:** Create `src/agentRuntime/trackRecord.ts`；Test `tests/trackRecord.test.ts`。

**Interfaces:**
- `TrackRecord { key: string; operationType: string; category?: string; magnitudeBucket?: string; samples: number; positive: number; neutral: number; negative: number; successRate: number }`。
- `buildTrackRecord(outputDir, { sinceDate?, days? }): Promise<TrackRecord[]>`——读历史 `outcomes.json`（多日），按 `operationType[×category×幅度档]` 聚合；append-only 存 `output/track-record.json`。样本量/阈值**不写死**，留给消费方配置。

- [ ] TDD：失败测试（给若干 OutcomeRecord，聚合出正确 successRate）→ 实现 → 通过 → Commit `git commit -m "新增 TrackRecord 成绩单聚合"`。

### Task T-2: 决策读历史（DecisionBuilder 记忆入口）

**Files:** Modify `dailyMissionContext.ts`（`CollectedContext` 加 `trackRecord?: TrackRecord[]`）、`decisionBuilder.ts`（grounding 增加历史成败摘要）；Create collector `trackRecordCollector`；Test。

**Interfaces:**
- `createTrackRecordCollector(outputDir): ContextCollector`——把 `buildTrackRecord` 结果塞 `CollectedContext.trackRecord`。
- `LlmDecisionBuilder` grounding 增加"同类操作历史成功率"提示；`RuleBasedDecisionBuilder` 可基于成功率调整 recommendation（可选）。
- **契约不变**（仍产 DecisionRecord），只是输入多"历史效果"。

- [ ] TDD：失败测试（context 带 trackRecord 时，LLM prompt 含历史摘要）→ 实现 → 通过 → Commit `git commit -m "决策器读飞轮历史成败（M3 记忆入口）"`。

---

# 里程碑 Z：集成回归

### Task Z-1: 端到端 + 全量

- [ ] 集成测试：explore loop 用只读工具组合完成一个"查曝光→查库存→给观察建议"的指令（FakeLlm 脚本化），断言只读、无写执行、产出决策经确认卡。
- [ ] 全量 `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'` 全绿；`npx tsc --noEmit` exit 0；`npm run build` 通过。
- [ ] Commit `git commit -m "agent brain 阶段集成回归"`。

---

## 明确不在本计划内
- **M4 数据驱动自主治理**：依赖累积成败数据 + 需人工设计护栏，不靠写代码补，留待数据充分后专项。
- **真实市场价 JSON / 热点 API**：外部输入，等提供（collector/provider 插槽已就绪）。
- **让 explore loop 自主执行写操作**：永不做，写操作恒走确认卡。

## 依赖顺序
```text
L（记账收尾，独立，先做）
A-1 内核 → A-2 只读工具集 → A-3 飞书接入   （核心，解锁复杂指令自主）
D-1/D-2 只读数据工具（A 之后，喂给 explore loop 更强）
T-1 成绩单 → T-2 决策读历史（依赖 M2 的 outcomes，代码可建）
Z 集成回归（最后）
```

## Self-Review
- **覆盖**：所有"可写代码补上"项——记账闭环(L)、探索型 agent(A)、数据层只读工具(D)、飞轮回边骨架(T)。M4/外部数据明确排除。
- **安全不倒退**：explore loop 只读自主，写走确认卡 + ledger；loop 有 maxSteps 硬上限；非法输出降级不执行。
- **增量**：全程 master 之上追加，新文件为主，改动集中在 toolRegistry/executor 追加区 + 两个原子 handler。
- **勘察前置**：A-3/D-1/D-2 标了 grep 勘察步（planner 分发、品类字段、按日读取），阻塞前置。
- **类型一致**：`ExploreTool`/`ExploreResult`(A-1)→A-2/A-3 一致；`TrackRecord`(T-1)→T-2/CollectedContext 一致；`RentalWriteLedgerContext`(L) 复用现有类型。
