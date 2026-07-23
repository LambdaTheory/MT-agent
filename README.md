# MT-agent

MT-agent 是一个面向运营场景的 `Node.js + TypeScript` 自动化项目，当前主要服务于支付宝侧商品与公域流量分析，并通过飞书完成日报投递、只读查询、任务提醒，以及部分活动页自动化辅助。

项目现阶段的核心定位不是“全自动改价/上链执行器”，而是“分析、汇总、提醒、半自动辅助”的运营 Agent 基座。高风险写操作默认需要确认，很多能力仍然保留为人工审批或人工兜底。

## 1. 项目现状

当前仓库已经具备以下主线能力：

- 公域流量日报生成：抓取商品总表、曝光数据、访问数据、订单分析数据，输出 `Markdown`、`Excel`、`JSON` 产物。
- 商品 ID 映射维护：从商品总表刷新映射，给分析结果补充平台商品 ID / 内部商品 ID 对应关系。
- 新品池与链接生命周期观察：跟踪最近新增商品、首次出现商品、下架链接、同款库存快照等状态。
- 飞书通知：支持个人、群聊、双通道发送文本/卡片消息。
- 飞书 Bot：支持只读问答、日报重发、部分命令式触发；支持 SDK 长连接模式，也保留 HTTP 回调实现。
- LLM 规划入口：支持接 OpenAI 兼容 `/chat/completions` 服务，用于自然语言路由到本地工具/工作流。
- 差异化定价活动自动化：支持活动页侦察、商品勾选、时间填写、折扣填写、提交前后记录。
- 关单信息模块：支持从外部接口同步关单备注，生成本地同步产物，并提供预览/观察报告能力。
- 现有链接模块：包含链接档案、审计、维护提醒、治理提醒与运营学习辅助能力。
- 商品修改模块：已支持租赁商品改价的自然语言预览、确认、串行执行、审计、回读校验和批量预览优化。
- 租赁价技能集成：仓库内置 `vendor/rental-price-agent` 作为外部技能模块，可配合飞书/Agent 工作流使用。

## 2. 当前边界

现阶段请按下面的边界理解这个项目：

- 已完成：分析、报表、通知、只读查询、差异化定价活动自动化辅助、商品租赁改价的确认式修改工作流。
- 部分完成：自然语言 Agent 规划、审批卡片衔接、运营辅助闭环。
- 未作为主目标完成：完全自动的商品变更执行、无人值守高风险操作、长期记忆与复杂多轮自治。

`TODO.md` 里仍保留了若干后续方向，例如更完整的飞书 Agent 化、报表格式校准、执行 Agent 拆分等。因此 README 中的使用说明以“当前可稳定运行的能力”为主。

## 3. 技术栈

- Node.js
- TypeScript
- Playwright
- Vitest
- xlsx-js-style
- 飞书 Node SDK `@larksuiteoapi/node-sdk`

建议环境：

- Node.js 20+，更推荐较新的 LTS 版本
- Windows PowerShell
- 可访问目标业务后台的网络环境
- 可复用的浏览器登录态

## 4. 目录结构

```text
MT-agent/
├─ config/                    # 主配置与示例配置
├─ docs/                      # 设计、交付、运行说明
├─ src/
│  ├─ cli/                    # 各类命令行入口
│  ├─ crawler/                # 页面抓取与登录态处理
│  ├─ publicTraffic/          # 公域流量分析与报表拼装
│  ├─ feishuBot/              # 飞书 Bot、消息分发、工具路由
│  ├─ agentRuntime/           # Agent 运行时、审批卡片、规划器
│  ├─ activityAutomation/     # 差异化定价活动自动化
│  ├─ closedOrderFeedback/    # 关单信息同步、分析、观察
│  ├─ linkRegistry/           # 现有链接档案、审计、治理、维护
│  ├─ inventoryStatus/        # 同款库存快照
│  ├─ mapping/                # 商品 ID 映射与补注
│  ├─ notify/                 # 飞书推送
│  └─ ...
├─ tests/                     # 自动化测试
├─ vendor/rental-price-agent/ # 外挂技能模块
├─ .env.example               # 环境变量样例
├─ ecosystem.config.cjs       # PM2 配置
└─ package.json
```

