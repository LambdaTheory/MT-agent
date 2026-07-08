# 链接上架状态(已下架)修复 — 实施计划

- 计划日期:2026-07-04
- 分支/worktree:`worktree-link-status-fix`(`.claude/worktrees/link-status-fix`)
- 范围:让链接注册表的商品状态真实反映平台"在售/已下架",使已下架链接不再进入改价/规格删除/补链等操作范围。
- 属性:巩固性重构(非重写),预计 1 个长任务内完成。

---

## 0. 背景与根因(必读)

MT-agent 用"平台商品id ↔ 端内id 映射 + 融合四个数据源"维护每个商品资料(`src/linkRegistry/buildRegistry.ts`,draft 带优先级合并)。四个源语义:

1. **商品总表**(xlsx → `src/mapping/goodsExportMapping.ts`):**全量**,含 出售中/已下架,含平台id(商家侧编码内嵌端内id,提供映射)。
2. **访问页**:含状态但**抓不到**,忽略。
3. **曝光页**(`src/crawler/exposureCrawler.ts`):**仅自动托管子集**,覆盖不全;含下架状态 + 托管状态。
4. **daemon 查询**(`src/linkRegistry/daemonCatalog.ts`,来自 **SaaS,准确率最高**):**直接用端内id 做键**(免映射),含 `syncStatus`(可售卖/已下架/未同步/已同步/停售)、`listingStatusText`、最近操作时间。

**根因:状态维度在合并时被三个带状态的源集体丢弃,`status` 退化成"哪个源见过就是 active"。**

- `goodsExportMapping.ts:55-57` 只读 `商品名称/商家侧编码/平台侧编码`,**总表状态列被丢弃**;`GoodsSnapshotItem`(`src/publicTraffic/types.ts:51-55`)无 status 字段;`addGoodsSnapshot`(`buildRegistry.ts:142-154`)一律 `setStatus('active',3)`。
- `buildRegistry.ts:214-215` `addDaemonCatalog` 对每条 daemon 记录 **无条件** `setStatus('active',4)`(最高优先级),**丢弃 daemon 自己的 `syncStatus`**(仅存进 `daemonSyncStatus` metadata,永不参与 status)。这是最严重的一处:最准的源明明报了"已下架",却被写成 active 并压倒一切。
- 曝光 `listingStatus`(`src/publicTraffic/exposureStatus.ts`)只在日报侧用(`mergePublicTrafficData.ts`/`analyzePublicTrafficData.ts`),**从不进 `buildLinkRegistry`**(`BuildLinkRegistryInput` 无曝光入参;`src/closedOrderFeedback/runtime.ts:234-242` 构造注册表时也不传)。
- 唯一的 `removed` 来源是 `src/publicTraffic/goodsLinkLifecycle.ts`,判据"从总表消失"(reason 硬编码 `'商品总表缺失'`),但**已下架商品仍在总表**,永远判不出 removed。

**后果**:操作范围过滤 `removed` 的护栏本身是对的(`src/feishuBot/agentToolExecutor.ts:295` `entries.filter(e => e.status !== 'removed')`、`:483` `=== 'active'`、`:1320`、`:1134`),但拿到的 `status` 对"已下架"是瞎的 → 已下架商品仍进操作范围。

**修正原则(已与需求方对齐)**:daemon(SaaS)当 status 权威(高优先级正确,只需改成从 `syncStatus` 推导而非钉死 active)→ 商品总表状态列当全量兜底 → 曝光当托管子集佐证;并加两个护栏:daemon 未覆盖 ≠ 已下架(回落总表)、daemon 陈旧 ≠ 现状(用最近操作时间做新鲜度仲裁)。

---

## 1. 目标与验收标准

**目标**:同一端内id 的最终 `listingState` 反映最新可信来源;已下架(delisted)与从总表消失(gone)分开建模;操作范围排除 delisted/gone 并给出可区分的用户提示。

