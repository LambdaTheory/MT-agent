# 交互可用性收口审计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套“能力层 vs 自然语言路由层”双轨测试与审计框架，系统性挖出 MT-agent 当前剩余的可用性断点（而不是等用户一句一句踩坑），并把问题分类到 capability / metadata / routing / workflow / data-health / reply-channel 各层，避免为了过某句测试继续往大 workflow 里堆逻辑。

**Architecture:** 本计划不是在做新功能，而是在建立一套**可重复、可归因、能指导收口优先级**的审计 harness：
1. **Capability-layer tests**：直接调用工具/能力，验证“系统本来会不会做”；
2. **NL-routing-layer tests**：用真实飞书话术跑 `parseBotIntent / handleBotIntent / planner`，验证“自然语言能不能稳定命中正确能力”；
3. **Result classification**：每条用例统一记录命中工具、返回形态、失败层级、证据摘要；
4. **Audit report**：汇总成“已稳定 / 边缘可用 / 断链 / 依赖数据健康 / 暂不建议依赖”这几类地图。

**Tech Stack:** TypeScript (ESM, `.js` 后缀)、vitest、现有 `handleBotIntent` / `parseBotIntent` / `executeAgentToolRequest` / `readOnlyToolRegistry` / `agentPlannerResponse` / `windowAggregate` / `sameSku best` / `refreshActivity` 相关工具。

## Global Constraints

- 所有相对 import 用 `.js` 后缀。
- **审计计划本身不新增 workflow，不以“让一句话通过”为目标去发明大工具。**
- 每个场景必须同时测试：
  1. **Capability layer**：直接验证工具/能力是否可做
  2. **NL-routing layer**：验证真实话术是否稳定命中该能力
- 任何修复建议都必须先归类为以下之一：
  - capability 缺口
  - metadata 契约缺口
  - routing 缺口
  - workflow 过重/边界错误
  - data health 问题
  - reply/channel 问题
- 产出必须让人一眼看出“这句话不通，是哪一层的问题”，而不是只给“通过/失败”。
- 不动 `package.json`。
- 测试：`npx vitest run <files> --exclude '**/.worktrees/**'`；`npx tsc -p tsconfig.json --noEmit`；`npm run build`。

## 现状背景（已核验）

- 当前系统已经有明显的“能力层”基础：
  - `publicTraffic.windowAggregate`
  - `system.dataHealth`
  - `strategy.safeSourceResolve`
  - `strategy.refreshCandidateExplain`
  - `product.rankBestSameSku`
- 但很多线上问题仍然出在：
  - 自然语言路由没命中这些能力
  - metadata 不够稳定，后续步骤接不上
  - workflow 吞掉了策略判断
  - 或运行时数据健康本身不够
- 也就是说，现在最需要的不是“再加功能”，而是把**真实可用边界摸清楚并结构化呈现出来**。

## File Structure

- **Create** `tests/interactionUsabilityMatrix.test.ts` —— 主矩阵测试（能力层 + 自然语言层配对）。
- **Create** `tests/interactionUsabilityCases.ts` —— 统一定义样例话术、预期能力、判定口径的数据表。
- **Create** `src/feishuBot/interactionUsabilityReport.ts` —— 汇总测试结果为结构化审计报告（仅测试辅助，不用于生产）。
- **Create** `docs/superpowers/specs/YYYY-MM-DD-interaction-usability-matrix.md` —— 机器跑完后人工阅读版矩阵（可由测试生成 JSON/MD，也可由脚本拼）。
- **Modify** （仅必要时）现有测试 helper 文件，复用 `handleBotIntent` / `executeAgentToolRequest` 的调用方式。

---

# 里程碑 A：定义审计矩阵（不是代码修复，而是可用性地图骨架）

### Task A-1: 定义统一的交互样例与判定模型

**Files:**
- Create: `tests/interactionUsabilityCases.ts`
- Test: `tests/interactionUsabilityMatrix.test.ts`（先跑最小 smoke）

**Interfaces:**
```ts
export type UsabilityFailureLayer =
  | 'capability'
  | 'metadata'
  | 'routing'
  | 'workflow'
  | 'data_health'
  | 'reply_channel';

export interface CapabilityExpectation {
  description: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface InteractionCase {
  id: string;
  category: 'query' | 'window' | 'strategy' | 'plan' | 'execute' | 'multistep';
  utterance: string;
  capabilityExpectation: CapabilityExpectation;
  notes?: string;
}
```

建议先建 12~15 条基础样例（覆盖你当前最常问的几类）：
- 查询类：
  - `查956`
  - `近20天数据最好r50是哪个id`
  - `近15天曝光为0的有哪些?`
- 策略类：
  - `为什么R50一个候选都没有`
  - `这个同款组能不能补链`
