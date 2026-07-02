# Rental 工具原子化重构（增量·非破坏）实施计划

> **执行说明：** 逐任务 checkbox。**本计划全程"增量叠加"：只新增原子工具，不改名、不删除、不改语义现有工具；共享文件（toolRegistry.ts / agentToolExecutor.ts / rentalPrice.ts）只在新增区域追加。** 因此可与正在进行的飞轮 B层并行，且能在 B层落地后干净合入。

**Goal:** 把 rental-price skill 已具备但被 MT-agent 粗化/未暴露的原子能力（按规格差异化改价、规格维度增删）忠实地暴露为原子工具，每个写工具套 plan→确认→apply→验真→ledger 安全信封；场景组合交给 agentic loop，而非打包进工具。

**Architecture:** skill 的 daemon action 本就原子（read/apply(nested)/spec-add-dim/spec-remove-dim/…）；本重构在 MT-agent 侧新增与之 1:1 的原子工具，不再把多 action 打包成场景工具。写工具走两段式（plan 预览→apply 执行），复用现有确认卡 + `ledgerContext` 归因。

**Tech Stack:** TypeScript (ESM, `.js` 后缀), vitest。复用 `RentalPriceSkillClient`、daemon `send`、approvalCard、`executeAgentToolRequest` dispatch、`ledgerContext`。

## Global Constraints（并行安全的硬约束）

- **只新增，不破坏**：不改名/不删除/不改变现有工具（`rental.priceChange` 广播、`specAddAndRefresh`、`refreshActivityExecute` 等保持原样）。
- **共享文件只追加**：`toolRegistry.ts`（工具数组末尾追加）、`agentToolExecutor.ts`（dispatch 追加 case）、`rentalPrice.ts`（client 接口追加可选方法）——不改现有行，降低与 B层的合并冲突。
- **原子工具 = 一个 daemon action + 安全信封**：不在工具内做场景编排；相对计算（如"母规格+30"）由调用方（loop/人）先算成绝对值再传，工具只写绝对值。
- 写操作走 plan→确认卡→apply→readback 验真→ledger（带 `runId?/decisionId?/subject`）。
- 所有 import 用 `.js` 后缀。
- 接线勘察为阻塞前置：标注"grep 定位/以实际为准"的步骤先读真实代码。
- 测试：`npx vitest run <file> --exclude '**/.worktrees/**'`；类型检查 `npx tsc -p tsconfig.json --noEmit` exit 0。

## 能力对照（skill 有 / MT-agent 现状 / 本计划新增）

| daemon 原子能力 | skill | MT-agent 现状 | 本计划 |
|---|:---:|---|---|
| `apply` nested `{specId:{field:value}}` | ✅（playwright-runner.js:319） | ❌ 改价广播式（RentalPriceChangeRequest 无 specId） | **新增 per-spec 改价工具** |
| `spec-add-dim` | ✅（:1474） | ❌ 未暴露 | **新增 specDim 工具（add）** |
| `spec-remove-dim` | ✅（:1481） | ❌ 未暴露 | **新增 specDim 工具（remove）** |
| `read`/`spec-discover`/`platform-search`/`batch-read` | ✅ | ✅ 已暴露（Phase 1 只读工具） | 不动 |
| `copy`/`delist`/`tenancy-set`/`spec-add-item` | ✅ | ✅ 已暴露（可能偏粗，保留兼容） | 不动 |

> 注：**"同品类销量排名""跨天窗口发现"不是 skill 能力**（skill 只是浏览器操作），属 MT-agent 数据层，**不在本计划**，另行排期。本计划范围 = rental 写侧原子化。

---

### Task 1: client 层新增 `applyPerSpec`（按规格写绝对值）

**Files:**
- Modify: `src/feishuBot/rentalPrice.ts`（`RentalPriceSkillClient` 追加可选方法 + `createRentalPriceSkillClient` 实现）
- Test: `tests/rentalPriceApplyPerSpec.test.ts`

**Interfaces:**
- Consumes: daemon `send({ action: 'apply', productId, changesFile })` 的 nested 格式（`{specId:{field:value}}`），随后 `submit` + `read` 验真。
- Produces: `RentalPriceSkillClient.applyPerSpec?(productId: string, specFields: Record<string, Record<string, string>>): Promise<RentalPriceExecutionResult>`——把 nested changes 交给 daemon apply→submit→readback，返回与 `execute` 同构的结果。**只写传入的 specId/字段的绝对值，不广播。**

- [ ] **Step 1: 勘察 daemon apply 的 nested 入口（阻塞前置）**

