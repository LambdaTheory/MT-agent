# Rental Skill 能力对齐与卡片升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MT-agent 在不削弱写操作安全边界的前提下，对齐 `rental-price-agent` 的原生高价值能力面，优先补齐被 wrapper 压扁/未暴露的 skill 能力，并把确认卡升级成适配飞轮与原子化的新语义。

**Architecture:** 保留 MT-agent 作为安全/审批/记账/飞轮编排层，不再继续粗化 skill 的原生业务能力。新增的能力分三层：① 高层业务安全流程（保留现有 `priceApply/perSpecPriceApply/...`）；② 高级表单态原子能力（如 `apply-current/submit/spec-refresh/spec-add-item`）用于连续表单流程与 batch 编排；③ 卡片语义层升级，让统一确认卡携带 run/phase/作用范围/预期后果，而不是停留在旧的“普通确认”模型。`task-store` 不并列接入主系统，只借鉴其 evidence/history 设计。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀)、vitest、现有 Feishu 卡片框架、`vendor/rental-price-agent` daemon & batch runner。

## Global Constraints

- 所有相对 import 用 `.js` 后缀。
- **不得削弱现有写操作安全边界**：确认卡 + `confirmationKey` + 记账 + execute 后 readback 校验 保持不变。
- 新增 skill 能力优先按“原生业务语义”暴露，避免再造粗包装；但高风险动作仍可放在“高级表单态能力”层，而非普通运营工具层。
- `apply-current` / `submit` 只作为**高级表单态能力**接入：必须显式绑定 `expectedProductId`，且默认不作为普通运营卡片按钮直接暴露。
- “上架”在本计划中明确定义为：**未定义业务动作，不在本轮实现**。
- batch runner 优先于 mirror 写回；mirror 仅先接读侧（`search` / `batch-spec`），`writeback-state` 后置。
- `task-store` 不并列接入 MT-agent 主任务系统；只允许借鉴其 evidence/history/result 结构。
- 测试：`npx vitest run <files> --exclude '**/.worktrees/**'`；类型检查 `npx tsc -p tsconfig.json --noEmit` exit 0；构建 `npm run build` 通过。

## 决策口径（已拍板）

- 能力完整优先。
- MT-agent 不再继续粗化 `rental-price-agent` 的原生高价值业务能力。
- 卡片要升级成适配飞轮状态机与原子化的语义层，而不是仅保持旧确认协议。
- batch 接入优先；mirror 先读后写；`task-store` 只借鉴不接入。
- `apply-current` / `submit` 要进入能力面，但作为高级表单态能力。

## 现有接口与已核验事实

- 原生 daemon action 面（实际实现为准）：`ping/login/navigate/read/apply/apply-current/submit/spec-discover/spec-add-item/spec-remove-item/spec-add-dim/spec-remove-dim/spec-add-and-refresh/spec-refresh/tenancy-set/delist/copy/platform-search/platform-search-all/batch-read`。见 `vendor/rental-price-agent/scripts/playwright-runner.js:1478-1577`、`vendor/rental-price-agent/SKILL.md:75-95`。
- `apply-current` 是“当前页继续填表，不导航”，并要求当前页产品校验；`submit` 是“提交当前页未保存表单态”。见 `vendor/rental-price-agent/scripts/playwright-runner.js:382-389`、`vendor/rental-price-agent/scripts/playwright-runner.js:391-444`。
- batch runner 已原生支持 `preview/execute/resume/status/delayed-verify/report/rollback`，且在 form-level setup 场景会特意阻断 preview，防止错误 diff 审批。见 `vendor/rental-price-agent/scripts/batch-runner.js:228-335`、`vendor/rental-price-agent/SKILL.md:155-195`。
- MT-agent 已补齐的主干工具：`rental.delist/delistBatch/copy/tenancySet/pricePreview/priceApply/priceRollback/perSpecPricePlan/perSpecPriceApply/specDimPlan/specDimApply/platformSearch/platformSearchAll/batchRead/readRaw/specDiscoverFull`。见 `src/agentRuntime/toolRegistry.ts:796-971`。
- 明确存在的 wrapper 压扁问题：`rental.specAddAndRefresh` 当前 schema 缺少 native 必需的 `specDimId`，只收 `productId + itemTitle`。见 `src/agentRuntime/toolRegistry.ts:299-307`、`src/feishuBot/rentalWriteOperationHandlers.ts:56-60` vs `vendor/rental-price-agent/SKILL.md:86`。
- 通用确认卡当前已支持 `requestRef + confirmationKey`，但取消按钮仍是 inline payload。见 `src/agentRuntime/approvalCard.ts:145-147`、`src/agentRuntime/approvalCard.ts:182`。
- Agent Explore 当前对可发确认卡的写工具仍走手写白名单，不覆盖全部新增原子写工具。见 `src/feishuBot/agentExploreResponse.ts:32-47`。

