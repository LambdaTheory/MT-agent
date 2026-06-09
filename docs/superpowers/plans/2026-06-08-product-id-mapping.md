# Product ID Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local mapping layer from Alipay platform product IDs to internal management platform IDs, and surface mapping status in reports for future execution-agent integration.

**Architecture:** Load a JSON mapping file from config, enrich `ProductAnalysisRow` with `internalProductId` and `mappingStatus`, then add these fields to XLSX/Markdown/action-facing outputs. Keep analysis grouped by `platformProductId`; internal ID is reference metadata only.

**Tech Stack:** Node.js, TypeScript, Vitest, xlsx-js-style.

---

### Task 1: Mapping Loader

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/config/loadConfig.ts`
- Create: `src/mapping/productIdMapping.ts`
- Test: `tests/productIdMapping.test.ts`

- [ ] **Step 1: Write failing tests**

Test loading a JSON file shaped as `{ "platform-id": "internal-id" }` and enriching rows with mapped/unmapped status.

- [ ] **Step 2: Run target test**

Run: `npm test -- tests/productIdMapping.test.ts`

Expected: FAIL because mapping module does not exist.

- [ ] **Step 3: Implement minimal loader/enricher**

Create `loadProductIdMapping(path)` and `applyProductIdMapping(rows, mapping)`.

- [ ] **Step 4: Verify target test**

Run: `npm test -- tests/productIdMapping.test.ts`

Expected: PASS.

### Task 2: Report Integration

**Files:**
- Modify: `src/cli/dailyReport.ts`
- Modify: `src/cli/rebuildLatestReport.ts`
- Modify: `src/report/buildWorkbook.ts`
- Modify: `src/report/buildMarkdown.ts`
- Modify: `config/agent.config.json`
- Create: `config/product-id-map.example.json`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Add config field**

Add optional `productIdMappingPath` to config, defaulting to `config/product-id-map.json` if present.

- [ ] **Step 2: Enrich analysis rows before reports**

Call mapping loader after `analyzeProducts` in both daily and rebuild commands.

- [ ] **Step 3: Add report fields**

Add `管理平台商品ID` and `映射状态` columns to XLSX; include unmapped count in Markdown overview.

- [ ] **Step 4: Verify**

Run: `npm test`, `npm run build`, `npm run rebuild-latest`.

### Self-Review

- Spec coverage: Mapping is local, optional, report-visible, and preserves platform-ID grouping.
- Placeholder scan: No placeholders remain.
- Type consistency: Uses `internalProductId` and `mappingStatus` consistently.