**验收标准(必须全部满足)**:
1. daemon `syncStatus ∈ {已下架, 停售}` 的商品,`buildLinkRegistry` 结果 `listingState='delisted'`、`status='removed'`,且**不出现在** `resolveRentalPriceSnapshotEntries` 的候选里。
2. 商品总表状态列为"已下架"、daemon 未覆盖的商品,同样判为 delisted 并被排除。
3. daemon 未覆盖(既无 daemon 记录)**不会**把商品误判为 delisted/gone(回落总表/曝光;无信号则 unknown,按现有 unknown 处理)。
4. Phase 0 的诊断脚本重跑后,"registry=active 但 daemon/总表/曝光=已下架"的不一致条数降到 0(或每条有明确解释)。
5. `npm test`、类型检查通过;新增单测覆盖状态推导与仲裁的关键分支。
6. 用户可见提示能区分"已下架(上架后可操作)"与"链接不存在"。

---

## 2. 设计决策

### D1. 用 `listingState` 新字段 + 派生 `status`(不改坏现有 enum)
- 新增 `listingState?: 'on_sale' | 'delisted' | 'gone' | 'unknown'` 到 `LinkRegistryEntry`(`src/linkRegistry/types.ts`)与 `DraftEntry`(`buildRegistry.ts`)。
- 新增 provenance:`statusSource?`(哪个源定的)、`statusObservedAt?`(该源的观测/操作时间)。
- **派生映射**:`on_sale→status:'active'`;`delisted|gone→status:'removed'`;`unknown→status:'unknown'`。
- 理由:现有消费方全按 `status active/removed/unknown` 工作(queryRegistry `includedByStatus`、operation-scope 过滤、卡片)。映射 delisted→removed 可**用最小改动立刻修复症状**,同时 `listingState` 保留 delisted/gone 区分供提示与未来使用。**不**直接改 enum,避免大范围回归。

### D2. 状态仲裁:信任层级 + 新鲜度覆盖 + 覆盖率护栏
- 每个 draft 收集来自各源的 `(source, listingState, observedAt)` 观测。
- 信任层级:**daemon > 商品总表 > 曝光**。
- **新鲜度覆盖**:较新的低层级源,可覆盖明显更旧的高层级源(阈值可配,如 daemon 观测比总表旧 > N 天则用总表)。默认 daemon 有值即优先(SaaS 最准)。
- **覆盖率/缺失护栏**:`listingState` 只能由**显式的下架/停售信号**得出;**任何源的"缺席/未返回"都不得推出 delisted/gone**(避免 daemon 分页抓漏导致批量误判)。缺显式信号 → 回落更低层级 → 都没有 → `unknown`。
- 实现为**纯函数** `arbitrateListingState(observations): { state, source, observedAt }`,独立单测。

### D3. 状态文本 → listingState 的统一映射
- 单一 helper `parseListingStateFromText(text)`:复用 `exposureStatus.ts` 的 出售中/已下架 正则;daemon `syncStatus` 映射:`可售卖|已同步|通过|上架 → on_sale`;`已下架|停售 → delisted`;`未同步 → unknown`。
- 集中一处,三个源共用,禁止各写各的正则。

---

## 3. 分阶段实施

> 每个 Phase 结束都应能编译 + 过测;尽量小步提交。

### Phase 0 — 基线与探明(只读,先做)
1. 探明真实字段(**阻塞项,先解决**):
   - 商品总表状态列的**确切表头名**与取值文案 —— 在 `output/`(或最近的商品总表 xlsx)里用脚本 dump 表头确认;若拿不到真实文件,向需求方索取一行真实表头。默认假设:列名候选 `商品状态`/`上架状态`,取值 `出售中`/`已下架`(与曝光页一致)。
   - daemon 回传结构:检查 `output/state/link-registry-daemon-catalog.json`(或 `daemonCatalog.ts` 解析入口),确认 `syncStatus` 是**结构化字段**还是只有原始 `cells`(后者靠 `looksLikeSyncStatus` 正则猜列,`daemonCatalog.ts:87-88`,脆弱,需在计划中记风险)。
   - 确认 daemon 是否含独立"最近操作时间"字段:当前 `entryFromPlatformRow` 未单独解析,且 `looksLikeListingStatus`(`:80`)会把纯日期误当 `listingStatusText`。若要做新鲜度仲裁,需在 Phase 2b 顺带把它拆成独立字段(如 `lastOperatedAt`)。
