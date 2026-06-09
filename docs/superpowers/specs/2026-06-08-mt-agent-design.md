# MT Agent Design

## Goal

Build a local operations agent for Alipay merchant dashboard data. The first version is a manually triggered command that automatically opens the dashboard, collects the 1-day, 7-day, and 30-day product data, and generates a daily XLSX report plus a Markdown operations summary.

The first version prioritizes stable data collection and useful analysis output. Scheduled execution, Feishu push, Feishu Q&A, Obsidian lookup, and internal product ID mapping are later phases.

## Project

The new project will live at:

```text
C:\works\MT-agent
```

It is separate from `C:\works\Alipay-dashboard-xlsx`. The existing browser extension remains a page export tool. `MT-agent` becomes the local operations agent. Useful code from the extension can be migrated or adapted, especially Ant Design table extraction, text normalization, workbook formatting, and the existing basic analysis field matching.

## Technology

Use the existing Node and TypeScript ecosystem:

- Node.js and TypeScript for the agent code.
- Playwright for browser control.
- `xlsx-js-style` or an equivalent XLSX library for workbook output.
- Local filesystem storage for raw data, reports, and logs.

Do not use OpenCode, Claude Code, Codex, or similar coding agents as the runtime base. Those tools can help develop the project, but the daily operations agent must be a deterministic local program with explicit logs, configuration, and error handling.

## First Version Scope

Included:

- Manual command trigger, such as `npm run daily-report`.
- Persistent browser profile for Alipay login reuse.
- Automatic navigation to the Alipay merchant dashboard product list.
- Automatic collection of 1-day, 7-day, and 30-day dashboard data.
- Full pagination collection for each period.
- Robust handling when the page size falls back from 100 rows to 10 rows.
- Raw JSON output for each period.
- One daily XLSX report.
- One daily Markdown summary.
- Rule and weight based product analysis keyed by platform product ID.
- Run log with clear failure reasons and collection statistics.

Excluded from the first version:

- Scheduled execution.
- Feishu Webhook push.
- Feishu conversational bot.
- Obsidian integration.
- Internal product ID mapping implementation.
- Complex multi-day historical trend analysis beyond the dashboard's 1/7/30-day periods.
- Direct backend API scraping or packet capture.

## Directory Layout

Recommended structure:

```text
MT-agent/
  src/
    crawler/        # Playwright navigation, filters, pagination, table reads
    extractor/      # Ant Design table extraction and field normalization
    analyzer/       # Product scoring, labels, recommendations
    report/         # XLSX and Markdown generation
    storage/        # Output paths, raw JSON, logs
    cli/            # daily-report command entry
  output/
    YYYY-MM-DD/
      MT运营日报_YYYY-MM-DD.xlsx
      MT运营日报_YYYY-MM-DD.md
      raw-1d.json
      raw-7d.json
      raw-30d.json
      run.log
  config/
    agent.config.json
  docs/
    superpowers/
      specs/
      plans/
```

The browser profile directory should be local and ignored by git:

```text
MT-agent/.browser-profile/
```

## Configuration

Use a local configuration file for values that may change:

```json
{
  "targetUrl": "https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list?appId=2021005181665859",
  "periods": ["1d", "7d", "30d"],
  "preferredPageSize": 100,
  "outputDir": "output"
}
```

The target URL comes from the current browser extension project. It must not be hard-coded deep inside crawler logic.

## Crawler Flow

The first version command flow is:

```text
Start daily-report
  -> open persistent browser profile
  -> navigate to target URL
  -> check whether the dashboard is available
  -> if login is required, pause and ask the user to log in manually
  -> collect 1-day data
  -> collect 7-day data
  -> collect 30-day data
  -> save raw JSON for each period
  -> run analysis
  -> generate XLSX
  -> generate Markdown
  -> write run log
```

Manual login is acceptable in the first version. The agent should reuse login state in `.browser-profile` on later runs.

## Period Collection

For each period, the crawler should:

