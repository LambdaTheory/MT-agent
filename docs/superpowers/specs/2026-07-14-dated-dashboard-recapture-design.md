# 指定业务日期访问页补抓设计

**日期：** 2026-07-14  
**状态：** 已确认，待实现  
**范围：** 为访问页补抓增加指定业务数据日期能力；保持 1日、7日、30日三周期抓取；修正飞书补抓结果卡的业务状态色。

## 1. 背景与目标

现有 `capture-dashboard` / `publicTraffic.refreshDashboard` 的 `date` 只用于本地输出目录和日报处理目标，访问页 crawler 不会操作后台日期控件。因此，不管传什么日期，实际抓取的仍是页面默认展示的数据。

支付宝访问页存在日期控件。人工侦察确认：

- 日期控件为 Ant Design picker，稳定线索为 `.ant-picker` 和 `input[placeholder="请选择日期"]`；
- 默认可能显示范围值，例如 `07-07 ~ 07-13`；
- 选择历史单日后会显示单日期，例如 `07-12`；
- 页面存在独立的 `1日`、`7日`、`30日` 周期切换按钮；
- 选择子账号是进入页面的必要步骤，正式流程必须继续复用 `ensureAuthenticatedMerchantSession()` 与 `selectSubAccountIfNeeded()`。

目标是让维护人员在任意未来时间按一个明确的业务数据日补抓访问页：页面切换到该日期、抓取三周期、验证正确性、安全落盘；如果存在对应日报则按既有规则修复日报，否则独立归档 raw。

## 2. 非目标

本期不包含：

- 批量日期区间补抓、队列、断点续跑或自动扫描最近可用日期；
- 自动从后台未更新的日期回退到更早日期；
- 通过猜测 URL 参数或未公开 API 绕过页面日期控件；
- 缺少日报时自动重跑一份历史完整日报；
- 结果卡上的一键重试按钮（避免绕过确认边界）；
- 改变主日报的运行目录规则或减少其三周期抓取范围。

## 3. 统一日期语义

`date` 在 CLI、飞书精确命令、Agent 工具和领域服务中统一表示：

> **业务数据截止日**：后台访问页日期选择器必须实际显示的单日日期。

例如：

```text
补抓 2026-07-12 访问页
```

表示后台选择 `2026-07-12`，然后抓取截至该日的 `1日`、`7日`、`30日` 表。

规则：

- 显式日期应为合法 `YYYY-MM-DD`；飞书继续支持现有日期提示形式，如 `7月12日`；
- 未指定日期时默认本地日期的昨天；例如 2026-07-14 默认请求 2026-07-13；
- 未来日期在启动浏览器前拒绝；
- 后台尚未更新目标日期时，必须报告该目标日不完整；不得自动抓取 7月12日后写进 7月13日；
- 页面回读日期不等于请求日期时，视为日期切换失败，不写 raw。

CLI 保持原命令名：

```powershell
npm run capture-dashboard -- --date 2026-07-12 --send-to group
```

飞书示例：

```text
补抓 2026-07-12 访问页
补抓 7月12日访问页 发群
补抓访问页
```

精确命令在确认卡中必须回显目标业务数据日、三个周期，以及“可能保存 raw、必要时重建并最多重发一次日报”的范围。

## 4. 模块边界与数据流

```text
CLI / 飞书意图 / Agent 工具
  → DashboardRefreshRequest { dataDate, sendTo }
    → dashboardRefresh
      ├─ dashboardCrawler：会话、子账号、选日期、日期回读、三周期抓取
      ├─ dashboardQuality：三周期完整性判定
      ├─ report-context locator：按 context.date 定位实际日报运行目录
      ├─ historicalDashboardCapture：无日报时独立 raw 与 manifest
      ├─ rebuildPublicTrafficReport：仅已有日报且补抓完整时调用
      └─ structured refresh result：供 CLI / SDK / HTTP 路径统一显示
```

