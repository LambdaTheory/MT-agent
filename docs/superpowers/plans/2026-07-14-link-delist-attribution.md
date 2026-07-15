# 链接下架原因归因 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 `delisted` 链接归因到平台审核/冻结/限制、已验证的 Agent 下架或外部人工下架（待确认），并持久化为链接档案事实。

**Architecture:** 商品总表解析层只采集结构化平台限制信息；operation ledger adapter 只把成功的下架事件归一化为证据。新增的 `delistAttribution` 纯函数仅根据最终状态、平台限制和下架事件做可测试决策，`buildLinkRegistry` 与运行时负责收集并传递其输入。

**Tech Stack:** Node.js 20+、TypeScript 5.8（strict / ESM / NodeNext）、Vitest 3.2、`xlsx-js-style`。

## Global Constraints

- 保持 `listingState` 的既有语义：`on_sale | delisted | gone | unknown`；归因不能改变状态仲裁。
- 仅当最终 `listingState === 'delisted'` 才写入下架原因；`on_sale` 必须优先于任何历史平台原因。
- 平台原因优先于同一链接的 Agent 下架成功事件。
- Agent 下架必须同时满足 `execution_succeeded`、明确 `delist` 动作和后续可信 `delisted` 观测；无回读、失败或仍在售均不得确认。
- 外部人工下架是 `suspected`，不得推断确认人或具体同事。
- 原因文本仅用于展示、归因和审计，不得反解析为商品写操作参数。
- 不实现链接数量不足/测试商品识别、逐链接归因日志、真实抓取、飞书发送、daemon 重启或业务写操作。
- 所有改动在本隔离 worktree 完成；不得触及用户已修改的 `src/agentRuntime/toolRegistry.ts`。
- 测试使用最小脱敏 fixture；禁止读取、打印或提交 `.env`、真实账号、浏览器 profile、token 或 secret。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `src/publicTraffic/types.ts` | 定义商品总表快照可携带的平台限制观察。 |
| `src/mapping/goodsExportMapping.ts` | 解析可选“审核不通过原因”“冻结原因”列，保留原文。 |
| `src/linkRegistry/daemonCatalog.ts` | 合并 snapshot 时保留平台限制信息，不因 daemon 合并丢失。 |
| `src/linkRegistry/delistOperationEvidence.ts`（新增） | 从 operation ledger journal 过滤并归一化已成功的 Agent 下架事件。 |
| `src/feishuBot/rentalWriteOperationHandlers.ts` | 为 ledger 的写操作事件记录结构化租赁 action，使通用确认工具可被识别为 `delist`。 |
| `src/linkRegistry/delistAttribution.ts`（新增） | 纯函数：根据最终状态、平台限制和 Agent 下架事件生成原因、置信度和证据。 |
| `src/linkRegistry/types.ts` | 定义正式 registry 的原因、置信度和证据契约。 |
| `src/linkRegistry/buildRegistry.ts` | 汇集商品总表限制、调用纯归因器、把结果物料化到 `LinkRegistryEntry`。 |
| `src/closedOrderFeedback/runtime.ts` | 加载 operation ledger 并把归一化的 Agent 下架事件传入 registry 构建。 |
| `src/linkRegistry/promptRefresh.ts` | 为新采集的商品总表 snapshot 统一补上参考日期，并同步写入嵌套平台限制观测时间。 |
| `tests/goodsExportMapping.test.ts` | 覆盖限制列解析及缺列兼容。 |
| `tests/delistOperationEvidence.test.ts`（新增） | 覆盖 ledger 事件过滤和通用确认工具的 action 判定。 |
| `tests/rentalWriteLedger.test.ts` | 验证下架 ledger 事件携带结构化 `rentalAction` metadata。 |
| `tests/linkRegistryDelistAttribution.test.ts`（新增） | 以纯函数覆盖原因优先级、时序和在售优先。 |
| `tests/linkRegistryBuild.test.ts` | 覆盖 build 集成与正式 `LinkRegistryEntry` 结果。 |
| `tests/linkRegistryRuntime.test.ts`（新增） | 验证 runtime 从 operation ledger 读取事件后再构建 registry。 |

## Shared Contracts

定义于 `src/linkRegistry/types.ts` 与 `src/publicTraffic/types.ts`：