Run: `sed -n '311,370p' vendor/rental-price-agent/scripts/playwright-runner.js`（读 `applyFieldsOnPage` 如何区分 nested vs 广播；确认 nested 是 `{specId:{field:value}}`）。再 `grep -n "action: 'apply'\|changesFile\|writeChangesFile\|send(" src/feishuBot/rentalPrice.ts` 看现有 `execute` 如何把 changes 传给 daemon（是否落临时 changesFile）。**以真实实现为准复用其 changes 写入/传输方式。**

- [ ] **Step 2: 写失败测试**

Create `tests/rentalPriceApplyPerSpec.test.ts`（用可注入的 fake daemon send 或按现有 client 测试夹具形态）:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('applyPerSpec', () => {
  it('sends nested per-spec changes to daemon apply and does not broadcast', async () => {
    const send = vi.fn(async (cmd: Record<string, unknown>) => {
      if (cmd.action === 'apply') return { status: 'ok', applied: 2 };
      if (cmd.action === 'submit') return { status: 'ok', submitted: true };
      if (cmd.action === 'read') return { status: 'ok', productId: '648', specs: [{ specId: '3862', title: 'A' }, { specId: '3863', title: 'B' }], values: { '3862': { rent1day: '50.00' }, '3863': { rent1day: '80.00' } } };
      return { status: 'ok' };
    });
    const client = createRentalPriceSkillClient({ send } as never); // 以实际构造签名为准
    const result = await client.applyPerSpec!('648', { '3862': { rent1day: '50.00' }, '3863': { rent1day: '80.00' } });
    expect(result.ok).toBe(true);
    const applyCall = send.mock.calls.find((c) => (c[0] as { action: string }).action === 'apply')?.[0] as Record<string, unknown>;
    // 断言传给 daemon 的 changes 是 nested，且只含传入的 specId
    expect(applyCall).toBeTruthy();
  });
});
```

> Step 1 若发现 `createRentalPriceSkillClient` 不接受可注入 `send`（而是内部构造 daemon 客户端），则按现有 client 测试的注入方式（look at `tests/feishuBotRentalPrice.test.ts` 如何 fake daemon）改写本测试的注入形态。

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/rentalPriceApplyPerSpec.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `applyPerSpec` 未定义。

- [ ] **Step 4: 实现**

In `rentalPrice.ts`, 接口追加：

```ts
  applyPerSpec?(productId: string, specFields: Record<string, Record<string, string>>): Promise<RentalPriceExecutionResult>;
```

在 `createRentalPriceSkillClient` 返回对象追加实现（复用现有 `execute` 的 changesFile 写入 + apply/submit/read 验真流程，只是 changes 用 nested 结构；字段经 `PRICE_FIELD_NAMES` 白名单 + `money()` 规范化）：

```ts
    async applyPerSpec(productId, specFields) {
      const normalized: Record<string, Record<string, string>> = {};
      for (const [specId, fields] of Object.entries(specFields)) {
        const clean: Record<string, string> = {};
        for (const [field, value] of Object.entries(fields)) {
          if (PRICE_FIELD_NAMES.has(field)) clean[field] = money(value);
        }
        if (Object.keys(clean).length) normalized[specId] = clean;
      }
      // 写 nested changesFile → send apply → submit → read 验真（复用 execute 的既有 helper）
      // 返回 { productId, ok, lines, ... } 同 RentalPriceExecutionResult
    }
```

（具体 apply/submit/read 调用复用 Step 1 勘察到的现有 helper，勿另造。）

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `npx vitest run tests/rentalPriceApplyPerSpec.test.ts tests/feishuBotRentalPrice.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/feishuBot/rentalPrice.ts tests/rentalPriceApplyPerSpec.test.ts
git commit -m "client 新增 applyPerSpec 按规格写绝对值（复用 daemon nested apply）"
```

---

### Task 2: client 层新增 `specAddDim` / `specRemoveDim`

**Files:**
- Modify: `src/feishuBot/rentalPrice.ts`
- Test: `tests/rentalPriceSpecDim.test.ts`

**Interfaces:**
- Produces: `specAddDim?(productId: string, title: string): Promise<RentalPriceSpecAddResult>`（daemon `spec-add-dim`，itemTitle 作维度标题）；`specRemoveDim?(request: { productId: string; specDimId: string }): Promise<RentalPriceSpecRemoveResult>`（daemon `spec-remove-dim`）。均执行后 `spec-discover` 验真返回结构。

- [ ] **Step 1: 勘察 daemon 分发（阻塞前置）**

Run: `sed -n '1472,1490p' vendor/rental-price-agent/scripts/playwright-runner.js`（确认 `spec-add-dim` 用 `itemTitle` 作维度名、`spec-remove-dim` 用 `specDimId`，及是否需 `allowCurrentPage/expectedProductId`）。以真实入参为准。

- [ ] **Step 2: 写失败测试**

Create `tests/rentalPriceSpecDim.test.ts`（fake send 断言发出 `spec-add-dim` / `spec-remove-dim`）:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('spec dimension client', () => {
  it('sends spec-add-dim with title', async () => {
    const send = vi.fn(async (cmd: Record<string, unknown>) => {
      if (cmd.action === 'spec-add-dim') return { status: 'ok', action: 'add-dim', title: '激光险' };
      if (cmd.action === 'spec-discover') return { status: 'ok', dimensions: [] };
      return { status: 'ok' };
    });
    const client = createRentalPriceSkillClient({ send } as never);
    const result = await client.specAddDim!('648', '激光险');
    expect(result.ok).toBe(true);
    expect(send.mock.calls.some((c) => (c[0] as { action: string }).action === 'spec-add-dim')).toBe(true);
  });
});
```

