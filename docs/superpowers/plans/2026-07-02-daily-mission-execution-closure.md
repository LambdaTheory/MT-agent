# Daily Mission 完成体（审批执行闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plan 模式的 Daily Mission 推进到完成体——审批通过后能把已批准决策接回现有写操作链路真实执行并记账，同时补齐真实数据 collector、LLM 决策上线、工具参数校验、失败日报。

**Architecture:** 复用现有 `buildAgentToolConfirmCard` + `agent_tool_confirm` 回调路径发送/接收审批；已批准的 `DecisionRecord.proposedTool` 转成标准 `AgentToolConfirmRequest`，经既有确认链路执行；执行时透传 `ledgerContext(runId+decisionId)` 让写操作落 `execution_*` 事件。循环驱动仍是确定性 Orchestrator，写操作仍需人工点审批。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀), vitest, 复用 Phase 1/2 的 Operation Ledger、DecisionRecord、DailyMissionOrchestrator、approvalCard、rental 写 handler、LlmProvider。

## Global Constraints

- 所有 import 使用 `.js` 后缀。
- 写操作一律经人工审批；本阶段不做无人值守自动执行。
- 每个执行相关事件必须带 `runId`、`decisionId`、`subject`、`at`（飞轮归因锚点）。
- LLM 只产候选决策；本地做 schema 校验、风险分类、工具参数复核；非法即降级为观察，绝不执行。
- 复用现有确认卡的 `confirmationKey` 防篡改，不新造审批协议。
- 测试用 `FakeLlmProvider` 与临时目录，不调真实 LLM/daemon。
- 运行测试：`npx vitest run <file> --exclude '**/.worktrees/**'`。
- 类型检查：`npx tsc -p tsconfig.json --noEmit`（期望 exit 0）。
- **接线勘察为阻塞性前置**：凡标注"以实际代码为准""grep 定位""按实际签名/字段/键调整"的步骤（Task 1 Step 5、Task 4 Step 4、Task 5 Step 1/5、Task 6 Step 3、Task 7 Step 3），是**必须先执行的阻塞前置**，不是可跳过的软提示。实现前必须先读真实代码确认函数签名、字段名、回调处理位置；**当真实代码与本计划的示例不一致时，一律以真实代码为准**，据此调整实现，不得照抄计划示例后放任类型检查失败。

## 现有接口（本计划依赖，勿重造）

- `buildAgentToolConfirmCard(request: AgentToolConfirmRequest, options?): FeishuCardPayload`（`src/agentRuntime/approvalCard.ts`）。
- `parseAgentToolConfirmRequest(value): AgentToolConfirmRequest | null`（校验 confirmationKey）。
- `AgentToolConfirmRequest = { toolName, arguments, reason, continuation? }`。
- `executeRentalWriteOperationHandler(request, client, ledgerContext?)`（Phase 2 已支持 `ledgerContext: { outputDir, runId?, decisionId? }`）。
- `executeAgentToolRequest(request, outputDir, options: AgentToolExecutionOptions)`（`src/feishuBot/agentToolExecutor.ts:1487`；`AgentToolExecutionOptions` 在 :89，当前无 ledgerContext 字段）。
- `validateAgentToolArguments` / `schemaAllowsArguments`（`src/agentRuntime/planner.ts`）、`findAgentTool`（`src/agentRuntime/toolRegistry.ts`）。
- `DecisionRecord.proposedTool = { toolName: string; arguments: Record<string, unknown> }`（`src/agentRuntime/decisionRecord.ts`）。
- `classifyDecisions(records): { approvals, observations }`（`src/agentRuntime/decisionPolicy.ts`）。
- `recordOperationEvent(outputDir, entry)`（`src/agentRuntime/operationLedger.ts`）。
- `findReportContextByDate(outputDir, date)` / `findLatestReportContext(outputDir)`（`src/feishuBot/reportStore.ts`）。
- `writeDailyJournal(input)`（`src/agentRuntime/dailyJournalWriter.ts`）。

---

### Task 1: DecisionPolicy 增加工具参数校验

**Files:**
- Modify: `src/agentRuntime/decisionPolicy.ts`
- Test: `tests/decisionPolicyToolValidation.test.ts`

**Interfaces:**
- Consumes: `findAgentTool`（toolRegistry）、`schemaAllowsArguments`（planner）。
- Produces: `classifyDecisions` 新增校验——`proposedTool` 存在但 `toolName` 不在注册表、或 `arguments` 不满足该工具 `inputSchema` 时，降级为观察并标 `blockedReason='工具参数非法'`。签名不变，仍返回 `{ approvals, observations }`。

- [ ] **Step 1: 写失败测试**

