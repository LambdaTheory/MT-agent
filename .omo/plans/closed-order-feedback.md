# 关单反馈运营建议模块 开发指导文档

## 新 Session 启动上下文

项目路径：

```text
C:\works\MT-agent\.worktrees\closed-order-feedback
```

分支：

```text
feature/closed-order-feedback
```

基线：

```text
master @ 2588fc9 调整：公域日报文本仅展示公域金额
```

重要约束：

- 不要修改或重启生产 PM2，尤其 `mt-feishu-bot`。
- 不要 push，除非用户明确要求。
- 不读取、打印或提交 `.env`、真实账号凭据、浏览器 profile 内容、任何 secret。
- 不接真实 LLM API；测试用 fake provider。
- 副作用（改价等）必须人工确认，禁止自动执行。
- 每条 git 命令前加：`$env:GIT_MASTER='1';`。
- 本 worktree 只做关单反馈模块设计/开发，不顺手改抓取、飞书卡片、agent-runtime、解耦等其他主线。

## 这是什么需求

订单平台会以 API 形式交付“关单订单 + 关单原因备注”。返回信息形态：`端内id + 备注内容`，更新即推送（主动推送给我们）。

目标：基于关单原因，对该链接的运营情况给出运营建议（例如改价、调规格、同款统一调价的候选提示）。

关键背景（决定整个设计定位）：

- 链都是我们这边上的；商家只在我们平台接收订单去发货。
- 我们负责派单与商品平台运营，掌握定价权和成交端数据。
- 商家能看到上级平台其他商家的价格（横向价格对比），但看不到曝光/访问/转化漏斗。
- 因此商家的关单归因（如“定价太低不接单”）是：有价格依据、但单维度、且带涨价倾向的反馈。

## 核心设计定位

```text
关单备注的角色：触发器 + 低权重定性线索（不是判断依据）
真正判断依据：我们独有的全局数据（同品类成交对照 + 自身漏斗）
最终动作：运营建议，我们自己可执行（执行权在我们）
LLM 角色：理解/归类/给建议（分析层），不直接触发任何副作用
```

不要把商家备注当成事实，要把它当成“去复核这条链”的触发信号。方向由我们的数据裁决，不被商家的涨价倾向带跑。

## 数据契约（待 API 文档确认）

API 交付时会附使用文档。接入前必须确认：

```text
必有：端内id、备注内容
强烈要求补充：关单时间、关单唯一id（用于时间窗聚合 + 幂等去重）
确认项：推送形态（webhook 推 / 我们拉）、频率、重试约定、鉴权方式
```

如果只有 `端内id + 备注`：

- 第一版能跑（即时解析 + 存档）。
- 但第二版“近 N 天累计聚合”会缺时间维度，做不了。
- 所以务必在 API 需求里争取关单时间与唯一id。

## 分阶段实现

### Phase 1：接收 + 解析 + 存档（无副作用，先做）

目标：把关单数据接进来、原因能归类、人看了觉得有用。

可能新增（命名为建议，非强制）：

```text
src/closedOrderFeedback/types.ts             关单反馈结构与原因枚举
src/closedOrderFeedback/ingest.ts            接收/落盘/幂等去重
src/closedOrderFeedback/reasonClassifier.ts  LLM 解析备注（带 fake provider 接口）
tests/closedOrderFeedbackIngest.test.ts
tests/closedOrderFeedbackClassifier.test.ts
```

LLM 解析输出（结构化，允许拒答）：

```ts
interface ClosedOrderReasonAnalysis {
  internalProductId: string;
  reasonType: 'pricing' | 'spec' | 'inventory' | 'service' | 'logistics' | 'irrelevant' | 'unclear';
  direction?: 'wants_higher_price' | 'wants_lower_price' | 'none';
  sentiment?: 'complaint' | 'neutral' | 'other';
  modelConfidence: number;
  suggestionHint?: string;
  rawNote: string;
  receivedAt?: string;
}
```

要点：

- `irrelevant` / `unclear` 必须是合法输出，允许模型拒答噪音。
- 不接真实 LLM；定义 provider 接口，测试注入 fake。
- 原始备注 + 端内id + 时间必须原样存档，便于回溯和评估模型质量。
- 幂等去重可借鉴现有 `src/feishuBot/dispatcher.ts` 的 messageId 去重模式。

Phase 1 不做置信度、不做同品类对照、不改价。可先把结果汇总进日报的一段“近期关单原因汇总”，或单独落盘。

### Phase 2：置信度评估（同品类对照，最重）

目标：用我们独有的成交数据，验证商家的价格判断到底对不对。

置信度 = 三来源合成（不是单一数字）：

```text
1. 商家归因（LLM 解析）          —— 最低权重，主要用于分类，不定方向
2. 自身漏斗（曝光/访问/转化）    —— 复用现有公域数据
3. 同品类对照（核心，新增）      —— 同款近 1/3/5 天单量 + 价格-单量关系
```

