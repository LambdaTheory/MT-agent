# 链接下架原因归因设计

**日期：** 2026-07-14  
**状态：** 已完成方案确认，等待文档评审  
**范围：** 链接档案中当前已下架链接的原因归因

## 1. 背景与问题

链接档案当前已经可以汇聚 daemon、商品总表、曝光和商品生命周期等来源，并将当前上架状态仲裁为：

- `on_sale`：当前在售；
- `delisted`：当前已下架或停售、未来可能恢复；
- `gone`：已从商品总表生命周期消失；
- `unknown`：信息不足或不可判定。

其中 `delisted` 只描述“当前是否下架”的事实，不能解释下架主体或原因。现有系统会发现同款链接数量变化或链接状态异常，但无法把以下原因明确区分并结构化沉淀：

- 平台审核不通过；
- 平台冻结；
- 其他平台限制；
- MT-agent 在人工确认后成功执行的下架；
- 未被 MT-agent 记录的外部后台人工下架。

本设计将下架原因作为长期 registry 事实的一部分，而不是临时审计文案或由 LLM 猜测的结论。

## 2. 目标

1. 在不改变现有 `listingState` 语义的前提下，为当前 `delisted` 链接生成可解释的下架原因。
2. 将商品总表中的“审核不通过/冻结原因”作为平台下架的结构化强证据。
3. 将 MT-agent 的成功下架事件与后续可信来源 `delisted` 回读相匹配，确认“Agent 受人工确认下架”。
4. 对没有平台限制证据、也没有可匹配 Agent 下架证据的已下架链接，明确标注为“外部人工下架（待确认）”。
5. 让归因逻辑成为独立纯函数层，便于测试、审计与后续扩展。
6. 保持现有状态仲裁、操作护栏、确认卡和旧 registry 消费方的兼容性。

## 3. 非目标

本期不包含：

- “同款链接数量少”异常原因判断；
- 新增测试商品识别；
- 逐链接归因决策日志或独立归因输出产物；
- 确认人、具体同事身份或平台后台操作者识别；
- 新增真实抓取、发送飞书消息、重启 daemon 或改变写操作确认流程；
- 使用自由文本原因推导任何写操作参数。

后续待办：

1. 对“同款链接数量少”区分测试商品、下架、分组错误、数据源问题等原因。
2. 生成按日的逐链接归因决策日志，包含状态、归因、证据、置信度及被抑制原因。
3. 如 daemon 或平台接口提供结构化操作类型、操作人、原因码，可将其纳入独立证据源。

## 4. 领域模型

### 4.1 当前状态与原因归因分离

`listingState` 保持当前含义：

```text
on_sale | delisted | gone | unknown
```

新的原因字段只回答“为何当前已下架”：

```ts
export type LinkDelistCause =
  | 'platform_review_rejected'
  | 'platform_frozen'
  | 'platform_restricted'
  | 'agent_confirmed_manual_off_shelf'
  | 'external_manual_off_shelf_pending_confirmation';

export type LinkDelistCauseConfidence = 'confirmed' | 'suspected';
```

`LinkRegistryEntry` 新增可选字段：

```ts
delistCause?: LinkDelistCause;
delistCauseConfidence?: LinkDelistCauseConfidence;
delistCauseEvidence?: LinkDelistCauseEvidence[];
```

原因字段仅在最终 `listingState === 'delisted'` 时存在；对于 `on_sale`、`gone`、`unknown`，不得写入当前下架原因。

### 4.2 证据模型

每条归因证据可追溯其来源、时间和文本：

```ts
export interface LinkDelistCauseEvidence {
  source: 'goods_snapshot' | 'operation_ledger';
  observedAt?: string;
  kind: 'platform_restriction' | 'agent_delist_execution';
  reasonText?: string;
  toolName?: string;
  operationEventAt?: string;
  runId?: string;
  decisionId?: string;
}
```

证据仅用于解释、展示、审计和归因；不能作为任何商品写操作的参数来源。

### 4.3 商品总表限制信息

商品总表快照扩展为可选的结构化平台限制信息：

```ts
export interface PlatformRestrictionObservation {
  kind: 'review_rejected' | 'frozen' | 'other';
  reasonText: string;
  observedAt?: string;
}
```

解析层读取“审核不通过原因”和“冻结原因”等可选列。非空的冻结信息优先归为 `frozen`；非空审核不通过信息归为 `review_rejected`；其他后续识别到的平台限制信息归为 `other`。原文必须保留。

`observedAt` 表示这份商品总表快照的采集/状态时间；它用于与 registry 当前状态的观测时间对照，不能伪造为 Excel 内部单元格时间。

## 5. 架构与组件边界

采用“独立归因纯函数层”的方案。

```text
商品总表解析 ────> 平台限制观察 ─┐
                                  │
operation ledger ──> 下架成功事件 ├─> delistAttribution 纯函数
                                  │              │
四源状态仲裁 ────> 最终状态/时间 ─┘              └─> registry 原因字段与证据
```

### 5.1 商品总表解析层

`src/mapping/goodsExportMapping.ts` 仅负责：

- 解析必需的商品标识字段和状态列；
- 可选解析审核不通过原因、冻结原因；
- 将原始限制信息写进 `GoodsSnapshotItem` 的结构化字段。

它不判断最终归因、不读取 operation ledger。

### 5.2 下架操作证据适配层

链接模块通过小型 adapter 从已有 operation ledger 读取下架证据：

- 只识别 `rental.delist`，以及 `rental.operationConfirmRequest` 中实际 action 为 `delist` 的写操作；
- 只接受 `execution_succeeded` 事件；
- `execution_started`、`execution_failed` 和没有明确下架动作的事件不得成为归因证据；
- 适配层返回已按商品 ID 归并的、最小化且可序列化的候选事件。

