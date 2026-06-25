# Link Registry Maintenance Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a link-registry maintenance view that reports coverage ratios and exports a prioritized queue of links/groups that still need manual maintenance.

**Architecture:** Keep the existing registry build/store/audit flow intact and add a focused `src/linkRegistry/maintenance.ts` module that derives maintenance coverage and queue items from the registry entries plus override risks. Extend the existing `linkRegistryAudit` CLI to print or emit this maintenance view so the team can use one command to see both low-level audit risks and actionable maintenance work.

**Tech Stack:** TypeScript, existing link registry modules, existing CLI wiring, Vitest.

---

### Task 1: Define maintenance report types and behavior with tests

**Files:**
- Create: `src/linkRegistry/maintenance.ts`
- Create: `tests/linkRegistryMaintenance.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that builds a maintenance report from a mixed registry and asserts:
- coverage counts for `grouped`, `classified`, and `mapped`
- a pending queue item for an active ungrouped link
- a pending queue item for a recent active link with missing category/productType

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/linkRegistryMaintenance.test.ts`

Expected: FAIL because `buildLinkRegistryMaintenanceReport` does not exist.

- [ ] **Step 3: Write minimal implementation**

Add:
- `LinkRegistryMaintenanceCoverage`
- `LinkRegistryMaintenanceQueueItem`
- `LinkRegistryMaintenanceReport`
- `buildLinkRegistryMaintenanceReport(entries, overrideRisks, options?)`

The first implementation only needs to support:
- grouped coverage
- classified coverage
- mapped coverage
- queue item reasons for `same_sku_group_missing`, `classification_missing`, `platform_mapping_missing`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/linkRegistryMaintenance.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/linkRegistry/maintenance.ts tests/linkRegistryMaintenance.test.ts
git commit -m "feat: add link registry maintenance report model"
```

### Task 2: Add prioritization for new and high-risk maintenance items

**Files:**
- Modify: `src/linkRegistry/maintenance.ts`
- Modify: `tests/linkRegistryMaintenance.test.ts`

- [ ] **Step 1: Write the failing test**

Extend tests to require:
- recent active links sort ahead of old removed links
- override risks create queue items
- sample-insufficient same-sku groups produce group-level maintenance tasks

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/linkRegistryMaintenance.test.ts`

Expected: FAIL on missing priority order or missing queue reasons.

- [ ] **Step 3: Write minimal implementation**

Add:
- queue priority rules
- recent-link detection using `firstSeenDate` / `updatedAt`
- queue reasons for `override_risk` and `same_sku_group_sample_insufficient`
- summary counters for `readyCount` and `pendingCount`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/linkRegistryMaintenance.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/linkRegistry/maintenance.ts tests/linkRegistryMaintenance.test.ts
git commit -m "feat: prioritize link registry maintenance queue"
```

### Task 3: Extend the existing audit CLI with maintenance output

**Files:**
- Modify: `src/cli/linkRegistryAudit.ts`
- Modify: `tests/linkRegistryAuditCli.test.ts`
- Test: `tests/linkRegistryMaintenance.test.ts`

- [ ] **Step 1: Write the failing test**

Add CLI assertions that:
- default summary now includes maintenance coverage lines
- `--json` output includes a `maintenance` section
- queue preview prints top pending items with Chinese reason labels

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/linkRegistryAuditCli.test.ts`

Expected: FAIL because the CLI does not expose maintenance output yet.

- [ ] **Step 3: Write minimal implementation**

Update the CLI to:
- compute both audit and maintenance views from the same entries
- print a short maintenance summary after the audit summary
- include maintenance data in JSON mode

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/linkRegistryAuditCli.test.ts tests/linkRegistryMaintenance.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/linkRegistryAudit.ts tests/linkRegistryAuditCli.test.ts tests/linkRegistryMaintenance.test.ts
git commit -m "feat: expose link registry maintenance queue in cli"
```

### Task 4: Verify focused registry behavior

**Files:**
- Modify: none expected

- [ ] **Step 1: Run focused tests**

Run: `npm.cmd test -- tests/linkRegistryMaintenance.test.ts tests/linkRegistryAuditCli.test.ts tests/linkRegistryAudit.test.ts tests/linkRegistryStore.test.ts tests/linkRegistryOverrides.test.ts`

Expected: PASS

- [ ] **Step 2: Run build verification**

Run: `npm.cmd run build`

Expected: PASS

- [ ] **Step 3: Inspect final diff**

Run: `git diff -- src/linkRegistry/maintenance.ts src/cli/linkRegistryAudit.ts tests/linkRegistryMaintenance.test.ts tests/linkRegistryAuditCli.test.ts docs/superpowers/plans/2026-06-24-link-registry-maintenance-queue.md`

Expected: only the maintenance-queue changes are present.
