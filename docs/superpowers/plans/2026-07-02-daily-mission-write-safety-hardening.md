# Daily Mission 写操作安全硬化实施计划

> **执行说明：** 逐任务实现，每步 checkbox 跟踪。依据 `docs/agent-runtime-refactor-development-audit-2026-07-02.md` 的 18 条发现，本计划覆盖全部 P0（写安全）+ 关键 P1（状态/日报/审计闭环）。P2 列为后续。

**Goal:** 关闭审批→执行闭环的 6 个 P0 写操作安全缺口，并补齐执行后的 run 状态/日报/审计闭环，使 Daily Mission 达到可进入真实执行的准入门槛。

**Architecture:** 审批回调不再从卡片重建决策，而是以持久化的 approval-request 为准，校验 run 态 + 决策归属 + 参数一致 + 幂等后，执行**持久化的已批准决策**；执行结果保留二次确认卡的 pending 态；执行推进 run 状态并重写日报；audit 聚合全产物。

**Tech Stack:** TypeScript (ESM, `.js` 后缀), vitest。复用现有 Ledger、DailyMissionRun、approvalCard、DecisionPolicy、rental 写 handler。

## Global Constraints

- 所有 import 用 `.js` 后缀。
- 写操作一律经人工审批；本阶段仍不做无人值守自动执行。
- **执行以持久化 approval-request 里的决策为准，不采信卡片回传的 toolName/arguments 重建决策**（P0-1 核心）。
- 每个执行相关事件带 `runId/decisionId/subject/at`。
- 幂等键 = `runId + decisionId`；已成功/处理中的决策拒绝重复执行。
- 决策工具白名单：拒绝 `plannerVisible === false` 的工具进入可执行审批。
- 返回 card（二次确认）的工具不得记为执行成功。
- **接线勘察为阻塞性前置**：标注"grep 定位""以实际签名为准"的步骤必须先读真实代码再实现；真实代码与示例不一致时以真实代码为准。
- 测试：`npx vitest run <file> --exclude '**/.worktrees/**'`；类型检查：`npx tsc -p tsconfig.json --noEmit`（exit 0）。

## 现有接口（已核验，勿重造）

- `findDailyMissionRunByRunId(outputDir, runId): Promise<DailyMissionRun | null>`；`loadDailyMissionRun(outputDir, date)`；`transitionDailyMissionRun(run, next, at)`；`isDailyMissionTerminalStatus(status)`；`saveDailyMissionRun(outputDir, run)`（`src/agentRuntime/dailyMissionRun.ts`）。
- `DailyMissionRun = { runId, date, status, trigger, startedAt, finishedAt?, artifactRefs }`；status ∈ collecting|planning|waiting_approval|executing|completed|failed|cancelled。
- `ClassifiedDecisions = { approvals: DecisionRecord[]; observations: DecisionRecord[] }`（`src/agentRuntime/decisionPolicy.ts`）。
- approval-request.json 内容即 `ClassifiedDecisions`（orchestrator 写入）。
- `dailyMissionArtifactPath(outputDir, date, 'approvalRequest'|'executionResults'|...)`（`src/agentRuntime/dailyMissionArtifacts.ts`）。
- `AgentToolDefinition.plannerVisible?: boolean`（`src/agentRuntime/tool.ts:13`）；`findAgentTool(name)` **不按 plannerVisible 过滤**（`toolRegistry.ts:860`）。
- `BotResponse = { text; card?: FeishuCardPayload; metadata? }`。
- `executeApprovedDecision`、`appendExecutionResult`、`writeExecutionResults`（`src/agentRuntime/dailyMissionExecution.ts`）。
- `recordOperationEvent(outputDir, entry)`（`src/agentRuntime/operationLedger.ts`）。

---

### Task 1: 持久化 approval-request 加载器 + 审批归属校验（P0-1）

**Files:**
- Create: `src/agentRuntime/dailyMissionApprovalStore.ts`
- Test: `tests/dailyMissionApprovalStore.test.ts`

**Interfaces:**
- Consumes: `ClassifiedDecisions`、`dailyMissionArtifactPath`、`DecisionRecord`。
- Produces: `loadApprovalRequest(outputDir, date): Promise<ClassifiedDecisions | null>`（文件缺失/坏 JSON 返回 null）；`findApprovedDecision(approval, decisionId): DecisionRecord | null`；`decisionMatchesRequest(decision, toolName, args): boolean`（比对 proposedTool.toolName 与规范化后的 arguments）。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionApprovalStore.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadApprovalRequest, findApprovedDecision, decisionMatchesRequest } from '../src/agentRuntime/dailyMissionApprovalStore.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

