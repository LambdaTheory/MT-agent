# Public Traffic Card Readable Tables Design

## Goal

Replace the long reason-heavy Feishu card with a short, scan-friendly report. The card should show numbers first, use compact paginated tables for product metrics, put long analysis text behind a collapsed panel, and keep new product observation out of the main body until its business definition is clarified.

## Problems To Fix

- Worktree runs can miss yesterday's report context because the isolated worktree has its own `output` directory. The card then incorrectly says there is no previous-day public traffic context.
- The current three detail tables include long `reason` text, causing wide rows, excessive vertical length, and poor readability.
- New product observation is too noisy and should not be listed as a main table yet.
- Today's funnel should use Feishu `column_set` layout to make the public / order / fulfillment blocks visually distinct.

## Card Structure

1. Business conclusions: keep short text, with previous-day comparison when available.
2. Divider.
3. Today's funnel: use Feishu JSON 2.0 `column_set` with three weighted columns:
   - Public traffic: exposure, public visits, downstream visits, amount.
   - Orders: created orders, signed orders, reviewed orders, shipped orders, signed amount.
   - Fulfillment: pending shipment, returned, overdue, closed.
4. Divider.
5. Section title `曝光 Top10`.
6. One paginated table with columns `商品 / ID / 曝光 / 访问 / 成交`.
7. Divider.
8. Section title `待优化`.
9. Three paginated tables, each with columns `ID / 曝光 / 访问 / 托管天`:
   - `曝光 0-10（N个）`
   - `曝光 10-50（N个）`
   - `曝光 50-100（N个）`
10. Divider.
11. Collapsible panel `分析与建议`, collapsed by default. It contains short grouped bullets only, not full product rows:
   - `曝光优化`: counts for the three exposure bands and brief action guidance.
   - `转化链路`: count of weak-conversion items and brief action guidance.
   - `新品观察`: only show the count and note that the口径 still needs clarification.

## Table Rules

- Tables are direct children of `body.elements` because Feishu 2.0 tables cannot be nested.
- Use `page_size: 10`, `row_height: "low"`, and `freeze_first_column: true`.
- Avoid long reason/action columns in root-level tables.
- Product names may be in the exposure Top10 table; optimization tables use ID-only columns to stay compact.

## Previous Context Rule

When reading yesterday's report context:

- First try the configured `outputDir` in the current workspace.
- If missing and the process is running inside `.worktrees/<name>`, fallback to the parent repository's `outputDir` path.
- Log which path supplied the previous context.

This keeps worktree validation from falsely reporting no previous-day context.

## Markdown And Workbook

- Markdown can remain more verbose, but should mirror the new top-level ordering.
- Workbook keeps full detail sheets for analysis and long reasons.

## Testing

- Unit test the previous-context fallback from worktree output to parent repository output.
- Unit test that the card contains compact tables with the new column sets and no root-level `reason` table columns.
- Unit test that new product rows are not emitted as a root-level table.
- Unit test that the analysis panel is collapsible and collapsed by default.