## 5. 核心功能说明

### 5.1 公域流量日报

入口命令：

```powershell
npm run public-traffic-report
```

主要做的事情：

- 抓取商品总表。
- 抓取公域曝光累计数据。
- 抓取后台 1/7/30 日访问数据。
- 抓取订单分析数据。
- 刷新商品 ID 映射。
- 生成日差、7 日汇总、30 日汇总。
- 分析低曝光、弱点击、弱转化、高潜商品、新品观察、生命周期治理等结果。
- 生成：
  - 飞书卡片/文本
  - `Markdown` 日报
  - `Excel` 日报
  - 多份 `JSON` 中间产物
  - 运行日志

补充能力：

- 记录商品首次出现状态。
- 识别新链接/下架链接。
- 生成同款库存快照。
- 在有配置时读取 goods-manager 最近 7 天新品池。
- 向飞书发送首版日报，以及链接维护/治理提醒。

### 5.2 传统日报

入口命令：

```powershell
npm run daily-report
```

这条链路更偏基础版抓取与报表生成，围绕仪表盘抓取、分析、Markdown/XLSX 输出和飞书发送。

### 5.3 飞书 Bot

入口命令：

```powershell
npm run feishu-bot
```

或使用 SDK 长连接模式：

```powershell
npm run feishu-bot:sdk
```

当前能力包括：

- 命令式问答。
- 最新日报摘要查询。
- 商品、链接、问题池、来源覆盖和订单指标查询。
- 触发/重发日报。
- 可选接入 LLM 进行自然语言意图规划。

说明：

- LLM 只负责“选工具/提参数/选工作流”。
- 实际执行仍由本地代码完成。
- 普通商品/链接/问题池/来源覆盖问题统一走 `productLink.query`；`publicTraffic.reportQuery` 保留给日报汇总、对比、聚合、订单、数据质量和结论等报表类问题。
- 飞书查询结果默认优先使用卡片展示：商品详情和问题池使用专用卡片，商品列表、问题池数量、来源覆盖、订单指标等使用轻量结果卡，同时保留完整文本 fallback。
- 高风险写操作设计上要经过审批确认，避免直接副作用。

更多历史交接说明可见 [docs/feishu-bot-readonly-command-agent-merge-handoff.md](docs/feishu-bot-readonly-command-agent-merge-handoff.md) 与 [docs/llm-agent-runtime.md](docs/llm-agent-runtime.md)。

### 5.4 差异化定价活动自动化模块

入口命令：

```powershell
npm run activity-automation:scout
```

可选参数：

```powershell
npm run activity-automation:scout -- --pick-products --starts-at 2026-06-25 --ends-at 2026-06-30
npm run activity-automation:scout -- --pick-products --confirm-submit
```

这个模块对应代码目录 [src/activityAutomation](src/activityAutomation/index.ts)，本质上是“差异化定价活动表单自动化”。

它当前做的事情，不只是简单打开页面，而是一整条围绕活动表单的辅助执行链路：

- 打开目标活动页并复用本地浏览器登录态。
- 检测是否进入登录页，如果掉登录则等待人工扫码登录。
- 必要时处理账号身份选择。
- 等待差异化定价活动表单加载完成。
- 侦察页面结构，输出截图、控件清单和分析结果。
- 根据参数执行自动选品。
- 根据参数填写活动开始/结束时间。
- 根据参数补齐差异化折扣档位。
- 在显式开启 `--confirm-submit` 时执行最终提交。
- 在提交后落盘提交会话记录，便于回溯。

