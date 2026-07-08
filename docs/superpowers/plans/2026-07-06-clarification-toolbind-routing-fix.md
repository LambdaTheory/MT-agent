# 澄清工具绑定 + 查询路由 + 探索可诊断性 修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐意图/澄清重构在生产里的"最后一公里"——让澄清候选真正绑定工具（不再退化为文本重放）、让"查<端内ID>"能显示已下架/链接不存在状态、让 newLinkBatchPlan 等不再硬报错死胡同、让探索失败可诊断。

**Architecture:** 全程 master 之上增量、可回退。核心是**让真实 LLM 产出 tool-bound 澄清候选**（改 prompt + 收紧校验），其余为局部路由/健壮性/可观测性修复。写操作安全边界不动。

**Tech Stack:** TypeScript (ESM, `.js` 后缀)、vitest。改 `llmPlanner.ts` / `planner.ts` / `tools.ts` / `agentToolExecutor.ts` / `toolRegistry.ts` / `agentExploreLoop.ts` / `agentExploreResponse.ts`。

## 背景：本计划要修的 4 条（均有实锤证据）

- **P0 澄清候选空转**：`llmPlanner.ts:59` 的 prompt 只要求澄清选项给 `label/message`，不要 `toolName`；`planner.ts:40-51` 因此把每个候选退化成 `agent.clarifiedMessage` 文本重放。落盘上下文 `clarify_1783301942304` 证实 4 个候选 `toolName` 全是 `agent.clarifiedMessage`。→ "澄清点击续接锁定工具"在生产从未触发，仍是文本重放。
- **P1 查<id>看不到已下架**：`查956` 落到 `tools.ts:704` `formatProductRows([])`→"没有找到匹配商品"，**没走到 `tools.ts:698-700` 已有的注册表回落**（那条会经 `formatRegistryProductRows` 显示 listingState）。需先诊断绕过原因。
- **P2 newLinkBatchPlan 死胡同**：schema（`toolRegistry.ts:535`）`minProperties:1` 太松，`{keyword:'x'}` 无 count 也放行 → handler `agentToolExecutor.ts:1924` 硬报"参数无效"，不回落澄清。
- **P3 探索不可诊断**：`agentExploreLoop.ts:78-105` 首轮 LLM 返回非 `{action:...}` JSON 即 `invalidResult`（0 步），且不记录原始输出，无法定位 #4。

## Global Constraints

- 所有相对 import 用 `.js` 后缀。
- **不弱化写操作安全**：tool-bound 候选续接到写工具仍走确认卡 + `confirmationKey`；探索仍只读、写走确认卡。
- **可回退**：`agent.clarifiedMessage` 文本重放候选**保留**为兜底（LLM 确实给不出工具时用），只是不再是唯一形态。
- 不动 `package.json`（避免与其它并行 worktree 冲突）。
- 测试：`npx vitest run <files> --exclude '**/.worktrees/**'`；`npx tsc -p tsconfig.json --noEmit` exit 0；`npm run build` 通过。
- LLM 测试用脚本化 provider / `FakeLlmProvider`，**且新增用例必须模拟真实模型行为**（如"只给 label/message 不给 toolName"），防止再次出现"测试绿但生产空转"。

## 现有接口（已核验）

- `llmPlanner.ts:58-59`：澄清 prompt 指令（要改）。
- `planner.ts:32-64`：`validateAgentPlannerClarificationProposal` 候选解析——`option.toolName + arguments` 且 `findAgentTool` 命中且 `schemaAllowsArguments` 通过才绑定，否则退化 `agent.clarifiedMessage`（`planner.ts:40-51`）。
- `tools.ts:690-705`：`query_product` 意图处理；`698-700` 为数字ID注册表回落，`704` 为空结果兜底。
- `reportStore.ts:165`：`formatProductRows([])` → "没有找到匹配商品。"；`parseNumericProductIdList`（`tools.ts:57` import）。
- `formatRegistryProductRows` → `formatLinkRegistryStatus(entry)`（含 listingState，`tools.ts:496-513`）。
- `newLinkBatchPlanArgumentsSchema`（`toolRegistry.ts:535`，`minProperties:1`）；handler `agentToolExecutor.ts:1920-1955`；`readNewLinkBatchWorkflowRequests` 返回 null → 硬报错。
- `runAgentExploreLoop`（`agentExploreLoop.ts:74-117`）；`agentExploreResponse`（`agentExploreResponse.ts:74-108`）。