### 4.1 `dashboardCrawler`

职责：

1. 复用已有会话与自动子账号选择；
2. 打开访问页；
3. 选择目标业务日期；
4. 回读、验证页面实际日期；
5. 依次抓 `1d`、`7d`、`30d`，保留既有分页候选、去重、空态二次确认、frame 支持和诊断上下文；
6. 返回 raw 和已经确认的 `actualPageDate`。

它不决定 raw 写入目录、是否重建或是否发送飞书。

### 4.2 `dashboardRefresh`

职责：

1. 接收业务数据日；
2. 在 output 中根据 `PublicTrafficDataReportContext.date === dataDate` 定位对应日报，而不是假设目录名等于数据日；
3. 调用 crawler 并评估三周期质量；
4. 已有日报时写回对应的三份访问 raw、读取和更新 run state、保留一次性重发保护；
5. 无日报时写入独立历史归档；
6. 返回结构化业务结果。

### 4.3 飞书与 CLI

- CLI 只加载环境和配置、解析参数、输出结构化结果的可读摘要；
- 飞书 intent 解析日期并把它传入确认卡；
- Agent 工具维持 `risk: write` / `requiresConfirmation: true`；
- SDK 和 HTTP 回调消费同一结构化状态，不能通过是否抛异常或是否有 `metadata.ok` 猜测颜色。

## 5. 页面日期选择与回读

### 5.1 交互顺序

```text
启动持久化浏览器
→ 登录失效时等待人工扫码
→ 自动选择目标子账号
→ 打开访问页并等待表格或空态
→ 打开“请选择日期”控件
→ 在 Ant picker 选择目标单日期
→ 按需确认
→ 等待页面刷新
→ 回读日期输入框并确认目标日
→ 切换 1日 / 7日 / 30日并逐周期抓取
```

### 5.2 定位与兼容策略

日期控件的首选定位为 `input[placeholder="请选择日期"]` 及其 `.ant-picker` 容器。操作实现应：

1. 点击控件容器展开 picker；
2. 使用年月导航和目标日 cell 选择日；
3. 若 picker 显示确认按钮则点击；若单击日期自动提交并关闭也接受；
4. 轮询输入框值直到刷新后稳定；
5. 继续使用已有 `waitForTableOrEmptyState` / `waitForDashboardTargetTableOrEmptyState` 等条件等待，不用固定延迟替代业务条件。

不通过 `fill()` 直接改 input 值，不使用 URL 日期猜测，不调用未验证的内部接口。

### 5.3 日期回读规则

页面当前单日显示可能为 `MM-DD`，也可能随着后台改版显示完整日期。实现应：

- 接受可明确映射到目标日的单日格式，如 `MM-DD`、`YYYY-MM-DD`、`YYYY/MM/DD`；
- 拒绝包含范围分隔符的值，如 `07-07 ~ 07-13`；
- 对跨年场景，若显示格式不能可靠区分年份，则依靠 picker 所选年月及交互状态确认；仍有歧义时失败而不猜测；
- 在回读成功前不得抓三周期或落盘。

## 6. 三周期抓取、质量和失败分类

本期继续抓取 `1日 / 7日 / 30日`。三周期都完整才是“补抓完成并可修复日报”的业务成功条件。

每周期继续执行：切换标签、空态确认、自适应分页、可见表格提取、按商品 ID 去重、总数读取和完整性检查。