从代码实现上看，`activityAutomation` 更像“差异化定价活动页面的半自动执行器”，而不是泛指所有活动页脚本。核心流程可见 [src/activityAutomation/workflow.ts](src/activityAutomation/workflow.ts) 与 [src/activityAutomation/differentialPricing.ts](src/activityAutomation/differentialPricing.ts)。

当前支持：

- 活动页面侦察。
- 控件扫描与截图。
- 自动选品。
- 日期填写。
- 折扣填写。
- 提交会话记录。
- 可选最终提交。

适用场景：

- 人工已经确定要配置一场差异化定价活动，但不想重复做机械化表单填写。
- 先侦察页面结构，再决定是否提交。
- 配合飞书/Agent 工作流，把“分析结果”向“执行准备”推进一步。

边界与风险：

- 强依赖目标平台页面结构。
- 强依赖当前账号权限和登录态。
- 勾选商品、填写日期、填写折扣、提交按钮都可能因页面改版而失效。
- 虽然具备写操作能力，但更适合“人工盯一眼的半自动执行”，而不是完全无人值守。

### 5.5 现有链接模块

这个模块对应代码目录 [src/linkRegistry](src/linkRegistry/store.ts)，主要负责“现有链接档案治理”，而不是单次报表里的临时字段。

当前可见职责包括：

- 建立和维护链接档案。
- 提供链接审计入口。
- 维护覆盖项和别名规则。
- 生成维护提醒与治理提醒。
- 为飞书卡片和后续 Agent 决策提供链接上下文。

链接档案会同时维护两个状态层级：

- `status`：面向既有消费方的粗粒度状态，包含 `active / removed / unknown`。
- `listingState`：面向上架语义的细粒度状态，包含 `on_sale / delisted / gone / unknown`。

其中 `delisted` 表示来源明确提示“已下架/停售”，`gone` 表示链接已从商品总表生命周期中消失；二者都会派生为 `status=removed`，因此不会进入改价、补链、规格删除、活动刷新等需要可操作链接的候选范围。飞书侧展示时会区分“已下架（上架后可操作）”与“链接不存在（总表缺失）”，避免把可恢复上架和已消失链接混为一类。

它和公域日报链路的关系比较紧密：

- 日报运行后会结合商品快照识别新链接、下架链接、生命周期变化。
- 系统会基于档案与风险状态生成治理提示。
- 飞书侧已经有对应的链接治理/维护提示流程。

如果从业务语言来理解，这一块就是“现有链接模块”或“链接档案治理模块”。

### 5.6 关单信息模块

入口命令：

```powershell
npm run closed-order-feedback:sync
npm run closed-order-feedback:preview
npm run closed-order-observation:report
```

这个模块对应代码目录 [src/closedOrderFeedback](src/closedOrderFeedback/runtime.ts)，本质上是“关单信息同步与分析模块”。

当前可见职责包括：

- 从外部接口拉取最近关单备注。
- 维护本地 ingest 状态，避免重复处理。
- 生成同步产物。
- 对关单原因做本地分析/预览。
- 生成关单观察报告，供运营判断问题类型和后续动作。

如果你希望用更业务化的说法，README 里可以把它理解为“关单信息模块”，不仅是同步数据，还负责把关单备注变成可观察、可分析的运营信息。

### 5.7 商品修改 / 租赁改价模块

商品修改模块当前以“租赁改价”为已完成主线，代码主要分布在 [src/feishuBot/rentalPrice.ts](src/feishuBot/rentalPrice.ts)、[src/feishuBot/agentToolExecutor.ts](src/feishuBot/agentToolExecutor.ts) 和 [vendor/rental-price-agent](vendor/rental-price-agent)。

当前支持：

