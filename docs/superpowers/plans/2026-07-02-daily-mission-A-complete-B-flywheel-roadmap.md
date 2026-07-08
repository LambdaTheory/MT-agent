# Daily Mission A 层完成 + B 层飞轮 路线图计划

> **执行说明：** 逐任务 checkbox 跟踪。本文分 4 个里程碑。**M1（A 层完成）为近期可执行任务，含完整 TDD 步骤；M2–M4（B 层飞轮）依赖尚不存在的真实市场 JSON 与累积历史数据，给结构化设计（接口/验收/数据模型），实现时先补 TDD。** 这是有意的粒度梯度，不是占位。

**Goal:** 把每日循环（A 层）推进到 100%（除热点 API 等非我方接口卡点），并为运营数据飞轮（B 层）建成数据地基→回边→数据驱动自主治理的完整路径（真实市场价后续以 JSON 提供）。

**Architecture:** A 层补齐"定时触发 + 决策质量 + 执行后闭环 + 持久化一致性 + 数据契约"；B 层沿"感知(市场价)→执行→效果归因→成绩单→决策读历史→数据驱动放开自主"闭合飞轮。全程不改写操作安全 harness，agent 仍只在 DecisionBuilder 槽内、写操作仍走审批+验真+归因。

**Tech Stack:** TypeScript (ESM, `.js` 后缀), vitest；复用 Orchestrator、Ledger、DecisionBuilder、LlmProvider、approval harness。

## Global Constraints

- 所有 import 用 `.js` 后缀。
- 不削弱已验收的 P0 写安全：写操作走审批（或第 4 级的白名单自动审批）+ 验真 + 归因记账。
- agent 只在 DecisionBuilder 槽内产 `DecisionRecord`；驱动/执行/安全始终是确定性 harness。
- 每个事件带 `runId/decisionId/subject/at` 归因锚点。
- **接线勘察为阻塞前置**：标注"grep 定位""以实际为准"的步骤必须先读真实代码，签名不符以真实代码为准。
- 真实市场价、热点 = 外部数据源，以 JSON/API 提供；本计划实现"读 JSON 的 collector + 缺失降级"，不假设字段全集。
- 测试：`npx vitest run <file> --exclude '**/.worktrees/**'`；类型检查：`npx tsc -p tsconfig.json --noEmit`（exit 0）。

## 现有接口（已核验，勿重造）

- `WriteDailyJournalInput = { outputDir, date, runId, context, decisions, classified, failure? }`（`src/agentRuntime/dailyJournalWriter.ts`）。
- `CollectedContext`（`dailyMissionContext.ts`）：`exposure? sales? hotspots? recentOperations? missingSources[]` + `CollectedContextPatch`、`ContextCollector`。
- `loadAllExecutionResults(outputDir, date)`、`DailyMissionExecutionResult{ runId, decisionId, ok, status, text, card? }`（`dailyMissionExecution.ts`）。
- `loadApprovalRequest`、`loadOperationLedgerJsonlEntries`、`recordOperationEvent`。
- `createDecisionBuilder({provider})`、`LlmProvider`（OpenAI 兼容）、`resolveLlmProviderFromEnv`（`decisionBuilderFactory.ts`）。
- Scheduler 参考现有 `src/cli/linkRegistryRefreshDaemon.ts`；CLI 脚本注册在 `package.json`（`daily-mission-run` / `daily-mission-audit`）。

---

# 里程碑 M1：A 层推进到 100%（近期，完整 TDD）

目标：定时自动触发 → 决策质量可评测 → 执行后日报/审计闭环 → 持久化一致 → 数据契约收紧。

---

### Task M1-1: 执行后重写 Journal（P1-8）

**Files:**
- Modify: `src/agentRuntime/dailyJournalWriter.ts`
- Modify: `src/agentRuntime/dailyMissionApprovalCallback.ts`
- Test: `tests/dailyJournalExecution.test.ts`