同品类对照逻辑（针对 pricing 类）：

```text
同价位的同款链都有单，就这条没接   -> 不是价格问题，商家归因存疑，置信度低
同价位的同款普遍没单               -> 价格判断可能成立，值得调价，置信度高
单量明显往低价链集中               -> 价格敏感，归因可信
单量与价格无明显关系               -> 价格不是主因，归因存疑
```

时间窗：

```text
近1天：噪声大，只看趋势
近3天：主要判断依据
近5/7天：确认是否持续
```

数据获取（重要，和抓取成本相关）：

- 同品类成交数据由我们自己去订单平台抓，不是 API 推送。
- 不要被关单推送实时触发抓取（来一条抓一次太重、可能高频打订单平台）。
- 做法：关单推送先入队落盘，同品类抓取挂在日报已有抓取节奏上批量评估。即“推送即时收，评估批量算”。

依赖：

- 同品类/同款分组来自 `feature/link-registry`（现有链接维护模块）。
- 没有可靠分组，对照组就不准 -> Phase 2 强依赖 link-registry 先就位。
- 对照组样本太小（同款仅 1-2 条）时，标注“样本不足，置信度低”，不硬给结论。

### Phase 3：运营建议输出（暂不自动改价）

```text
人确认后改价：复用现有改价确认卡（src/feishuBot/rentalPrice.ts 等）
同款统一调价：高风险放大器，单独立项，第一版不做
```

## 与其它模块的依赖关系

```text
依赖 feature/link-registry：
  端内id -> 同款分组 -> 同品类对照（Phase 2 必需）

复用现有：
  端内id -> 平台id 映射（src/mapping/*）
  曝光/访问/转化数据（src/publicTraffic/*, src/agentData/*）
  改价确认卡（src/feishuBot/rentalPrice.ts）
  LLM provider 接口（src/llm/*）
  幂等去重模式（src/feishuBot/dispatcher.ts）
```

## 优先级

中等优先级。卡点：

- 关单 API 还在开发中（最硬）。
- 同款分组（link-registry）需先就位。
- 置信度依赖的成交数据来自抓取链路，需抓取先稳定。

建议排在“抓取可靠性”和“agent-runtime/解耦”之后启动；等 API 文档 + link-registry 就位后，Phase 1 很轻、可快速验证价值。

## 现在就能做（不依赖 API）

- 定义关单反馈类型与原因枚举（types.ts）。
- 设计 LLM 解析 provider 接口 + fake 测试。
- 设计接收/落盘/去重骨架（先用样例数据驱动）。
- 与 link-registry 对齐“同款分组”查询接口形态。

## 2026-06-18 本阶段执行记录：fake-provider 骨架

阶段边界：

- 只做 fake-provider 骨架，不接真实关单 API。
- 不读取外部真实接口，不接真实 LLM API，不触发真实副作用。
- 输入契约先固定为：`internalProductId`、`rawRemark`、可选 `closeId`、可选 `closedAt`。
- 输出仅做置信度反馈对象，`recommendedAction` 必须始终是 `manual_review_only`。

真实 API 仍需确认字段：

- 必需：端内 id、备注内容。
- 建议争取：`closeId`（幂等去重）、`closedAt`（时间窗聚合）。
- 缺少 `closeId` / `closedAt` 时允许处理，但 `dataCompleteness` 必须标注不完整。

当前 fake-provider 闭环：

```text
internalProductId + rawRemark
  -> fake provider 固定样例（不读外部接口）
  -> linkRegistry.byInternalId(internalProductId)
  -> linkRegistry.bySameSkuGroup(sameSkuGroupId)
  -> confidence feedback object
```

置信度契约：

- 商家备注只作为低权重线索，只能辅助 reasonTags / inferredReason。
- 找不到端内 id、找不到 sameSkuGroupId、同款样本不足时必须降权并标注需人工复核。
- 同款样本充足也只输出复核对象，不输出自动改价、自动下架、自动复制、自动租期/规格修改建议。
- 当前阶段固定 `recommendedAction = "manual_review_only"`。

## 验证

```text
npm run build
npm test
针对性：npx vitest run tests/closedOrderFeedback*.test.ts
```

测试不接真实 API、不接真实 LLM、不打订单平台；用样例数据 + fake provider。

## 下一 Session 第一步

1. 进入 `C:\works\MT-agent\.worktrees\closed-order-feedback`。
2. 阅读本文件。
3. 阅读参考：`src/feishuBot/dispatcher.ts`（去重）、`src/llm/*`（provider 接口）、`src/mapping/*`（端内id 映射）。
4. 先做 Phase 1 的 types + fake-provider 解析骨架，不接真实数据。
5. 等 API 文档到位再写真实接收层；等 link-registry 就位再做 Phase 2。