- 通过飞书/Agent 自然语言触发租赁改价预览，例如“改价,所有x300u链接所有租期价格-10元”。
- 改价前读取 SaaS 商品详情页当前值，生成 diff、审计文件、回滚参考和确认卡。
- 用户确认后执行 `rental.priceApply`，执行后 readback verify，并记录校验结果。
- 批量 x300u 等场景使用 `batch-read` 和并发审计预览加速确认卡生成。
- 对“价格8”这类裸数字表达做歧义拦截，要求明确写成 `8折`、`0.8倍`、`+8元`、`-8元` 或绝对价格。

安全边界：

- 确认前只做读取、预览和审计，不写入真实价格。
- 确认后的真实改价仍按商品串行执行，避免并发写操作放大风险。
- PM2 重启不会自动续跑已中断的真实改价任务；如果执行中断，必须根据 verify 产物核对已完成商品，只补执行缺口，避免重复减价。
- MT-agent 生成的改价审计/执行产物写入 `vendor/.rental-price-agent-data/artifacts/mt-agent-audit`，不污染 lifecycle `tasks` 状态目录。

### 5.8 其他辅助命令

常用命令还包括：

```powershell
npm run probe-page-size
npm run probe-exposure-page
npm run capture-dashboard
npm run sync-product-id-map
npm run refresh-product-id-map
npm run rebuild-latest
npm run link-registry:audit
npm run operations-learning-loop:preview
npm run agent:dry-run -- "查询 565"
```

## 6. 安装与初始化

### 6.1 安装依赖

```powershell
npm install
```

如果要使用租赁价技能模块，再执行：

```powershell
npm run rental-price-skill:install
```

### 6.2 配置环境变量

以 `.env.example` 为模板创建本地 `.env`，至少根据你要启用的能力补齐对应变量。

常见变量分组：

- 飞书应用：
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
  - `FEISHU_SEND_TO`
  - `FEISHU_PERSONAL_RECEIVE_ID_TYPE`
  - `FEISHU_PERSONAL_RECEIVE_ID`
  - `FEISHU_GROUP_RECEIVE_ID_TYPE`
  - `FEISHU_GROUP_RECEIVE_ID`
- 飞书 Bot：
  - `FEISHU_BOT_USE_SDK`
  - `FEISHU_BOT_OPEN_ID`
  - `FEISHU_BOT_MENTION_NAME`
  - `FEISHU_BOT_PORT`
  - `FEISHU_BOT_VERIFICATION_TOKEN`
  - `FEISHU_BOT_ENCRYPT_KEY`
  - `FEISHU_BOT_CALLBACK_SIGNATURE_SECRET`：HTTP 回调模式下敏感卡片操作必须配置请求签名密钥；不要复用 Encrypt Key。
  - `MT_AGENT_INACTIVE_REFRESH_APPROVER_IDS`：“跑失活刷新”执行审批白名单。填写允许审批的飞书 `open_id`/`user_id`，支持逗号、分号或空白分隔；留空会 fail closed，任何人都不能审批执行。
- LLM：
  - `LLM_PROVIDER`
  - `LLM_BASE_URL`
  - `LLM_MODEL`
  - `LLM_API_KEY`
  - `MT_AGENT_LLM_PROVIDER`
  - `MT_AGENT_LLM_BASE_URL`
  - `MT_AGENT_LLM_MODEL`
  - `MT_AGENT_LLM_API_KEY`
- 输出与外挂模块：
  - `MT_AGENT_OUTPUT_DIR`
  - `RENTAL_PRICE_AGENT_DIR`
  - `RENTAL_PRICE_AGENT_DAEMON_URL`
  - `RENTAL_PRICE_AGENT_DAEMON_TOKEN`
- 可选业务接口：
  - `GOODS_MANAGER_BASE_URL`
  - `CLOSED_ORDER_REMARKS_BASE_URL`
  - `CLOSED_ORDER_REMARKS_API_TOKEN`
  - `CLOSED_ORDER_REMARKS_SOURCE_APP_CODE`

### 6.3 配置主配置文件

默认配置文件是 [config/agent.config.json](config/agent.config.json)。

关键字段：