Create `tests/decisionPolicyToolValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(over: Partial<DecisionRecord>): DecisionRecord {
  return {
    decisionId: 'd', runId: 'r', title: 't', subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down', recommendation: 'approve_to_execute', risk: 'write',
    rationale: ['曝光下降'], evidenceRefs: ['exposure'], uncertainties: [],
    proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
    ...over,
  };
}

describe('classifyDecisions tool validation', () => {
  it('approves when proposedTool args satisfy the tool schema', () => {
    const { approvals } = classifyDecisions([record({})]);
    expect(approvals).toHaveLength(1);
  });

  it('downgrades when toolName is unknown', () => {
    const { approvals, observations } = classifyDecisions([record({ proposedTool: { toolName: 'rental.nope', arguments: {} } })]);
    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具参数非法');
  });

  it('downgrades when args violate the schema', () => {
    const { approvals, observations } = classifyDecisions([record({ proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: 'not-an-array' } } })]);
    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具参数非法');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/decisionPolicyToolValidation.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 未知工具/非法参数当前仍进 approvals。

- [ ] **Step 3: 实现校验**

Edit `src/agentRuntime/decisionPolicy.ts`:

```ts
import type { DecisionRecord } from './decisionRecord.js';
import { findAgentTool } from './toolRegistry.js';
import { schemaAllowsArguments } from './planner.js';

export interface ClassifiedDecisions {
  approvals: DecisionRecord[];
  observations: DecisionRecord[];
}

function toolArgumentsValid(record: DecisionRecord): boolean {
  if (!record.proposedTool) return false;
  const tool = findAgentTool(record.proposedTool.toolName);
  if (!tool) return false;
  return schemaAllowsArguments(tool.inputSchema, record.proposedTool.arguments);
}

function blockedReason(record: DecisionRecord): string {
  if (!record.proposedTool) return '缺少可执行工具参数';
  if (!toolArgumentsValid(record)) return '工具参数非法';
  if (record.uncertainties.length > 0) return '存在不确定项';
  return '证据不足';
}

export function classifyDecisions(records: DecisionRecord[]): ClassifiedDecisions {
  const approvals: DecisionRecord[] = [];
  const observations: DecisionRecord[] = [];

  for (const record of records) {
    const executable = record.recommendation === 'approve_to_execute';
    const evidenced = record.evidenceRefs.length > 0 && record.uncertainties.length === 0;
    if (executable && evidenced && toolArgumentsValid(record)) {
      approvals.push(record);
    } else if (executable) {
      observations.push({ ...record, recommendation: 'observe', blockedReason: blockedReason(record) });
    } else {
      observations.push(record);
    }
  }

  return { approvals, observations };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/decisionPolicyToolValidation.test.ts tests/decisionPolicy.test.ts --exclude '**/.worktrees/**'`
Expected: PASS（新旧 policy 测试都过）。

- [ ] **Step 5: 校验 `schemaAllowsArguments` 签名**

Run: `grep -n "export function schemaAllowsArguments" src/agentRuntime/planner.js src/agentRuntime/planner.ts`
Expected: 找到 `schemaAllowsArguments(schema, args)`。若签名不同（如返回对象而非 boolean），按实际签名调整 `toolArgumentsValid`（用其 boolean 结果或 `.ok` 字段）。

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/decisionPolicy.ts tests/decisionPolicyToolValidation.test.ts
git commit -m "DecisionPolicy 增加 proposedTool 参数 schema 校验"
```

---

### Task 2: 决策 → 确认请求转换

**Files:**
- Create: `src/agentRuntime/dailyMissionApproval.ts`
- Test: `tests/dailyMissionApproval.test.ts`

**Interfaces:**
- Consumes: `DecisionRecord`、`AgentToolConfirmRequest`、`buildAgentToolConfirmCard`。
- Produces: `decisionToConfirmRequest(decision): AgentToolConfirmRequest`（`toolName`=decision.proposedTool.toolName，`arguments`=proposedTool.arguments，`reason` 编码 `[[dailyMission:runId=<runId>;decisionId=<decisionId>]] <title>`）；`parseDailyMissionReason(reason): { runId: string; decisionId: string } | null`；`buildDailyMissionApprovalCards(decisions): FeishuCardPayload[]`。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionApproval.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decisionToConfirmRequest, parseDailyMissionReason, buildDailyMissionApprovalCards } from '../src/agentRuntime/dailyMissionApproval.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

const decision: DecisionRecord = {
  decisionId: 'dec-1', runId: 'run-1', title: '648 降价 10%', subjects: [{ kind: 'product', id: '648' }],
  operationType: 'price_down', recommendation: 'approve_to_execute', risk: 'write',
  rationale: ['曝光下降'], evidenceRefs: ['exposure'], uncertainties: [],
  proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
};