- [ ] **Step 3–6:** 运行失败 → 在 `rentalPrice.ts` 接口 + 实现追加 `specAddDim`（send `{action:'spec-add-dim', productId, itemTitle:title}` → spec-discover 验真）与 `specRemoveDim`（send `{action:'spec-remove-dim', productId, specDimId}`）→ 通过 → 回归 `feishuBotRentalPrice` → Commit `git commit -m "client 新增 specAddDim/specRemoveDim（暴露 skill 规格维度能力）"`。

---

### Task 3: 原子工具 `rental.perSpecPricePlan` / `rental.perSpecPriceApply`

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`（末尾追加两个工具 + schema）
- Modify: `src/feishuBot/agentToolExecutor.ts`（追加 dispatch）
- Create: `src/feishuBot/rentalPerSpecPriceHandlers.ts`
- Test: `tests/rentalPerSpecPrice.test.ts`

**Interfaces:**
- `rental.perSpecPricePlan`（risk `high`，requiresConfirmation `true`）：入参 `{ productId: string; specPrices: Array<{ specId: string; fields: Record<string,string> }> }`（**绝对值**，相对计算由调用方先算好）；读当前 spec 值生成 diff 预览 + 专用确认卡，内部产出 `rental.perSpecPriceApply` 确认请求。
- `rental.perSpecPriceApply`（`plannerVisible: false`）：确认后调 `client.applyPerSpec(productId, specFields)`。
- 复用现有确认卡 + `ledgerContext`。

- [ ] **Step 1: 勘察现有改价工具的 plan/apply 骨架（阻塞前置）**

Run: `grep -n "rentalPricePreviewResponse\|rentalPriceApplyResponse\|buildRentalPricePreviewCard\|priceApply" src/feishuBot/agentToolExecutor.ts`（复用现有 preview 卡 + priceApply 确认回执模式，保持 UI/交互一致，勿另造一套卡片体系）。

- [ ] **Step 2: 写失败测试**

Create `tests/rentalPerSpecPrice.test.ts`（构造 handler，fake client 断言 applyPerSpec 被调、只写指定 spec）:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('rental.perSpecPriceApply', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-psp-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('applies only the specified spec values', async () => {
    const applyPerSpec = vi.fn(async () => ({ productId: '648', ok: true, lines: ['done'] }));
    const client = { applyPerSpec, preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }), execute: async () => ({ productId: '648', ok: true, lines: [] }), specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }), copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }), delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }), tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }), specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }) } as unknown as RentalPriceSkillClient;
    const res = await executeAgentToolRequest(
      { toolName: 'rental.perSpecPriceApply', arguments: { productId: '648', specFields: { '3863': { rent1day: '80.00' } } }, reason: 'x' },
      dir,
      { rentalPriceClient: client },
    );
    expect(res.metadata?.ok).not.toBe(false);
    expect(applyPerSpec).toHaveBeenCalledWith('648', { '3863': { rent1day: '80.00' } });
  });
});
```

- [ ] **Step 3–6:** 运行失败 → 实现 handler（plan：读 specDiscover/read 生成 diff 卡；apply：调 `applyPerSpec`，套 ledgerContext）→ toolRegistry 末尾追加两工具 + schema → executor 追加 dispatch case（apply 路径传 `options.ledgerContext`）→ 通过 → 回归 `feishuBotTools` → Commit `git commit -m "新增 rental.perSpecPricePlan/Apply 按规格差异化改价原子工具"`。

---