- `targetUrl`：后台访问数据页面。
- `periods`：通常为 `1d / 7d / 30d`。
- `preferredPageSize`：抓取时的分页大小。
- `outputDir`：输出目录，默认 `output`。
- `browserProfileDir`：浏览器登录态目录。
- `productIdMappingPath`：商品 ID 映射文件路径。
- `goodsExportUrl`：商品总表页面。
- `exposureUrl`：公域曝光页面。

## 7. 运行说明

### 7.1 本地生成日报

```powershell
npm run public-traffic-report
```

运行前请确认：

- 依赖已安装。
- `.env` 已配置。
- 浏览器登录态可用。
- 目标后台页面可访问。

### 7.2 启动飞书 Bot

```powershell
npm run feishu-bot:sdk
```

如果使用 PM2：

```powershell
npm run feishu-bot:pm2:start
npm run feishu-bot:pm2:status
npm run feishu-bot:pm2:logs
```

PM2 配置位于 [ecosystem.config.cjs](ecosystem.config.cjs)。

### 7.3 干跑 Agent 意图

```powershell
npm run agent:dry-run -- "查询 565"
```

这个命令适合在不真正执行工作流时验证意图识别与运行时分发结果。

## 8. 输出产物

项目默认把产物写入 `output/`。

典型结构如下：

```text
output/
├─ 2026-06-25/
│  ├─ 公域数据日报_2026-06-25.md
│  ├─ 公域数据日报_2026-06-25.xlsx
│  ├─ 商品总表_2026-06-25.xlsx
│  ├─ 订单分析_2026-06-25.json
│  ├─ 各类曝光/访问/上下文 JSON
│  └─ 运行日志
├─ latest/
│  └─ 最新运行日志
└─ state/
   ├─ goods-first-seen.json
   └─ goods-link-lifecycle.json
```

不同 CLI 会在 `output` 下写入不同子目录或状态文件。

## 9. 测试与构建

构建：

```powershell
npm run build
```

测试：

```powershell
npm test
```

仓库内测试覆盖较广，包含：

- 抓取逻辑
- 报表拼装
- 飞书 Bot
- Agent Runtime
- 商品映射
- 新品/曝光分析
- 链接治理
- 库存快照

## 10. 现阶段限制与风险

- 强依赖业务后台页面结构，页面改版后抓取逻辑可能需要调整。
- 强依赖本地登录态，登录失效时相关命令会失败。
- 多个能力依赖真实业务环境与内网接口，离线环境无法完整验证。
- 高风险变更型能力必须走预览、确认、执行、回读校验链路；租赁改价模块已具备该流程，但仍不建议无人值守批量执行。
- 仓库包含较多设计文档与阶段性交接文档，正式对外使用时建议结合当前分支状态甄别。

## 11. 现阶段推荐使用方式

如果你是第一次接手这个项目，建议按下面顺序使用：

1. `npm install`
2. 复制并完善 `.env`
3. 检查 `config/agent.config.json`
4. 先跑 `npm run build`
5. 再跑 `npm test`
6. 使用 `npm run public-traffic-report` 验证主链路
7. 需要飞书联动时再启动 `npm run feishu-bot:sdk`

## 12. 相关文档

- [docs/llm-agent-runtime.md](docs/llm-agent-runtime.md)
- [docs/feishu-bot-readonly-command-agent-merge-handoff.md](docs/feishu-bot-readonly-command-agent-merge-handoff.md)
- [docs/delivery/goods-manager-new-products-v2.md](docs/delivery/goods-manager-new-products-v2.md)
- [TODO.md](TODO.md)

## 13. 一句话总结

这是一个已经具备“抓取数据 -> 生成运营日报 -> 飞书分发 -> Bot 查询/审批 -> 确认式商品修改辅助”闭环的运营 Agent 项目；当前最成熟的能力是公域流量日报、飞书联动和租赁改价确认流程，最需要谨慎使用的是依赖真实后台页面和写操作确认的自动化流程。