**Interfaces:**
- `WriteDailyJournalInput` 增加可选 `executionResults?: DailyMissionExecutionResult[]`；markdown 增加"实际执行"段（executed/pending/failed 分组）。
- 审批回调在 `saveDailyMissionRun` 后调用 `writeDailyJournal`（带 `loadAllExecutionResults` 结果），使日报反映真实执行。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyJournalExecution.test.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';

describe('journal with execution results', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-jex-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('renders actual execution section', async () => {
    const { markdownPath } = await writeDailyJournal({
      outputDir: dir, date: '2026-07-02', runId: 'run-1',
      context: { runId: 'run-1', date: '2026-07-02', outputDir: dir, collectedAt: 'x', missingSources: [] },
      decisions: [], classified: { approvals: [], observations: [] },
      executionResults: [{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '已下架 648' }],
    });
    const md = await readFile(markdownPath, 'utf8');
    expect(md).toContain('实际执行');
    expect(md).toContain('dec-1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dailyJournalExecution.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 无 executionResults 字段/执行段。

- [ ] **Step 3: 扩展 writer**

In `dailyJournalWriter.ts`, add `executionResults?: DailyMissionExecutionResult[]` to `WriteDailyJournalInput`（import 类型），并在 `renderMarkdown` 追加：

```ts
  const exec = input.executionResults ?? [];
  const executionLines = exec.length
    ? ['', '## 实际执行', ...exec.map((r) => `- ${r.decisionId} → ${r.status}${r.ok ? '（成功）' : ''}：${r.text}`)]
    : [];
  // 将 executionLines 拼进返回数组
```

json 产物同样加入 `executionResults`。

- [ ] **Step 4: 回调执行后重写日报**

In `dailyMissionApprovalCallback.ts`, after `saveDailyMissionRun(outputDir, advanced)`:

```ts
  const journalResults = await loadAllExecutionResults(outputDir, run.date);
  const approvalForJournal = approval; // 已加载
  await writeDailyJournal({
    outputDir, date: run.date, runId: run.runId,
    context: { runId: run.runId, date: run.date, outputDir, collectedAt: now, missingSources: [] },
    decisions: approvalForJournal.approvals, classified: approvalForJournal,
    executionResults: journalResults.filter((r) => r.runId === run.runId),
  }).catch(() => {});
```

（`writeDailyJournal` import 加到文件顶部。）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/dailyJournalExecution.test.ts tests/dailyMissionApprovalCallbackGuard.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/dailyJournalWriter.ts src/agentRuntime/dailyMissionApprovalCallback.ts tests/dailyJournalExecution.test.ts
git commit -m "执行后重写 Journal 反映实际执行结果"
```

---

### Task M1-2: 决策接地（Grounding）

**Files:**
- Modify: `src/agentRuntime/decisionBuilder.ts`（`LlmDecisionBuilder`）
- Test: `tests/llmDecisionBuilderGrounding.test.ts`

**Interfaces:**
- `LlmDecisionBuilder` 在 system prompt 注入"可用可执行工具清单（仅 plannerVisible!==false）+ 每个工具的字段约束"，让 LLM 只提平台真支持的动作。新增内部 `buildToolCatalogPrompt()` 从 `toolRegistry` 读可见工具生成清单。

- [ ] **Step 1: 写失败测试**

Create `tests/llmDecisionBuilderGrounding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LlmDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';

const ctx: CollectedContext = { runId: 'run-1', date: '2026-07-02', outputDir: '/x', collectedAt: 'x', missingSources: [] };

describe('LlmDecisionBuilder grounding', () => {
  it('injects the visible tool catalog into the prompt', async () => {
    const provider = new FakeLlmProvider('{"decisions":[]}');
    await new LlmDecisionBuilder({ provider }).build(ctx);
    const system = provider.lastInput?.messages.find((m) => m.role === 'system')?.content ?? '';
    expect(system).toContain('rental.pricePreview');
    expect(system).not.toContain('rental.priceApply'); // plannerVisible:false 不入清单
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/llmDecisionBuilderGrounding.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前 prompt 无工具清单。

- [ ] **Step 3: 勘察工具枚举 API（阻塞前置）**

Run: `grep -n "export function.*agentTools\|export const agentTools\|listAgentTools\|export function findAgentTool" src/agentRuntime/toolRegistry.ts`
若无导出的"列出全部工具"函数，新增 `export function listPlannerVisibleTools(): AgentToolDefinition[]`（过滤 `plannerVisible !== false`）。以实际导出为准。

- [ ] **Step 4: 实现 grounding**

In `decisionBuilder.ts`, add catalog builder and inject:

```ts
import { listPlannerVisibleTools } from './toolRegistry.js';

function buildToolCatalogPrompt(): string {
  const tools = listPlannerVisibleTools();
  return ['可用可执行工具（proposedTool.toolName 只能取以下之一）：', ...tools.map((t) => `- ${t.name}: ${t.description}`)].join('\n');
}
```

在 `LlmDecisionBuilder.build` 的 system message 末尾拼接 `buildToolCatalogPrompt()`。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/llmDecisionBuilderGrounding.test.ts tests/llmDecisionBuilder.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/decisionBuilder.ts src/agentRuntime/toolRegistry.ts tests/llmDecisionBuilderGrounding.test.ts
git commit -m "决策器注入可见工具清单接地"
```

---

### Task M1-3: 决策 golden set 评测

**Files:**
- Create: `tests/nl-decision-golden/*.json`（若干 `{ context, expect }` 样例）
- Create: `src/agentRuntime/decisionGolden.ts`（评测跑判器）
- Test: `tests/decisionGolden.test.ts`

**Interfaces:**
- `evaluateDecisionGolden(builder, cases): Promise<{ passed: number; failed: GoldenFailure[] }>`；每个 case 断言"给定 context，产出决策的 operationType/recommendation/subject 命中期望"。用 `FakeLlmProvider`（或 RuleBased）跑，接入 CI 防回归。

- [ ] **Step 1: 写 golden 样例 + 失败测试**

Create `tests/nl-decision-golden/hotspot-observe.json`:

```json
{ "name": "热点临近产出观察", "context": { "runId": "g1", "date": "2026-07-02", "outputDir": "/x", "collectedAt": "x", "missingSources": [], "hotspots": [{ "eventId": "e1", "source": "manual", "title": "演唱会A", "startsAt": "2026-07-04T00:00:00.000Z", "affectedCategories": ["相机"], "confidence": "high" }] }, "expect": { "minDecisions": 1, "recommendation": "observe" } }
```

Create `tests/decisionGolden.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateDecisionGolden } from '../src/agentRuntime/decisionGolden.js';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'nl-decision-golden');

describe('decision golden set', () => {
  it('rule-based builder passes all golden cases', async () => {
    const files = (await readdir(goldenDir)).filter((f) => f.endsWith('.json'));
    const cases = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(goldenDir, f), 'utf8'))));
    const result = await evaluateDecisionGolden(new RuleBasedDecisionBuilder(), cases);
    expect(result.failed).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/decisionGolden.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现跑判器**

Create `src/agentRuntime/decisionGolden.ts`：

```ts
import type { DecisionBuilder } from './decisionBuilder.js';
import type { CollectedContext } from './dailyMissionContext.js';

export interface GoldenCase { name: string; context: CollectedContext; expect: { minDecisions?: number; recommendation?: string; operationType?: string }; }
export interface GoldenFailure { name: string; reason: string; }

export async function evaluateDecisionGolden(builder: DecisionBuilder, cases: GoldenCase[]): Promise<{ passed: number; failed: GoldenFailure[] }> {
  const failed: GoldenFailure[] = [];
  for (const c of cases) {
    const decisions = await builder.build(c.context);
    if (c.expect.minDecisions !== undefined && decisions.length < c.expect.minDecisions) { failed.push({ name: c.name, reason: `decisions ${decisions.length} < ${c.expect.minDecisions}` }); continue; }
    if (c.expect.recommendation && !decisions.some((d) => d.recommendation === c.expect.recommendation)) { failed.push({ name: c.name, reason: `no decision with recommendation ${c.expect.recommendation}` }); continue; }
    if (c.expect.operationType && !decisions.some((d) => d.operationType === c.expect.operationType)) { failed.push({ name: c.name, reason: `no decision with operationType ${c.expect.operationType}` }); }
  }
  return { passed: cases.length - failed.length, failed };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/decisionGolden.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/nl-decision-golden src/agentRuntime/decisionGolden.ts tests/decisionGolden.test.ts
git commit -m "新增决策 golden set 评测防回归"
```

---

### Task M1-4: audit 加厚（补 P1-14 剩余）

**Files:**
- Modify: `src/cli/dailyMissionAudit.ts`
- Test: `tests/dailyMissionAuditDetail.test.ts`

**Interfaces:**
- `buildDailyMissionAuditSummary` 增加"逐决策明细"：每条 decision 的 recommendation、是否 approved、执行状态（从 execution-results）、subject。summary 增加 `decisions: Array<{ decisionId, status, subject }>` 字段。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionAuditDetail.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailyMissionAuditSummary } from '../src/cli/dailyMissionAudit.js';

describe('audit per-decision detail', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-audd-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('lists per-decision execution status', async () => {
    const d = join(dir, 'daily-mission', '2026-07-02'); await mkdir(d, { recursive: true });
    await writeFile(join(d, 'approval-request.json'), JSON.stringify({ approvals: [{ decisionId: 'dec-1', subjects: [{ kind: 'product', id: '648' }] }], observations: [] }), 'utf8');
    await writeFile(join(d, 'execution-results.json'), JSON.stringify([{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '' }]), 'utf8');
    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-02');
    expect(summary.decisions?.find((x: { decisionId: string }) => x.decisionId === 'dec-1')?.status).toBe('executed');
  });
});
```

- [ ] **Step 2–5**: 运行失败 → 在 `buildDailyMissionAuditSummary` 中合并 approval-request 的 approvals 与 execution-results，按 decisionId 生成 `decisions[]` 明细 → 运行通过 → Commit `git commit -m "审计输出逐决策执行明细"`。

---

### Task M1-5: 持久化一致性（P1-9 / P1-11 / P1-12）

**Files:**
- Modify: `src/agentRuntime/dailyMissionExecution.ts`（execution-results 加 per-file 锁，P1-11）
- Modify: `src/feishuBot/rentalWriteOperationHandlers.ts` / `dailyMissionExecution.ts`（ledger 事件 `at` 用 mission date 语义，P1-9）
- Modify: `src/agentRuntime/operationLedger.ts`（`recordOperationEvent` 双写同锁 + dedupe，P1-12）
- Test: `tests/dailyMissionPersistence.test.ts`

**Interfaces:**
- `appendExecutionResult` 复用 ledger 式 per-file lock，避免并发覆盖。
- 执行事件写入时以 `runId` 对应 run.date 决定 JSONL 分区（或在 metadata 记 `missionDate` + audit 按 runId 跨日聚合）。**勘察前置**：先确认 audit 是否已按 runId 聚合（M1-4），二选一避免重复。
- `recordOperationEvent` 的 JSONL + JSON journal 双写放同一锁内，带 `eventKey=runId+decisionId+event+at` dedupe。

- [ ] **Step 1: 写并发/分区测试**（并发 append 不丢、历史 date 审批事件能按 runId 查到）→ **Step 2–5**: 失败 → 实现锁/分区/dedupe → 通过 → Commit `git commit -m "收紧 execution-results/ledger 持久化一致性"`。

（本任务代码较分散，实现时逐子项 TDD；每子项独立 commit。）

---

### Task M1-6: 数据契约收紧（P2-15 / P2-16 / P2-17 / P2-18）

**Files:**
- Modify: `src/agentRuntime/decisionRecord.ts`（subjects 非空，P2-15）
- Modify: `src/agentRuntime/decisionBuilder.ts`（LLM 非法决策转 blocked observation，P2-16）
- Modify: `src/agentRuntime/hotspotEvents.ts` + collector（缺失/损坏进 missingSources，P2-17）
- Modify: 文档/CLI env（统一 `MT_AGENT_OUTPUT_DIR`，P2-18）
- Test: `tests/dataContract.test.ts`

**Interfaces:**
- `isValidDecisionRecord`：`subjects` 须 `length >= 1`。
- `LlmDecisionBuilder`：非法决策不丢弃，转 `{ recommendation:'observe', blockedReason, evidenceRefs:['llm.validation'], proposedTool: undefined }`。
- Hotspot collector：源不可用（读/解析失败）时 collector reject（进 missingSources），区别于"源正常但无事件"。

- [ ] **Step 1: 写失败测试**（空 subjects 被拒/降级；非法 LLM 决策变 blocked observation 且无 proposedTool；hotspot 文件损坏进 missingSources）→ **Step 2–5**: 失败 → 实现 → 通过 → Commit `git commit -m "收紧决策/热点/env 数据契约"`。

---

### Task M1-7: Scheduler 定时触发

**Files:**
- Create: `src/cli/dailyMissionDaemon.ts`
- Modify: `package.json`（script `daily-mission-daemon`）
- Test: `tests/dailyMissionScheduler.test.ts`

**Interfaces:**
- Produces: `computeNextRunDelayMs(now, hhmm): number`（纯函数，算到下一个每日 HH:MM 的毫秒）；daemon 主循环用它 setTimeout 到点调用 `daily-mission-run` 的 `main()`，跑完记录 last-run，再排下一次。参考 `linkRegistryRefreshDaemon.ts` 的守护模式。审批超时提醒、失败补跑作为 daemon 的后续增量。

- [ ] **Step 1: 写纯函数失败测试**

Create `tests/dailyMissionScheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeNextRunDelayMs } from '../src/cli/dailyMissionDaemon.js';

describe('computeNextRunDelayMs', () => {
  it('schedules to the next HH:MM today when target is later', () => {
    const now = new Date('2026-07-02T08:00:00.000Z').getTime();
    const delay = computeNextRunDelayMs(now, '09:30', 'UTC');
    expect(delay).toBe(90 * 60 * 1000);
  });
  it('rolls to tomorrow when target already passed', () => {
    const now = new Date('2026-07-02T10:00:00.000Z').getTime();
    const delay = computeNextRunDelayMs(now, '09:30', 'UTC');
    expect(delay).toBeGreaterThan(23 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: 运行确认失败** → **Step 3: 勘察 daemon 模式**（`grep -n "setTimeout\|setInterval\|loadEnv\|main" src/cli/linkRegistryRefreshDaemon.ts`，沿用其守护/优雅退出模式）→ **Step 4: 实现 `computeNextRunDelayMs` + daemon 主循环**（时区参数默认取 env，调用 dailyMissionRun 的 `main()`）→ **Step 5: 通过** → **Step 6: 冒烟**（`--once` 跑一次退出）→ **Step 7: Commit** `git commit -m "新增 Daily Mission 定时触发 daemon"`。

---

### Task M1-8: M1 全量回归

- [ ] 全量：`npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'` 通过；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build` 通过。Commit 集成测试。

**M1 完成即 A 层 100%**（除热点 API 非我方卡点）：定时自动出审批卡、决策可评测、执行后日报/审计闭环、持久化一致、数据契约收紧。

---

# 里程碑 M2：B 层数据地基（市场价 JSON + 效果归因）

> 粒度：M2 可近期做（市场价 collector 是确定性读 JSON；效果归因是确定性聚合）。市场 JSON 字段以你后续提供的格式为准，本里程碑先定"最小契约 + 缺失降级"。

### Task M2-1: MarketPriceCollector（读 JSON）

**Files:** Create `src/agentRuntime/marketPriceCollector.ts`；Test `tests/marketPriceCollector.test.ts`。

**Interfaces:**
- `MarketPriceSnapshot`（最小契约：`{ productId | category, price, currency?, capturedAt }[]`，其余字段透传）。
- `createMarketPriceCollector(outputDir): ContextCollector`：读 `daily-mission/<date>/market-price.json`（或 `config/market-price.json`），塞 `CollectedContext.marketPrice`；文件缺失/损坏 → collector reject（进 missingSources）。
- `CollectedContext` 增加可选 `marketPrice?: unknown`（不写死字段全集，等真实 JSON）。

**验收:** collector 读到 JSON 塞进 context；缺失进 missingSources；`DecisionBuilder` prompt 能看到 marketPrice（M1-2 grounding 之上加"我的价 vs 市场价"提示）。实现时先补 TDD（读取/缺失/字段透传三例）。

### Task M2-2: 效果归因 OutcomeRecord

**Files:** Create `src/agentRuntime/outcomeAttribution.ts`；Test `tests/outcomeAttribution.test.ts`。

**Interfaces:**
- `OutcomeRecord = { decisionId, runId, operationType, subject, executedAt, measuredAt, before: MetricSnapshot, after: MetricSnapshot, outcome: 'positive'|'neutral'|'negative' }`。
- `attributeOutcomes(outputDir, missionDate, lookaheadDays): Promise<OutcomeRecord[]>`：对某日已 executed 的决策，读其 subject 在执行后 N 天的曝光/销售（复用 Collector/report context），与执行前对比，按阈值判 outcome，写 `output/daily-mission/<date>/outcomes.json` + `outcome_attributed` ledger 事件。

**依赖:** 需要"执行前基线"——执行时应快照 subject 当时指标（M2-2 附带：执行时在 execution result 或 ledger 记 `beforeMetric`）。**这是飞轮回边的第一段。**

**验收:** 给定执行记录 + 前后指标，产出 OutcomeRecord 且 outcome 判定正确；无后续数据时标 pending。TDD。

---

# 里程碑 M3：飞轮回边（成绩单 + 决策读历史）

> 粒度：结构化设计。依赖 M2 的 OutcomeRecord **累积一段时间**才有意义，实现时补 TDD，但"阈值/样本量"需真实数据校准，不在此写死。

### Task M3-1: TrackRecord 成绩单

**Interfaces:**
- `TrackRecord`：按 `operationType × 品类 × 幅度档` 聚合 OutcomeRecord → `{ key, samples, positive, neutral, negative, successRate }`。
- `buildTrackRecord(outputDir): Promise<TrackRecord[]>` 从历史 outcomes.json 聚合；append-only 存 `output/track-record.json`。
- **设计要点:** 成绩单是飞轮的记分牌，也是 M4 自动审批的依据。样本量 N 和成功率阈值**留作配置**，由真实数据校准。

### Task M3-2: 决策读历史（DecisionBuilder 记忆）

**Interfaces:**
- `CollectedContext` 增加 `trackRecord?: TrackRecord[]` 与 `recentOutcomes?: OutcomeRecord[]`；新增对应 collector。
- `LlmDecisionBuilder` grounding 增加"同类操作历史成败"提示（"该品类降价历史成功率 X%"），让决策读飞轮回边数据。
- **设计要点:** 契约不变（仍产 DecisionRecord），只是输入多"历史效果"。这一步闭合飞轮：今天的操作→效果→喂回明天决策。

**验收（实现时）:** context 带 trackRecord 时，prompt 含历史成败摘要；RuleBased 版可基于成功率调整 recommendation。

---

# 里程碑 M4：第 4 级 数据驱动自动审批治理

> 粒度：结构化设计 + 护栏规格。**依赖 M3 成绩单累积足够样本**。这是"放开自主"的治理层，不是 agent/模型问题——用确定性规则 + 护栏，绝不用模型自信决定放开。

### Task M4-1: 自动审批策略（确定性规则）

**Interfaces:**
- `AutoApprovalPolicy`：`autoApprovable(decision, trackRecord, config): { auto: boolean; reason: string }`。规则（全真才自动）：
  - `operationType ∈ 可逆低风险白名单`（config，如小幅降价、上链；下架/大额/不可逆永不入白名单）
  - 该类 `samples >= N` 且 `successRate >= 阈值`（config）
  - `幅度 <= 上限`（config）
  - `risk != high`
- 插在 `classifyDecisions` 之后：`approve_to_execute` 且 `autoApprovable` → 标 `autoApproved`；其余照旧发人工审批卡。
- **设计要点:** 纯代码规则，不涉及模型；配置化阈值/白名单/上限。

### Task M4-2: 护栏

**Interfaces:**
- 每日自动执行预算上限（`config.autoExecuteDailyCap`）。
- 金丝雀：新入白名单类型先自动执行 `canaryRatio` 比例。
- 负面自动回滚：`attributeOutcomes` 判 negative → 自动触发 rollback（复用现有 rollback）+ `auto_rollback` 事件。
- 一键熔断：`config.autoExecuteEnabled=false` 立即全退回人工。
- 所有自动执行走与人工审批**同一** execute→verify→ledger 路径，只是审批闸门由规则自动开。

### Task M4-3: 渐进放量（影子→金丝雀→全量）

**Interfaces:**
- 影子模式：标"本可自动"但仍发人工卡，记录"自动决定 vs 人工决定"一致率到 ledger。
- 一致率达标 → 金丝雀（小比例自动）→ 成功率稳定 → 全量（白名单类型全自动，高风险永远人工）。
- **设计要点:** 每级切换由数据指标驱动（一致率、成功率），配置化，可一键回退到上一级。

**M4 验收（实现时）:** 白名单低风险操作在成绩单达标后自动执行且记 `auto_approved` + execution 事件；预算/熔断/金丝雀护栏生效；高风险恒走人工；负面结果自动回滚。

---

## 里程碑依赖与顺序

```text
M1（A层100%，近期，完整TDD）
  ├─ M1-1 执行后Journal ─ M1-4 audit ─ M1-5 持久化 ─ M1-6 契约（可并行）
  ├─ M1-2 grounding ─ M1-3 golden set
  └─ M1-7 scheduler ─ M1-8 回归
        ↓
M2（B层地基）M2-1 市场价JSON collector ─ M2-2 效果归因（需执行前基线快照）
        ↓（OutcomeRecord 累积数周）
M3（飞轮回边）M3-1 成绩单 ─ M3-2 决策读历史
        ↓（成绩单累积足够样本，阈值校准）
M4（数据驱动自主）M4-1 自动审批规则 ─ M4-2 护栏 ─ M4-3 渐进放量
```

**关键节奏:** M1 可立即全部实现（A 层 100%）。M2 市场价 collector 待你的 JSON 格式即可做，效果归因需先在执行时埋"前基线快照"。M3/M4 依赖真实数据累积**数周到数月**，故给结构化设计——实现时每任务先补 TDD，阈值/白名单由真实数据校准，绝不凭空写死。

## Self-Review

- **Spec 覆盖:** A 层剩余全部有任务——scheduler(M1-7)、grounding(M1-2)+golden(M1-3)、P1-8(M1-1)、audit(M1-4)、P1-9~12(M1-5)、P2(M1-6)。B 层——市场价 JSON(M2-1)、回边(M2-2 归因→M3-1 成绩单→M3-2 决策读历史)、第4级治理(M4-1 规则+M4-2 护栏+M4-3 放量)。热点 API 明确列为非我方卡点，不在计划内。
- **粒度梯度声明:** M1 完整 TDD（可执行）；M2 半详细（JSON 待格式）；M3/M4 结构化设计（依赖累积数据），已在文首和里程碑标注为有意梯度，非占位。
- **类型一致:** `DailyMissionExecutionResult`（M1-1 引用现有）、`CollectedContext.marketPrice/trackRecord/recentOutcomes`（M2-1/M3-2 递进扩展，均可选）、`OutcomeRecord`(M2-2)→`TrackRecord`(M3-1)→`AutoApprovalPolicy`(M4-1) 链条一致。
- **安全不倒退:** M4 自动执行仍走同一 execute→verify→ledger + 护栏 + 高风险恒人工，未削弱 P0。
- **勘察前置:** M1-2/M1-5/M1-7 标了 grep 勘察步骤（工具枚举 API、audit 聚合方式、daemon 模式），阻塞前置。
