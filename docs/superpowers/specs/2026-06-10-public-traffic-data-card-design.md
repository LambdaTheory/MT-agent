# 公域数据日报与飞书卡片 Design

## Goal

将现有公域曝光日报升级为公域数据日报：聚合两个支付宝页面的数据，完成从曝光到访问、订单、发货的整体漏斗分析，并通过飞书卡片推送老板摘要。

## Scope

包含：

- 聚合旧页面的商品访问、订单、发货等后链路经营数据。
- 聚合新页面的公域曝光、曝光页访问、金额、托管商品数据。
- 使用 `平台商品ID` 作为两个页面商品数据的 join key。
- 输出商品标识时优先使用映射后的端内 ID；未映射时回退平台商品 ID。
- 保留 `1日/7日/30日` 三个周期数据。
- 飞书卡片主展示 `1日` 摘要，Markdown/XLSX 展示 `1日/7日/30日` 明细。
- App API 发送 `interactive` 飞书卡片。
- 输出存储沿用旧版日报的清晰日期目录风格：所有当日产物放在 `output/YYYY-MM-DD/`。
- 文件名使用中文业务命名：例如 `公域数据日报_YYYY-MM-DD.md`、`公域访问数据_1日.json`、`公域曝光总览_YYYY-MM-DD.json`。
- 抓取流程闭环为一次浏览器登录工作流，在同一登录态下依次抓取公域曝光页面和公域访问数据页面。

不包含：

- 飞书按钮交互。
- 飞书卡片模板 ID 或卡片搭建工具变量。
- 流式更新卡片。
- 自动修改商品。
- LLM 文案建议或问答能力。

## Current State

当前 `public-traffic-report` 主要基于公域曝光页输出报告：

- 抓取公域曝光页的 1/7/30 总览。
- 抓取当前托管商品曝光表。
- 基于曝光日差分和 7/30 汇总做规则分析。
- 飞书发送纯文本摘要。

旧版 dashboard 抓取能力仍存在，用于访问、订单、发货等商品经营数据，但尚未接入公域曝光报告。

## Data Sources

### Exposure Page

来源：`config.exposureUrl`。

用途：

- 公域入口曝光量。
- 公域曝光页访问量。
- 公域金额。
- 托管商品曝光表。
- 商品托管天数。

### Public Visit Page

来源：`config.targetUrl`。

用途：

- 公域访问数据。
- 公域访问后的订单数据。
- 公域访问后的发货数据。
- 公域访问链路经营转化指标。

## Data Model

新增聚合层，输入两个页面的标准化数据，输出公域数据报告上下文。

核心字段：

- `platformProductId`: 平台商品 ID，唯一 join key。
- `displayProductId`: 展示用商品 ID。映射命中时为 `端内ID <internalProductId>`；未命中时为 `平台商品ID <platformProductId>`。
- `period`: `1d`、`7d`、`30d`。
- `exposure`: 公域曝光。
- `publicVisits`: 公域曝光页访问。
- `dashboardVisits`: dashboard 访问。
- `orders`: dashboard 订单指标。
- `shipments`: dashboard 发货指标。
- `amount`: 金额。
- `exposureVisitRate`: 曝光到访问率。
- `visitOrderRate`: 访问到订单转化率。
- `visitShipmentRate`: 访问到发货转化率。

字段命名可根据现有 dashboard 标准化结果适配，但语义必须保持一致。

## Analysis Output

报告输出整体摘要和商品问题分组。

整体摘要包含：

- 曝光。
- 公域访问。
- 后链路访问。
- 订单。
- 发货。
- 金额。
- 曝光到访问率。
- 访问到订单/发货转化。

商品问题分组包含：

- 曝光不足：曝光低，后链路表现也弱。
- 曝光有但点击弱：曝光高，公域访问率低。
- 点击有但转化弱：访问有，订单或发货弱。
- 高潜力商品：曝光和访问表现较好，值得继续放量。
- 新品观察：沿用现有新品观察逻辑，并使用端内 ID 展示。
- 生命周期治理：沿用现有治理逻辑，并使用端内 ID 展示。

阈值继续通过规则配置演进。若某项 dashboard 指标缺失，不应阻断报告生成，应在对应指标处降级为 0 或标记为数据缺失，并在 run log 中记录。

## Feishu Card

App API 发送卡片消息：

- `msg_type`: `interactive`。
- `content`: JSON 字符串，内部为飞书卡片 JSON。

卡片结构：

- 标题：`公域数据日报 YYYY-MM-DD`。
- 今日漏斗摘要：展示 `1日` 的曝光、访问、订单、发货、金额和核心转化率。
- 问题模块数量：展示各问题分组数量。
- Top 商品列表：优先展示端内 ID，未映射回退平台商品 ID。
- 报告路径：Markdown 和 XLSX 路径。