```ts
export interface PlatformRestrictionObservation {
  kind: 'review_rejected' | 'frozen' | 'other';
  reasonText: string;
  observedAt?: string;
}

export type LinkDelistCause =
  | 'platform_review_rejected'
  | 'platform_frozen'
  | 'platform_restricted'
  | 'agent_confirmed_manual_off_shelf'
  | 'external_manual_off_shelf_pending_confirmation';

export type LinkDelistCauseConfidence = 'confirmed' | 'suspected';

export interface LinkDelistCauseEvidence {
  source: 'goods_snapshot' | 'operation_ledger';
  kind: 'platform_restriction' | 'agent_delist_execution';
  observedAt?: string;
  reasonText?: string;
  toolName?: string;
  operationEventAt?: string;
  runId?: string;
  decisionId?: string;
}

export interface AgentDelistEvent {
  internalProductId: string;
  at: string;
  toolName: string;
  runId?: string;
  decisionId?: string;
}
```

`LinkRegistryEntry` 新增：

```ts
delistCause?: LinkDelistCause;
delistCauseConfidence?: LinkDelistCauseConfidence;
delistCauseEvidence?: LinkDelistCauseEvidence[];
```

`GoodsSnapshotItem` 新增：

```ts
platformRestriction?: PlatformRestrictionObservation;
```

---

### Task 1: Capture Platform Restriction Evidence in Goods Snapshots

**Files:**
- Modify: `src/publicTraffic/types.ts:51-58`
- Modify: `src/mapping/goodsExportMapping.ts:46-58, 73-122`
- Modify: `src/linkRegistry/daemonCatalog.ts:288-317`
- Modify: `src/linkRegistry/promptRefresh.ts:148-177`
- Test: `tests/goodsExportMapping.test.ts`

**Interfaces:**
- Consumes: the workbook headers `商品状态`/`上架状态`, `审核不通过原因`, and `冻结原因`.
- Produces: `GoodsSnapshotItem.platformRestriction?: PlatformRestrictionObservation`; it is consumed later by `buildLinkRegistry`.

- [ ] **Step 1: Add failing parser tests for restriction columns and absent columns**

Append these cases to `tests/goodsExportMapping.test.ts`:

```ts
it('reads review rejection and freeze reasons as structured platform restrictions', async () => {
  const path = await writeWorkbook([
    ['商品名称', '商家侧编码', '平台侧编码', '商品状态', '审核不通过原因', '冻结原因'],
    ['审核商品', '81665859-701-1', 'platform-701', '已下架', '资质审核不通过', ''],
    ['冻结商品', '81665859-702-1', 'platform-702', '已下架', '', '涉嫌违规冻结'],
    ['正常商品', '81665859-703-1', 'platform-703', '出售中', '', ''],
  ]);

  expect(parseGoodsExportSnapshot(path)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      internalProductId: '701',
      platformRestriction: { kind: 'review_rejected', reasonText: '资质审核不通过' },
    }),
    expect.objectContaining({
      internalProductId: '702',
      platformRestriction: { kind: 'frozen', reasonText: '涉嫌违规冻结' },
    }),
    expect.objectContaining({
      internalProductId: '703',
      platformRestriction: undefined,
    }),
  ]));
});

it('keeps snapshot parsing compatible when restriction columns are absent', async () => {
  const path = await writeWorkbook([
    ['商品名称', '商家侧编码', '平台侧编码', '商品状态'],
    ['商品A', '81665859-762-06081446', '2026060822000531936344', '已下架'],
  ]);

  expect(parseGoodsExportSnapshot(path)[0]).toEqual({
    platformProductId: '2026060822000531936344',
    internalProductId: '762',
    productName: '商品A',
    listingState: 'delisted',
    listingStatusText: '已下架',
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- tests/goodsExportMapping.test.ts
```

Expected: FAIL because `platformRestriction` is absent from `GoodsSnapshotItem` and parser output.

- [ ] **Step 3: Add the data contract and minimal workbook parser**

In `src/publicTraffic/types.ts`, directly before `GoodsSnapshotItem`, add:

```ts
export interface PlatformRestrictionObservation {
  kind: 'review_rejected' | 'frozen' | 'other';
  reasonText: string;
  observedAt?: string;
}
```

Extend `GoodsSnapshotItem`:

```ts
export interface GoodsSnapshotItem {
  platformProductId: string;
  internalProductId: string;
  productName: string;
  listingState?: LinkListingState;
  listingStatusText?: string;
  observedAt?: string;
  platformRestriction?: PlatformRestrictionObservation;
}
```

In `src/mapping/goodsExportMapping.ts`, import `PlatformRestrictionObservation`, add optional header lookup, and construct one restriction using frozen first:

```ts
const reviewRejectionReasonIndex = findOptionalColumn(headers, ['审核不通过原因']);
const freezeReasonIndex = findOptionalColumn(headers, ['冻结原因']);

const reviewRejectionReason = reviewRejectionReasonIndex === null ? '' : normalize(row[reviewRejectionReasonIndex]);
const freezeReason = freezeReasonIndex === null ? '' : normalize(row[freezeReasonIndex]);
const platformRestriction: PlatformRestrictionObservation | undefined = freezeReason
  ? { kind: 'frozen', reasonText: freezeReason }
  : reviewRejectionReason
    ? { kind: 'review_rejected', reasonText: reviewRejectionReason }
    : undefined;
```