| 分类 | 条件 | raw / 日报行为 | 卡片颜色 |
|---|---|---|---|
| 参数错误 | 非法或未来日期 | 不启动浏览器，不写 raw | 红 |
| 会话失败 | 登录、子账号失败 | 不写 raw，浏览器按现有失败策略保留 | 红 |
| 日期失败 | 控件缺失、回读为旧日期/范围、刷新超时 | 不写 raw | 红 |
| 结构失败 | 表格、分页或解析异常 | 不将失败伪装成成功 raw | 红 |
| 数据仍缺失 | 已确认目标日，但任一周期空/不完整 | 保存实际 raw；不重建、不重发 | 橙 |
| 首版完整 | 三周期完整且无需修复 | 保存 raw；不重建、不重发 | 蓝 |
| 已重发 | 三周期完整但已因补抓重发过 | 保存 raw；不重复重发 | 蓝 |
| 修复成功 | 首版缺失、本次三周期完整且未重发 | 保存 raw、重建、重发一次 | 绿 |

安全诊断应包含请求数据日、回读日期、当前周期、URL、标题、正文摘要、frame URL 和分页候选失败信息；不得记录 token、cookie、profile 内容或完整敏感业务数据。

## 7. 按数据日定位日报与历史归档

### 7.1 已有日报

日报主流程当前以运行日创建目录，但 `context.date` 通常是前一个业务数据日。因此补抓不能使用 `output/<dataDate>` 猜测写入位置。

应遍历/复用现有 `findReportContextByDate()` 语义，定位 `context.date === dataDate` 的实际日报目录。找到后：

- 覆盖该目录内 `公域访问数据_1日.json`、`公域访问数据_7日.json`、`公域访问数据_30日.json`；
- 加载该目录的 `public-traffic-run-state.json`；
- 根据首版质量、本次质量和 `dashboardRefreshResent` 做决策；
- 只有“首版缺失 + 本次三周期完整 + 未重发”时调用 `rebuildPublicTrafficReport` 并发送；
- 状态文件缺失时采用保守策略：不可把本次质量伪装成首版质量并自动重发。

### 7.2 无既有日报

如果不存在 `context.date === dataDate` 的日报上下文，则不猜测或创建日报运行目录。仍可安全保存页面已确认日期的 raw：

```text
output/historical-dashboard-captures/<dataDate>/
├─ 公域访问数据_1日.json
├─ 公域访问数据_7日.json
├─ 公域访问数据_30日.json
└─ capture-manifest.json
```

manifest 至少记录：

```json
{
  "dataDate": "2026-06-01",
  "actualPageDate": "2026-06-01",
  "capturedAt": "ISO timestamp",
  "reportContextFound": false,
  "quality": "per-period structured summary",
  "rebuild": "skipped",
  "resend": "skipped",
  "reason": "未找到该业务数据日的既有日报上下文"
}
```

该分支不重建、不重发，只向操作者明确提示 raw 已归档且未找到对应日报。

## 8. 结构化结果与飞书结果卡

### 8.1 领域结果状态

`runDashboardRefresh()` 应返回业务状态，而不只返回中文文本：

```ts
type DashboardRefreshStatus =
  | 'repaired'
  | 'still_missing'
  | 'saved_existing_complete'
  | 'saved_already_resent'
  | 'saved_historical_without_report';

type DashboardRefreshResult = {
  dataDate: string;
  actualPageDate: string;
  resolvedReportRunDate?: string;
  refreshQuality: DashboardQualitySummary;
  firstQuality?: DashboardQualitySummary;
  status: DashboardRefreshStatus;
  rebuild: 'performed' | 'skipped';
  resend: 'performed' | 'skipped';
  rawLocation: string;
  message: string;
};
```

异常路径以明确错误返回/抛出，由飞书统一映射为红色失败卡。文本是展示结果，不能再作为状态判断输入。

### 8.2 卡片信息层级

补抓结束使用专用“业务数据补抓结果卡”，取代通用的“Agent 操作已完成”成功卡。

首屏固定展示：

1. 业务状态标题和语义颜色；
2. 业务数据日；
3. 页面实际回读日期；
4. `1日 / 7日 / 30日` 的紧凑状态块（完整性与行数）；
5. 日报处理结论（重建、重发或跳过）；
6. 针对当前状态的唯一关键说明和 raw 去向。

不在首屏显示分页、去重、总数、frame 诊断等长技术信息；必要时可折叠展示。

