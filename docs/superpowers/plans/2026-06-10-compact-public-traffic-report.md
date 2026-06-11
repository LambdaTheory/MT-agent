# Compact Public Traffic Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten public traffic report output by hiding empty sections and rendering summary metrics in compact multi-column/multi-item lines.

**Architecture:** Keep crawler and analysis data unchanged. Update only report builders so Feishu card uses field columns and text/Markdown use compact lines; keep XLSX unchanged as the full artifact.

**Tech Stack:** TypeScript, Vitest, Feishu interactive card markdown fields.

---

### Task 1: Red Tests

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] Add tests that empty modules do not render section titles or `暂无` notes in Feishu text/card/Markdown.
- [ ] Add tests that funnel and module counts render compact multi-item lines.
- [ ] Add tests that warning products are capped in text output.

### Task 2: Text And Markdown Compact Rendering

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`

- [ ] Replace one-metric-per-line funnel output with compact lines.
- [ ] Render module counts only for non-empty modules.
- [ ] Omit empty insight sections instead of showing empty notes.
- [ ] Cap warning products to 15 in text/Markdown.

### Task 3: Feishu Card Compact Rendering

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`

- [ ] Render today funnel as multi-column fields.
- [ ] Render module counts as multi-column fields, only non-zero.
- [ ] Omit empty section elements.
- [ ] Cap warning products to 15.

### Task 4: Verification

- [ ] Run `npm test -- tests/publicTrafficReport.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
