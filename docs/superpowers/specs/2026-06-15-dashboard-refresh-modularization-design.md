# 访问页补抓与日报重建设计

## 背景

当前 `npm run public-traffic-report` 是完整日报流程，会一次性抓取商品总表、公域曝光、访问页后链路、订单分析，并生成日报、Excel、上下文和飞书卡片。

实际运行中，访问页后链路数据更新时间不固定。首版日报可能在访问页尚未更新时生成，导致商品页访问、创建订单、发货、访问到下单率、访问到发货率等指标缺失或偏低，进而影响转化弱、高潜力、曝光不足、新品观察等分析结论。

本阶段不拆完整抓取流程，只抽离访问页补抓能力，并在必要时基于已有产物重建日报和重发飞书。

## 目标

- 保留 `npm run public-traffic-report` 当前完整流程。
- 新增访问页独立补抓入口，默认抓取 `1d`、`7d`、`30d` 全周期访问页数据。
- 对比当天首版日报的数据质量；如果首版访问页缺失且本次补抓完整，则自动重建日报并重发飞书。
- 如果首版无缺失，只保存本次访问页 raw，不重建不重发。
- 如果首版缺失但本次补抓仍不完整，只保存 raw，不重建不重发，并记录原因。
- 避免重复自动重发，同一天补抓自动重发成功后默认不再重复触发。

## 非目标

- 不拆商品总表、公域曝光、订单分析等其他抓取阶段。
- 不改变 `public-traffic-report` 的默认用户行为。
- 不支持单周期访问页补抓；第一阶段固定抓 `1d`、`7d`、`30d`。
- 不新增强制重发参数；需要手动重发时继续使用已有飞书重发能力。
- 不重新请求 goods-manager 新品池；重建时沿用首版上下文中的新品池数据。

## 命令行为

新增脚本：

```bash
npm run capture-dashboard
```

默认行为：

- 加载 `.env` 和 `config/agent.config.json`。
- 使用当前日期作为运行日期。
- 抓取访问页 `1d`、`7d`、`30d`。
- 保存 raw 到当天输出目录。
- 检查首版日报是否存在访问页缺失。
- 检查本次补抓 raw 是否完整。
- 根据决策结果决定是否重建日报和重发飞书。

支持参数：

- `--date YYYY-MM-DD`：指定运行日期目录，默认当天。
- `--send-to personal|group|both`：仅在触发重发时覆盖飞书发送目标，默认使用环境变量配置。

命令输出需要明确展示：

- 本次访问页抓取质量。
- 首版访问页质量。
- 是否重建。
- 是否重发。
- 未重发时的原因。

## 产物设计

访问页 raw 沿用当前路径：

- `output/YYYY-MM-DD/公域访问数据_1日.json`
- `output/YYYY-MM-DD/公域访问数据_7日.json`
- `output/YYYY-MM-DD/公域访问数据_30日.json`

新增运行状态文件：

- `output/YYYY-MM-DD/public-traffic-run-state.json`

状态文件记录首版日报和补抓重发状态：

```json
{
  "date": "2026-06-15",
  "firstReportSent": true,
  "firstReportGeneratedAt": "2026-06-15T01:00:00.000Z",
  "firstDashboardQuality": {
    "hasMissing": true,
    "periods": {
      "1d": { "complete": false, "rowCount": 0 },
      "7d": { "complete": true, "rowCount": 300 },
      "30d": { "complete": true, "rowCount": 300 }
    },
    "notes": ["今日访问数据支付宝暂未更新，本期访问量板块指标缺失。"]
  },
  "dashboardRefreshResent": false
}
```

`public-traffic-report` 在首版日报生成和发送后写入该状态文件。`capture-dashboard` 读取并更新该状态文件。

## 缺失判定

访问页缺失采用组合判断：日报上下文质量提示和 raw 完整性。

首版日报缺失判断：

- 读取 `公域数据上下文_YYYY-MM-DD.json`。
- 如果 `dataQualityNotes` 存在访问页或后链路缺失提示，则认为首版存在缺失。
- 同时检查当天三周期访问页 raw。

raw 不完整判断：任一周期满足以下条件即视为该周期缺失：

- 文件不存在。
- JSON 解析失败。
- `collection.complete === false`。
- `collection.rowCount === 0`。
- `headers.length === 0`。
- `rows.length === 0`。

本次补抓后的完整性也使用同一规则。

## 决策规则

`capture-dashboard` 的自动决策：