### 8.3 状态映射

| 状态 | 标题 | 颜色 | 关键内容 |
|---|---|---|---|
| `repaired` | 访问页补抓并重建完成 | 绿 | 三周期完整、已重建、已重发一次 |
| `still_missing` | 访问页补抓完成，但数据仍未完整 | 橙 | 明确缺失周期/原因、raw 去向、未重建/未重发、建议稍后重试同一数据日 |
| `saved_existing_complete` | 访问页数据已保存 | 蓝 | 首版完整、无需重建、三周期质量 |
| `saved_already_resent` | 访问页数据已保存 | 蓝 | 已跳过重复重发、三周期质量 |
| `saved_historical_without_report` | 历史访问页 raw 已归档 | 蓝 | 未找到既有日报、归档位置、明确未重建/未重发 |
| 异常 | 访问页补抓失败 | 红 | 目标日期、失败阶段、无敏感诊断、明确未写入不可信数据 |

橙色的语义是“流程完成但业务数据不完整”，绝不能显示为绿色。红色的语义是“未确认数据正确性，未写入”。蓝色表示安全保存但不宣称日报修复。绿色仅表示三周期完整且实际修复/重发已完成。

SDK 和 HTTP callback 必须共享同一个状态映射；不能依赖 `metadata.ok` 缺省为成功的通用逻辑。确认后可先显示蓝色“处理中”卡，最终替换为专用结果卡。第一版结果卡不提供直接重试按钮，重试必须重新发起命令和确认。

## 9. 测试与验证

不把真实后台抓取作为自动化测试前提。实现应先补 source/fixture/纯函数测试。

### 9.1 日期与参数

- CLI 显式 `--date` 传递业务数据日；
- CLI 无日期默认昨天；
- 飞书 ISO 日期、中文月日和无日期默认值均正确；
- 精确命令将日期传入确认卡；
- 未来日期拒绝。

### 9.2 页面日期选择

- 页面日期格式化与回读解析；
- 接受单日格式；
- 拒绝范围值；
- 控件缺失、确认按钮差异、回读未变、跨年歧义与刷新超时；
- 回读成功前不得进入三周期循环。

### 9.3 定位与落盘

- 通过 `context.date` 定位实际日报目录（包括次日运行目录）；
- 不误写目录名相同但 context 不匹配的日报；
- 无日报时写 `historical-dashboard-captures/<dataDate>` 的三 raw 与 manifest；
- 无日报分支不重建、不重发。

### 9.4 质量与决策

- 三周期完整才可修复；
- 任一周期缺失只保存 raw，且不重建/不重发；
- 首版完整、已重发、状态文件缺失的保守行为；
- 请求日期与实际页面日期不一致时不落盘。

### 9.5 飞书卡片契约

- `still_missing` 为橙色，绝不显示“Agent 操作已完成”；
- `repaired` 为绿色；
- 首版完整、重复重发跳过、无日报归档为蓝色；
- 异常为红色且声明未写入；
- SDK 和 HTTP callback 显示一致。

### 9.6 最终验证

- 运行新增/相关 Vitest 测试；
- 运行 `npm run build`；
- 只有用户另行明确授权后，才针对一个已知历史日期执行真实后台抓取验证日期回读、三周期 raw、质量摘要与卡片颜色；真实验证默认不发送飞书。

## 10. 实施顺序

1. 新增日期语义、默认日期、未来日期校验和飞书日期透传测试；
2. 在 crawler 中实现并测试日期 picker 操作、回读与诊断；
3. 重构 dashboard refresh 的按 data date 定位、既有日报落盘和历史归档分支；
4. 以结构化 refresh status 替换展示层对文本/隐式成功的依赖；
5. 为 SDK 和 HTTP 路径接入专用结果状态卡；
6. 运行聚焦测试和 build；
7. 在明确授权后进行真实后台验证。
