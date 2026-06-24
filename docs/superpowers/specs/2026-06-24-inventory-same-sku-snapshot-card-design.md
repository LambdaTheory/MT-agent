# 库存情况同款组经营快照卡片 Design

## Goal

在不并入现有日报展示的前提下，新增一个独立的飞书只读入口 `库存情况`，让运营可以：

- 先看全局同款组经营概览
- 再按商品名或短名下钻到单个同款组
- 基于 link registry 的 `sameSkuGroupId` 聚合现有日报商品级数据
- 获得可解释、可审计的组级经营画像，而不是依赖 LLM 猜商品名

第一阶段的核心目标不是做“真实库存件数查询”，而是做“同款组经营概览卡片”。

## Scope

包含：

- 独立飞书命令 `库存情况`
- 无参数时返回全局概览卡
- 带查询词时返回单组详情卡
- 使用 link registry 做组名解析和歧义处理
- 基于最新日报上下文生成独立的同款组经营快照
- 将组级汇总、主力链接和风险标签展示在飞书卡片中

不包含：

- 不改造现有日报卡片主展示结构
- 不承诺真实库存件数、仓库库存或在库台数
- 不新增新的抓取链路
- 不做趋势图或历史多日分析
- 不在第一阶段输出自动运营建议结论
- 不做飞书交互式筛选器或按钮回写

## Current State

当前项目已经具备三块可直接复用的基础：

1. `link registry`
   - 已有 `resolveAlias(query)`
   - 已有 `getByInternalId(id)`
   - 已有 `listBySameSkuGroup(groupId)`
   - 已有 `audit()`

2. `PublicTrafficDataReportContext`
   - 已有商品级 `1d / 7d / 30d` 指标
   - 指标包含曝光、公域访问、公域金额
   - 指标包含创建 / 签约 / 审出 / 发货订单数与金额
   - 指标包含若干转化率

3. 飞书只读命令路由
   - 已有独立卡片型命令实现模式
   - 已有“先查最新上下文，再返回只读卡片”的运行方式

因此第一阶段不需要重新抓数据，重点是把“单链接经营数据”提升为“同款组经营数据”。

## User Experience

### Command Behavior

- `库存情况`
  返回全局概览卡
- `库存情况 pocket3`
  返回 Pocket 3 同款组详情卡
- `库存情况 ace pro 2`
  先走 link registry alias 解析，再决定展示结果

### Resolution Rules

- 唯一命中：
  直接返回该同款组详情卡
- 多个候选：
  返回候选组列表和澄清原因，不直接猜
- 无命中：
  明确提示未在链接档案中找到可解释命中

### Important Naming Boundary

飞书命令仍叫 `库存情况`，但第一阶段展示的是“组经营概览”，不是“真实库存数量”。

## Output Surfaces

### 1. 全局概览卡

`库存情况` 无参数时展示：

- 链接档案总览
  - 总链接数
  - 已分组链接数
  - 未分类链接数
  - 同款组数
- 经营快照覆盖情况
  - 有快照数据的同款组数
  - 无快照数据的同款组数
- 重点同款组 Top5
  - 默认按 `1日金额` 排序
  - 次排序按 `1日公域访问`
- 异常同款组 Top5
  - 高曝光低金额
  - 高访问低转化
  - 仅 1 条 active 链接
  - 组内大量链接缺数据
- 待整理提醒
  - 未分类链接数
  - 样本不足组数
  - alias 冲突数

### 2. 单组详情卡

`库存情况 <query>` 时展示：

- 组基础信息
  - 组名
  - `sameSkuGroupId`
  - `categoryName`
  - `productType`
  - active 链接数
  - 总链接数
- `1d / 7d / 30d` 汇总
  - 曝光
  - 公域访问
  - 公域金额
  - 创建 / 签约 / 审出 / 发货订单数
  - 创建 / 签约 / 审出 / 发货订单金额
  - 曝光→访问率
  - 访问→创建率
  - 访问→发货率
- 组内主力链接 Top5
  - 端内 ID
  - 商品名
  - 状态
  - 1日曝光
  - 1日公域访问
  - 1日公域金额
- 风险提示
  - 仅 1 条 active 链接
  - 组内存在 removed / unknown
  - 组内部分链接无日报数据
  - 样本不足
- 解析说明
  - 本次按什么 query 命中
  - 命中方式是 alias / sameSkuGroup / internal id

## Architecture

整体分成四层：

1. `group snapshot builder`
   - 输入：最新 `PublicTrafficDataReportContext` 与 `link registry`
   - 输出：同款组经营快照

