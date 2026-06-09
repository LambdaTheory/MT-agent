# 公域流量规则分析设计

## 目标

新增一层轻量、可配置的规则分析能力，让公域流量日报不再只输出空的运营模块。第一版基于 `npm run public-traffic-report` 已经抓到的曝光数据，生成四类稳定候选：曝光优化、转化优化、新品观察、生命周期治理。

本阶段只做规则分析，不执行商品操作，不接 Feishu Q&A，不接审批卡片，也不生成 LLM 文案建议。

## 选定方案

采用轻量规则引擎。

- 阈值和 Top N 数量放在 `config/public-traffic-rules.json`。
- 配置文件不存在时使用默认值。
- 配置文件存在但 JSON 或字段值非法时直接失败，避免误用阈值。
- 输出继续兼容现有 `PublicTrafficReportContext` 的 `identifier`、`action`、`reason` 三字段结构。

这样可以尽快让日报产生运营价值，同时保持实现小、后续容易调参。

## 架构

新增三个公域流量模块，并接入现有 CLI。

### 规则配置

`src/publicTraffic/rulesConfig.ts` 负责：

- 定义 `PublicTrafficRulesConfig` 类型。
- 提供 `DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG` 保守默认值。
- 提供 `loadPublicTrafficRulesConfig(path?: string)`，读取可选 JSON、校验并与默认值合并。

默认配置路径是 `config/public-traffic-rules.json`。缺文件表示使用默认值；非法 JSON 或非法阈值表示运行失败。

### 聚合加载

CLI 当前已经写入 `exposure-daily-delta.json`。下一阶段需要从 `output/public-traffic/YYYY-MM-DD/` 读取最近的日差分文件，并复用现有 `aggregateExposureDeltas` 生成 7 日和 30 日汇总。

CLI 需要新增写入：

```text
output/public-traffic/YYYY-MM-DD/exposure-7d-summary.json
output/public-traffic/YYYY-MM-DD/exposure-30d-summary.json
```

回看窗口内缺失日期直接跳过。已存在但损坏的日差分 JSON 必须失败，不能静默跳过，否则会生成错误判断。

### 分析模块

`src/publicTraffic/analyzePublicTraffic.ts` 负责把数据转换成报告候选项。输入包括：

- 报告日期。
- 当天 `ExposureDailyDelta[]`。
- 7 日 `ExposureProductSummary[]`。
- 30 日 `ExposureProductSummary[]`。
- 当前 `ExposureCumulativeProduct[]` 快照。
- 规则配置。

输出包括四个 section：

- `exposureOptimization`
- `conversionOptimization`
- `newProductObservation`
- `lifecycleGovernance`

分析模块不读文件，不关心 Feishu、Markdown 或 XLSX，只负责把数据转成报告结构。

## 配置结构

第一版配置保持小而容易调整。

```json
{
  "topN": 5,
  "exposureOptimization": {
    "highExposure": 1000,
    "lowVisitRate": 0.01,
    "lowExposure": 50,
    "potentialVisits": 3,
    "potentialAmount": 1
  },
  "conversionOptimization": {
    "minVisits": 5,
    "weakAmount": 1,
    "minExposure": 100
  },
  "newProductObservation": {
    "lowExposure": 20,
    "zeroVisitMaxExposure": 100
  },
  "lifecycleGovernance": {
    "minCustodyDays": 30,
    "weak30dExposure": 100,
    "weak30dVisits": 3,
    "weak30dAmount": 1
  }
}
```

校验规则：

- `topN` 必须是正整数。
- 所有阈值必须是有限的非负数。
- `lowVisitRate` 必须在 0 到 1 之间。
- 未识别字段第一版可以忽略，避免后续版本增加配置时过度阻塞。

## 规则口径

### 曝光优化

生成以下候选：

- 高曝光但访问率低。
- 低曝光但 7/30 日有访问或金额，说明可能有潜力但公域曝光不足。

排序优先级：

1. 高曝光且访问率最低的商品。
2. 低曝光但金额或访问更高的商品。

### 转化优化

生成以下候选：

- 有访问但金额为 0。
- 曝光和访问不低，但金额偏弱。

排序优先级：访问数降序，其次曝光数降序。

### 新品观察

生成以下候选：

- 当天日差分带 `new_product` 标记的商品。
- 新商品曝光低或访问为 0。

该模块只使用观察语言，不使用执行语言。原因文案应类似：“新品今日进入公域快照，曝光偏低，建议继续观察”。

### 生命周期治理

生成以下候选：

- 累计 `custodyDays` 大于等于 `minCustodyDays`，且 30 日曝光、访问、金额都偏弱的商品。

第一版如果 `custodyDays` 为 `null`，不进入生命周期治理。后续可以通过抓取器解析“已托管 N 天”来增强该模块。

排序优先级：托管天数降序，其次 30 日曝光升序。

## 标识和原因格式

本阶段使用平台商品 ID 作为可靠标识：

```text
平台商品ID 20260603220003308013234
```

如果后续分析输入补充端内 ID，再切换成端内 ID 优先、平台商品 ID 辅助。

原因文案要短、事实化，并包含触发规则的关键指标。例如：

```text
7日曝光 1200，访问率 0.50%，低于阈值 1.00%
```

## CLI 数据流

`runPublicTrafficReportCli` 从当前骨架填充升级为：

1. 抓取曝光页。
2. 保存累计快照和总体概况。
3. 读取前一天累计快照。
4. 计算并保存当天日差分。
5. 读取近 7 日和 30 日日差分。
6. 聚合并保存 7 日和 30 日汇总。
7. 读取规则配置。
8. 生成四个分析模块。
9. 写入 `report-context.json`、Markdown、XLSX 和 Feishu 文本。

CLI 需要在日志里记录四个模块各生成多少条候选。

## 错误处理

- 缺少规则配置文件时使用默认值。
- 规则配置非法时，在写入依赖规则的报告文件前失败。
- 历史日差分缺少某些日期时跳过。
- 已存在的历史日差分损坏时失败。
- Feishu 发送失败继续保持非致命；本地报告文件生成后不回滚。

## 测试策略

实现时继续使用 TDD。

测试需要覆盖：

- 配置文件缺失时加载默认值。
- 非法规则配置会被拒绝。
- 部分配置能与默认值合并。
- 曝光优化候选生成。
- 转化优化候选生成。
- 新品观察候选生成。
- 生命周期治理在 `custodyDays` 有值和为空时的行为。
- 读取近 7/30 日日差分时跳过缺失日期、拒绝损坏文件。
- CLI/report context 路径能生成非空 section。

## 不在本阶段范围

- 基于 goods-list 快照的新品检测。
- 端内 ID 优先展示。
- 观察状态持久化和冷却期接入。
- 访问/订单/发货看板数据合并。
- 商品操作、Feishu Q&A、审批卡片或 LLM 建议。

这些留到规则日报稳定产生内容之后再继续推进。
