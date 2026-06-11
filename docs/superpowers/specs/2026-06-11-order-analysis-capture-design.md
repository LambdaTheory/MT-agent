# 订单分析页采集 + 日报数据增强 设计文档

日期：2026-06-11
状态：已与用户确认

## 背景

公域数据日报目前的数据源是公域曝光页和公域访问数据页。支付宝商家后台另有四个订单分析页面（标准订单分析 overview / 发货分析 delivery / 归还分析 return / 关单分析 customs），包含订单、发货、归还、关单的汇总指标。probe（`output/latest/order-analysis-probe.json`）已验证四个页面均可进入且指标卡片结构稳定。

同时，公域访问数据页的商品表新增了 4 个金额列（2026-06-11 实测确认）：`创建订单金额`、`签约订单金额`、`审出订单金额`、`发货订单金额`。

## 本期范围

1. 订单分析四页指标抓取（1 日窗口），落盘 JSON，并追加到日报 xlsx 的单个 `订单分析` sheet。
2. 订单分析 1 日数据合并进今日漏斗（飞书卡片 + Markdown），改为三行 KPI 分栏。
3. 日报 xlsx `商品明细` sheet 表头汉化。
4. 访问页 4 个新金额列接入商品级数据管线（仅抓取、落盘、展示，不改诊断规则）。

明确不做：

- 经营结论本期不动（仍是昨日公域口径）。
- 不基于新金额列修改诊断规则（转化弱/高潜力等口径不变）。
- 不建新的数据收集 xlsx（复用现有日报 xlsx）。

## 1. 订单分析四页抓取

新文件 `src/crawler/orderAnalysisCrawler.ts`。

### URL

`https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/order/<key>?appId=2021005181665859`，key 依次为 `overview`、`delivery`、`return`、`customs`。

### 每页流程

1. 复用主流程已登录的 `page` 导航；遇 `select-identity` 走 `selectSubAccountIfNeeded`。
2. 将日期范围切换为「1日」（页面默认 7 日窗口）。实现前先做一次小 probe 确认日期控件形态（antd Radio/Segmented/日期选择器）。
3. 若存在 `展开` toggle（`.toggle-yVCmNQC3`，overview 和 customs 各 1 个）则点击展开。
4. 遍历 `.merchant-ui-data-indicators-items.merchant-ui-data-indicators-items-default` 指标项，每项提取 `{ label, value, delta }`（delta 即 `较前7日±x%`，无则空字符串）。
5. 抓取页面标注的数据日期（如 `2026-06-08`），写入结果。各页数据滞后天数不一（probe 时 overview 滞后 3 天、delivery 滞后 5 天），数据日期必须随数据保存以明确口径。

指标文本解析做成纯函数，便于用 probe 真实文本做 Vitest fixture。

### 失败策略

任一页导航失败、日期切换失败或指标项为空 → 抛错 → 整个日报运行失败，不推飞书（与商品总表刷新一致，用户确认）。

### 落盘

- `output/YYYY-MM-DD/订单分析_YYYY-MM-DD.json`（YYYY-MM-DD 为运行日，与现有输出一致）
- `output/latest/order-analysis.json` 快照

结构：

```json
{
  "capturedAt": "ISO 时间戳",
  "runDate": "2026-06-12",
  "pages": {
    "overview": {
      "dataDate": "2026-06-08",
      "indicators": [{ "label": "签约订单数", "value": "542", "delta": "+40.8%" }]
    },
    "delivery": { "...": "..." },
    "return": { "...": "..." },
    "customs": { "...": "..." }
  }
}
```

### 主流程接入

`src/crawler/publicTrafficCrawler.ts` 在 dashboard 抓取之后追加 `collectOrderAnalysisPages`，复用同一 browser/page，保持一次扫码完成全部抓取。

## 2. 日报 xlsx：新增 `订单分析` sheet

`src/publicTraffic/buildPublicTrafficWorkbook.ts` 追加一个 sheet（名为 `订单分析`），四块数据纵向排入，块间空一行：

```
【标准订单分析】数据日期：2026-06-08
指标          数值      较前7日
签约订单数     542      +40.8%
...

【发货分析】数据日期：2026-06-06
...
【归还分析】...
【关单分析】...
```

## 3. 今日漏斗合并订单分析数据（飞书卡片 + Markdown）

现有今日漏斗是单行 6 项 KPI（曝光/公域访问/后链路访问/订单/发货/金额），其中订单和发货来自访问页（经常滞后为 0）。改为三行 KPI 分栏：