当前不记录确认人。本期以“成功执行事件 + 后续 delisted 回读”作为 Agent 下架的确认条件。

### 5.3 归因纯函数层

新增 `src/linkRegistry/delistAttribution.ts`。该模块：

- 不读取文件；
- 不请求 daemon 或业务后台；
- 不写日志或输出；
- 仅接收标准化的最终状态、状态来源、观测时间、平台限制观察、Agent 下架候选事件和来源健康结论；
- 返回可选的原因、置信度和证据。

`buildRegistry.ts` 继续只负责汇集来源、状态仲裁、同款组/分类推断和最终条目物料化；它调用归因纯函数，不内嵌下架原因规则。

## 6. 决策规则

### 6.1 前置安全条件

1. 若最终 `listingState !== 'delisted'`，不生成 `delistCause`。
2. 若状态数据不可用、健康检查要求抑制破坏性判断，或最终状态未被可信仲裁为 `delisted`，不生成归因。
3. 若更新鲜可信来源显示 `on_sale`，以在售优先：不生成当前下架归因。旧审核/冻结文案若被保留，只能作为历史数据，不能展示为当前平台下架。

### 6.2 原因优先级

对满足前置条件的 `delisted` 条目按以下顺序处理：

1. **平台限制原因**
   - 总表存在有效且与当前状态不矛盾的限制观察；
   - 审核不通过 → `platform_review_rejected`；
   - 冻结 → `platform_frozen`；
   - 其他平台限制 → `platform_restricted`；
   - 置信度：`confirmed`；
   - 证据：总表原始原因、状态文本及观测时间。

2. **Agent 受人工确认下架**
   - 没有上述有效平台限制原因；
   - 有同一 `internalProductId` 的成功下架 operation ledger 事件；
   - 该成功事件时间不晚于最终可信的 `delisted` 观测时间；
   - 因此完成“成功执行 + 后续来源回读为 delisted”的闭环；
   - 原因：`agent_confirmed_manual_off_shelf`；
   - 置信度：`confirmed`；
   - 证据：工具名、事件时间、run/decision 标识（如有）和当前状态观测。

3. **外部人工下架（待确认）**
   - 最终状态为 `delisted`；
   - 没有有效的平台限制原因；
   - 没有可匹配的 Agent 成功下架事件；
   - 原因：`external_manual_off_shelf_pending_confirmation`；
   - 置信度：`suspected`；
   - 展示含义：很可能通过业务后台或其他非 MT-agent 覆盖入口下架，系统不能判定具体操作者。

平台限制原因优先于 Agent 成功事件，因为前者是平台对当前不可售状态的直接说明。若两类证据同时存在，Agent 事件可保留在证据中，但最终原因使用平台限制。

## 7. 展示语义

| 内部原因 | 展示文本 |
| --- | --- |
| `platform_review_rejected` | 平台审核不通过 |
| `platform_frozen` | 平台冻结 |
| `platform_restricted` | 平台限制下架 |
| `agent_confirmed_manual_off_shelf` | Agent 受人工确认下架 |
| `external_manual_off_shelf_pending_confirmation` | 外部人工下架（待确认） |

“外部人工下架（待确认）”不是“确认由某位同事执行”。它只说明系统排除了当前可识别的平台限制和 MT-agent 已验证下架记录，仍需要业务侧确认。

## 8. 回读与错误处理

| 情况 | 处理 |
| --- | --- |
| 下架操作仅开始或执行失败 | 不作为归因证据 |
| 执行成功，但没有之后的 `delisted` 回读 | 不确认 Agent 下架 |
| 执行成功，后续回读仍为 `on_sale` | 在售优先；不输出当前下架原因 |
| 平台限制与成功 Agent 事件同时存在 | 平台原因优先，事件保留为证据 |
| `delisted` 但没有平台/Agent 证据 | 外部人工下架（待确认） |
| `unknown`、健康门抑制或不可消解状态冲突 | 不输出下架归因 |
| 总表缺失原因列、原因值为空 | 与无平台限制证据等价，保持兼容 |

## 9. 测试策略与验收

### 9.1 单元测试

1. 商品总表正确读取审核不通过、冻结原因及其原文；空列、缺列保持兼容。
2. 审核、冻结和其他限制分别映射到正确原因和 `confirmed` 置信度。
3. 最终 `on_sale` 时，即使总表有旧平台原因，也不产生当前下架归因。
4. `rental.delist` 成功事件与后续 `delisted` 回读匹配时，产生 `agent_confirmed_manual_off_shelf`。
5. 仅开始、失败、成功但无回读、成功但回读在售均不产生已确认 Agent 下架。
6. 平台原因和 Agent 成功事件同时存在时，平台原因优先。
7. 无平台/Agent 证据的 `delisted` 产生外部人工下架（待确认）和 `suspected`。
8. `unknown`、不健康数据源或被状态规则抑制时没有归因。

### 9.2 回归测试

- 既有四源上架状态仲裁和 24 小时新鲜度覆盖保持不变；
- daemon 抓空、快照骤降时生命周期抑制逻辑保持不变；
- registry 持久化、查询、审计和旧 JSON 兼容；
- `delisted / gone → removed` 的既有可操作范围护栏不被削弱。

### 9.3 验收标准

- 商品总表审核/冻结原因被带入正式链接档案；
- 当前 `delisted` 链接能获得平台、已确认 Agent、外部待确认或无归因四类结果之一；
- Agent 下架不因开始、失败或缺少回读而被误确认为已下架；
- 更新鲜可信来源恢复在售时，不残留当前下架归因；
- 不扩大本期范围到测试商品、链接数量少或逐链接归因日志。