---

## File Structure

- `src/agentRuntime/llmPlanner.ts` —— 澄清 prompt 要求 toolName+arguments。
- `src/agentRuntime/planner.ts` —— 候选校验：绑定判定放宽到"允许 placeholder/部分参数"，并明确保留文本兜底。
- `src/feishuBot/tools.ts` —— P1 查<id> 路由回落诊断与修复。
- `src/agentRuntime/toolRegistry.ts` —— P2 newLinkBatchPlan schema 收紧（如可）。
- `src/feishuBot/agentToolExecutor.ts` —— P2 handler 回落澄清/引导，不死胡同。
- `src/agentRuntime/agentExploreLoop.ts` + `agentExploreResponse.ts` —— P3 原始输出日志 + 容错解析 + 清晰文案。
- 测试按里程碑分文件新增。

---

# 里程碑 P0：澄清候选真正绑定工具（最高优先，修 #1/#2 的根）

### Task P0-1: planner 澄清 prompt 要求 toolName + arguments

**Files:**
- Modify: `src/agentRuntime/llmPlanner.ts`
- Test: `tests/llmPlannerClarificationPrompt.test.ts`

**Interfaces:**
- 改 `llmPlanner.ts:58-59` 澄清指令为（保留原意，增加工具绑定要求）：
  - 每个 option 必须给：`label`、`toolName`（从可用工具清单里选最可能的那个）、`arguments`（尽量填已知参数，如端内ID；未知参数可省略）、可选 `description`；`message` 作为该选项的自然语言兜底描述。
  - 明确：当澄清是"对某个已知目标选哪个动作"时，**每个 option 必须绑定具体工具**；仅当输入无法映射到任何工具（纯无法理解）时，才允许只给 message 的文本引导选项。
- **不改** JSON 顶层结构（仍是 `{goal, needsClarification, question, options, confidence, reason, originalMessage}`），只加 option 内字段要求。

- [ ] **Step 1: 勘察** Run: `grep -n "Clarification options\|needsClarification\|options" src/agentRuntime/llmPlanner.ts`，确认 prompt 拼接位置与措辞。
- [ ] **Step 2: 写失败测试**

Create `tests/llmPlannerClarificationPrompt.test.ts`：断言构造出的 planner system/user prompt 文本里，澄清说明包含要求 `toolName` 与 `arguments` 的措辞（如包含 `toolName`、`arguments` 关键词与"绑定/选择具体工具"语义）。
```ts
import { describe, expect, it } from 'vitest';
import { buildAgentPlannerPrompt } from '../src/agentRuntime/llmPlanner.js'; // 以真实导出名为准，勘察后校正
// 断言 prompt 含 toolName / arguments 要求
```
（若 prompt 文本未导出，改为对 `llmPlanner` 生成的消息做断言；勘察后确定断言入口。）

- [ ] **Step 3: 运行确认失败** → **Step 4: 改 prompt 措辞** → **Step 5: 通过**
- [ ] **Step 6: Commit** `git commit -m "planner 澄清 prompt 要求候选绑定 toolName 与 arguments"`

### Task P0-2: 候选校验允许部分参数绑定（不因缺参数退化成文本）

**Files:**
- Modify: `src/agentRuntime/planner.ts`
- Test: `tests/plannerClarificationCandidates.test.ts`（已存在，追加用例）