- **第 1 行 公域（昨日）**——口径不变，来自曝光页/访问页：`曝光 | 公域访问 | 后链路访问 | 金额`
- **第 2 行 订单（标注 overview 数据日期，如 06-08）**——来自标准订单分析 1 日：`创建订单 | 签约订单 | 审出订单 | 发货订单 | 签约金额`
- **第 3 行 履约（标注各自数据日期）**——来自发货/归还/关单分析 1 日：`待发货 | 归还 | 逾期 | 关单`

说明：

- 访问页的创单/发货不再进漏斗 KPI（仍留在商品明细和诊断规则里）。
- Markdown 同结构输出三行。
- 各页指标抓全落 JSON，漏斗只挑以上展示项。
- 每行标注自己的数据日期，接受多口径混排（用户确认）。

## 4. `商品明细` 表头汉化

| 现表头 | 中文 |
| --- | --- |
| platformProductId | 平台商品ID |
| displayProductId | 端内ID |
| productName | 商品名称 |
| custodyDays | 托管天数 |
| `1d_` / `7d_` / `30d_` 前缀 | 1日 / 7日 / 30日 |
| exposure | 曝光量 |
| publicVisits | 公域访问 |
| dashboardVisits | 后链路访问 |
| createdOrders | 创建订单 |
| signedOrders | 签约订单 |
| reviewedOrders | 审出订单 |
| shippedOrders | 发货订单 |
| amount | 金额（元） |
| exposureVisitRate | 曝光→访问率 |
| visitCreatedOrderRate | 访问→创单率 |
| visitShipmentRate | 访问→发货率 |

示例：`7d_exposure` → `7日曝光量`。

## 5. 访问页 4 个新金额列接入

实测（2026-06-11）访问页表头：

`商品信息 | SPU信息 | 频道访问次数 | 创建订单数 | 签约订单数 | 审出订单数 | 发货订单数 | 创建订单金额 | 签约订单金额 | 审出订单金额 | 发货订单金额 | 操作`

相比历史 raw（2026-06-08/09）新增 4 个金额列。

### 变更

- `src/extractor/normalizeRows.ts`：新增 4 个**可选**表头索引（`创建订单金额` / `签约订单金额` / `审出订单金额` / `发货订单金额`），解析为 `createdOrderAmount` / `signedOrderAmount` / `reviewedOrderAmount` / `shippedOrderAmount`。旧数据缺列时缺省为 0，不破坏历史回放。表头匹配用精确包含，已确认与 `创建订单数` 等不冲突。
- `src/domain/types.ts` / `src/publicTraffic/types.ts`：`PeriodProductMetrics` 与合并宽表行类型补充 4 个金额字段。
- `src/publicTraffic/mergePublicTrafficData.ts`：透传 4 个金额字段。
- `商品明细` sheet：新增 12 列（3 周期 × 4 金额），如 `1日创建订单金额（元）`。

### 口径说明

- summary 级金额仍以曝光页 `交易金额` 为准，口径不变。
- 4 个金额列随访问页一起滞后/缺失（访问页空态时为 0），仅作商品级诊断补充数据。

## 测试

- 订单分析指标解析纯函数：用 probe 真实文本做 fixture（Vitest）。
- `buildPublicTrafficWorkbook`：`订单分析` sheet 结构、`商品明细` 中文表头与 12 个新金额列断言。
- 今日漏斗三行布局：飞书卡片 column_set 与 Markdown 输出断言（含数据日期标注、订单分析数据缺失时行为）。
- `normalizeRows`：含金额列的新表头、不含金额列的旧表头两组用例。
- 源码 wiring 断言：`publicTrafficCrawler` 接入 `collectOrderAnalysisPages`、CLI 落盘订单分析 JSON。
- 回归：`npm test`、`npm run build`，最后实跑 `npm run public-traffic-report` 验证。

## 决策记录

- 日期窗口：四页都切「1日」，只抓当日数据（用户确认）。
- 失败策略：订单分析抓取失败 → 整个运行失败（用户确认）。
- xlsx：不建新文件，追加单个 `订单分析` sheet 到日报 xlsx（用户确认）。
- 金额列：纳入抓取与展示，不改诊断规则（用户确认）。
- 日报呈现：订单分析 1 日数据合并进今日漏斗，三行 KPI 分栏，每行标注数据日期（用户确认，替代此前"不进日报内容"的决定）。