1. Select the matching dashboard period, such as 1 day, 7 days, or 30 days.
2. Wait for the table to refresh based on actual page conditions, not a fixed sleep alone.
3. Try to set the page size to `100` rows.
4. Read the actual page size after refresh.
5. Collect all pages using the actual current pagination state.
6. Deduplicate rows by platform product ID.
7. Record page count, row count, deduped count, and any page size fallback in the log.

The agent must not assume that setting 100 rows per page succeeds. The dashboard may fall back to 10 rows per page. This fallback is a supported condition, not a fatal error.

## Pagination Reliability

Correctness must not depend on `100条/页`.

The crawler should treat preferred page size as an optimization:

```text
try 100 rows/page
if actual page size is 100:
  collect fewer pages
else:
  continue with the actual page size, commonly 10
```

Each period should be considered complete when either:

- The displayed total count equals the deduplicated collected count.
- Or the crawler reaches a disabled or unavailable next-page button and no more rows are available.

If a displayed total count is available and does not match the deduplicated count, the report should still write raw data but mark the run as incomplete in `run.log` and the Markdown summary.

## Table Extraction

The table extraction should adapt logic from `C:\works\Alipay-dashboard-xlsx`:

- Read the visible Ant Design table.
- Preserve visible column order for raw sheets.
- Skip checkbox columns and operation/action columns.
- Split `商品信息` into `商品名称` and `商品ID`.
- Split `SPU信息` into `SPU名称` and `SPUID`.
- Normalize text, whitespace, copied ID labels, and comma-separated numbers.

Required normalized fields for analysis:

- Product name.
- Platform product ID.
- Visit count.
- Created order count.
- Signed order count.
- Reviewed order count.
- Shipped order count.

Optional reference fields:

- SPU name.
- SPU ID.

If required fields are missing for a period, the run should stop with a clear error that lists the missing fields and the actual headers found.

## Analysis Model

The first version uses deterministic rules plus weighted scoring. It should avoid black-and-white conclusions and include confidence.

For each product, compute per-period metrics:

- Visits.
- Created orders.
- Signed orders.
- Reviewed orders.
- Shipped orders.
- Created conversion rate.
- Signed conversion rate.
- Reviewed conversion rate.
- Shipped conversion rate.

For each product, output:

- Product name.
- Platform product ID.
- SPU name, if present.
- SPU ID, if present.
- 1-day, 7-day, and 30-day core metrics.
- Risk score from 0 to 100.
- Opportunity score from 0 to 100.
- Risk level: high, medium, low.
- Opportunity level: high, medium, low.
- Recommendation action.
- Confidence: high, medium, low.
- Reason text.

Recommendation actions:

- Suspected inactive.
- Suspected pricing problem.
- Add more links.
- Increase exposure.
- High exposure but low conversion.
- Stable performer.
- Keep observing.

The report text can be Chinese even when code identifiers remain English.

## Product Recommendation Rules

The initial rule set should encode the current business understanding:

- Suspected inactive: 30-day visits exist, 30-day shipped orders are 0, and 7-day and 1-day shipped orders are also 0. Higher visits should increase risk and confidence.
- Suspected pricing problem: 30-day data shows prior order signal, but 7-day or 1-day data weakens significantly while visits remain. This should not be treated as direct inactive status.
- Add more links: 1-day or 7-day visits are not high, such as below 100, but there is already order or shipped-order signal. This is a strong opportunity signal.
- Increase exposure: conversion is healthy but visit volume is low or moderate.
- High exposure but low conversion: visits are high while created or shipped conversion is weak. The recommendation should mention price, image, title, and stock checks.
- Stable performer: 1-day, 7-day, and 30-day signals are consistent and there are shipped orders.
- Keep observing: data volume is too small, period signals conflict, or no strong risk/opportunity exists.

Thresholds should be implemented as named constants so they can be tuned after reviewing real reports.

## Confidence

Confidence should be derived from data volume and cross-period agreement:

- High confidence: 30-day visits are at least 100 and 1-day, 7-day, and 30-day signals agree.
- Medium confidence: 30-day visits are between 30 and 99, or the short-term and long-term signals have mild tension.
- Low confidence: visits are very low, only one period has signal, or the data is incomplete.

Confidence is not the same as risk or opportunity. A product can have high risk and medium confidence, or high opportunity and low confidence.

## Analysis Key