2. 写只读诊断脚本 `src/cli/linkListingStatusDiagnose.ts`(或 tmp 脚本):对每个端内id 输出 `registry.status` / daemon syncStatus / 总表 presence+状态 / 最近曝光 listingStatus,并**列出所有 "registry=active 但某源=已下架" 的不一致**。作为基线与最终回归 oracle。记录当前不一致条数。

### Phase 1 — 数据模型
- `src/linkRegistry/types.ts`:给 `LinkRegistryEntry` 加 `listingState?`、`statusSource?`、`statusObservedAt?`。
- `buildRegistry.ts`:`DraftEntry` 加对应字段 + 观测收集容器(如 `listingObservations: Array<{source,state,observedAt}>`)。
- 新增 `src/linkRegistry/listingState.ts`:`parseListingStateFromText`、`arbitrateListingState`、`listingStateToStatus`。**先写这个文件 + 单测**。

### Phase 2 — 三个状态源接入
**2a 商品总表状态列**
- `goodsExportMapping.ts`:`parseGoodsExportWorkbook` 增读状态列(用 `findColumn` 的**可选**变体,列缺失时不抛错、记 skip 原因);把 listingState 写入快照项。
- `src/publicTraffic/types.ts`:`GoodsSnapshotItem` 加 `listingStatus?`(复用 `ExposureLinkStatus` 或新 listingState)。
- `buildRegistry.ts` `addGoodsSnapshot`:改为往 `listingObservations` 追加总表观测(不再无脑 active)。
- 同步更新 `src/mapping/annotateGoodsExportWorkbook.ts` 及任何依赖 `GoodsSnapshotItem` 形状处;更新 `tests/goodsExportMapping.test.ts` fixture(加状态列)。

**2b daemon syncStatus → 状态(核心修复)**
- `buildRegistry.ts` `addDaemonCatalog`(`:208-219`):删掉无条件 `setStatus('active',4)`;改为 `parseListingStateFromText(item.syncStatus ?? item.listingStatusText)` → 追加 daemon 观测(带 `discoveredAt`/最近操作时间作 observedAt)。
- 若 Phase 0 确认需要,`daemonCatalog.ts` 把"最近操作时间"拆为独立字段并停止把日期误并入 `listingStatusText`。

**2c 曝光 listingStatus 接入注册表**
- `BuildLinkRegistryInput` 加 `exposureListingStatus?: Record<platformProductId, { state; observedAt }>`。
- 新增 `addExposureListingStatus(drafts, input, productIdMapping)`:平台id→端内id 映射后追加曝光观测(仅托管子集)。
- 在 `src/closedOrderFeedback/runtime.ts:234` 与 `src/linkRegistry/promptRefresh.ts` 的注册表构造处,加载已持久化的曝光累计产物(参考 `src/publicTraffic/rebuildPublicTrafficReport.ts:100` 读 `paths.exposureCumulativeProducts`)并传入。缺文件时优雅降级为空。

### Phase 3 — 仲裁落地
- `buildRegistry.ts` `finalizeEntry`(或新 `resolveListing` 步骤):调用 `arbitrateListingState(draft.listingObservations)`,写 `listingState/statusSource/statusObservedAt`,并 `status = listingStateToStatus(listingState)`。
- 移除/收敛旧的 `setStatus` 优先级逻辑中与"listing 在售/下架"相关的部分(保留 firstSeen/lifecycle 的存在性语义,但 lifecycle"消失"归入 `gone` 而非冒充下架)。
- `goodsLinkLifecycle` 的"总表消失"事件映射到 `gone` 观测(最低信任),不再是唯一 removed 源。