Extend `goodsSnapshotItem()` input and return only when supplied:

```ts
platformRestriction?: PlatformRestrictionObservation;
// ...
...(input.platformRestriction ? { platformRestriction: input.platformRestriction } : {}),
```

For duplicate internal IDs, preserve the first non-empty `platformRestriction` exactly as existing code preserves `listingStatusText`:

```ts
platformRestriction: current.platformRestriction ?? platformRestriction,
```

- [ ] **Step 4: Preserve the new field during daemon merge and stamp newly collected exports**

In both copied `GoodsSnapshotItem` objects in `mergeGoodsSnapshotWithDaemon()`, retain the field:

```ts
...(item.platformRestriction ? { platformRestriction: item.platformRestriction } : {}),
```

and, for the existing product branch:

```ts
...(current?.platformRestriction ? { platformRestriction: current.platformRestriction } : {}),
```

In `refreshLinkRegistryForPrompt()`, immediately after parsing the workbook, replace the bare assignment with a stamp that keeps the top-level and nested observation coherent:

```ts
goodsSnapshotFromExport = parseGoodsExportSnapshot(goodsExportPath).map((item) => ({
  ...item,
  ...(item.listingState ? { observedAt: referenceDate } : {}),
  ...(item.platformRestriction
    ? { platformRestriction: { ...item.platformRestriction, observedAt: referenceDate } }
    : {}),
}));
```

Do not set an artificial timestamp in `parseGoodsExportSnapshot()` itself; it has no collection-time input.

- [ ] **Step 5: Run the focused parser tests and static build**

Run:

```powershell
npm test -- tests/goodsExportMapping.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the independently testable snapshot evidence unit**

```powershell
git add src/publicTraffic/types.ts src/mapping/goodsExportMapping.ts src/linkRegistry/daemonCatalog.ts src/linkRegistry/promptRefresh.ts tests/goodsExportMapping.test.ts
git commit -m "feat: 采集商品总表平台限制原因"
```

---

### Task 2: Normalize Successful Agent Delist Events from the Operation Ledger

**Files:**
- Create: `src/linkRegistry/delistOperationEvidence.ts`
- Modify: `src/feishuBot/rentalWriteOperationHandlers.ts:17-166`
- Test: `tests/delistOperationEvidence.test.ts`
- Test: `tests/rentalWriteLedger.test.ts:33-61`

**Interfaces:**
- Consumes: `OperationPlanJournalEntry[]` from `OperationLedgerStore.journal`.
- Produces: `collectAgentDelistEvents(entries: OperationPlanJournalEntry[]): AgentDelistEvent[]`.
- Produces: ledger event metadata `{ rentalAction: RentalOperationConfirmRequest['action'] }` for every rental write event.
- Later consumed by: `loadClosedOrderRegistryContext()` and `delistAttribution`.

- [ ] **Step 1: Write failing evidence extraction tests**

Create `tests/delistOperationEvidence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectAgentDelistEvents } from '../src/linkRegistry/delistOperationEvidence.js';

const succeededDelist = {
  planId: 'plan-1',
  at: '2026-07-14T09:00:00.000Z',
  event: 'execution_succeeded',
  toolName: 'rental.delist',
  subject: { kind: 'product' as const, id: '648' },
};