describe('dailyMissionApproval', () => {
  it('encodes runId/decisionId into the confirm request reason and round-trips', () => {
    const request = decisionToConfirmRequest(decision);
    expect(request.toolName).toBe('rental.pricePreview');
    expect(request.arguments).toEqual({ productIds: ['648'], discount: 0.9 });
    const parsed = parseDailyMissionReason(request.reason);
    expect(parsed).toEqual({ runId: 'run-1', decisionId: 'dec-1' });
  });

  it('returns null for non-daily-mission reasons', () => {
    expect(parseDailyMissionReason('普通改价')).toBeNull();
  });

  it('builds one card per decision', () => {
    const cards = buildDailyMissionApprovalCards([decision]);
    expect(cards).toHaveLength(1);
  });

  it('skips decisions without proposedTool', () => {
    const cards = buildDailyMissionApprovalCards([{ ...decision, proposedTool: undefined }]);
    expect(cards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionApproval.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyMissionApproval.ts`:

```ts
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from './approvalCard.js';
import type { DecisionRecord } from './decisionRecord.js';

const REASON_PREFIX = 'dailyMission';
const REASON_PATTERN = /^\[\[dailyMission:runId=([^;]+);decisionId=([^\]]+)\]\]/;

export function decisionToConfirmRequest(decision: DecisionRecord): AgentToolConfirmRequest {
  if (!decision.proposedTool) {
    throw new Error(`Decision ${decision.decisionId} has no proposedTool`);
  }
  return {
    toolName: decision.proposedTool.toolName,
    arguments: decision.proposedTool.arguments,
    reason: `[[${REASON_PREFIX}:runId=${decision.runId};decisionId=${decision.decisionId}]] ${decision.title}`,
  };
}

export function parseDailyMissionReason(reason: string): { runId: string; decisionId: string } | null {
  const match = REASON_PATTERN.exec(reason);
  if (!match) return null;
  return { runId: match[1], decisionId: match[2] };
}

export function buildDailyMissionApprovalCards(decisions: DecisionRecord[]): FeishuCardPayload[] {
  return decisions
    .filter((decision) => decision.proposedTool)
    .map((decision) => buildAgentToolConfirmCard(decisionToConfirmRequest(decision)));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionApproval.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionApproval.ts tests/dailyMissionApproval.test.ts
git commit -m "新增决策到确认请求转换与审批卡构建"
```

---

### Task 3: executeAgentToolRequest 透传 ledgerContext

**Files:**
- Modify: `src/feishuBot/agentToolExecutor.ts`（`AgentToolExecutionOptions` :89；write 分支路由）
- Test: `tests/agentToolExecutorLedger.test.ts`

**Interfaces:**
- Consumes: `RentalWriteLedgerContext`（Phase 2，`src/feishuBot/rentalWriteOperationHandlers.ts`）。
- Produces: `AgentToolExecutionOptions` 新增可选 `ledgerContext?: { outputDir: string; runId?: string; decisionId?: string }`；rental 写分支把它传给 `executeRentalWriteOperationHandler`。未传时行为不变。

- [ ] **Step 1: 写失败测试**

Create `tests/agentToolExecutorLedger.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: ['done'] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('executeAgentToolRequest ledgerContext', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-exec-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('threads ledgerContext into rental write handler', async () => {
    await executeAgentToolRequest(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'x' },
      dir,
      { rentalPriceClient: fakeClient(), ledgerContext: { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' } },
    );
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((e) => e.event === 'execution_succeeded' && e.decisionId === 'dec-1' && e.runId === 'run-1')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/agentToolExecutorLedger.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `ledgerContext` 未透传，无 execution_succeeded 事件。

- [ ] **Step 3: 扩展 options 并透传**

In `src/feishuBot/agentToolExecutor.ts`, extend `AgentToolExecutionOptions` (around :89):

```ts
export interface AgentToolExecutionOptions {
  rentalPriceClient?: RentalPriceSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  ledgerContext?: { outputDir: string; runId?: string; decisionId?: string };
}
```

In the rental write dispatch branch (`rental.copy`/`delist`/`tenancySet`/`specDiscover`/`specAddAndRefresh` and `rental.operationConfirmRequest`), pass the ledger context:

```ts
    case 'rental.copy':
    case 'rental.delist':
    case 'rental.tenancySet':
    case 'rental.specDiscover':
    case 'rental.specAddAndRefresh':
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    // ...
    case 'rental.operationConfirmRequest':
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/agentToolExecutorLedger.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 5: 回归 executor 既有测试**

Run: `npx vitest run tests/feishuBotTools.test.ts tests/feishuBotRentalPrice.test.ts tests/rentalWriteLedger.test.ts --exclude '**/.worktrees/**'`
Expected: PASS（未传 ledgerContext 的旧路径不变）。

- [ ] **Step 6: Commit**

```bash
git add src/feishuBot/agentToolExecutor.ts tests/agentToolExecutorLedger.test.ts
git commit -m "executeAgentToolRequest 透传 ledgerContext 到写 handler"
```

---

### Task 4: 已批准决策执行分发

**Files:**
- Create: `src/agentRuntime/dailyMissionExecution.ts`
- Test: `tests/dailyMissionExecution.test.ts`

**Interfaces:**
- Consumes: `executeAgentToolRequest`、`recordOperationEvent`、`DecisionRecord`、`decisionToConfirmRequest`（Task 2）。
- Produces: `executeApprovedDecision(input): Promise<{ ok: boolean; text: string }>`，`input: { decision, outputDir, options }`；先写 `approval_accepted` 事件，再调 `executeAgentToolRequest`（带 `ledgerContext={outputDir, runId, decisionId}`），返回执行文本。写操作的 `execution_*` 事件由 Task 3 的透传自动产生。`writeExecutionResults(outputDir, date, results)` 落 `execution-results.json`。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionExecution.test.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeApprovedDecision, writeExecutionResults } from '../src/agentRuntime/dailyMissionExecution.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: ['delisted'] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

const decision: DecisionRecord = {
  decisionId: 'dec-1', runId: 'run-1', title: '下架 648', subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high',
  rationale: ['长期无曝光'], evidenceRefs: ['exposure'], uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

describe('executeApprovedDecision', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-dmx-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records approval_accepted and execution events with attribution', async () => {
    const result = await executeApprovedDecision({ decision, outputDir: dir, options: { rentalPriceClient: fakeClient() } });
    expect(result.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date)).filter((e) => e.decisionId === 'dec-1').map((e) => e.event);
    expect(events).toContain('approval_accepted');
    expect(events).toContain('execution_succeeded');
  });

  it('writes execution-results.json', async () => {
    await writeExecutionResults(dir, '2026-07-02', [{ decisionId: 'dec-1', ok: true, text: 'delisted' }]);
    const raw = await readFile(join(dir, 'daily-mission', '2026-07-02', 'execution-results.json'), 'utf8');
    expect(JSON.parse(raw)[0].decisionId).toBe('dec-1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionExecution.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyMissionExecution.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { decisionToConfirmRequest } from './dailyMissionApproval.js';
import type { DecisionRecord } from './decisionRecord.js';
import { recordOperationEvent } from './operationLedger.js';

export interface ExecuteApprovedDecisionInput {
  decision: DecisionRecord;
  outputDir: string;
  options?: AgentToolExecutionOptions;
}

export interface DailyMissionExecutionResult {
  decisionId: string;
  ok: boolean;
  text: string;
}

export async function executeApprovedDecision(input: ExecuteApprovedDecisionInput): Promise<DailyMissionExecutionResult> {
  const { decision, outputDir } = input;
  const now = () => new Date().toISOString();
  await recordOperationEvent(outputDir, {
    planId: decision.decisionId,
    at: now(),
    event: 'approval_accepted',
    runId: decision.runId,
    decisionId: decision.decisionId,
    subject: decision.subjects[0],
  });
  const request = decisionToConfirmRequest(decision);
  const response = await executeAgentToolRequest(request, outputDir, {
    ...input.options,
    ledgerContext: { outputDir, runId: decision.runId, decisionId: decision.decisionId },
  });
  const ok = response.metadata?.ok !== false;
  return { decisionId: decision.decisionId, ok, text: response.text };
}

export async function writeExecutionResults(
  outputDir: string,
  date: string,
  results: DailyMissionExecutionResult[],
): Promise<string> {
  const path = dailyMissionArtifactPath(outputDir, date, 'executionResults');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return path;
}
```

- [ ] **Step 4: 校验 artifact name**

Run: `grep -n "executionResults" src/agentRuntime/dailyMissionArtifacts.ts`
Expected: `DAILY_MISSION_ARTIFACT_FILENAMES` 含 `executionResults: 'execution-results.json'`（Phase 1 已定义）。若键名不同，按实际键调整。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionExecution.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/dailyMissionExecution.ts tests/dailyMissionExecution.test.ts
git commit -m "新增已批准决策执行分发与执行结果落盘"
```

---

### Task 5: 审批回调接入 Daily Mission 执行

**Files:**
- Modify: 现有飞书回调分发（先 `grep` 定位：`grep -rn "agent_tool_confirm" src/feishuBot/server.ts src/feishuBot/sdkClient.ts`）
- Test: `tests/dailyMissionApprovalCallback.test.ts`

**Interfaces:**
- Consumes: `parseDailyMissionReason`（Task 2）、`executeApprovedDecision`（Task 4）、既有 `parseAgentToolConfirmRequest`。
- Produces: 一个可单测的纯函数 `resolveDailyMissionApproval(request, outputDir, options): Promise<DailyMissionExecutionResult | null>`——当 `parseDailyMissionReason(request.reason)` 命中时，用 request 重建 DecisionRecord 最小体并调 `executeApprovedDecision`；不命中返回 `null`（交回普通确认路径）。把它挂进现有 `agent_tool_confirm` 回调处理：命中 daily-mission 前缀就走它，否则走原逻辑。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionApprovalCallback.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('resolveDailyMissionApproval', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-cb-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('executes a daily-mission-tagged confirm request', async () => {
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: fakeClient() },
    );
    expect(result?.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date)).map((e) => e.event);
    expect(events).toContain('approval_accepted');
  });

  it('returns null for non-daily-mission requests', async () => {
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '普通下架' },
      dir,
      { rentalPriceClient: fakeClient() },
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionApprovalCallback.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现纯函数**

Create `src/agentRuntime/dailyMissionApprovalCallback.ts`:

```ts
import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { executeApprovedDecision, type DailyMissionExecutionResult } from './dailyMissionExecution.js';
import type { DecisionRecord } from './decisionRecord.js';
import type { AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';

export async function resolveDailyMissionApproval(
  request: AgentToolConfirmRequest,
  outputDir: string,
  options?: AgentToolExecutionOptions,
): Promise<DailyMissionExecutionResult | null> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return null;
  const decision: DecisionRecord = {
    decisionId: tag.decisionId,
    runId: tag.runId,
    title: request.reason,
    subjects: [{ kind: 'product', id: typeof request.arguments.productId === 'string' ? request.arguments.productId : 'unknown' }],
    operationType: 'observe',
    recommendation: 'approve_to_execute',
    risk: 'high',
    rationale: [],
    evidenceRefs: [],
    uncertainties: [],
    proposedTool: { toolName: request.toolName, arguments: request.arguments },
  };
  return executeApprovedDecision({ decision, outputDir, options });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionApprovalCallback.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 5: 挂进现有回调分发**

Run: `grep -rn "agent_tool_confirm" src/feishuBot/server.ts src/feishuBot/sdkClient.ts`
在处理 `agent_tool_confirm` 且已 `parseAgentToolConfirmRequest` 得到合法 request 后、调用普通执行前，插入：

```ts
import { resolveDailyMissionApproval } from '../agentRuntime/dailyMissionApprovalCallback.js';
// ...在确认执行处：
const missionResult = await resolveDailyMissionApproval(request, outputDir, executionOptions);
if (missionResult) {
  return { text: missionResult.text };
}
// 否则继续原有 executeAgentToolRequest 逻辑
```

（`outputDir`、`executionOptions` 用该回调上下文已有的值；`server.ts` 与 `sdkClient.ts` 两处都要挂，保持一致。）

- [ ] **Step 6: 回归飞书回调测试**

Run: `npx vitest run tests/feishuBotServer.test.ts tests/feishuBotSdkCardAction.test.ts --exclude '**/.worktrees/**'`
Expected: PASS（daily-mission 前缀不命中时走原逻辑，旧行为不变）。

- [ ] **Step 7: Commit**

```bash
git add src/agentRuntime/dailyMissionApprovalCallback.ts src/feishuBot/server.ts src/feishuBot/sdkClient.ts tests/dailyMissionApprovalCallback.test.ts
git commit -m "审批回调接入 Daily Mission 决策执行"
```

---

### Task 6: 真实 Exposure / Sales Collector

**Files:**
- Create: `src/agentRuntime/dailyMissionCollectors.ts`
- Test: `tests/dailyMissionCollectors.test.ts`

**Interfaces:**
- Consumes: `findReportContextByDate` / `findLatestReportContext`（reportStore）、`ContextCollector`（dailyMissionContext）。
- Produces: `createExposureCollector(outputDir): ContextCollector`（读当日 report context，抽出曝光摘要塞 `exposure`）；`createSalesCollector(outputDir): ContextCollector`（抽订单/销售摘要塞 `sales`）；找不到 report context 时 collect 抛错（由 `collectDailyMissionContext` 记入 `missingSources`）。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionCollectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createExposureCollector } from '../src/agentRuntime/dailyMissionCollectors.js';

describe('createExposureCollector', () => {
  it('throws when no report context exists so the source is marked missing', async () => {
    const collector = createExposureCollector('/nonexistent-output-dir');
    await expect(collector.collect({ runId: 'r', date: '2026-07-02', outputDir: '/nonexistent-output-dir' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionCollectors.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 确认 report context 形状**

Run: `grep -n "export interface PublicTrafficDataReportContext\|exposure\|products" src/feishuBot/reportStore.ts | head`
读出 report context 里可用的曝光/订单字段（如 `context.rows` / `context.summary`），据此决定摘要字段。以下实现按"存在则取、缺失留空"编写，字段名以实际 context 为准。

- [ ] **Step 4: 实现**

Create `src/agentRuntime/dailyMissionCollectors.ts`:

```ts
import { findLatestReportContext, findReportContextByDate } from '../feishuBot/reportStore.js';
import type { ContextCollector } from './dailyMissionContext.js';

async function loadContext(outputDir: string, date: string) {
  const byDate = await findReportContextByDate(outputDir, date);
  if (byDate) return byDate.context;
  const latest = await findLatestReportContext(outputDir);
  if (latest) return latest.context;
  throw new Error(`No public traffic report context for ${date}`);
}

export function createExposureCollector(outputDir: string): ContextCollector {
  return {
    name: 'exposure',
    collect: async ({ date }) => {
      const context = await loadContext(outputDir, date);
      return { exposure: { date: context.date, source: 'publicTraffic', context } };
    },
  };
}

export function createSalesCollector(outputDir: string): ContextCollector {
  return {
    name: 'sales',
    collect: async ({ date }) => {
      const context = await loadContext(outputDir, date);
      return { sales: { date: context.date, source: 'orderAnalysis', context } };
    },
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionCollectors.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 6: 接进 CLI**

In `src/cli/dailyMissionRun.ts`, replace the placeholder exposure/sales file collectors with the real ones:

```ts
import { createExposureCollector, createSalesCollector } from '../agentRuntime/dailyMissionCollectors.js';
// ...
  const collectors: ContextCollector[] = [
    createExposureCollector(outputDir),
    createSalesCollector(outputDir),
    { name: 'recentOperations', collect: async () => ({ recentOperations: await collectRecentOperations(outputDir, date, 7) }) },
    { name: 'hotspots', collect: async () => ({ hotspots: await hotspotProvider.listEvents({ date, lookaheadDays: 7 }) }) },
  ];
```

- [ ] **Step 7: 冒烟（无 report context 时 exposure/sales 记入 missingSources，不阻断）**

Run: `MT_AGENT_OUTPUT_DIR=$(mktemp -d) npx tsx src/cli/dailyMissionRun.ts --date 2026-07-02`
Expected: 打印 plan 完成；daily-journal 的"缺失数据源"包含 exposure、sales（因该临时目录无日报）。

- [ ] **Step 8: Commit**

```bash
git add src/agentRuntime/dailyMissionCollectors.ts src/cli/dailyMissionRun.ts tests/dailyMissionCollectors.test.ts
git commit -m "新增真实 Exposure/Sales Collector 并接入 CLI"
```

---

### Task 7: LlmDecisionBuilder 上线（可配置）

**Files:**
- Create: `src/agentRuntime/decisionBuilderFactory.ts`
- Modify: `src/cli/dailyMissionRun.ts`
- Test: `tests/decisionBuilderFactory.test.ts`

**Interfaces:**
- Consumes: `RuleBasedDecisionBuilder`、`LlmDecisionBuilder`（decisionBuilder）、现有 `LlmProvider` 构造（`src/llm/openAiCompatibleProvider.ts`）。
- Produces: `createDecisionBuilder(options: { provider?: LlmProvider }): DecisionBuilder`——有 provider 返回 `LlmDecisionBuilder`，否则返回 `RuleBasedDecisionBuilder`；`resolveLlmProviderFromEnv(): LlmProvider | undefined`（env 配了 LLM 就构造 provider，否则 undefined）。

- [ ] **Step 1: 写失败测试**

Create `tests/decisionBuilderFactory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDecisionBuilder } from '../src/agentRuntime/decisionBuilderFactory.js';
import { RuleBasedDecisionBuilder, LlmDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

describe('createDecisionBuilder', () => {
  it('returns RuleBased when no provider', () => {
    expect(createDecisionBuilder({})).toBeInstanceOf(RuleBasedDecisionBuilder);
  });

  it('returns Llm when provider is present', () => {
    expect(createDecisionBuilder({ provider: new FakeLlmProvider('{"decisions":[]}') })).toBeInstanceOf(LlmDecisionBuilder);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/decisionBuilderFactory.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 确认现有 provider 构造入口**

Run: `grep -rn "openAiCompatibleProvider\|createLlmProvider\|new OpenAiCompatible\|resolveLlmProvider\|LLM_" src/llm/ src/agentRuntime/llmPlanner.ts | head`
沿用现有构造方式（如 `createOpenAiCompatibleProvider(config)` 或 planner 里已有的 provider 解析）实现 `resolveLlmProviderFromEnv`；若 planner 已有 env→provider 解析函数，直接复用它而不是重写。

- [ ] **Step 4: 实现**

Create `src/agentRuntime/decisionBuilderFactory.ts`:

```ts
import { LlmDecisionBuilder, RuleBasedDecisionBuilder, type DecisionBuilder } from './decisionBuilder.js';
import type { LlmProvider } from '../llm/provider.js';

export function createDecisionBuilder(options: { provider?: LlmProvider }): DecisionBuilder {
  if (options.provider) return new LlmDecisionBuilder({ provider: options.provider });
  return new RuleBasedDecisionBuilder();
}
```

`resolveLlmProviderFromEnv` 加在同文件（按 Step 3 的实际 provider 构造实现；若复用 planner 的解析函数则 re-export）：

```ts
// 示意：具体构造以 Step 3 找到的现有函数为准
import { maybeCreatePlannerLlmProvider } from './llmPlanner.js';
export function resolveLlmProviderFromEnv(): LlmProvider | undefined {
  return maybeCreatePlannerLlmProvider();
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/decisionBuilderFactory.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 6: 接进 CLI**

In `src/cli/dailyMissionRun.ts`:

```ts
import { createDecisionBuilder, resolveLlmProviderFromEnv } from '../agentRuntime/decisionBuilderFactory.js';
// ...
    decisionBuilder: createDecisionBuilder({ provider: resolveLlmProviderFromEnv() }),
```

- [ ] **Step 7: Commit**

```bash
git add src/agentRuntime/decisionBuilderFactory.ts src/cli/dailyMissionRun.ts tests/decisionBuilderFactory.test.ts
git commit -m "DecisionBuilder 工厂：配了 LLM 走 Llm 版否则规则版"
```

---

### Task 8: 失败 Journal

**Files:**
- Modify: `src/agentRuntime/dailyMissionOrchestrator.ts`（`saveFailedRun`）
- Modify: `src/agentRuntime/dailyJournalWriter.ts`（支持失败摘要）
- Test: `tests/dailyMissionFailureJournal.test.ts`

**Interfaces:**
- Consumes: `writeDailyJournal`。
- Produces: `writeDailyJournal` 的 input 增加可选 `failure?: { stage: string; message: string }`；有 failure 时 markdown 顶部标注"任务失败，停在 <stage>：<message>"；Orchestrator 的 `saveFailedRun` 在存 failed 状态后调用 `writeDailyJournal` 写失败日报。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionFailureJournal.test.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';

describe('failure journal', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-fail-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('marks the failing stage in markdown', async () => {
    const { markdownPath } = await writeDailyJournal({
      outputDir: dir, date: '2026-07-02', runId: 'run-1',
      context: { runId: 'run-1', date: '2026-07-02', collectedAt: 'x', missingSources: [] },
      decisions: [], classified: { approvals: [], observations: [] },
      failure: { stage: 'planning', message: 'boom' },
    });
    const md = await readFile(markdownPath, 'utf8');
    expect(md).toContain('任务失败');
    expect(md).toContain('planning');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionFailureJournal.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `failure` 字段未支持。

- [ ] **Step 3: 扩展 writeDailyJournal**

In `src/agentRuntime/dailyJournalWriter.ts`, add `failure?: { stage: string; message: string }` to `WriteDailyJournalInput`, and in the markdown renderer prepend when present:

```ts
  const failureLines = input.failure
    ? [`> ⚠️ 任务失败，停在 ${input.failure.stage}：${input.failure.message}`, '']
    : [];
  return [
    `# 运营日报 ${date}`,
    '',
    ...failureLines,
    // ...原有行
  ].join('\n');
```

同时 journal json 里加入 `failure: input.failure ?? null`。

- [ ] **Step 4: Orchestrator 失败时写失败日报**

In `src/agentRuntime/dailyMissionOrchestrator.ts`, extend `saveFailedRun` to also write a failure journal. Track current stage in a variable and pass it:

```ts
// 在 runDailyMissionPlan 内用 let stage = 'collecting'; 在每次 transition 后更新 stage。
// catch 块：
  } catch (error) {
    await saveFailedRun(input.outputDir, run, now());
    await writeDailyJournal({
      outputDir: input.outputDir, date: input.date, runId: input.runId,
      context: { runId: input.runId, date: input.date, collectedAt: now(), missingSources: [] },
      decisions: [], classified: { approvals: [], observations: [] },
      failure: { stage, message: error instanceof Error ? error.message : String(error) },
    }).catch(() => {});
    throw error;
  }
```

（`writeDailyJournal` import 加到文件顶部。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionFailureJournal.test.ts tests/dailyJournalWriter.test.ts tests/dailyMissionOrchestrator.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/dailyJournalWriter.ts src/agentRuntime/dailyMissionOrchestrator.ts tests/dailyMissionFailureJournal.test.ts
git commit -m "失败时写失败 Journal，标注停在哪一步"
```

---

### Task 9: 端到端执行闭环集成测试 + 全量回归

**Files:**
- Test: `tests/dailyMissionExecutionIntegration.test.ts`

**Interfaces:**
- Consumes: `runDailyMissionPlan`、`resolveDailyMissionApproval`、`buildDailyMissionApprovalCards`、`loadOperationLedgerJsonlEntries`。

- [ ] **Step 1: 写集成测试**

Create `tests/dailyMissionExecutionIntegration.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('daily mission execution closure', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-closure-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('approval callback executes and records the full attribution chain', async () => {
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: fakeClient() },
    );
    expect(result?.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const chain = (await loadOperationLedgerJsonlEntries(dir, date)).filter((e) => e.decisionId === 'dec-1').map((e) => e.event);
    expect(chain).toContain('approval_accepted');
    expect(chain).toContain('execution_started');
    expect(chain).toContain('execution_succeeded');
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run tests/dailyMissionExecutionIntegration.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 3: 全量回归**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`
Expected: 全部通过。

- [ ] **Step 4: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add tests/dailyMissionExecutionIntegration.test.ts
git commit -m "新增 Daily Mission 执行闭环端到端集成测试"
```

---

## 可选后续（本计划非目标）

- **Scheduler**：cron / PM2 每日定时触发 `daily-mission-run`；复用现有 `linkRegistryRefreshDaemon` 的守护模式。审批超时提醒、失败补跑。
- **审批汇总卡（单卡多决策）**：本计划一决策一卡；后续可做分组汇总卡 + 分项审批按钮。
- **ApiHotspotEventProvider**：等外部演唱会 API，替换 `FileHotspotEventProvider`，结构不变。
- **MarketPriceCollector**：真实市场价接入，新增 collector 塞 `CollectedContext`。
- **飞轮回边**：DecisionBuilder 读历史 Ledger 事件成败，产出更准决策；据成败统计数据驱动地放开低风险操作自动执行。

---

## Self-Review

**Spec 覆盖：**
- 审批回调→真实执行闭环（脊柱）→ Task 2/3/4/5/9 ✓
- exposure/sales 真实 collector → Task 6 ✓
- LlmDecisionBuilder 上线 → Task 7 ✓
- DecisionPolicy 工具参数校验 → Task 1 ✓
- 失败 Journal → Task 8 ✓
- Scheduler → 列为可选后续（本阶段非目标，因需外部进程/定时基础设施，且不阻塞闭环验证）✓

**Placeholder 扫描：** Task 5/6/7 有三处"以实际签名/字段为准"的勘察步骤（Step 定位 `agent_tool_confirm` 回调、report context 字段、provider 构造入口）——这是有意的：这些是现有代码的接线点，实现时必须先读真实代码再接，不能凭空写死。已给出明确 grep 命令和接入位置，非空泛占位。其余 code step 均为完整代码。

**类型一致性：** `DailyMissionExecutionResult`（Task4 定义）在 Task5/9 引用一致；`decisionToConfirmRequest`（Task2）→ Task4/5 一致；`AgentToolExecutionOptions.ledgerContext`（Task3）→ Task4 使用一致；`parseDailyMissionReason` 返回 `{runId, decisionId}`（Task2）→ Task5 解构一致；`writeDailyJournal` 的 `failure` 字段（Task8）与 Task8 测试一致；artifact 键 `executionResults`（Task4）在 Phase 1 `DAILY_MISSION_ARTIFACT_FILENAMES` 已定义。

**依赖顺序正确性：** Task1（policy 校验）独立；Task2（转换）独立；Task3（透传）独立；Task4 依赖 2+3；Task5 依赖 2+4；Task6/7/8 独立于闭环；Task9 依赖 5。可按 1→2→3→4→5→6→7→8→9 顺序，或并行 {1,2,3,6,7,8} 后再 4→5→9。