**Interfaces:**
- 现状 `planner.ts:43-51`：`toolName && isRecord(args)` 且 `schemaAllowsArguments(tool.inputSchema, args)` 才绑定，否则退化文本。
- 改为：绑定判定用 `schemaAllowsArguments(tool.inputSchema, args, { allowPlaceholders: true })`，允许**部分/占位参数**也能绑定到工具（缺的参数留给下游 `reviewAgentToolArguments` 走 tool-bound 澄清补齐）。
- 仍保留：`toolName` 缺失或 `findAgentTool` 未命中 → 退化 `agent.clarifiedMessage`（真·无工具兜底）。

- [ ] **Step 1: 写失败测试**（追加到 `tests/plannerClarificationCandidates.test.ts`）：
  - 给 option `{ label:'下架648', toolName:'rental.delist', arguments:{ productId:'648' } }` → 断言候选绑定 `rental.delist`（非 `agent.clarifiedMessage`）。
  - 给 option `{ label:'改价648', toolName:'rental.priceChange', arguments:{ productId:'648' } }`（无 fields/discount，部分参数）→ 断言**仍绑定 `rental.priceChange`**，而不是退化文本。
  - 给 option 无 toolName → 断言退化 `agent.clarifiedMessage`（兜底保留）。
- [ ] **Step 2: 运行确认失败** → **Step 3: 改 `planner.ts` 绑定判定加 `allowPlaceholders:true`** → **Step 4: 通过 + 回归 `planner` 相关测试**
- [ ] **Step 5: Commit** `git commit -m "澄清候选允许部分参数绑定工具，减少文本退化"`

### Task P0-3: 端到端——真实形态澄清候选点击后走工具确认卡

**Files:**
- Test: `tests/clarificationToolBoundE2E.test.ts`
- （如需微调）Modify: `src/feishuBot/tools.ts`

**Interfaces:**
- 用脚本化 provider 让 planner 返回**带 toolName 的澄清 proposal**（模拟修好后的真实模型），跑 `handleBotIntent`：
  - 断言落盘澄清上下文的候选 `toolName` 是真实工具（如 `rental.delist`），**不是** `agent.clarifiedMessage`。
  - 断言点击该候选（select ref）→ 产出 `rental.delist` 的确认卡（写工具仍走确认，不直接执行、不重放文本）。

- [ ] **Step 1: 写失败测试**（覆盖上面两点）→ **Step 2: 失败** → **Step 3: 若 tools.ts 组装候选处有阻碍则修** → **Step 4: 通过**
- [ ] **Step 5: Commit** `git commit -m "端到端校验澄清候选绑定工具并续接确认卡"`

---

# 里程碑 P1：查<端内ID> 显示上架状态（修 #3 路由侧）

### Task P1-1: 诊断 查<id> 为何绕过已有注册表回落

**Files:** 仅勘察，不改码。

- [ ] **Step 1: 复现路径勘察**
  - Run: `grep -n "parseNumericProductIdList" src/feishuBot/reportStore.ts` 读其实现，确认 `parseNumericProductIdList('956')` 是否返回 `['956']`（若返回空 → 就是它把流程推到了 `tools.ts:704`）。
  - Run: `grep -n "query_product\|查\|parseAgentFirstBotIntent" src/feishuBot/intent.ts`，确认 planner-first 下 "查956" 是走本地 `query_product` 意图，还是被送去 planner 选了别的只读工具。
  - 记录结论：命中 704 的真实原因（A：parseNumericProductIdList 空；B：走了 planner 的 report-only 查询工具；C：其它）。

- [ ] **Step 2: Commit（仅记录诊断）** 把结论写进 `docs/superpowers/plans/` 对应计划的勘察小节或提交说明，无代码改动可跳过 commit。

### Task P1-2: 让数字ID查询在日报查不到时回落注册表并显示 listingState