describe('collectAgentDelistEvents', () => {
  it('keeps only successful direct delists for numeric product subjects', () => {
    expect(collectAgentDelistEvents([
      succeededDelist,
      { ...succeededDelist, at: '2026-07-14T09:01:00.000Z', event: 'execution_started' },
      { ...succeededDelist, at: '2026-07-14T09:02:00.000Z', event: 'execution_failed' },
      { ...succeededDelist, at: 'not-a-date' },
      { ...succeededDelist, subject: { kind: 'sameSkuGroup' as const, id: 'group-a' } },
    ])).toEqual([{
      internalProductId: '648',
      at: '2026-07-14T09:00:00.000Z',
      toolName: 'rental.delist',
    }]);
  });

  it('recognizes successful generic confirm requests only when metadata records delist', () => {
    expect(collectAgentDelistEvents([
      {
        ...succeededDelist,
        toolName: 'rental.operationConfirmRequest',
        metadata: { rentalAction: 'delist' },
        runId: 'run-1',
        decisionId: 'decision-1',
      },
      {
        ...succeededDelist,
        toolName: 'rental.operationConfirmRequest',
        metadata: { rentalAction: 'copy' },
      },
    ])).toEqual([{
      internalProductId: '648',
      at: '2026-07-14T09:00:00.000Z',
      toolName: 'rental.operationConfirmRequest',
      runId: 'run-1',
      decisionId: 'decision-1',
    }]);
  });
});
```

Extend the first test in `tests/rentalWriteLedger.test.ts` with:

```ts
expect(entries.every((entry) => entry.metadata?.rentalAction === 'delist')).toBe(true);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
npm test -- tests/delistOperationEvidence.test.ts tests/rentalWriteLedger.test.ts
```

Expected: FAIL because the adapter does not exist and ledger metadata has no `rentalAction`.

- [ ] **Step 3: Record the structured rental action on all write events**

In `src/feishuBot/rentalWriteOperationHandlers.ts`, change `recordWriteEvent()` to accept `rentalAction`:

```ts
async function recordWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  event: RentalWriteEvent,
  toolName: string,
  productId: string,
  rentalAction: RentalOperationConfirmRequest['action'],
): Promise<void> {
  if (!context) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? 'ad-hoc',
    at: context.missionDate ? `${context.missionDate}T00:00:00.000Z` : new Date().toISOString(),
    event,
    toolName,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    subject: { kind: 'product', id: productId },
    metadata: {
      ...(context.missionDate ? { missionDate: context.missionDate } : {}),
      rentalAction,
    },
  });
}
```

Pass `rentalRequest.action` at every `recordWriteEvent()` call. Change `recordFailedWriteEvent()` to receive and forward the same action. Do not add action inference to the operation ledger store itself.

- [ ] **Step 4: Implement the pure ledger adapter**

Create `src/linkRegistry/delistOperationEvidence.ts`:

```ts
import type { OperationPlanJournalEntry } from '../agentRuntime/operationPlan.js';