### Phase 4 — 操作范围消费 & 提示
- 确认 operation-scope 过滤仍生效(delisted→status removed,`agentToolExecutor.ts:295/483/1320/1134` 无需改即可排除)。补测。
- 提示区分:`agentToolExecutor.ts:194-195`(在架/已下架)、`src/feishuBot/linkRegistryOverviewCard.ts`、审计/库存卡按 `listingState` 显示 "已下架(上架后可操作)" vs "链接不存在(gone)"。
- (可选增强)范围解析剔除 delisted 时,确认卡追加 "已剔除 N 条已下架"。

### Phase 5 — 测试与验证
- 单测:`parseListingStateFromText`、`arbitrateListingState`(信任层级/新鲜度/缺失护栏全分支)、`listingStateToStatus`、goodsExportMapping 状态列、`buildRegistry` daemon 已下架→removed、曝光接入。
- 集成:混合四源 fixture 构建注册表,断言 delisted 不进 `resolveRentalPriceSnapshotEntries` 候选。
- 重跑 Phase 0 诊断:不一致条数→0(或逐条解释)。
- `npm test` + 类型检查。用 `/verify` 或实际跑一遍 daily 报表/注册表刷新 CLI 做冒烟。

### Phase 6 — 文档与记忆
- 更新 `README.md` 链接模块小节;在 `docs/superpowers/specs/` 写设计说明(对齐既有命名)。
- 更新 memory:`link-registry-four-sources-status`(标注已修复的部分)。

---

## 4. 风险与缓解
- **真实表头/文案未知** → Phase 0 先探明或索取;解析做成"列可缺失、文案复用曝光正则、命中不了记 skip"。
- **daemon 只回 cells(非结构化)** → `syncStatus` 靠正则猜列,脆弱;记录风险,必要时推动 daemon 端回传结构化字段。
- **daemon 覆盖不全/陈旧** → 缺失护栏(D2:不得由缺席推 delisted)+ 新鲜度仲裁;Phase 0 诊断量化覆盖率。
- **改 `GoodsSnapshotItem` 形状的连带影响** → 全仓搜索消费方,逐一更新 + 类型检查兜底。
- **回归** → listingState→status 的映射保持现有 enum 语义,消费方零改动即修复;新增全部走新字段。

## 5. 明确不在本任务范围(另立任务)
- sameSkuGroupId 三层覆盖模型重构(见 memory `link-registry-override-model-flaws`)。仅当阻塞状态修复时才最小触碰。
- overrides 文件并发/原子写加固。
- 硬编码正则表(短名/分类)→ 数据表化。

## 6. 关键文件锚点速查
- `src/linkRegistry/buildRegistry.ts`:`addGoodsSnapshot:142` `addDaemonCatalog:208-219` `finalizeEntry:520` `confidenceFor:503`
- `src/linkRegistry/daemonCatalog.ts`:`entryFromPlatformRow:101` `looksLikeSyncStatus:87` `looksLikeListingStatus:80`
- `src/linkRegistry/types.ts`:`LinkRegistryStatus:1` `LinkRegistryEntry:7`
- `src/mapping/goodsExportMapping.ts`:`parseGoodsExportWorkbook:53` `findColumn:32`
- `src/publicTraffic/types.ts`:`GoodsSnapshotItem:51` `ExposureLinkStatus:13` `ExposureCumulativeProduct:15`
- `src/publicTraffic/exposureStatus.ts`:`parseExposureLinkStatus:20`
- `src/closedOrderFeedback/runtime.ts`:`loadClosedOrderRegistryContext:214` `buildLinkRegistry({...}):234`
- `src/feishuBot/agentToolExecutor.ts`:`queryableEntries:295` `resolveRentalPriceSnapshotEntries:369` 状态文案 `:194-195`
- `src/publicTraffic/goodsLinkLifecycle.ts`:`updateGoodsLinkLifecycle:50`