**Files:**
- Modify: `src/feishuBot/tools.ts`（`query_product` 分支，`690-705`）
- Test: `tests/queryProductRegistryFallback.test.ts`

**Interfaces:**
- 依据 P1-1 结论修：
  - 若根因 A（parseNumericProductIdList 漏 3 位数等）→ 修 `parseNumericProductIdList`，并保证走到 `698-700` 注册表回落。
  - 若根因 B（planner 选了 report-only 工具）→ 让该只读工具/或 `query_product` 在报表空且 keyword 是数字ID时回落 `formatRegistryProductRows`（含 listingState）。
- 目标行为：`查<已下架ID>` → 显示"已下架（上架后可操作）"；`查<总表没有的ID>` → "链接不存在（总表缺失）"；`查<在架ID>` → 在架/日报数据。

- [ ] **Step 1: 写失败测试**（构造 registry 含一个 `listingState:'delisted'` 的 entry、report context 里没有它 → 断言 `查<该ID>` 返回文本含"已下架"，而非"没有找到匹配商品"）
- [ ] **Step 2: 运行确认失败** → **Step 3: 按 P1-1 结论实现回落** → **Step 4: 通过 + 回归 `feishuBotTools`/`feishuBotCommandAnalysis`**
- [ ] **Step 5: Commit** `git commit -m "查端内ID在日报缺失时回落注册表显示上架状态"`

---

# 里程碑 P2：newLinkBatchPlan 不再死胡同（修 #2 健壮性）

### Task P2-1: 参数不足时回落引导/澄清，而非硬报错

**Files:**
- Modify: `src/feishuBot/agentToolExecutor.ts`（`newLinkBatchPlan` handler，`1920-1955`）
- （可选）Modify: `src/agentRuntime/toolRegistry.ts`（收紧 schema，若 `schemaAllowsArguments` 支持 `anyOf`）
- Test: `tests/newLinkBatchPlanGuard.test.ts`

**Interfaces:**
- 现状：`readNewLinkBatchWorkflowRequests(args)` 返回 null → 直接返回 `{ text: '新链批量铺设参数无效：需要 keyword 和 count，或 items 数组。' }`（死胡同）。
- 改为：返回**可操作引导**——明确告诉用户"补链需要：关键词 + 数量，例如『给<关键词>补3条』或提供 items 数组；若你其实想对该商品做别的（下架/改价/查看），请直接说明"。metadata 标 `{ ok:false, needsMoreInput:true }`。
- **勘察前置**：Run: `grep -n "schemaAllowsArguments\|anyOf" src/agentRuntime/planner.ts` 确认是否支持 `anyOf`。若支持，则把 `newLinkBatchPlanArgumentsSchema` 收紧为 `anyOf:[{required:['keyword','count']},{required:['items']}]`，从源头让 planner 空参数选择在校验阶段就 `invalid_arguments`（走既有 `invalidPlannerArgumentsClarification`）。若不支持 anyOf，仅做 handler 引导。

- [ ] **Step 1: 勘察 anyOf 支持** → **Step 2: 写失败测试**（`{keyword:'处理648'}` 无 count → 断言返回引导文案，不含"参数无效"死胡同；且 metadata `needsMoreInput:true`）
- [ ] **Step 3: 运行确认失败** → **Step 4: 实现（handler 引导 + 可选 schema anyOf）** → **Step 5: 通过 + 回归 `feishuBotTools`**
- [ ] **Step 6: Commit** `git commit -m "newLinkBatchPlan 参数不足回落引导而非硬报错"`

---

# 里程碑 P3：探索失败可诊断（定位 #4）

### Task P3-1: explore 记录原始输出 + 区分失败原因 + 容错解析

**Files:**
- Modify: `src/agentRuntime/agentExploreLoop.ts`
- Modify: `src/feishuBot/agentExploreResponse.ts`
- Test: `tests/agentExploreLoopInvalid.test.ts`

