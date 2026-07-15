# Dashboard Batch Recapture CLI Design

## Context

指定业务数据日访问页补抓已经支持单日 CLI 和飞书工具，但单日入口每次都会启动独立 Playwright 会话。现在本地 output 中存在多天访问页 raw 缺失，逐日补抓会反复登录/选择子账号，效率低且容易中断。需要一个正式批量 CLI，在一次 Playwright 登录和子账号选择后循环补抓多个业务数据日，并沿用现有单日补抓的安全语义。

## Goal

新增正式 CLI `capture-dashboard-batch`，用于一次浏览器会话批量补抓多个访问页业务数据日。首版只支持 CLI，不做飞书自然语言/确认卡批量交互。

## Non-goals

- 不做飞书批量交互入口。
- 不自动重发重建后的公域日报。
- 不做复杂断点恢复或持久 batch state。
- 不改变单日 `capture-dashboard` 和 `publicTraffic.refreshDashboard` 的现有行为。

## CLI Interface

新增 npm script:

```bash
npm run capture-dashboard-batch -- --dates 2026-06-12,2026-06-13,2026-06-16
```

支持参数：

- `--dates <YYYY-MM-DD,...>`：必填，逗号分隔业务数据日。
- `--send-to personal|group|both`：可选，只发送每个日期的补抓结果卡，不用于重发公域日报。
- `--json`：可选，输出结构化批量结果。

默认失败策略：失败即停。某个日期失败后停止后续日期，保留已完成日期结果并返回非零退出码。

## Architecture

### Reuse shared Playwright session

新增批量 CLI 调用 `ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: 'dashboard-refresh-batch' })` 一次，复用返回的 `page` 循环处理日期。循环结束后关闭 browser context；如果发生失败，沿用 `MT_AGENT_KEEP_BROWSER_ON_FAILURE` 的语义决定是否保留窗口。

### Refactor single-date refresh into reusable post-capture helper

现有 `runDashboardRefresh` 会自己打开/关闭浏览器，不适合批量复用。将 `src/publicTraffic/dashboardRefresh.ts` 中“抓取后处理”抽成导出 helper，例如：

```ts
export async function saveDashboardRefreshCapture(input: {
  config: AgentConfig;
  dataDate: string;
  capture: { tables: RawTableData[]; actualPageDate: string };
  sendReport?: boolean;
  sendTo?: 'personal' | 'group' | 'both';
}): Promise<DashboardRefreshResult>
```

职责：

- 校验 `dataDate`。
- 评估 1d/7d/30d 质量。
- 用 `findPublicTrafficReportByDataDate(outputDir, dataDate)` 定位既有日报。
- 无既有日报时调用 `saveHistoricalDashboardCapture`，不重建、不发送。
- 有既有日报时写入 `paths.publicVisitRaw`。
- 读取/写入 `public-traffic-run-state.json`。
- 复用 `decideDashboardRefreshOutcome`。
- 仅当 `sendReport === true` 且状态允许时调用 `rebuildPublicTrafficReport` 触发公域日报发送。

单日 `runDashboardRefresh` 保持原语义，内部改为：打开浏览器 → `collectDashboardPage` → 调用 `saveDashboardRefreshCapture({ sendReport: true, sendTo })`。

批量 CLI 调用同一个 helper，但传 `sendReport: false`，因此不会自动重发公域日报。

### Per-date result card sending

若 CLI 传入 `--send-to`，每个日期完成后发送 `buildDashboardRefreshResultCard(result)` 生成的补抓结果卡。发送失败只记录为该日期失败并停止后续日期；不伪装为 repaired。

结果卡是“补抓结果通知”，不是公域日报重发。

### Date validation

所有日期使用 `assertDashboardDataDate` 校验。重复日期去重并保持首次出现顺序。未来日期、非法日期、空 dates 直接报错，不启动浏览器。

## Data Flow

1. CLI 解析参数。
2. `loadEnv()`。
3. `loadConfig()`。
4. 校验并去重 dates。
5. 启动一次 Playwright 持久化会话。
6. 对每个 date：
   - `collectDashboardPage(config, page, { dataDate })`。
   - `saveDashboardRefreshCapture({ config, dataDate, capture, sendReport: false })`。
   - 可选发送该日期结果卡。
   - 记录 item result。
7. 打印批量汇总。
8. 任一失败时停止后续日期，设置 `process.exitCode = 1`。

## Output

默认控制台输出：

- 批量开始：日期数量和列表。
- 每个日期：序号、业务数据日、页面回读日、状态、质量摘要、raw 位置、动作说明。
- 结束汇总：completed / failed / repaired / still_missing / saved / archived。

`--json` 输出单个 JSON 对象：

```json
{
  "total": 3,
  "completed": 2,
  "failed": 1,
  "stopped": true,
  "results": [
    { "date": "2026-06-12", "ok": true, "status": "still_missing", "rawLocation": "..." },
    { "date": "2026-06-13", "ok": false, "error": "..." }
  ]
}
```

## Error Handling

- 日期参数错误：不启动浏览器，直接失败。
- 页面日期回读失败：该日期失败，停止后续。
- 报告上下文 JSON 损坏：该日期失败，停止后续。
- 无既有日报：安全归档 raw，状态为 `saved_historical_without_report`，不失败。
- 抓取后仍缺失：状态为 `still_missing`，不失败，不重建。
- 结果卡发送失败：该日期失败，停止后续。

## Testing

- `tests/captureDashboardBatchCli.test.ts`
  - 参数解析：dates、send-to、json、非法日期、重复去重。
  - 执行顺序：按日期顺序调用 shared page capture。
  - 失败即停：第二个日期失败时第三个不执行。
  - `--send-to` 只发送结果卡，不传递为日报重发。
- `tests/dashboardRefresh.test.ts`
  - `saveDashboardRefreshCapture` 与单日 `runDashboardRefresh` 共用状态语义。
  - `sendReport: false` 不调用 `rebuildPublicTrafficReport` 发送公域日报。
- `tests/captureDashboardCliSource.test.ts` 或新增 source test
  - package script 暴露 `capture-dashboard-batch`。
  - CLI 有 import guard。
  - `loadEnv()` 在 `loadConfig()` 之前。

Manual verification after implementation:

```bash
npm run capture-dashboard-batch -- --dates 2026-06-12,2026-06-13 --json
```

确认只一次登录/子账号选择，两个日期依次抓取，并且没有公域日报重发。

## Self-review

- No placeholders remain.
- Scope is limited to formal batch CLI and helper refactor.
- CLI sends only result cards when requested; it does not auto-send rebuilt reports.
- Existing single-date behavior remains unchanged by routing through the new helper with `sendReport: true`.