- 计划类：
  - `帮我下架r50近30天产生订单金额为0的链接`
  - `帮我下架pocket3近30天产生订单金额为0的链接`
- 执行类：
  - `帮我下架所有近30天产生订单金额为0的链接,除了没有可用的安全源商品,并且下掉一个补链一个`
- 多步类：
  - `先查一下2026013022000994654214的端内id是多少,然后根据这个id铺四条链接`
  - `近15天曝光为0的有哪些?下架,并且补链这些id`

- [ ] **Step 1: 写文件骨架**

Create `tests/interactionUsabilityCases.ts` with a first batch of cases:

```ts
import type { CapabilityExpectation, InteractionCase } from './interactionUsabilityTypes.js';

export const interactionUsabilityCases: InteractionCase[] = [
  {
    id: 'best-r50-20d',
    category: 'query',
    utterance: '近20天数据最好r50是哪个id',
    capabilityExpectation: { toolName: 'product.rankBestSameSku', arguments: { query: 'r50', periodDays: 30, metric: 'amount' } },
  },
  {
    id: 'refresh-r50-zero-amount',
    category: 'plan',
    utterance: '帮我下架r50近30天产生订单金额为0的链接',
    capabilityExpectation: { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount' } },
  },
];
```

- [ ] **Step 2: 写最小 failing test**

Create `tests/interactionUsabilityMatrix.test.ts` skeleton and assert the case list is non-empty, categories are valid, and each case has an expected tool.

- [ ] **Step 3: Run failing test**

Run: `npx vitest run tests/interactionUsabilityMatrix.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — helper/imports not ready.

- [ ] **Step 4: Minimal implementation**
- [ ] **Step 5: Run passing test**
- [ ] **Step 6: Commit**

```bash
git add tests/interactionUsabilityCases.ts tests/interactionUsabilityMatrix.test.ts
git commit -m "定义交互可用性审计样例矩阵"
```

---

# 里程碑 B：能力层审计（系统本来会不会做）

### Task B-1: 为每条样例增加 capability-layer 验证

**Files:**
- Modify: `tests/interactionUsabilityMatrix.test.ts`

**Interfaces:**
为每条 case 跑能力层验证：
- 对读工具：直接 `executeAgentToolRequest({ toolName, arguments, reason: 'usability audit' }, outputDir, options)`
- 对不适合直接执行的执行/计划类：至少验证**计划工具**或**解释工具**返回结构，而不是越过确认边界执行写操作

输出结构建议：
```ts
interface CapabilityAuditResult {
  caseId: string;
  ok: boolean;
  toolName: string;
  evidence: string;
  failureLayer?: UsabilityFailureLayer;
}
```

- [ ] **Step 1: 写失败测试**

在 `interactionUsabilityMatrix.test.ts` 增加 2~3 条能力层用例：
- `best-r50-20d` → 直测 `product.rankBestSameSku`
- `refresh-r50-zero-amount` → 直测 `operations.refreshActivityPlan`（只验证计划，不执行）
- `why-zero-candidates` → 直测 `strategy.refreshCandidateExplain`

- [ ] **Step 2: Run failing test**
- [ ] **Step 3: Implement capability helpers**
- [ ] **Step 4: Run passing test**
- [ ] **Step 5: Commit**

```bash
git add tests/interactionUsabilityMatrix.test.ts
git commit -m "增加交互样例的能力层审计"
```

---

# 里程碑 C：自然语言路由层审计（系统能不能稳定命中能力层）

### Task C-1: 为每条样例增加 NL-routing 审计

**Files:**
- Modify: `tests/interactionUsabilityMatrix.test.ts`

**Interfaces:**
对每条 case 增加第二层验证：
- 直接走 `handleBotIntent(...)`
- 观察返回是：文本 / 澄清卡 / 策略卡 / 执行确认卡 / 无回复
- 验证是否命中预期能力或至少命中正确层

输出结构建议：
```ts
interface RoutingAuditResult {
  caseId: string;
  ok: boolean;
  utterance: string;
  matchedTool?: string;
  responseType: 'text' | 'clarification_card' | 'strategy_card' | 'execute_confirm_card' | 'none';
  failureLayer?: UsabilityFailureLayer;
  evidence: string;
}
```

判定标准：
- capability 层通过，但 NL 层失败 → `failureLayer = 'routing'`
- capability 层通过，NL 层命中大 workflow 而非策略/数据能力 → `failureLayer = 'workflow'`
- capability 层通过，NL 层结果里 metadata 断链 → `failureLayer = 'metadata'`

- [ ] **Step 1: 写失败测试**

追加到 `interactionUsabilityMatrix.test.ts`：
- `近20天数据最好r50是哪个id` 至少应命中 same-sku best（不应掉 generic query）
- `帮我下架r50近30天产生订单金额为0的链接` 应命中 targeted refresh plan（而非全局 72 条）
- `近15天曝光为0的有哪些?` 至少应落到 `windowAggregate` / explain 类能力，而不是沉默失败

- [ ] **Step 2: Run failing test**
- [ ] **Step 3: Implement NL-routing audit helpers**
- [ ] **Step 4: Run passing test**
- [ ] **Step 5: Commit**

```bash
git add tests/interactionUsabilityMatrix.test.ts
git commit -m "增加交互样例的自然语言路由审计"
```

---

# 里程碑 D：生成结构化可用性报告

### Task D-1: 输出机器可读审计报告

**Files:**
- Create: `src/feishuBot/interactionUsabilityReport.ts`
- Test: `tests/interactionUsabilityReport.test.ts`

**Interfaces:**
```ts
export interface InteractionUsabilityReport {
  generatedAt: string;
  capabilityPassed: string[];
  routingPassed: string[];
  blockedByCapability: string[];
  blockedByRouting: string[];
  blockedByMetadata: string[];
  blockedByWorkflow: string[];
  blockedByDataHealth: string[];
  blockedByReplyChannel: string[];
  details: Array<CapabilityAuditResult | RoutingAuditResult>;
}