---

## File Structure

- `docs/superpowers/plans/2026-07-03-rental-skill-capability-alignment.md`（本计划）
- `src/agentRuntime/toolRegistry.ts` —— 新原子/高级表单态工具注册入口。
- `src/feishuBot/agentToolExecutor.ts` —— 新工具 dispatch、可能的 batch/mirror 读侧接线。
- `src/feishuBot/rentalPrice.ts` —— client wrapper；重点修 `specAddAndRefresh` 入参语义，并新增 `applyCurrent/submit/specAddItem/specRefresh` 等方法。
- `src/feishuBot/rentalWriteOperationHandlers.ts` —— 现有聚合写路径；必要时拆出高级表单态 handler。
- `src/feishuBot/agentExploreResponse.ts` —— Explore 写卡覆盖策略收敛。
- `src/agentRuntime/approvalCard.ts` —— 取消按钮 `requestRef` / 卡面元信息升级。
- `src/agentRuntime/dailyMissionApproval.ts` / `dailyMissionApprovalCallback.ts` —— 卡面元信息与飞轮 phase/runId/decisionId 承载。
- （新增）`src/feishuBot/rentalFormStateHandlers.ts` —— 若高级表单态能力单独成文件。
- （新增）`src/feishuBot/rentalBatchHandlers.ts` —— batch preview/execute/status/resume/report/rollback 的 MT 接线。
- （新增）`src/feishuBot/rentalMirrorHandlers.ts` —— mirror 读侧接线。
- 测试文件按任务分拆新增。

---

## Task 1: 修正 `specAddAndRefresh` 语义，不再压扁 native 能力

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/rentalWriteOperationHandlers.ts`
- Modify: `src/feishuBot/rentalPrice.ts`
- Test: `tests/rentalSpecAddAndRefreshAlignment.test.ts`

**Interfaces:**
- 当前问题：MT 工具 schema 只有 `productId + itemTitle`，但 native 需要 `productId + specDimId + itemTitle`。
- Produces:
  ```ts
  // tool arguments
  { productId: string; specDimId: string; itemTitle: string }
  
  // client
  specAddAndRefresh(productId: string, specDimId: string, itemTitle: string): Promise<RentalPriceSpecAddResult>
  ```
- 不新增“上架”语义；仅修正现有工具与 native 对齐。

- [ ] **Step 1: 写失败测试**

Create `tests/rentalSpecAddAndRefreshAlignment.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

vi.mock('../src/feishuBot/rentalPriceDaemon.js', () => ({
  sendRentalPriceAgentRequest: vi.fn(async (_rootDir: string, request: unknown) => request),
}));

import { sendRentalPriceAgentRequest } from '../src/feishuBot/rentalPriceDaemon.js';