Webhook fallback 暂时保留纯文本摘要，避免同时维护两套卡片协议造成范围扩大。

## Output Storage

公域数据日报产物放在统一日期目录下：`output/YYYY-MM-DD/`。

文件命名和含义：

- `公域数据日报_YYYY-MM-DD.md`: 给人阅读的 Markdown 日报。
- `公域数据日报_YYYY-MM-DD.xlsx`: 给运营筛选和复盘使用的 Excel 日报。
- `公域数据上下文_YYYY-MM-DD.json`: 生成日报和飞书卡片前的最终结构化聚合数据。
- `公域数据运行日志_YYYY-MM-DD.log`: 本次运行事件、抓取完整性、异常和飞书发送状态。
- `公域访问数据_1日.json`: 公域访问数据页面抓到的 1 日原始表格数据。
- `公域访问数据_7日.json`: 公域访问数据页面抓到的 7 日原始表格数据。
- `公域访问数据_30日.json`: 公域访问数据页面抓到的 30 日原始表格数据。
- `公域曝光总览_YYYY-MM-DD.json`: 公域曝光页面 1/7/30 日总体曝光、访问、金额、转化率。
- `公域曝光商品快照_YYYY-MM-DD.json`: 公域曝光页面当前托管商品累计快照。
- `公域曝光日差分_YYYY-MM-DD.json`: 当前快照和上一日快照的商品级日增量；无上一日快照时为空，避免首跑累计值污染。
- `公域曝光7日汇总_YYYY-MM-DD.json`: 最近 7 天商品级曝光日差分聚合。
- `公域曝光30日汇总_YYYY-MM-DD.json`: 最近 30 天商品级曝光日差分聚合。

`output/latest/` 可以继续作为最新 raw/debug 快照，但飞书卡片和最终报告路径应指向日期目录下的中文文件名。

## Data Flow

1. CLI 加载 `.env`。
2. CLI 加载 agent config 和规则配置。
3. 打开一次持久化浏览器上下文，完成一次支付宝扫码登录和子账号选择。
4. 在同一登录态中抓取公域曝光页，生成曝光页总览和商品曝光数据。
5. 在同一登录态中抓取公域访问数据页面，生成 1/7/30 商品访问、订单、发货数据。
6. 加载 `config.productIdMappingPath` 商品 ID 映射。
7. 以 `平台商品ID` 聚合两个页面的数据。
8. 生成 `1日/7日/30日` 公域数据报告上下文。
9. 生成中文命名的 Markdown、XLSX、JSON context 和 run log。
10. App API 发送飞书卡片；若无 App API 配置但有 webhook，则发送纯文本 fallback。

## Error Handling

- 单个商品缺少映射：回退平台商品 ID，不报错。
- 映射文件不存在：所有商品回退平台商品 ID，并记录 run log。
- 公域访问数据页面整体抓取失败：本次报告失败，不发送误导性完整日报。
- 公域访问数据页面单个周期为空且标记不完整：记录 run log 并继续生成部分报告。
- 公域访问数据页面出现非空表头/行但缺少关键字段：本次报告失败，避免吞掉页面结构变更。
- 曝光页抓取失败：本次报告失败，不发送误导性完整日报。
- 飞书卡片发送失败：报告文件仍保留，run log 记录失败原因。
- 飞书 App API 配置缺失：若存在 webhook 则走纯文本 fallback，否则记录跳过。

## Testing

测试覆盖：

- 映射命中时，报告项显示 `端内ID <internalProductId>`。
- 映射未命中时，报告项显示 `平台商品ID <platformProductId>`。
- 两个页面同一平台商品 ID 可聚合到同一报告项。
- 缺少一侧商品数据时，报告项仍可生成并标记缺失或使用 0 值。
- 飞书 App API 卡片发送使用 `msg_type: interactive`。
- 飞书卡片 JSON 包含标题、今日漏斗摘要、问题模块数量、Top 商品和报告路径。
- `public-traffic-report` CLI 调用卡片发送路径。
- 公域日报输出路径使用 `output/YYYY-MM-DD/` 和中文文件名。
- 公域访问数据原始 JSON 使用 `公域访问数据_1日.json`、`公域访问数据_7日.json`、`公域访问数据_30日.json`。
- 单次运行只打开一个浏览器上下文，并在同一登录态下抓两个页面。

## Success Criteria

- `npm test` 通过。
- `npm run build` 通过。
- `npm run public-traffic-report` 同时抓取两个页面并生成公域数据日报。
- `npm run public-traffic-report` 一次扫码完成两个页面抓取。
- 飞书收到卡片消息，不再只是纯文本消息。
- 卡片和报告中的商品标识优先为端内 ID，未映射商品回退平台商品 ID。
- Markdown/XLSX 保留 1/7/30 三个周期明细。
- 当日产物集中在 `output/YYYY-MM-DD/`，文件名为中文业务命名。