export function buildInteractionUsabilityReport(...): InteractionUsabilityReport;
```
- 目标不是写生产逻辑，而是把测试结果统一归档，形成“当前已稳定 / 有边角 / 不建议依赖”的地图。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: Run failing test**
- [ ] **Step 3: Implement report builder**
- [ ] **Step 4: Run passing test**
- [ ] **Step 5: Commit**

```bash
git add src/feishuBot/interactionUsabilityReport.ts tests/interactionUsabilityReport.test.ts
git commit -m "新增交互可用性审计报告构建器"
```

### Task D-2: 生成人工阅读版矩阵文档

**Files:**
- Create: `docs/superpowers/specs/2026-07-08-interaction-usability-matrix.md`

**Interfaces:**
文档格式建议：
- 场景分组（查询 / 窗口 / 策略 / 计划 / 执行 / 多步）
- 每条话术：
  - 预期能力层
  - 当前 capability 结果
  - 当前 NL-routing 结果
  - 失败层级
  - 是否建议现在依赖

- [ ] **Step 1: 根据测试结果生成初稿**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-08-interaction-usability-matrix.md
git commit -m "沉淀交互可用性矩阵审计结果"
```

---

# 里程碑 E：加一个“防止为了过测试而重新堆 workflow”的护栏

### Task E-1: 在审计计划与测试里显式记录 failureLayer

**Files:**
- Modify: `tests/interactionUsabilityMatrix.test.ts`
- Modify: `src/feishuBot/interactionUsabilityReport.ts`

**Interfaces:**
统一 failureLayer：
```ts
'capability' | 'metadata' | 'routing' | 'workflow' | 'data_health' | 'reply_channel'
```

规则：
- 若 capability 层通过、NL 层失败，必须落到 `routing/metadata/workflow` 之一，**不能直接建议新增新工具**。
- 只有 capability 层本身都失败时，才允许把问题归为 `capability` 并考虑补能力。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: Run failing test**
- [ ] **Step 3: Implement failureLayer classification rules**
- [ ] **Step 4: Run passing test**
- [ ] **Step 5: Commit**

```bash
git add tests/interactionUsabilityMatrix.test.ts src/feishuBot/interactionUsabilityReport.ts
git commit -m "为交互审计加入 failureLayer 分类护栏"
```

---

# 里程碑 Z：集成回归

### Task Z-1: 全量 + 类型 + 构建

- [ ] **Step 1: 定向回归**

Run: `npx vitest run tests/interactionUsabilityMatrix.test.ts tests/interactionUsabilityReport.test.ts tests/windowAggregate.test.ts tests/safeSource.test.ts tests/refreshCandidateExplain.test.ts --exclude '**/.worktrees/**'`

- [ ] **Step 2: 全量**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`
Run: `npx tsc -p tsconfig.json --noEmit`
Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git commit -m "交互可用性收口审计集成回归"
```

---

## 明确不在本计划内
- 不新增业务 workflow。
- 不为了让某一句话通过而临时造“大而粗”的工具。
- 不直接修所有查出来的问题；本计划的目标是**先把真实可用边界系统性摸清楚并分类**。

## Self-Review
- **核心原则落实**：每条交互都双测 capability 层 + NL 路由层，避免把路由问题误判成能力缺口。
- **防回摆**：failureLayer 强制分类，防止为了过测试而继续堆 workflow。
- **输出清晰**：最终会有结构化报告 + 人类可读矩阵，帮助你判断“现在到底能不能放心用”。