The first version analysis is product-centric. The primary key is the platform product ID from the Alipay dashboard.

SPU name and SPU ID may be preserved in raw data and shown as reference columns when available, but they are not first-version analysis keys. The agent should not generate a separate SPU recommendation sheet in the first version because current operations decisions are made on individual product links.

Future versions may add SPU-level grouping if it becomes useful, but this must not distract from product-level recommendations.

## XLSX Output

Generate one daily workbook:

```text
MT运营日报_YYYY-MM-DD.xlsx
```

Sheets:

- `1天原始数据`
- `7天原始数据`
- `30天原始数据`
- `商品综合分析`

Raw sheets preserve visible table columns after normalization. Analysis sheets add computed fields, scores, levels, confidence, recommendation action, and reason text.

`商品综合分析` should include at least:

- 商品名称
- 平台商品ID
- 1天访问
- 1天创建
- 1天发货
- 7天访问
- 7天创建
- 7天发货
- 30天访问
- 30天创建
- 30天发货
- 30天发货率
- 风险分
- 机会分
- 风险等级
- 机会等级
- 建议动作
- 置信度
- 判定原因

If SPU fields are present in the source data, `商品综合分析` may also include `SPU名称` and `SPUID` as reference columns, but no recommendation should depend on them in the first version.

The workbook should use readable column widths, frozen header rows, soft header styling, and row highlighting for high-risk and high-opportunity items.

## Markdown Output

Generate one daily Markdown report:

```text
MT运营日报_YYYY-MM-DD.md
```

The Markdown report should focus on decisions, not raw tables:

- Run status and whether any period collection was incomplete.
- Summary counts for suspected inactive, suspected pricing problem, add links, increase exposure, and stable performers.
- Top high-risk products with reasons.
- Top high-opportunity products with reasons.
- Product-level opportunities.
- Items needing manual review because confidence is low or data conflicts.

Example structure:

```text
# MT每日运营日报 YYYY-MM-DD

## 今日重点

## 优先处理

## 建议补链/加曝光

## 商品机会

## 需要人工复核

## 抓取状态
```

## Logging and Failure Handling

Every run writes:

```text
output/YYYY-MM-DD/run.log
```

The log should include:

- Start and end time.
- Target URL.
- Whether manual login was required.
- For each period: actual page size, page count, row count, deduped count, displayed total count if available, and fallback events.
- Missing field errors.
- Incomplete collection warnings.
- Output file paths.

First version failure behavior is simple: fail fast for login, missing required fields, inaccessible page, or table extraction failure. Partial raw data may be saved if already collected, but the report should clearly mark incomplete data.

## Internal Product ID Mapping

The platform product ID from Alipay is not the same as the internal product ID in the existing product management system.

First version only reserves fields and does not implement mapping. Later phases may add:

```text
config/product-mapping.json
```

With entries such as:

```json
[
  {
    "platformProductId": "10001",
    "internalProductId": "MT-8888",
    "internalProductName": "端内商品名称",
    "notes": "可选备注"
  }
]
```

Future reports can add internal product ID and mapping status. Obsidian integration and Feishu Q&A can later use the same mapping to answer questions like which internal product ID corresponds to a platform product ID.

This mapping feature is P3 and must not delay the first version.

## Later Phases

Phase 2:

- Feishu Webhook push of the Markdown summary.
- Optional Windows Task Scheduler setup after local output is stable.

Phase 3:

- Feishu conversational bot for asking about specific products and recommendations.
- Local query API or command interface backed by raw data and reports.

Phase 4:

- Internal product ID mapping.
- Obsidian vault integration.
- Longer historical trend storage and analysis across multiple daily runs.

## Success Criteria

The first version is successful when:

- Running one command produces a complete daily report for 1-day, 7-day, and 30-day data.
- The agent can complete collection even if the page size falls back to 10 rows.
- Output includes raw JSON, XLSX, Markdown, and a useful log.
- The product analysis identifies suspected inactive products, likely pricing problems, low-exposure products with orders, high-exposure low-conversion products, stable performers, and uncertain items.
- The user can inspect the Markdown summary for decisions and the XLSX for detailed evidence.