export interface AgentDelistEvent {
  internalProductId: string;
  at: string;
  toolName: string;
  runId?: string;
  decisionId?: string;
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isSuccessfulDelist(entry: OperationPlanJournalEntry): boolean {
  if (entry.event !== 'execution_succeeded') return false;
  if (entry.toolName === 'rental.delist') return true;
  return entry.toolName === 'rental.operationConfirmRequest'
    && entry.metadata?.rentalAction === 'delist';
}

export function collectAgentDelistEvents(entries: OperationPlanJournalEntry[]): AgentDelistEvent[] {
  return entries
    .filter((entry) => isSuccessfulDelist(entry)
      && entry.subject?.kind === 'product'
      && /^\d+$/.test(entry.subject.id)
      && isValidTimestamp(entry.at))
    .map((entry) => ({
      internalProductId: entry.subject!.id,
      at: entry.at,
      toolName: entry.toolName!,
      ...(entry.runId ? { runId: entry.runId } : {}),
      ...(entry.decisionId ? { decisionId: entry.decisionId } : {}),
    }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.internalProductId.localeCompare(right.internalProductId));
}
```

- [ ] **Step 5: Run the focused tests and build**

Run:

```powershell
npm test -- tests/delistOperationEvidence.test.ts tests/rentalWriteLedger.test.ts tests/operationLedgerAttribution.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the operation evidence unit**

```powershell
git add src/linkRegistry/delistOperationEvidence.ts src/feishuBot/rentalWriteOperationHandlers.ts tests/delistOperationEvidence.test.ts tests/rentalWriteLedger.test.ts
git commit -m "feat: 归一化Agent下架操作证据"
```

---

### Task 3: Implement the Pure Delist Attribution Decision Layer

**Files:**
- Create: `src/linkRegistry/delistAttribution.ts`
- Modify: `src/linkRegistry/types.ts:1-36`
- Test: `tests/linkRegistryDelistAttribution.test.ts`

**Interfaces:**
- Consumes: `LinkListingState`, `PlatformRestrictionObservation[]`, `AgentDelistEvent[]`, final status observation time.
- Produces: `attributeDelist(input: DelistAttributionInput): DelistAttributionResult | null`.
- Later consumed by: `buildLinkRegistry.finalizeEntry()`.

- [ ] **Step 1: Write failing unit tests for all decision branches**

Create `tests/linkRegistryDelistAttribution.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { attributeDelist } from '../src/linkRegistry/delistAttribution.js';

const delisted = { listingState: 'delisted' as const, statusObservedAt: '2026-07-14T10:00:00.000Z' };

describe('attributeDelist', () => {
  it('maps review, frozen, and other platform restrictions as confirmed causes', () => {
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ kind: 'review_rejected', reasonText: '资质不足', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_review_rejected', confidence: 'confirmed' });
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ kind: 'frozen', reasonText: '涉嫌违规', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_frozen', confidence: 'confirmed' });
    expect(attributeDelist({ ...delisted, platformRestrictions: [{ kind: 'other', reasonText: '平台限制', observedAt: '2026-07-14T09:00:00.000Z' }] }))
      .toMatchObject({ cause: 'platform_restricted', confidence: 'confirmed' });
  });

  it('makes platform restriction win over a matching agent event', () => {
    expect(attributeDelist({
      ...delisted,
      platformRestrictions: [{ kind: 'frozen', reasonText: '冻结', observedAt: '2026-07-14T09:00:00.000Z' }],
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'platform_frozen', confidence: 'confirmed' });
  });

  it('confirms agent delist only when a successful event is no later than delisted readback', () => {
    expect(attributeDelist({
      ...delisted,
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist', runId: 'run-1' }],
    })).toMatchObject({ cause: 'agent_confirmed_manual_off_shelf', confidence: 'confirmed' });

    expect(attributeDelist({
      ...delisted,
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T10:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });

  it('uses external pending confirmation only for a delisted current state with no accepted evidence', () => {
    expect(attributeDelist(delisted)).toEqual({
      cause: 'external_manual_off_shelf_pending_confirmation',
      confidence: 'suspected',
      evidence: [],
    });
    expect(attributeDelist({ ...delisted, listingState: 'on_sale' })).toBeNull();
    expect(attributeDelist({ listingState: 'unknown' })).toBeNull();
    expect(attributeDelist({ listingState: 'gone' })).toBeNull();
  });

  it('does not confirm an agent event when final delisted observation has no valid time', () => {
    expect(attributeDelist({
      listingState: 'delisted',
      agentDelistEvents: [{ internalProductId: '648', at: '2026-07-14T09:30:00.000Z', toolName: 'rental.delist' }],
    })).toMatchObject({ cause: 'external_manual_off_shelf_pending_confirmation', confidence: 'suspected' });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
npm test -- tests/linkRegistryDelistAttribution.test.ts
```

Expected: FAIL because `delistAttribution.ts` and new registry types do not exist.

- [ ] **Step 3: Add registry types and implement a side-effect-free decision function**

In `src/linkRegistry/types.ts`, add exports after `LinkListingState`:

```ts
export type LinkDelistCause =
  | 'platform_review_rejected'
  | 'platform_frozen'
  | 'platform_restricted'
  | 'agent_confirmed_manual_off_shelf'
  | 'external_manual_off_shelf_pending_confirmation';

export type LinkDelistCauseConfidence = 'confirmed' | 'suspected';

export interface LinkDelistCauseEvidence {
  source: 'goods_snapshot' | 'operation_ledger';
  kind: 'platform_restriction' | 'agent_delist_execution';
  observedAt?: string;
  reasonText?: string;
  toolName?: string;
  operationEventAt?: string;
  runId?: string;
  decisionId?: string;
}
```

Add the optional fields to `LinkRegistryEntry` directly after `statusObservedAt`:

```ts
delistCause?: LinkDelistCause;
delistCauseConfidence?: LinkDelistCauseConfidence;
delistCauseEvidence?: LinkDelistCauseEvidence[];
```

Create `src/linkRegistry/delistAttribution.ts` with the following complete public shape:

```ts
import type { PlatformRestrictionObservation } from '../publicTraffic/types.js';
import type { AgentDelistEvent } from './delistOperationEvidence.js';
import type { LinkDelistCause, LinkDelistCauseConfidence, LinkDelistCauseEvidence, LinkListingState } from './types.js';

export interface DelistAttributionInput {
  listingState: LinkListingState;
  statusObservedAt?: string;
  platformRestrictions?: PlatformRestrictionObservation[];
  agentDelistEvents?: AgentDelistEvent[];
}

export interface DelistAttributionResult {
  cause: LinkDelistCause;
  confidence: LinkDelistCauseConfidence;
  evidence: LinkDelistCauseEvidence[];
}

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function causeForRestriction(kind: PlatformRestrictionObservation['kind']): LinkDelistCause {
  if (kind === 'review_rejected') return 'platform_review_rejected';
  if (kind === 'frozen') return 'platform_frozen';
  return 'platform_restricted';
}

function restrictionRank(kind: PlatformRestrictionObservation['kind']): number {
  if (kind === 'frozen') return 3;
  if (kind === 'review_rejected') return 2;
  return 1;
}

function selectRestriction(items: PlatformRestrictionObservation[]): PlatformRestrictionObservation | null {
  const candidates = items.filter((item) => item.reasonText.trim());
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const timeOrder = (validTimestamp(right.observedAt) ?? -Infinity) - (validTimestamp(left.observedAt) ?? -Infinity);
    return timeOrder || restrictionRank(right.kind) - restrictionRank(left.kind) || left.reasonText.localeCompare(right.reasonText);
  })[0] ?? null;
}

function matchingAgentEvent(events: AgentDelistEvent[], statusObservedAt: string | undefined): AgentDelistEvent | null {
  const observed = validTimestamp(statusObservedAt);
  if (observed === null) return null;
  return [...events]
    .filter((event) => {
      const at = validTimestamp(event.at);
      return at !== null && at <= observed;
    })
    .sort((left, right) => right.at.localeCompare(left.at))[0] ?? null;
}

export function attributeDelist(input: DelistAttributionInput): DelistAttributionResult | null {
  if (input.listingState !== 'delisted') return null;

  const restriction = selectRestriction(input.platformRestrictions ?? []);
  if (restriction) {
    return {
      cause: causeForRestriction(restriction.kind),
      confidence: 'confirmed',
      evidence: [{
        source: 'goods_snapshot',
        kind: 'platform_restriction',
        ...(restriction.observedAt ? { observedAt: restriction.observedAt } : {}),
        reasonText: restriction.reasonText,
      }],
    };
  }

  const event = matchingAgentEvent(input.agentDelistEvents ?? [], input.statusObservedAt);
  if (event) {
    return {
      cause: 'agent_confirmed_manual_off_shelf',
      confidence: 'confirmed',
      evidence: [{
        source: 'operation_ledger',
        kind: 'agent_delist_execution',
        operationEventAt: event.at,
        toolName: event.toolName,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.decisionId ? { decisionId: event.decisionId } : {}),
      }],
    };
  }

  return {
    cause: 'external_manual_off_shelf_pending_confirmation',
    confidence: 'suspected',
    evidence: [],
  };
}
```

- [ ] **Step 4: Run pure attribution tests and build**

Run:

```powershell
npm test -- tests/linkRegistryDelistAttribution.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the pure attribution unit**

```powershell
git add src/linkRegistry/types.ts src/linkRegistry/delistAttribution.ts tests/linkRegistryDelistAttribution.test.ts
git commit -m "feat: 增加链接下架原因归因"
```

---

### Task 4: Integrate Attribution into Registry Build and Runtime Loading

**Files:**
- Modify: `src/linkRegistry/buildRegistry.ts:12-48, 180-198, 628-681`
- Modify: `src/closedOrderFeedback/runtime.ts:1-12, 221-262`
- Create: `tests/linkRegistryRuntime.test.ts`
- Modify: `tests/linkRegistryBuild.test.ts`

**Interfaces:**
- Consumes: `BuildLinkRegistryInput.agentDelistEvents?: AgentDelistEvent[]` and `GoodsSnapshotItem.platformRestriction`.
- Produces: populated `LinkRegistryEntry.delistCause`, `delistCauseConfidence`, and `delistCauseEvidence`.
- Consumes: `loadOperationLedgerStore(resolvedPaths.artifactsDir).journal` via `collectAgentDelistEvents()`.

- [ ] **Step 1: Add failing build integration tests**

Append these cases to `tests/linkRegistryBuild.test.ts`:

```ts
it('materializes platform freeze attribution for a delisted goods snapshot', () => {
  expect(buildLinkRegistry({
    goodsSnapshot: [{
      platformProductId: 'platform-1701',
      internalProductId: '1701',
      productName: '冻结商品',
      listingState: 'delisted',
      listingStatusText: '已下架',
      observedAt: '2026-07-14T10:00:00.000Z',
      platformRestriction: { kind: 'frozen', reasonText: '涉嫌违规冻结', observedAt: '2026-07-14T10:00:00.000Z' },
    }],
  })[0]).toMatchObject({
    listingState: 'delisted',
    delistCause: 'platform_frozen',
    delistCauseConfidence: 'confirmed',
    delistCauseEvidence: [{ source: 'goods_snapshot', reasonText: '涉嫌违规冻结' }],
  });
});

it('uses verified agent delist only after a later delisted observation', () => {
  expect(buildLinkRegistry({
    daemonCatalog: {
      generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
      entries: [{ internalProductId: '1702', productName: 'Agent下架商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
    },
    agentDelistEvents: [{ internalProductId: '1702', at: '2026-07-14T09:00:00.000Z', toolName: 'rental.delist', runId: 'run-1' }],
  })[0]).toMatchObject({
    delistCause: 'agent_confirmed_manual_off_shelf',
    delistCauseConfidence: 'confirmed',
  });
});

it('keeps on-sale priority and clears current delist attribution despite old restriction data', () => {
  expect(buildLinkRegistry({
    goodsSnapshot: [{
      platformProductId: 'platform-1703', internalProductId: '1703', productName: '已恢复商品',
      listingState: 'on_sale', listingStatusText: '出售中', observedAt: '2026-07-14T10:00:00.000Z',
      platformRestriction: { kind: 'review_rejected', reasonText: '旧审核原因', observedAt: '2026-07-13T10:00:00.000Z' },
    }],
  })[0]).not.toHaveProperty('delistCause');
});

it('uses external manual pending confirmation when a delisted link has no platform or agent evidence', () => {
  expect(buildLinkRegistry({
    daemonCatalog: {
      generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0,
      entries: [{ internalProductId: '1704', productName: '外部下架商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }],
    },
  })[0]).toMatchObject({
    delistCause: 'external_manual_off_shelf_pending_confirmation',
    delistCauseConfidence: 'suspected',
    delistCauseEvidence: [],
  });
});
```

- [ ] **Step 2: Run build integration tests and verify they fail**

Run:

```powershell
npm test -- tests/linkRegistryBuild.test.ts
```

Expected: FAIL because `BuildLinkRegistryInput` does not accept `agentDelistEvents` and registry materialization does not call `attributeDelist()`.

- [ ] **Step 3: Thread restrictions and normalized events through `buildLinkRegistry()`**

In `src/linkRegistry/buildRegistry.ts`:

1. Import `attributeDelist`, `AgentDelistEvent`, and `PlatformRestrictionObservation`.
2. Extend `BuildLinkRegistryInput`:

```ts
agentDelistEvents?: AgentDelistEvent[];
```

3. Extend `DraftEntry`:

```ts
platformRestrictions: PlatformRestrictionObservation[];
```

4. Initialize it in `draftFor()`:

```ts
const draft: DraftEntry = {
  internalProductId,
  listingObservations: [],
  platformRestrictions: [],
  nameHints: new Set<string>(),
  aliases: new Set<string>(),
  sources: new Set<LinkRegistrySource>(),
};
```

5. In `addGoodsSnapshot()`, after adding the listing observation, retain a nonblank restriction:

```ts
if (item.platformRestriction?.reasonText.trim()) {
  draft.platformRestrictions.push(item.platformRestriction);
}
```

6. Change `finalizeEntry()` to accept the events:

```ts
function finalizeEntry(draft: DraftEntry, agentDelistEvents: AgentDelistEvent[]): LinkRegistryEntry
```

After `listingDecision`, call the pure decision function:

```ts
const attribution = attributeDelist({
  listingState: listingDecision.state,
  statusObservedAt: listingDecision.observedAt,
  platformRestrictions: draft.platformRestrictions,
  agentDelistEvents: agentDelistEvents.filter((event) => event.internalProductId === draft.internalProductId),
});
```

Materialize only a non-null result:

```ts
...(attribution ? {
  delistCause: attribution.cause,
  delistCauseConfidence: attribution.confidence,
  delistCauseEvidence: attribution.evidence,
} : {}),
```

7. Pass `input.agentDelistEvents ?? []` when mapping all drafts:

```ts
return [...drafts.values()]
  .map((draft) => finalizeEntry(draft, input.agentDelistEvents ?? []))
  .sort(compareInternalProductId);
```

Do not create a new `LinkRegistrySource`: the restriction remains evidence from the existing `goods_snapshot` source and ledger evidence is explicit in `delistCauseEvidence`.

- [ ] **Step 4: Add a failing runtime integration test**

Create `tests/linkRegistryRuntime.test.ts`. Use a temporary output directory with minimal JSON state files plus a persisted operation ledger event. Call `loadClosedOrderRegistryContext({ artifactsDir: outputDir, goodsSnapshotPath, productIdMapPath, productNameMapPath, firstSeenPath, lifecyclePath, daemonCatalogPath, overridesPath }, cwd)` and assert that the entry for a daemon-delisted product becomes `agent_confirmed_manual_off_shelf` when the ledger contains:

```ts
{
  planId: 'plan-1',
  at: '2026-07-14T09:00:00.000Z',
  event: 'execution_succeeded',
  toolName: 'rental.delist',
  subject: { kind: 'product', id: '1702' },
}
```

The daemon fixture must have `discoveredAt: '2026-07-14T10:00:00.000Z'` and `syncStatus: '已下架'`. Write the event with `recordOperationEvent(outputDir, entry)` rather than hand-writing JSONL, so the test verifies the actual ledger persistence contract.

- [ ] **Step 5: Make runtime load and pass ledger evidence**

In `src/closedOrderFeedback/runtime.ts`, add imports:

```ts
import { loadOperationLedgerStore } from '../agentRuntime/operationLedger.js';
import { collectAgentDelistEvents } from '../linkRegistry/delistOperationEvidence.js';
```

After `resolvedPaths` is available, load the ledger safely as part of the existing asynchronous data load:

```ts
const [productIdMapping, productNameMap, goodsSnapshot, firstSeen, lifecycle, operationLedger] = await Promise.all([
  // retain the existing five loaders unchanged,
  loadOperationLedgerStore(resolvedPaths.artifactsDir),
]);
```

Pass the normalized journal into `buildLinkRegistry()`:

```ts
agentDelistEvents: collectAgentDelistEvents(operationLedger.journal),
```

`loadOperationLedgerStore()` already returns an empty valid store for a missing/corrupt ledger; do not catch and silently hide other runtime errors in this layer.

- [ ] **Step 6: Run focused integration tests and TypeScript build**

Run:

```powershell
npm test -- tests/linkRegistryBuild.test.ts tests/linkRegistryRuntime.test.ts tests/linkRegistryRefreshHealth.test.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 7: Commit registry/runtime integration**

```powershell
git add src/linkRegistry/buildRegistry.ts src/closedOrderFeedback/runtime.ts tests/linkRegistryBuild.test.ts tests/linkRegistryRuntime.test.ts
git commit -m "feat: 在链接档案中接入下架归因"
```

---

### Task 5: Run Regression Suite and Verify Scope Boundaries

**Files:**
- Modify only if failures expose a genuine implementation defect in files already listed above.
- Test: `tests/goodsExportMapping.test.ts`
- Test: `tests/delistOperationEvidence.test.ts`
- Test: `tests/linkRegistryDelistAttribution.test.ts`
- Test: `tests/linkRegistryBuild.test.ts`
- Test: `tests/linkRegistryRuntime.test.ts`
- Test: `tests/linkRegistry*.test.ts`
- Test: `tests/rentalWriteLedger.test.ts`
- Test: `tests/operationLedger*.test.ts`

**Interfaces:**
- Consumes: completed contracts from Tasks 1–4.
- Produces: a verified implementation that does not widen scope into link-count classification or attribution logs.

- [ ] **Step 1: Run the exact feature suite**

Run:

```powershell
npm test -- tests/goodsExportMapping.test.ts tests/delistOperationEvidence.test.ts tests/linkRegistryDelistAttribution.test.ts tests/linkRegistryBuild.test.ts tests/linkRegistryRuntime.test.ts tests/rentalWriteLedger.test.ts tests/operationLedger.test.ts tests/operationLedgerAttribution.test.ts tests/operationLedgerBadLine.test.ts
```

Expected: all selected files and tests PASS.

- [ ] **Step 2: Run all link-registry regression tests**

Run:

```powershell
npm test -- tests/linkRegistry*.test.ts
```

Expected: all selected link-registry tests PASS, including state freshness and refresh-health protections.

- [ ] **Step 3: Run the full static build**

Run:

```powershell
npm run build
```

Expected: `tsc -p tsconfig.json` exits with code 0.

- [ ] **Step 4: Inspect scope and working-tree diff before final commit**

Run:

```powershell
git diff --check
git diff --stat HEAD~4..HEAD
git status --short --branch
```

Expected: no whitespace errors; changes limited to the files listed in Tasks 1–4; no change to `src/agentRuntime/toolRegistry.ts`; no production output, credentials, or unrelated worktree files.

- [ ] **Step 5: Commit only if a real regression fix was necessary**

If prior steps required a source or test fix after Task 4, commit that minimal correction:

```powershell
git add <only-the-corrected-files>
git commit -m "fix: 修正链接下架归因回归"
```

If all tests pass without further changes, do not create an empty commit.

## Plan Self-Review

- **Spec coverage:** Task 1 implements product-export platform restrictions; Task 2 creates trusted Agent delist evidence; Task 3 implements platform-first, readback-gated attribution; Task 4 writes the result to registry and supplies real ledger input; Task 5 verifies compatibility, freshness safeguards and scope exclusions.
- **Placeholder scan:** no `TODO`, `TBD`, “appropriate error handling”, or unspecified test steps remain.
- **Type consistency:** `PlatformRestrictionObservation` flows from `GoodsSnapshotItem` → draft → `DelistAttributionInput`; `AgentDelistEvent` flows from adapter → `BuildLinkRegistryInput` → attribution; the exact fields written to `LinkRegistryEntry` are defined in `types.ts` before use.
- **Scope check:** The plan deliberately excludes link-count/test-product classification and per-link decision-log artifacts; both remain follow-up work.