2. `group snapshot store`
   - 负责读取和返回最新组快照
   - 不负责现场抓取或复杂计算

3. `inventory query service`
   - 负责处理 `库存情况` 文本命令
   - 调用 link registry 解析 query
   - 决定返回全局概览、单组详情、歧义提示或未命中提示

4. `feishu card formatter`
   - 负责把结果格式化成飞书卡片与文本兜底

## Data Model

建议新增独立组快照产物，按日期输出，例如：

- `output/YYYY-MM-DD/同款组经营快照_YYYY-MM-DD.json`

### Snapshot Root

- `date`
- `sourceReportDate`
- `generatedAt`
- `summary`
- `groups`
- `coverage`
- `registryAuditSummary`

### Group Snapshot

每个组至少包含：

- `sameSkuGroupId`
- `groupName`
- `categoryId`
- `categoryName`
- `productType`
- `activeLinkCount`
- `totalLinkCount`
- `mappedRowCount`
- `missingMetricLinkCount`
- `periods`
  - `1d`
  - `7d`
  - `30d`
- `topLinks`
- `risks`

### Period Metrics

每个周期保留：

- `exposure`
- `publicVisits`
- `amount`
- `createdOrders`
- `signedOrders`
- `reviewedOrders`
- `shippedOrders`
- `createdOrderAmount`
- `signedOrderAmount`
- `reviewedOrderAmount`
- `shippedOrderAmount`
- `exposureVisitRate`
- `visitCreatedOrderRate`
- `visitShipmentRate`

### Top Link Item

- `internalProductId`
- `platformProductId`
- `productName`
- `shortName`
- `status`
- `oneDayExposure`
- `oneDayPublicVisits`
- `oneDayAmount`

## Aggregation Rules

- 数量类字段直接求和
  - 曝光、访问、订单数、金额
- 比率类字段不做简单平均
  - 先聚合分子和分母，再重新计算
- `topLinks` 默认按 `1日金额` 降序，其次 `1日公域访问`
- 没有 `sameSkuGroupId` 的链接不进入组快照
  - 这类条目进入全局概览的待整理提醒
- removed 链接默认不计入 active 链接数
  - 但可以保留在总链接数和风险提示里

## Global Overview Rules

全局概览优先展示“今天最值得看”的组，而不是展示所有组。

推荐榜：

- 先按 `1日金额` 排序
- 次排序按 `1日公域访问`
- 只展示有经营数据的组

异常榜：

- `1日曝光` 高但 `1日金额 = 0`
- `1日公域访问` 高但 `访问→发货率` 很低
- 仅 1 条 active 链接
- `missingMetricLinkCount > 0`

## Error Handling

- 没有最新日报上下文：
  明确返回“暂无最新日报上下文，无法生成库存情况快照”
- 快照文件不存在：
  明确返回“暂无最新同款组经营快照”
- query 命中多个组：
  返回候选列表，不自动选
- query 无命中：
  返回 not found 提示，不瞎猜
- 组存在但没有任何经营指标：
  返回组存在，但说明暂无日报指标数据

## Testing

至少覆盖：

- `库存情况` 返回全局概览
- `库存情况 <sameSkuGroupId>` 直接命中组
- `库存情况 <alias>` 唯一命中组
- `库存情况 <alias>` 多候选时返回澄清
- `库存情况 <alias>` 无命中时返回 not found
- 组快照正确汇总 `1d / 7d / 30d` 指标
- 比率类按分子分母重算，而不是平均
- 组内 removed / missing metrics 能正确进入风险提示
- 全局概览能输出重点组与异常组
- 没有快照或没有上下文时返回清晰错误文本

## Success Criteria

- 存在独立于现有日报卡片的 `库存情况` 飞书入口
- 数据来源复用现有日报上下文，不新增抓取链路
- 能生成独立的同款组经营快照文件
- `库存情况` 无参数能返回全局概览卡
- `库存情况 <query>` 能稳定返回单组详情卡，或明确要求澄清
- Agent 不靠 LLM 猜商品名，必须通过 link registry 解析组名
- 第一阶段不承诺真实库存件数，只展示组经营概览

## Recommended Delivery Order

1. 组快照数据结构与聚合器
2. 单组查询服务
3. 全局概览生成
4. 飞书命令接入
5. 歧义处理与卡片格式化

## Phase 2 Direction

第二阶段再考虑：

- 组级运营建议
- 组级异常评分
- 同款组趋势对比
- 将组画像部分嵌回现有日报

第一阶段先把“同款组经营画像可查、可解释、可复用”做扎实。