- 首版完整：保存新 raw，不重建不重发。
- 首版缺失，新 raw 不完整：保存新 raw，不重建不重发。
- 首版缺失，新 raw 完整：保存新 raw，重建日报，重发飞书。
- 如果 `dashboardRefreshResent === true`：默认不再自动重发，只保存 raw 并记录已重发过。

## 重建规则

重建不重新抓线上全量数据，而是读取当天已有产物和最新访问页 raw：

- `config/product-id-map.json`
- `goods-list-snapshot.json`
- `公域曝光商品快照_YYYY-MM-DD.json`
- `公域曝光总览_YYYY-MM-DD.json`
- `公域曝光日差分_YYYY-MM-DD.json`
- `公域曝光7日汇总_YYYY-MM-DD.json`
- `公域曝光30日汇总_YYYY-MM-DD.json`
- `公域访问数据_1日.json`
- `公域访问数据_7日.json`
- `公域访问数据_30日.json`
- `订单分析_YYYY-MM-DD.json`
- 首版 `公域数据上下文_YYYY-MM-DD.json` 中的 `newProductPoolItems`、`newProductPoolIds` 和必要的 Agent 数据

重建输出：

- `公域数据上下文_YYYY-MM-DD.json`
- `公域数据日报_YYYY-MM-DD.md`
- `公域数据日报_YYYY-MM-DD.xlsx`
- 飞书卡片内容

重建后的上下文应：

- 移除已恢复的访问页缺失提示。
- 增加补抓说明，例如：`访问页数据已于 HH:mm 补抓更新，本报告为重建版。`
- 保留首版上下文中与访问页无关的新品池、Agent 下架链接等信息。

重发成功后更新状态：

- `dashboardRefreshResent = true`
- `dashboardRefreshResentAt = ISO 时间`
- `dashboardRefreshDecision = "rebuilt_and_resent"`

## 代码结构

新增模块：

- `src/cli/captureDashboard.ts`
  - CLI 入口。
  - 解析 `--date`、`--send-to`。
  - 调用补抓服务。
  - 打印决策结果。

- `src/publicTraffic/dashboardRefresh.ts`
  - 访问页补抓编排。
  - 判断首版缺失。
  - 判断新 raw 完整性。
  - 决定是否重建和重发。
  - 更新 `public-traffic-run-state.json`。

- `src/publicTraffic/dashboardQuality.ts`
  - 访问页 raw 完整性判断。
  - 从 `dataQualityNotes` 判断访问页缺失。
  - 生成质量摘要。

- `src/publicTraffic/rebuildPublicTrafficReport.ts`
  - 基于已有产物重建日报。
  - 复用 `mergePublicTrafficData`、`analyzePublicTrafficData`、Markdown、Workbook、飞书卡片构建逻辑。

现有模块小改：

- `src/cli/publicTrafficReport.ts`
  - 保留主行为不变。
  - 首版日报生成和发送后写入运行状态文件。
  - 只抽出重建所需的最少公共函数，避免大范围重构。

- `src/publicTraffic/paths.ts`
  - 新增 `publicTrafficRunState` 路径。

- `package.json`
  - 新增 `capture-dashboard` 脚本。

## 测试策略

新增或扩展测试：

- `tests/dashboardQuality.test.ts`
  - raw 完整时判定完整。
  - `complete=false` 判定缺失。
  - `rowCount=0` 判定缺失。
  - `headers` 或 `rows` 为空判定缺失。
  - `dataQualityNotes` 命中访问页缺失提示时判定缺失。

- `tests/dashboardRefresh.test.ts`
  - 首版完整：只保存 raw，不重建不重发。
  - 首版缺失，新 raw 不完整：只保存 raw，不重建不重发。
  - 首版缺失，新 raw 完整：重建并重发。
  - 已经 `dashboardRefreshResent=true`：不重复自动重发。

- `tests/rebuildPublicTrafficReport.test.ts`
  - 能从已有产物重建上下文、Markdown、Excel。
  - 重建后保留新品池、下架链接等首版上下文信息。
  - 访问页恢复后移除缺失提示并增加补抓说明。

- CLI 测试
  - `capture-dashboard` 入口存在。
  - 默认抓取三周期，不支持单周期模式。
  - `--date` 和 `--send-to` 参数解析正确。

## 验收标准

- `npm run public-traffic-report` 行为保持兼容。
- `npm run capture-dashboard` 默认抓取访问页 `1d`、`7d`、`30d`。
- 首版缺失且补抓完整时，能自动重建并重发飞书。
- 首版完整时，补抓只保存 raw，不重建不重发。
- 已自动重发过的日期不会重复自动重发。
- 相关测试、全量测试和 TypeScript 构建通过。