**Interfaces:**
- `runAgentExploreLoop` 返回结构增加可选诊断字段：`invalidReason?: 'non_json' | 'unknown_action' | 'unknown_tool' | 'bad_args' | 'tool_error' | 'invalid_finish'` 与 `rawFirstOutput?: string`（截断 300 字）。
- `agentExploreResponse`：当 `stopReason==='invalid'` 时，日志（`console.warn`）打印 `invalidReason + rawFirstOutput`；用户文案从笼统"未形成有效结论"改为按原因区分（如"模型未按要求输出可执行动作，请重试或换种说法"）。
- **容错解析**：若首轮 `result.json` 为空但 `result.text` 是被 ```json ...``` 包裹或前后有文字的 JSON，尝试提取首个 JSON 对象再解析（仅在 explore loop 内做，不改共享 `generateJson`）。

- [ ] **Step 1: 写失败测试**：
  - 脚本化 provider 首轮返回非 action JSON（如纯文本）→ 断言 `stopReason:'invalid'`、`invalidReason:'unknown_action'` 或 `'non_json'`、`rawFirstOutput` 非空。
  - 首轮返回 ```json 包裹的合法 call_tool → 断言能被容错解析并执行该只读工具（steps≥1）。
- [ ] **Step 2: 运行确认失败** → **Step 3: 实现诊断字段 + 容错解析 + 文案** → **Step 4: 通过 + 回归 `agentExploreLoop`/`agentExploreResponse` 现有测试**
- [ ] **Step 5: Commit** `git commit -m "探索loop增加失败诊断与JSON容错解析"`

---

# 里程碑 Z：集成回归

### Task Z-1: 全量 + 类型 + 构建

- [ ] **Step 1: 相关定向回归** Run: `npx vitest run tests/llmPlannerClarificationPrompt.test.ts tests/plannerClarificationCandidates.test.ts tests/clarificationToolBoundE2E.test.ts tests/queryProductRegistryFallback.test.ts tests/newLinkBatchPlanGuard.test.ts tests/agentExploreLoopInvalid.test.ts tests/feishuBotTools.test.ts tests/feishuBotServer.test.ts tests/feishuBotSdkCardAction.test.ts --exclude '**/.worktrees/**'`
- [ ] **Step 2: 全量 + 类型 + 构建** Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`；`npx tsc -p tsconfig.json --noEmit`；`npm run build`
- [ ] **Step 3: Commit** `git commit -m "澄清工具绑定与路由修复集成回归"`

---

## 明确不在本计划内
- **曝光爬虫丢行 / 数据健康护栏（H1）**：属运行侧数据健康，你已明确不由我这边开发。
- **意图解析三个 LLM 入口合并为单次决策**：更大重构，留后续。
- **改写确认卡协议**：不动。

## 依赖顺序
```text
P0（最高优先：修澄清空转，直接解释 #1/#2 的迷惑）
  P0-1 prompt → P0-2 校验放宽 → P0-3 端到端
P1（查id 状态，独立）：P1-1 诊断 → P1-2 修
P2（死胡同健壮性，独立）
P3（探索可诊断，独立）
Z 集成回归（最后）
```

## Self-Review
- **对症**：P0 直击"澄清候选空转"实锤根因；P1 修"查id 看不到已下架"；P2 修死胡同；P3 让 #4 可定位。
- **防复发**：P0 测试要求模拟真实模型形态（只给 message 不给 toolName 也要覆盖），杜绝"测试绿但生产空转"重演。
- **安全不倒退**：tool-bound 候选续接写工具仍走确认卡；文本兜底保留；探索仍只读。
- **勘察前置**：P0-1（prompt 入口）、P1-1（查id 绕过原因）、P2-1（anyOf 支持）均标了 grep 勘察，以真实为准。
- **不碰 package.json**，与其它 worktree 并行安全。
