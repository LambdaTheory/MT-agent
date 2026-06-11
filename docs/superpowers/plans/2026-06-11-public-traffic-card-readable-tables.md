# Public Traffic Card Readable Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Feishu public traffic card as a short, numeric, paginated-table report and fix previous-day context lookup in worktrees.

**Architecture:** Keep `analyzePublicTrafficData` as the analysis source. Rework `buildPublicTrafficCard.ts` to emit compact root-level Feishu 2.0 tables and a collapsed markdown analysis panel. Add a small previous-context path resolver in the CLI so worktree runs can read parent repository output.

**Tech Stack:** TypeScript, Vitest, Feishu Card JSON 2.0, Node.js fs/path APIs.

---

### Task 1: Previous Context Fallback

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Test: `tests/publicTrafficReportCliBehavior.test.ts`

- [ ] Add a test that writes yesterday `公域数据上下文_YYYY-MM-DD.json` only under the parent repo output path while the configured `outputDir` points to `.worktrees/<name>/output`, then asserts the loaded previous summary is used and the generated conclusions do not contain `暂无昨日公域数据上下文`.
- [ ] Extract previous-context lookup into a helper that tries configured `outputDir` first and, when `process.cwd()` contains `.worktrees`, tries the parent repo sibling output path.
- [ ] Log the path used for previous context.
- [ ] Run `npm test -- tests/publicTrafficReportCliBehavior.test.ts`.
- [ ] Commit: `修复：worktree读取昨日公域上下文`.

### Task 2: Compact Card Tables

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] Add tests asserting the card has:
  - no root table column named `reason`;
  - one `曝光 Top10` table with columns `商品/ID/曝光/访问/成交`;
  - three optimization tables with titles `曝光 0-10`, `曝光 10-50`, `曝光 50-100` and columns `ID/曝光/访问/托管天`;
  - no `new_table` root table.
- [ ] Replace current diagnostic/action/new product root tables with the four compact metric tables.
- [ ] Use `page_size: 10`, `row_height: "low"`, `freeze_first_column: true`.
- [ ] Keep dividers between major sections.
- [ ] Run `npm test -- tests/publicTrafficReport.test.ts`.
- [ ] Commit: `功能：飞书卡片改为指标表格`.

### Task 3: Funnel Column Layout And Analysis Panel

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] Add tests asserting `今日漏斗` is followed by `column_set` sections for public/order/fulfillment metrics.
- [ ] Add tests asserting there is a `collapsible_panel` with title `分析与建议`, `expanded: false`, and markdown bullets for exposure optimization, conversion chain, and new product observation count.
- [ ] Rework funnel rendering to use Feishu `column_set` weighted columns with compact metric cards.
- [ ] Move long analysis/advice text into the collapsed panel; do not list new products in the main card body.
- [ ] Run `npm test -- tests/publicTrafficReport.test.ts`.
- [ ] Commit: `功能：飞书卡片使用分栏漏斗和折叠建议`.

### Task 4: Verification And Test Push

**Files:**
- No planned code changes.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run public-traffic-report` using existing login/session and `.env` in the worktree.
- [ ] Confirm the run log says `飞书通知已发送`.
- [ ] If format is acceptable, merge the worktree branch into `master` and run one master data-context test/report verification.

## Self-Review

- Spec coverage: previous context fallback, compact metric tables, no long reason columns, no new product root table, funnel columns, dividers, collapsed analysis panel, and test push are covered.
- Placeholder scan: no placeholders or vague implementation steps remain.
- Type consistency: all named files and components exist in the current codebase.