const approved: DecisionRecord = {
  decisionId: 'dec-1', runId: 'run-1', title: '下架 648', subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high',
  rationale: [], evidenceRefs: ['exposure'], uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

describe('dailyMissionApprovalStore', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-appr-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('loads approval-request and finds the approved decision by id', async () => {
    const p = join(dir, 'daily-mission', '2026-07-02', 'approval-request.json');
    await mkdir(join(dir, 'daily-mission', '2026-07-02'), { recursive: true });
    await writeFile(p, JSON.stringify({ approvals: [approved], observations: [] }), 'utf8');
    const approval = await loadApprovalRequest(dir, '2026-07-02');
    expect(approval).not.toBeNull();
    expect(findApprovedDecision(approval!, 'dec-1')?.decisionId).toBe('dec-1');
    expect(findApprovedDecision(approval!, 'nope')).toBeNull();
  });

  it('returns null when file missing', async () => {
    expect(await loadApprovalRequest(dir, '2026-07-02')).toBeNull();
  });

  it('matches request against approved decision tool + args regardless of key order', () => {
    expect(decisionMatchesRequest(approved, 'rental.delist', { productId: '648' })).toBe(true);
    expect(decisionMatchesRequest(approved, 'rental.priceApply', { productId: '648' })).toBe(false);
    expect(decisionMatchesRequest(approved, 'rental.delist', { productId: '999' })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionApprovalStore.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyMissionApprovalStore.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import type { ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function loadApprovalRequest(outputDir: string, date: string): Promise<ClassifiedDecisions | null> {
  try {
    const parsed = JSON.parse(await readFile(dailyMissionArtifactPath(outputDir, date, 'approvalRequest'), 'utf8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.approvals) || !Array.isArray(parsed.observations)) return null;
    return { approvals: parsed.approvals as DecisionRecord[], observations: parsed.observations as DecisionRecord[] };
  } catch {
    return null;
  }
}

export function findApprovedDecision(approval: ClassifiedDecisions, decisionId: string): DecisionRecord | null {
  return approval.approvals.find((decision) => decision.decisionId === decisionId) ?? null;
}

export function decisionMatchesRequest(decision: DecisionRecord, toolName: string, args: Record<string, unknown>): boolean {
  if (!decision.proposedTool) return false;
  if (decision.proposedTool.toolName !== toolName) return false;
  return canonical(decision.proposedTool.arguments) === canonical(args);
}
```

- [ ] **Step 4: 校验 artifact 键名**

Run: `grep -n "approvalRequest" src/agentRuntime/dailyMissionArtifacts.ts`
Expected: `approvalRequest: 'approval-request.json'`。不同则按实际键调整。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionApprovalStore.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/dailyMissionApprovalStore.ts tests/dailyMissionApprovalStore.test.ts
git commit -m "新增持久化 approval-request 加载与审批归属校验"
```

---

### Task 2: 幂等检查（P0-2）

**Files:**
- Modify: `src/agentRuntime/dailyMissionExecution.ts`
- Test: `tests/dailyMissionIdempotency.test.ts`

**Interfaces:**
- Produces: `loadExecutionResult(outputDir, date, decisionId): Promise<DailyMissionExecutionResult | null>`（读 execution-results.json 找已存在结果）；`executeApprovedDecision` 新增可选 `input.date`，执行前若已存在同 decisionId 且 `ok === true` 的结果，直接返回该结果且**不再调用 client**。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionIdempotency.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeApprovedDecision, appendExecutionResult } from '../src/agentRuntime/dailyMissionExecution.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

const decision: DecisionRecord = {
  decisionId: 'dec-1', runId: 'run-1', title: '下架 648', subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high',
  rationale: [], evidenceRefs: ['x'], uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

describe('daily mission idempotency', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-idem-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('does not call client again when decision already executed ok', async () => {
    await appendExecutionResult(dir, '2026-07-02', { decisionId: 'dec-1', ok: true, text: '已下架' });
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));
    const client = { delist, preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
    const result = await executeApprovedDecision({ decision, outputDir: dir, date: '2026-07-02', options: { rentalPriceClient: client } });
    expect(result.ok).toBe(true);
    expect(delist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionIdempotency.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前无幂等，client.delist 被调用。

- [ ] **Step 3: 实现**

In `src/agentRuntime/dailyMissionExecution.ts`, add loader and guard. Extend `ExecuteApprovedDecisionInput` with `date?: string`:

```ts
export async function loadExecutionResult(outputDir: string, date: string, decisionId: string): Promise<DailyMissionExecutionResult | null> {
  const path = dailyMissionArtifactPath(outputDir, date, 'executionResults');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return null;
    return (parsed.filter(isExecutionResult).find((entry) => entry.decisionId === decisionId)) ?? null;
  } catch {
    return null;
  }
}
```

In `executeApprovedDecision`, before recording approval_accepted:

```ts
  const { decision, outputDir } = input;
  if (input.date) {
    const existing = await loadExecutionResult(outputDir, input.date, decision.decisionId);
    if (existing && existing.ok) return existing;
  }
  // ...原有 approval_accepted + execute
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionIdempotency.test.ts tests/dailyMissionExecution.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionExecution.ts tests/dailyMissionIdempotency.test.ts
git commit -m "执行前按 runId+decisionId 幂等检查，已成功则不重复执行"
```

---

### Task 3: 决策工具白名单，拒绝 plannerVisible:false（P0-3）

**Files:**
- Modify: `src/agentRuntime/decisionPolicy.ts`
- Test: `tests/decisionPolicyHiddenTool.test.ts`

**Interfaces:**
- 修改 `toolArgumentsValid`：工具须存在、`plannerVisible !== false`、且 args 满足 schema，三者全真才算合法；否则决策降级为观察，`blockedReason='工具不允许自动审批'`。

- [ ] **Step 1: 写失败测试**

Create `tests/decisionPolicyHiddenTool.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(toolName: string): DecisionRecord {
  return {
    decisionId: 'd', runId: 'r', title: 't', subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down', recommendation: 'approve_to_execute', risk: 'high',
    rationale: ['x'], evidenceRefs: ['exposure'], uncertainties: [],
    proposedTool: { toolName, arguments: { items: [{ productId: '648', fields: { rent1day: '20.00' } }] } },
  };
}

describe('decision policy hidden tool rejection', () => {
  it('downgrades plannerVisible:false tools like rental.priceApply', () => {
    const { approvals, observations } = classifyDecisions([record('rental.priceApply')]);
    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具不允许自动审批');
  });
});
```

Run: `grep -n "rental.priceApply\|plannerVisible: false" src/agentRuntime/toolRegistry.ts` 确认 `rental.priceApply` 确为 `plannerVisible:false`（审计称 :684）。若示例工具名/schema 与实际不符，按实际调整测试的 toolName 与 arguments。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/decisionPolicyHiddenTool.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前 hidden 工具进 approvals。

- [ ] **Step 3: 实现**

In `src/agentRuntime/decisionPolicy.ts`, tighten `toolArgumentsValid` and reason:

```ts
function toolArgumentsValid(record: DecisionRecord): boolean {
  if (!record.proposedTool) return false;
  const tool = findAgentTool(record.proposedTool.toolName);
  if (!tool || tool.plannerVisible === false) return false;
  return schemaAllowsArguments(tool.inputSchema, record.proposedTool.arguments);
}

function blockedReason(record: DecisionRecord): string {
  if (!record.proposedTool) return '缺少可执行工具参数';
  const tool = findAgentTool(record.proposedTool.toolName);
  if (!tool || tool.plannerVisible === false) return '工具不允许自动审批';
  if (!schemaAllowsArguments(tool.inputSchema, record.proposedTool.arguments)) return '工具参数非法';
  if (record.uncertainties.length > 0) return '存在不确定项';
  return '证据不足';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/decisionPolicyHiddenTool.test.ts tests/decisionPolicyToolValidation.test.ts tests/decisionPolicy.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/decisionPolicy.ts tests/decisionPolicyHiddenTool.test.ts
git commit -m "DecisionPolicy 拒绝 plannerVisible:false 工具自动审批"
```

---

### Task 4: 二次确认卡 pending 态，不记执行成功（P0-4）

**Files:**
- Modify: `src/agentRuntime/dailyMissionExecution.ts`（`DailyMissionExecutionResult` + `executeApprovedDecision`）
- Test: `tests/dailyMissionPendingCard.test.ts`

**Interfaces:**
- `DailyMissionExecutionResult` 新增 `status: 'executed' | 'pending_confirmation' | 'failed'` 和可选 `card?: FeishuCardPayload`；`executeApprovedDecision`：当 `response.card` 存在时，`status='pending_confirmation'`、`ok=false`、保留 `card`；否则按 metadata.ok 判 executed/failed。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionPendingCard.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeApprovedDecision } from '../src/agentRuntime/dailyMissionExecution.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

// pricePreview 会返回二次确认卡；用一个多商品 preview 决策触发
const decision: DecisionRecord = {
  decisionId: 'dec-1', runId: 'run-1', title: '预览改价', subjects: [{ kind: 'product', id: '648' }],
  operationType: 'price_down', recommendation: 'approve_to_execute', risk: 'high',
  rationale: [], evidenceRefs: ['x'], uncertainties: [],
  proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
};

function client(): RentalPriceSkillClient {
  return { preview: async () => ({ productId: '648', fields: { rent1day: '18.00' }, lines: ['1天:20->18'], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
}

describe('pending confirmation card', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-pend-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('marks pending_confirmation and not ok when a card is returned', async () => {
    const result = await executeApprovedDecision({ decision, outputDir: dir, options: { rentalPriceClient: client() } });
    expect(result.status).toBe('pending_confirmation');
    expect(result.ok).toBe(false);
  });
});
```

Run: `grep -n "buildRentalPricePreviewCard\|return.*card\|metadata.*ok" src/feishuBot/agentToolExecutor.ts | head` 确认 `rental.pricePreview` 确会返回 `card`。若该工具在当前 client 形态下不返回 card，改用能稳定返回 card 的工具/参数或 mock `executeAgentToolRequest`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionPendingCard.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前 result 无 status 字段、pending 被记 ok。

- [ ] **Step 3: 实现**

In `src/agentRuntime/dailyMissionExecution.ts`:

```ts
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface DailyMissionExecutionResult {
  decisionId: string;
  ok: boolean;
  status: 'executed' | 'pending_confirmation' | 'failed';
  text: string;
  card?: FeishuCardPayload;
}
```

In `executeApprovedDecision`, replace the return:

```ts
  const response = await executeAgentToolRequest(decisionToConfirmRequest(decision), outputDir, {
    ...input.options,
    ledgerContext: { outputDir, runId: decision.runId, decisionId: decision.decisionId },
  });
  if (response.card) {
    return { decisionId: decision.decisionId, ok: false, status: 'pending_confirmation', text: response.text, card: response.card };
  }
  const ok = response.metadata?.ok !== false;
  return { decisionId: decision.decisionId, ok, status: ok ? 'executed' : 'failed', text: response.text };
```

同步更新 `isExecutionResult` 类型守卫允许新增字段（`status` 必有，`card` 可选）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionPendingCard.test.ts tests/dailyMissionExecution.test.ts tests/dailyMissionIdempotency.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionExecution.ts tests/dailyMissionPendingCard.test.ts
git commit -m "执行结果区分 pending_confirmation，二次确认卡不记成功"
```

---

### Task 5: 审批回调改用持久化决策 + 全校验（P0-1 收口）

**Files:**
- Modify: `src/agentRuntime/dailyMissionApprovalCallback.ts`
- Test: `tests/dailyMissionApprovalCallbackGuard.test.ts`

**Interfaces:**
- `resolveDailyMissionApproval` 重写：解析 tag → 加载 run（须存在且 `status === 'waiting_approval' || 'executing'`，终态/取消拒绝）→ 加载 approval-request → `findApprovedDecision` 必须命中 → `decisionMatchesRequest` 必须一致 → 用**持久化的已批准决策**（非卡片重建）调 `executeApprovedDecision`（传 `date`）。任一校验失败抛错并**不执行**。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionApprovalCallbackGuard.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { saveDailyMissionRun, createDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

async function seedRun(dir: string, status: 'waiting_approval' | 'completed') {
  let run = createDailyMissionRun({ runId: 'run-1', date: '2026-07-02', trigger: 'manual', startedAt: '2026-07-02T00:00:00.000Z' });
  if (status === 'completed') {
    run = transitionDailyMissionRun(run, 'planning', 'x');
    run = transitionDailyMissionRun(run, 'waiting_approval', 'x');
    run = transitionDailyMissionRun(run, 'executing', 'x');
    run = transitionDailyMissionRun(run, 'completed', 'x');
  }
  await saveDailyMissionRun(dir, run);
  const dmDir = join(dir, 'daily-mission', '2026-07-02');
  await mkdir(dmDir, { recursive: true });
  await writeFile(join(dmDir, 'approval-request.json'), JSON.stringify({
    approvals: [{ decisionId: 'dec-1', runId: 'run-1', title: '下架 648', subjects: [{ kind: 'product', id: '648' }], operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high', rationale: [], evidenceRefs: ['x'], uncertainties: [], proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } } }],
    observations: [],
  }), 'utf8');
}

function client(delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }))): { client: RentalPriceSkillClient; delist: typeof delist } {
  const c = { delist, preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
  return { client: c, delist };
}

const req = (over: Partial<{ toolName: string; args: Record<string, unknown>; decisionId: string }> = {}) => ({
  toolName: over.toolName ?? 'rental.delist',
  arguments: over.args ?? { productId: '648' },
  reason: `[[dailyMission:runId=run-1;decisionId=${over.decisionId ?? 'dec-1'}]] 下架 648`,
});

describe('resolveDailyMissionApproval guards', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-guard-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('executes when run is waiting_approval and decision matches', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();
    const result = await resolveDailyMissionApproval(req(), dir, { rentalPriceClient: c });
    expect(result?.ok).toBe(true);
    expect(delist).toHaveBeenCalledTimes(1);
  });

  it('rejects when run is terminal', async () => {
    await seedRun(dir, 'completed');
    const { client: c, delist } = client();
    await expect(resolveDailyMissionApproval(req(), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });

  it('rejects when decisionId not in approval-request', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();
    await expect(resolveDailyMissionApproval(req({ decisionId: 'nope' }), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });

  it('rejects when args mismatch persisted approval', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();
    await expect(resolveDailyMissionApproval(req({ args: { productId: '999' } }), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionApprovalCallbackGuard.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前回调不校验 run 态/归属/参数。

- [ ] **Step 3: 重写回调**

Rewrite `src/agentRuntime/dailyMissionApprovalCallback.ts`:

```ts
import type { AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { findApprovedDecision, decisionMatchesRequest, loadApprovalRequest } from './dailyMissionApprovalStore.js';
import { appendExecutionResult, executeApprovedDecision, type DailyMissionExecutionResult } from './dailyMissionExecution.js';
import { findDailyMissionRunByRunId, isDailyMissionTerminalStatus } from './dailyMissionRun.js';

export async function resolveDailyMissionApproval(
  request: AgentToolConfirmRequest,
  outputDir: string,
  options?: AgentToolExecutionOptions,
): Promise<DailyMissionExecutionResult | null> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return null;

  const run = await findDailyMissionRunByRunId(outputDir, tag.runId);
  if (!run) throw new Error(`Daily Mission run not found: ${tag.runId}`);
  if (isDailyMissionTerminalStatus(run.status)) throw new Error(`Daily Mission run ${tag.runId} is terminal (${run.status}); refusing execution.`);
  if (run.status !== 'waiting_approval' && run.status !== 'executing') throw new Error(`Daily Mission run ${tag.runId} not awaiting approval (${run.status}).`);

  const approval = await loadApprovalRequest(outputDir, run.date);
  if (!approval) throw new Error(`No approval-request for run ${tag.runId} on ${run.date}.`);
  const decision = findApprovedDecision(approval, tag.decisionId);
  if (!decision) throw new Error(`Decision ${tag.decisionId} is not in the approved set for run ${tag.runId}.`);
  if (!decisionMatchesRequest(decision, request.toolName, request.arguments)) {
    throw new Error(`Confirm request does not match approved decision ${tag.decisionId}.`);
  }

  const result = await executeApprovedDecision({ decision, outputDir, date: run.date, options });
  await appendExecutionResult(outputDir, run.date, result);
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionApprovalCallbackGuard.test.ts tests/dailyMissionApprovalCallback.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。（若旧 `dailyMissionApprovalCallback.test.ts` 因新校验失败，更新其夹具：先 seed 一个 waiting_approval run + approval-request。）

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionApprovalCallback.ts tests/dailyMissionApprovalCallbackGuard.test.ts tests/dailyMissionApprovalCallback.test.ts
git commit -m "审批回调改用持久化决策并校验 run态/归属/参数一致"
```

---

### Task 6: ledgerContext 覆盖 priceApply / refreshActivityExecute（P0-5）

**Files:**
- Modify: `src/feishuBot/agentToolExecutor.ts`（:1653 refreshActivityExecute、:1692 priceApply 分支及其执行函数签名）
- Test: `tests/agentToolExecutorLedgerCoverage.test.ts`

**Interfaces:**
- `refreshActivityExecuteResponse`、`rental.priceApply` 执行路径接收并透传 `options.ledgerContext`，使其真实写操作产生带 `runId/decisionId/subject` 的 `execution_*` 事件。

- [ ] **Step 1: 勘察实际执行函数签名（阻塞前置）**

Run: `sed -n '1685,1700p' src/feishuBot/agentToolExecutor.ts` 与 `grep -n "async function refreshActivityExecuteResponse\|async function.*priceApply\|readPriceApplyItems\|client.execute" src/feishuBot/agentToolExecutor.ts`
读出 priceApply 分支如何逐项调用 `client.execute`、refreshActivityExecute 如何调用 delist/copy，确定在哪里插入 `recordOperationEvent` 或透传 ledgerContext。**以真实代码为准**。

- [ ] **Step 2: 写失败测试**

Create `tests/agentToolExecutorLedgerCoverage.test.ts`（以 priceApply 为例，按 Step 1 实际参数形状构造）:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function client(): RentalPriceSkillClient {
  return { preview: async () => ({ productId: '648', fields: { rent1day: '18.00' }, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: ['done'] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
}

describe('ledgerContext coverage for priceApply', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-cov-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records execution events with attribution for rental.priceApply', async () => {
    await executeAgentToolRequest(
      { toolName: 'rental.priceApply', arguments: { items: [{ productId: '648', fields: { rent1day: '18.00' } }] }, reason: 'x' },
      dir,
      { rentalPriceClient: client(), ledgerContext: { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' } },
    );
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((e) => e.event === 'execution_succeeded' && e.decisionId === 'dec-1')).toBe(true);
  });
});
```

（`rental.priceApply` 的 arguments 形状以 Step 1 勘察为准；若需先 preview 再 apply，按实际调整。）

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/agentToolExecutorLedgerCoverage.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — priceApply 路径未产生带 decisionId 的 execution 事件。

- [ ] **Step 4: 实现透传**

按 Step 1 结果，在 priceApply 与 refreshActivityExecute 执行路径中，于每个实际写操作前后调用 `recordOperationEvent`（带 `options.ledgerContext` 的 runId/decisionId + 对应 subject），或把 ledgerContext 传入其执行函数。示意（priceApply 逐项）：

```ts
    case 'rental.priceApply': {
      // ...读出 items 后，对每项 execute 前后：
      // if (options.ledgerContext) await recordOperationEvent(options.ledgerContext.outputDir, { planId: options.ledgerContext.decisionId ?? runId, at: new Date().toISOString(), event: 'execution_started', runId: options.ledgerContext.runId, decisionId: options.ledgerContext.decisionId, toolName: 'rental.priceApply', subject: { kind: 'product', id: item.productId } });
      // ...execute... 成功/失败后记 execution_succeeded / execution_failed
    }
```

`refreshActivityExecuteResponse` 增加可选 `ledgerContext` 形参并在 :1653 传入 `options.ledgerContext`，内部下架/补链处记事件。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/agentToolExecutorLedgerCoverage.test.ts tests/feishuBotTools.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/feishuBot/agentToolExecutor.ts tests/agentToolExecutorLedgerCoverage.test.ts
git commit -m "ledgerContext 覆盖 priceApply/refreshActivityExecute 真实写路径"
```

---

### Task 7: 记录 approval_rejected（P0-6）

**Files:**
- Create: `src/agentRuntime/dailyMissionRejection.ts`
- Modify: 飞书取消回调分发（先 `grep -rn "agent_tool_cancel" src/feishuBot/server.ts src/feishuBot/sdkClient.ts`）
- Test: `tests/dailyMissionRejection.test.ts`

**Interfaces:**
- Produces: `recordDailyMissionRejection(request, outputDir): Promise<boolean>`——若 request.reason（或 cancel payload 携带的 tag）命中 dailyMission，写 `approval_rejected` 事件（带 runId/decisionId/subject）并返回 true；否则 false。取消回调命中时调用它。
- 勘察前置：取消按钮当前只带 `action/toolName/confirmationKey`（审计 P0-6），**不带 reason**。因此需先让 `buildDailyMissionApprovalCards` 生成的卡片在 cancel behavior 里带上 dailyMission tag（requestRef 或 reason 摘要），Task 7 Step 1 先确认取消 payload 能否拿到 tag；拿不到则先扩展审批卡的 cancel payload。

- [ ] **Step 1: 勘察取消 payload（阻塞前置）**

Run: `grep -n "agent_tool_cancel" src/agentRuntime/approvalCard.ts src/feishuBot/server.ts src/feishuBot/sdkClient.ts`
读出取消回调能拿到哪些字段。若拿不到 dailyMission tag，则在 `buildDailyMissionApprovalCards`（`src/agentRuntime/dailyMissionApproval.ts`）改为透传 requestRef，并让 cancel payload 带上它。**以真实回调 payload 为准**。

- [ ] **Step 2: 写失败测试**

Create `tests/dailyMissionRejection.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordDailyMissionRejection } from '../src/agentRuntime/dailyMissionRejection.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

describe('recordDailyMissionRejection', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-rej-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records approval_rejected for a daily-mission tagged cancel', async () => {
    const handled = await recordDailyMissionRejection({ toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架 648' }, dir);
    expect(handled).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((e) => e.event === 'approval_rejected' && e.decisionId === 'dec-1')).toBe(true);
  });

  it('returns false for non-daily-mission cancels', async () => {
    expect(await recordDailyMissionRejection({ toolName: 'rental.delist', arguments: {}, reason: '普通取消' }, dir)).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionRejection.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现**

Create `src/agentRuntime/dailyMissionRejection.ts`:

```ts
import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { recordOperationEvent } from './operationLedger.js';

export async function recordDailyMissionRejection(
  request: Pick<AgentToolConfirmRequest, 'toolName' | 'arguments' | 'reason'>,
  outputDir: string,
): Promise<boolean> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return false;
  const productId = typeof request.arguments.productId === 'string' ? request.arguments.productId : 'unknown';
  await recordOperationEvent(outputDir, {
    planId: tag.decisionId,
    at: new Date().toISOString(),
    event: 'approval_rejected',
    runId: tag.runId,
    decisionId: tag.decisionId,
    subject: { kind: 'product', id: productId },
  });
  return true;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionRejection.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: 挂进取消回调**

按 Step 1 结果，在 `server.ts` / `sdkClient.ts` 的 `agent_tool_cancel` 处理里，取消状态设置前调用 `recordDailyMissionRejection(...)`（reason/tag 来自 Step 1 确认的可得字段）。两处保持一致。

- [ ] **Step 7: 回归 + Commit**

```bash
npx vitest run tests/feishuBotServer.test.ts tests/feishuBotSdkCardAction.test.ts --exclude '**/.worktrees/**'
git add src/agentRuntime/dailyMissionRejection.ts src/agentRuntime/dailyMissionApproval.ts src/feishuBot/server.ts src/feishuBot/sdkClient.ts tests/dailyMissionRejection.test.ts
git commit -m "审批取消记录 approval_rejected 事件"
```

---

### Task 8: 执行后推进 run 状态（P1-7）

**Files:**
- Modify: `src/agentRuntime/dailyMissionApprovalCallback.ts`
- Test: `tests/dailyMissionRunAdvance.test.ts`

**Interfaces:**
- 回调执行后按结果推进 run：`waiting_approval → executing`（首个执行）；当该 run 的所有 approved 决策都有 executed/failed 结果时 `→ completed`；有 failed 且无 pending 时 `→ failed`；存在 pending_confirmation 保持 executing。用 `loadApprovalRequest` 的 approvals 数与 `execution-results.json` 已终态结果数比对判断完成。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionRunAdvance.test.ts`（seed 单决策 run，执行后应 completed）:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, transitionDailyMissionRun, saveDailyMissionRun, loadDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

async function seed(dir: string) {
  let run = createDailyMissionRun({ runId: 'run-1', date: '2026-07-02', trigger: 'manual', startedAt: 'x' });
  run = transitionDailyMissionRun(run, 'planning', 'x');
  run = transitionDailyMissionRun(run, 'waiting_approval', 'x');
  await saveDailyMissionRun(dir, run);
  const d = join(dir, 'daily-mission', '2026-07-02'); await mkdir(d, { recursive: true });
  await writeFile(join(d, 'approval-request.json'), JSON.stringify({ approvals: [{ decisionId: 'dec-1', runId: 'run-1', title: '下架', subjects: [{ kind: 'product', id: '648' }], operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high', rationale: [], evidenceRefs: ['x'], uncertainties: [], proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } } }], observations: [] }), 'utf8');
}
function client(): RentalPriceSkillClient {
  return { delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }), preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
}

describe('run advance after execution', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-adv-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('advances run to completed when the only approved decision executes ok', async () => {
    await seed(dir);
    await resolveDailyMissionApproval({ toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架' }, dir, { rentalPriceClient: client() });
    const run = await loadDailyMissionRun(dir, '2026-07-02');
    expect(run?.status).toBe('completed');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionRunAdvance.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前回调不推进 run 状态。

- [ ] **Step 3: 实现推进**

In `resolveDailyMissionApproval`, after `appendExecutionResult`, load run/approval/results and advance:

```ts
  // 执行并 append 后：
  const now = new Date().toISOString();
  let advanced = run;
  if (run.status === 'waiting_approval') advanced = transitionDailyMissionRun(advanced, 'executing', now);
  const results = await loadAllExecutionResults(outputDir, run.date); // 新增：读整份 execution-results
  const terminal = results.filter((r) => r.status === 'executed' || r.status === 'failed');
  const pending = results.some((r) => r.status === 'pending_confirmation');
  if (!pending && terminal.length >= approval.approvals.length) {
    const anyFailed = terminal.some((r) => r.status === 'failed');
    advanced = transitionDailyMissionRun(advanced, anyFailed ? 'failed' : 'completed', now);
  }
  await saveDailyMissionRun(outputDir, advanced);
  return result;
```

`loadAllExecutionResults` 加在 `dailyMissionExecution.ts`（读整个 execution-results.json 数组）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionRunAdvance.test.ts tests/dailyMissionApprovalCallbackGuard.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionApprovalCallback.ts src/agentRuntime/dailyMissionExecution.ts tests/dailyMissionRunAdvance.test.ts
git commit -m "审批执行后推进 DailyMissionRun 状态"
```

---

### Task 9: 审计汇总聚合 decisions/approvals/executions（P1-14）+ JSONL 坏行容错（P1-13）

**Files:**
- Modify: `src/agentRuntime/operationLedger.ts`（`loadOperationLedgerJsonlEntries` 坏行跳过）
- Modify: `src/cli/dailyMissionAudit.ts`（`buildDailyMissionAuditSummary` 聚合产物）
- Test: `tests/dailyMissionAuditSummary.test.ts`、`tests/operationLedgerBadLine.test.ts`

**Interfaces:**
- `loadOperationLedgerJsonlEntries` 逐行 parse，坏行跳过并计数（返回结构不变，坏行不抛错）。
- `buildDailyMissionAuditSummary` 增加读取 approval-request（approvals/observations 数）、execution-results（executed/pending/failed 数）、run 状态，汇总进 `lines`。

- [ ] **Step 1: 写坏行测试**

Create `tests/operationLedgerBadLine.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries, operationLedgerJsonlPath } from '../src/agentRuntime/operationLedger.js';

describe('ledger bad line tolerance', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-bad-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('skips corrupt lines and returns valid entries', async () => {
    const p = operationLedgerJsonlPath(dir, '2026-07-02');
    await mkdir(join(dir, 'operation-ledger'), { recursive: true });
    await writeFile(p, `${JSON.stringify({ planId: 'a', at: '2026-07-02T00:00:00.000Z', event: 'data_collected' })}\n{corrupt json\n${JSON.stringify({ planId: 'b', at: '2026-07-02T00:00:01.000Z', event: 'decision_created' })}\n`, 'utf8');
    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-02');
    expect(entries.map((e) => e.event)).toEqual(['data_collected', 'decision_created']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/operationLedgerBadLine.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 坏行导致 `JSON.parse` 抛错。

- [ ] **Step 3: 坏行跳过**

In `src/agentRuntime/operationLedger.ts` `loadOperationLedgerJsonlEntries`, replace map with a per-line try/catch:

```ts
    const entries: OperationPlanJournalEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line) as OperationPlanJournalEntry); }
      catch { /* skip corrupt line */ }
    }
    return entries;
```

- [ ] **Step 4: 写审计汇总测试**

Create `tests/dailyMissionAuditSummary.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailyMissionAuditSummary } from '../src/cli/dailyMissionAudit.js';

describe('audit summary aggregation', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-auds-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('includes approval and execution counts', async () => {
    const d = join(dir, 'daily-mission', '2026-07-02'); await mkdir(d, { recursive: true });
    await writeFile(join(d, 'approval-request.json'), JSON.stringify({ approvals: [{ decisionId: 'dec-1' }], observations: [{ decisionId: 'o1' }] }), 'utf8');
    await writeFile(join(d, 'execution-results.json'), JSON.stringify([{ decisionId: 'dec-1', ok: true, status: 'executed', text: '' }]), 'utf8');
    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-02');
    const text = summary.lines.join('\n');
    expect(text).toContain('待审批');
    expect(text).toContain('已执行');
  });
});
```

- [ ] **Step 5: 运行确认失败**

Run: `npx vitest run tests/dailyMissionAuditSummary.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 当前 audit 只统计 ledger 事件。

- [ ] **Step 6: 实现聚合**

In `src/cli/dailyMissionAudit.ts` `buildDailyMissionAuditSummary`, additionally load approval-request 与 execution-results（用 Task 1 的 `loadApprovalRequest` 和一个读 execution-results 的 helper），把 `待审批 N | 观察 M | 已执行 X | 待二次确认 Y | 失败 Z` 加进 `lines`。

- [ ] **Step 7: 运行确认通过 + Commit**

Run: `npx vitest run tests/dailyMissionAuditSummary.test.ts tests/operationLedgerBadLine.test.ts tests/dailyMissionAudit.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

```bash
git add src/agentRuntime/operationLedger.ts src/cli/dailyMissionAudit.ts tests/dailyMissionAuditSummary.test.ts tests/operationLedgerBadLine.test.ts
git commit -m "审计汇总聚合审批/执行 + JSONL 坏行跳过"
```

---

### Task 10: 端到端硬化集成测试 + 全量回归

**Files:**
- Test: `tests/dailyMissionHardeningIntegration.test.ts`

- [ ] **Step 1: 写集成测试**

覆盖：seed waiting_approval run + approval-request → 合法确认执行成功、run→completed、ledger 有 approval_accepted+execution_succeeded → 重复确认不重复执行（幂等）→ 终态 run 再确认被拒。

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, transitionDailyMissionRun, saveDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

async function seed(dir: string) {
  let run = createDailyMissionRun({ runId: 'run-1', date: '2026-07-02', trigger: 'manual', startedAt: 'x' });
  run = transitionDailyMissionRun(run, 'planning', 'x');
  run = transitionDailyMissionRun(run, 'waiting_approval', 'x');
  await saveDailyMissionRun(dir, run);
  const d = join(dir, 'daily-mission', '2026-07-02'); await mkdir(d, { recursive: true });
  await writeFile(join(d, 'approval-request.json'), JSON.stringify({ approvals: [{ decisionId: 'dec-1', runId: 'run-1', title: '下架', subjects: [{ kind: 'product', id: '648' }], operationType: 'delist', recommendation: 'approve_to_execute', risk: 'high', rationale: [], evidenceRefs: ['x'], uncertainties: [], proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } } }], observations: [] }), 'utf8');
}

describe('daily mission hardening integration', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-hard-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('executes once, records chain, is idempotent on repeat', async () => {
    await seed(dir);
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));
    const client = { delist, preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
    const req = { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架' };
    await resolveDailyMissionApproval(req, dir, { rentalPriceClient: client });
    await resolveDailyMissionApproval(req, dir, { rentalPriceClient: client }); // 幂等：run 已 completed 或 result 已 ok
    expect(delist).toHaveBeenCalledTimes(1);
    const chain = (await loadOperationLedgerJsonlEntries(dir, '2026-07-02')).filter((e) => e.decisionId === 'dec-1').map((e) => e.event);
    expect(chain).toContain('approval_accepted');
    expect(chain).toContain('execution_succeeded');
  });
});
```

（第二次确认时 run 已 completed，按 Task 5 校验会抛错；测试改为 `await expect(second).rejects.toThrow()` 或用幂等返回。二选一，按 Task 5/8 最终行为对齐断言。）

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run tests/dailyMissionHardeningIntegration.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 3: 全量回归**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`
Expected: 全部通过。

- [ ] **Step 4: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add tests/dailyMissionHardeningIntegration.test.ts
git commit -m "新增 Daily Mission 写安全硬化端到端集成测试"
```

---

## 本计划覆盖的审计条目

- P0-1 → Task 1 + Task 5（持久化决策 + run态/归属/参数校验）
- P0-2 → Task 2（幂等）
- P0-3 → Task 3（plannerVisible 白名单）
- P0-4 → Task 4（pending 卡不记成功）
- P0-5 → Task 6（ledgerContext 覆盖）
- P0-6 → Task 7（approval_rejected）
- P1-7 → Task 8（run 态推进）
- P1-13 → Task 9（JSONL 坏行）
- P1-14 → Task 9（audit 聚合）

## 未纳入本计划（后续单独排期）

- P1-8 post-execution journal 重写（依赖 Task 8 的 run 态；建议紧接 Task 8 之后做，需扩展 `WriteDailyJournalInput` 纳入 execution-results）。
- P1-9 事件 mission-date 分区、P1-10 同日多 run、P1-11 execution-results 并发锁、P1-12 recordOperationEvent 双写原子性——属持久化一致性重构，建议合并为一个"Ledger/Artifact 一致性"专项计划。
- P2-15 subjects minItems、P2-16 LLM 非法决策转 blocked observation、P2-17 热点缺失 missingSources、P2-18 env 变量统一——数据契约小批量，建议一个 P2 收尾计划。

## Self-Review

- **Spec 覆盖**：全部 6 个 P0 各有任务；关键 P1（7/13/14）纳入；其余 P1/P2 明确列入"未纳入/后续"，非遗漏。
- **Placeholder**：Task 6/7 各有一处"阻塞前置勘察步骤"（priceApply 执行函数形状、cancel payload 字段）——已用 Global Constraints 声明为阻塞前置并给 grep 命令，非空泛占位。
- **类型一致**：`DailyMissionExecutionResult.status`（Task 4 引入）在 Task 8 判定 terminal/pending、Task 9 audit 计数一致；`loadApprovalRequest`/`findApprovedDecision`/`decisionMatchesRequest`（Task 1）在 Task 5/9 引用一致；`executeApprovedDecision` 的 `date` 形参（Task 2）在 Task 5 传入一致。
- **依赖顺序**：1→2→3→4→5→6→7→8→9→10。Task 5 依赖 1/2/4；Task 8 依赖 5；Task 9 依赖 1/4。可并行 {1,2,3,4,6,7}，再 5→8→9→10。