describe('specAddAndRefresh alignment', () => {
  it('forwards specDimId to native spec-add-and-refresh action', async () => {
    const client = createRentalPriceSkillClient(process.cwd());
    await client.specAddAndRefresh('648', '1355', '128G');
    expect(sendRentalPriceAgentRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ action: 'spec-add-and-refresh', productId: '648', specDimId: '1355', itemTitle: '128G' }),
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/rentalSpecAddAndRefreshAlignment.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 现有 wrapper 不接 `specDimId`。

- [ ] **Step 3: 实现对齐**

在 `rentalPrice.ts` 修改 client 方法签名与 `send({ action:'spec-add-and-refresh', ... })` 载荷，带上 `specDimId`。同步更新：
- toolRegistry schema
- write handler 对请求的解析与校验
- 任何引用 `client.specAddAndRefresh(productId, itemTitle)` 的调用点

- [ ] **Step 4: 回归**

Run: `npx vitest run tests/rentalSpecAddAndRefreshAlignment.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/toolRegistry.ts src/feishuBot/rentalWriteOperationHandlers.ts src/feishuBot/rentalPrice.ts tests/rentalSpecAddAndRefreshAlignment.test.ts
git commit -m "修正 specAddAndRefresh 与 rental skill 原生语义对齐"
```

---

## Task 2: 暴露缺失的高价值原子能力：`specAddItem` / `specRefresh`

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/agentToolExecutor.ts`
- Modify: `src/feishuBot/rentalPrice.ts`
- Create: `src/feishuBot/rentalFormStateHandlers.ts`（若现有文件不适合继续堆）
- Test: `tests/rentalFormStateTools.test.ts`

**Interfaces:**
- Produces new tools:
  ```ts
  rental.specAddItem { productId: string; specDimId: string; itemTitle: string }
  rental.specRefresh { productId: string }
  ```
- 这两个是**高级表单结构能力**；默认仍走确认卡。
- `specAddItem` 对齐 native `spec-add-item`；`specRefresh` 对齐 native `spec-refresh`。

- [ ] **Step 1: 写失败测试**

Create `tests/rentalFormStateTools.test.ts`，覆盖：
1. registry 中能找到 `rental.specAddItem` / `rental.specRefresh`
2. executor dispatch 到对应 client 方法
3. client 向 daemon 发送 `spec-add-item` / `spec-refresh`

示例骨架：
```ts
import { describe, expect, it, vi } from 'vitest';
import { listAgentTools } from '../src/agentRuntime/toolRegistry.js';

vi.mock('../src/feishuBot/rentalPriceDaemon.js', () => ({
  sendRentalPriceAgentRequest: vi.fn(async (_rootDir: string, request: unknown) => request),
}));
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/rentalFormStateTools.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 工具不存在。

- [ ] **Step 3: 实现工具面**

在 `toolRegistry.ts` 追加工具注册；在 `rentalPrice.ts` 追加 client 方法：
```ts
specAddItem(productId: string, specDimId: string, itemTitle: string)
specRefresh(productId: string)
```
在 executor/handlers 中完成 dispatch。

- [ ] **Step 4: 回归**

Run: `npx vitest run tests/rentalFormStateTools.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/toolRegistry.ts src/feishuBot/agentToolExecutor.ts src/feishuBot/rentalPrice.ts src/feishuBot/rentalFormStateHandlers.ts tests/rentalFormStateTools.test.ts
git commit -m "暴露 rental skill 规格项与规格刷新原子能力"
```

---

## Task 3: 把 `apply-current` / `submit` 纳入能力面，但定位为高级表单态能力

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/agentToolExecutor.ts`
- Modify: `src/feishuBot/rentalPrice.ts`
- Modify/Create: `src/feishuBot/rentalFormStateHandlers.ts`
- Test: `tests/rentalApplyCurrentSubmit.test.ts`

**Interfaces:**
- Produces new high-risk tools:
  ```ts
  rental.applyCurrent { expectedProductId: string; changes: Record<string, unknown> | Record<string, Record<string, unknown>> }
  rental.submitCurrent { expectedProductId: string }
  ```
- Both are **advanced form-state tools**, not ordinary operator-facing actions.
- `rental.applyCurrent` internally must send:
  ```ts
  { action: 'apply-current', changesFile, allowCurrentPage: true, expectedProductId }
  ```
- `rental.submitCurrent` internally must send:
  ```ts
  { action: 'submit' }
  ```
  but only after current-page guard has been satisfied by surrounding handler state/contract.

- [ ] **Step 1: 写失败测试**

Create `tests/rentalApplyCurrentSubmit.test.ts`，覆盖：
1. `applyCurrent` 发送 `apply-current + allowCurrentPage + expectedProductId`
2. `submitCurrent` 发送 `submit`
3. registry 中这两个工具标记为写工具且默认不可直接走普通 Explore 卡面

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/rentalApplyCurrentSubmit.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 工具不存在。

- [ ] **Step 3: 实现高级表单态能力**

在 `rentalPrice.ts` 新增 wrapper；在 handler 中把 `changes` 落临时 JSON 后调用 daemon。工具描述中明确写出“当前页高级操作，需要显式商品校验”。

- [ ] **Step 4: 回归**

Run: `npx vitest run tests/rentalApplyCurrentSubmit.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/toolRegistry.ts src/feishuBot/agentToolExecutor.ts src/feishuBot/rentalPrice.ts src/feishuBot/rentalFormStateHandlers.ts tests/rentalApplyCurrentSubmit.test.ts
git commit -m "新增 rental 高级表单态 applyCurrent 与 submitCurrent 能力"
```

---

## Task 4: 升级卡片协议的“语义层”，并补 Explore/取消链路真缺口

**Files:**
- Modify: `src/agentRuntime/approvalCard.ts`
- Modify: `src/feishuBot/agentToolConfirmStore.ts`（若取消也转 requestRef 需要接线）
- Modify: `src/feishuBot/agentExploreResponse.ts`
- Modify: `src/agentRuntime/dailyMissionApproval.ts`
- Modify: `src/agentRuntime/dailyMissionApprovalCallback.ts`（若需传递额外 card meta）
- Test: `tests/approvalCardRequestRefCancel.test.ts`
- Test: `tests/agentExploreResponseCardCoverage.test.ts`

**Interfaces:**
- 目标不是改 callback family，而是升级语义承载。
- Produces:
  1. 取消按钮支持 `requestRef + confirmationKey`，不再总是 inline 大 payload。
  2. Explore 不再靠手写白名单决定所有原子写工具是否能出确认卡；至少补齐：
     - `rental.priceApply`
     - `rental.perSpecPriceApply`
     - `rental.specDimApply`
     - `rental.delistBatch`
     - `rental.priceRollback`
  3. 卡面 metadata 至少能体现：来源 / phase / 作用范围 / 预期后果 / `runId` / `decisionId`（如有）。

- [ ] **Step 1: 写失败测试（取消 requestRef）**

Create `tests/approvalCardRequestRefCancel.test.ts`：
- 构造 `buildAgentToolConfirmCard(request, { requestRef: 'req-1' })`
- 断言取消按钮 value 也使用 `requestRef`，而不是塞完整 `arguments`

- [ ] **Step 2: 写失败测试（Explore 覆盖）**

Create `tests/agentExploreResponseCardCoverage.test.ts`：
- 让 `agentExploreResponse` 产出包含 `rental.priceApply` / `rental.perSpecPriceApply` / `rental.specDimApply` / `rental.delistBatch` / `rental.priceRollback` 的决策
- 断言可生成确认卡，而不是“建议有、按钮无”

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/approvalCardRequestRefCancel.test.ts tests/agentExploreResponseCardCoverage.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL。

- [ ] **Step 4: 实现协议与语义升级**

1. `approvalCard.ts`：让取消按钮在有 `requestRef` 时走 `{ action:'agent_tool_cancel', requestRef, confirmationKey }`。
2. `agentToolConfirmStore.ts` / 取消入口：解析取消 `requestRef`。
3. `agentExploreResponse.ts`：把“能否给卡”从手写名单收敛为 registry/risk/ledger-coverage 规则，至少覆盖本任务列出的新增原子工具。
4. `dailyMissionApproval.ts`：在 reason 或可见文本中加入 `runId/decisionId`，为后续 phase 感知卡面留槽。

- [ ] **Step 5: 回归**

Run: `npx vitest run tests/approvalCardRequestRefCancel.test.ts tests/agentExploreResponseCardCoverage.test.ts tests/agentExploreResponse.test.ts tests/dailyMissionOrchestrator.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/approvalCard.ts src/feishuBot/agentToolConfirmStore.ts src/feishuBot/agentExploreResponse.ts src/agentRuntime/dailyMissionApproval.ts src/agentRuntime/dailyMissionApprovalCallback.ts tests/approvalCardRequestRefCancel.test.ts tests/agentExploreResponseCardCoverage.test.ts
git commit -m "升级确认卡语义并补齐原子写工具卡片覆盖"
```

---

## Task 5: 接入 batch runner 主干能力（优先于 mirror / task-store）

**Files:**
- Create: `src/feishuBot/rentalBatchHandlers.ts`
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/agentToolExecutor.ts`
- Test: `tests/rentalBatchHandlers.test.ts`

**Interfaces:**
- First batch scope:
  ```ts
  rental.batchPreview { specFile: string }
  rental.batchExecute { specFile: string; confirmFormSetupWithoutPreview?: boolean }
  rental.batchStatus { stateFile: string }
  rental.batchResume { stateFile: string }
  rental.batchReport { stateFile: string }
  rental.batchRollback { stateFile: string; confirm?: boolean }
  ```
- 这些工具是“批处理控制面”，不是普通单商品写工具。
- `specFile/stateFile` 的文件来源与权限边界必须明确，避免任意路径注入；优先只允许 `tasks/batches/` 或已保存审计路径。

- [ ] **Step 1: 勘察现有 daemon 启动/调用封装（阻塞前置）**

Run: `grep -n "batch-runner\|spawn\|node .*batch" src/feishuBot/rentalPrice.ts src/feishuBot/*.ts`
确认当前项目是否已有调用 batch-runner 的公共 helper；没有则新增最小封装，不要在 handler 中直接散落 shell 字符串。

- [ ] **Step 2: 写失败测试**

Create `tests/rentalBatchHandlers.test.ts`：
- mock 掉 batch-runner 调用 helper
- 断言 toolRegistry 中存在 `batchPreview/batchExecute/...`
- 断言 executor 能 dispatch 到 handler
- 断言命令参数与输入字段对应

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/rentalBatchHandlers.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 工具不存在。

- [ ] **Step 4: 实现 batch 控制面**

新增 handler 封装 `preview/execute/status/resume/report/rollback`；保证输出保留 stateFile / result summary，供后续卡片/ledger/audit 使用。

- [ ] **Step 5: 回归**

Run: `npx vitest run tests/rentalBatchHandlers.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/feishuBot/rentalBatchHandlers.ts src/agentRuntime/toolRegistry.ts src/feishuBot/agentToolExecutor.ts tests/rentalBatchHandlers.test.ts
git commit -m "接入 rental skill batch runner 主干能力"
```

---

## Task 6: 接入 mirror 读侧（仅读，不做 writeback）

**Files:**
- Create: `src/feishuBot/rentalMirrorHandlers.ts`
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/agentToolExecutor.ts`
- Test: `tests/rentalMirrorHandlers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  rental.mirrorSearch { keyword: string }
  rental.mirrorBatchSpec { keyword: string }
  ```
- 明确不接：`writeback-state`
- 结果用于 planning / research / batch spec scaffolding，不直接触发写操作。

- [ ] **Step 1: 写失败测试**

Create `tests/rentalMirrorHandlers.test.ts`：
- mock mirror-search helper
- 断言 registry / executor / handler 接线正常

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/rentalMirrorHandlers.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 工具不存在。

- [ ] **Step 3: 实现 mirror 读侧**

新增 handler，仅封装 `search` / `batch-spec`。输出尽量保留原生 summary 字段。

- [ ] **Step 4: 回归**

Run: `npx vitest run tests/rentalMirrorHandlers.test.ts --exclude '**/.worktrees/**'`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/feishuBot/rentalMirrorHandlers.ts src/agentRuntime/toolRegistry.ts src/feishuBot/agentToolExecutor.ts tests/rentalMirrorHandlers.test.ts
git commit -m "接入 rental mirror 读侧能力"
```

---

## Task 7: 文档化“native action → MT tool → 状态”对照表（供长期审计，不是 README）

**Files:**
- Create: `docs/superpowers/specs/2026-07-03-rental-skill-capability-map.md`

**Interfaces:**
- 内容要求：
  - `native action`
  - `MT tool / wrapper`
  - 状态：`等价 / 安全包装 / wrapper压扁 / 缺失 / 未定义业务语义`
  - 备注：如 `上架` 标为“未定义业务动作”
- 这不是用户 README，而是给后续审计/规划的事实表。

- [ ] **Step 1: 依据本计划前 6 个任务的最终结果整理对照表**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-03-rental-skill-capability-map.md
git commit -m "沉淀 rental skill 与 MT-agent 能力对照表"
```

---

## Task 8: 全量回归

- [ ] **Step 1: 运行本计划新增与相关回归测试**

Run: `npx vitest run tests/rentalSpecAddAndRefreshAlignment.test.ts tests/rentalFormStateTools.test.ts tests/rentalApplyCurrentSubmit.test.ts tests/approvalCardRequestRefCancel.test.ts tests/agentExploreResponseCardCoverage.test.ts tests/rentalBatchHandlers.test.ts tests/rentalMirrorHandlers.test.ts --exclude '**/.worktrees/**'`

- [ ] **Step 2: 全量测试 / 类型检查 / 构建**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`
Run: `npx tsc -p tsconfig.json --noEmit`
Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "rental skill 能力对齐阶段集成回归"
```

---

## 明确不在本计划内
- **上架**：未定义业务动作，本轮不实现。
- **mirror writeback-state**：后置，等事实源与回写责任边界明确后再做。
- **task-store 并列接入**：不做；仅后续借鉴其 evidence/history/result 结构。
- **重写整个卡片协议**：不做；只升级语义层与 requestRef/取消链路。

## 优先级顺序（建议按此执行）
```text
Task 1 修正 specAddAndRefresh 语义压扁
Task 2 暴露 specAddItem / specRefresh
Task 3 暴露 apply-current / submit 为高级表单态能力
Task 4 卡片语义升级 + Explore/取消链路缺口
Task 5 batch runner 主干接入
Task 6 mirror 读侧接入
Task 7 能力对照文档
Task 8 全量回归
```

## Self-Review
- **Spec coverage:** 已覆盖你关心的 5 个待确认点：上架语义冻结、apply-current/submit 定位、batch 范围、mirror 范围、第一批补齐缺口优先级。
- **Placeholder scan:** 无 TBD/TODO；每个任务都有明确文件与测试入口。个别 shell 接线处标了勘察前置，是为了以真实 helper 为准，不是留空。
- **Type consistency:** `specDimId` 对齐 native；`applyCurrent/submitCurrent` 被统一定义为高级表单态能力；batch/mirror 工具名前缀保持 `rental.*`。
- **Safety:** 所有新增写能力都在 MT-agent 安全边界内接入，不绕开确认卡、记账、verify 体系。