### Task 4: 原子工具 `rental.specDimPlan` / `rental.specDimApply`

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`、`src/feishuBot/agentToolExecutor.ts`
- Create: `src/feishuBot/rentalSpecDimHandlers.ts`
- Test: `tests/rentalSpecDim.test.ts`

**Interfaces:**
- `rental.specDimPlan`（risk `high`，requiresConfirmation `true`）：入参 `{ productId: string; action: 'add' | 'remove'; title?: string; specDimId?: string }`（add 需 title，remove 需 specDimId）；生成确认卡（回显将增/删的维度）。
- `rental.specDimApply`（`plannerVisible: false`）：确认后调 `client.specAddDim` / `client.specRemoveDim`，套 `ledgerContext`。

- [ ] **Step 1–6:** 勘察现有 spec 操作确认卡（`rentalWriteOperationHandlers` / `rentalPrice` 的 operationConfirm 模式）→ 写失败测试（fake client 断言 add 调 specAddDim、remove 调 specRemoveDim）→ 实现 handler + 两工具 + dispatch（传 ledgerContext）→ 通过 → 回归 → Commit `git commit -m "新增 rental.specDimPlan/Apply 规格维度增删原子工具"`。

---

### Task 5: 集成回归 + 并行安全自检

**Files:**
- Test: `tests/rentalAtomizationIntegration.test.ts`

- [ ] **Step 1: 写集成测试**

覆盖场景二的原子编排（不做成一个死工具，而是验证原子工具可被顺序调用组合）：读规格 → specDimApply(加激光险维度) → perSpecPriceApply(给新规格写"母价+30"的绝对值)。用 fake client 断言调用序列 + 只写指定 spec + ledger 有 execution 事件。

- [ ] **Step 2: 运行集成测试** → PASS。

- [ ] **Step 3: 并行安全自检（关键）**

Run: `git diff master --stat`
**确认只改了：** `rentalPrice.ts`（接口追加）、`toolRegistry.ts`（数组末尾追加）、`agentToolExecutor.ts`（dispatch 追加）、新增的 `rental*Handlers.ts` + 测试。**确认未改动**：`dailyMission*`、`decision*`、`operationLedger`、`cli/dailyMission*`（B层地盘）。若有交集，说明踩到 B层，需回退重做为纯追加。

- [ ] **Step 4: 全量回归 + 类型检查**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'` 全绿；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build` 通过。

- [ ] **Step 5: Commit**

```bash
git add tests/rentalAtomizationIntegration.test.ts
git commit -m "rental 原子工具集成测试 + 并行安全自检"
```

---

## 合入策略（与 live B层协调）

```text
1. 本分支从 master 或 B层当前 tip 起独立 worktree
2. 全程增量：不动旧工具、共享文件只追加
3. 定期 merge master（含 B层进展）进本分支，别攒到最后
4. 合入顺序：B层这批先落 master → 本分支 rebase 其上 → 合入
5. 合入后：B层的 M3 grounding 会自动把新原子工具纳入决策器可选集；
   将来 M4 白名单可引用这些原子工具（per-spec 改价、specDim）
```

## 与 agentic loop 的关系（为什么这样切）

- 本计划**不做**"复制所有规格加激光险+30"这种场景死工具。
- 它只提供原子写工具：`perSpecPriceApply`（写绝对值）、`specDimApply`（增删维度）。
- **场景编排上移给 loop**：loop 读规格 → 决定加哪个维度 → 读母价算+30 → 调 perSpecPriceApply 写绝对值。相对计算、批量循环、跨商品都在 loop 侧，工具保持哑而原子。
- 这正是"停止场景工程、把工具原子化、场景交给脑子"的落地。

## 未纳入本计划（另行排期，非 rental skill 能力）

- `product.rankBestByCategory`（同品类按 N 天销量排名）—— MT-agent 数据层，非 skill。
- 跨天窗口过滤发现（近15天曝光/订单）—— MT-agent 数据层。
- 现有粗工具（`priceChange` 广播、`refreshActivityExecute` 打包）的拆细/弃用 —— 待 B层稳定、新原子工具验证后再评估，本计划只做增量不动它们。

## Self-Review

- **范围:** 覆盖两个真实写侧缺口——per-spec 改价（Task 1+3）、规格维度增删（Task 2+4）；集成验证原子编排（Task 5）。数据层缺口明确排除。
- **增量安全:** Global Constraints + Task 5 Step 3 自检强制"只追加、不碰 B层文件"，保证与 live B层并行不冲突。
- **原子哲学落地:** 工具写绝对值、不做相对计算/场景编排，组合上移 loop（文首 + "与 loop 关系"节声明）。
- **Placeholder:** Task 1/2/3/4 各有"勘察前置"步（daemon apply nested 入口、spec-dim 入参、现有 plan/apply 骨架、确认卡模式），给了 grep/sed 定位，非空泛占位；client 实现复用现有 helper 而非另造。
- **类型一致:** `applyPerSpec(productId, Record<specId,Record<field,value>>)`（Task1）→ `perSpecPriceApply` 调用一致（Task3）；`specAddDim/specRemoveDim`（Task2）→ `specDimApply` 调用一致（Task4）；均可选方法（`?`），不破坏现有 client 实现。
- **安全不倒退:** 新写工具全走确认卡 + ledgerContext 归因 + readback，与既有 P0 边界一致。
