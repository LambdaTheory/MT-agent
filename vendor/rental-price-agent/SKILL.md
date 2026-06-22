---
name: rental-price-agent
description: >
  This skill handles rental platform operations including price adjustment, stock
  management, and SKU modification via Playwright browser automation. It should be
  used when the user wants to change prices, adjust inventory, modify SKUs, or
  perform bulk product operations on a SaaS rental platform that has no API.
  Trigger phrases include "改价", "改价格", "改库存", "改SKU", "调价",
  "批量改价", "修改商品", "更新租赁价格".
agent_created: true
---

# Rental Price Agent

Operate a SaaS rental platform backend via Playwright browser automation to modify
product pricing, inventory, and SKUs. The agent acts as an orchestrator, not a
black-box automator — every modification requires user confirmation before
execution.

## Core Principle

**Mirror data locates; the SaaS detail page verifies.** The agent never trusts
cached or mirrored data for current values. Reading real-time page data is
mandatory before and after every modification.

## Architecture

```
rental-price-agent/
├── SKILL.md                    # This file
├── config.example.json         # Config template (copy to config.json)
├── .env                        # Credentials (not in repo)
├── scripts/
│   ├── playwright-runner.js    # Browser engine (daemon + legacy modes)
│   ├── batch-runner.js         # Multi-product orchestration
│   ├── diff-generator.js       # Change preview with rule validation
│   ├── mirror-search.js        # Mirror API client (search + writeback)
│   ├── task-store.js           # Operation log
│   ├── init.js                 # Environment bootstrap
│   ├── run-tests.sh            # Regression test suite
│   └── lib/
│       ├── config-loader.js    # Shared config + .env loader
│       └── rule-checker.js     # Shared price/stock rule validator
└── references/
    └── process.md              # 15-step process reference
```

## Quick Start

```bash
# First time: check environment and connectivity
node scripts/init.js

# Start daemon (one Chrome process, persistent session)
node scripts/playwright-runner.js daemon start [--port=9223]

# Send commands — three ways:
# A) stdin pipe (Linux/Mac): echo '{"action":"login"}' | node ... daemon send
# B) JSON file (Windows, avoids PowerShell quoting issues):
echo '{"action":"read","productId":"761"}' > cmd.json
node scripts/playwright-runner.js daemon send --file cmd.json
# C) PowerShell Invoke-RestMethod (bypasses all shell issues; token is required):
$token = Get-Content .daemon.token
Invoke-RestMethod -Uri http://127.0.0.1:9223 -Method POST -Headers @{"X-Rental-Agent-Token"=$token} -Body '{"action":"read","productId":"761"}' -ContentType "application/json"

# Stop daemon
node scripts/playwright-runner.js daemon stop
```

All actions below can be sent as JSON commands to the daemon. The daemon
auto-initializes the browser on first command and auto-logins when needed.

### Daemon Actions

| Action | JSON Fields | Description |
|---|---|---|
| `ping` | — | Health check |
| `login` | — | Login to SaaS |
| `read` | `productId`, `fields`? | Read field values from product page. Optional `fields` array to filter. |
| `apply` | `productId`, `changesFile` | Fill form fields from a changes JSON file (navigates to product) |
| `apply-current` | `changesFile` | Fill form fields on current page (no navigation — use after spec changes) |
| `submit` | — | Click save button on current page |
| `navigate` | `productId` | Navigate to product detail page |
| `spec-discover` | `productId` | List all spec dimensions and items |
| `spec-add-item` | `productId`, `specDimId`, `itemTitle` | Add a spec item to a dimension |
| `spec-add-and-refresh` | `productId`, `specDimId`, `itemTitle` | **Atomic**: add item + refresh table + return new values |
| `spec-remove-item` | `productId`, `specDimId` | Remove last spec item from a dimension |
| `spec-add-dim` | `productId`, `itemTitle` | Add a new spec dimension |
| `spec-remove-dim` | `productId`, `specDimId` | Remove a spec dimension |
| `spec-refresh` | `productId` | Click "刷新规格项目表" |
| `tenancy-set` | `productId`, `days` | Set rental periods (e.g. "1,10,30") + return new values |
| `delist` | `productId` | Delist product: search → check → click 下架 → verify |
| `copy` | `productId` | Copy product: search → click 复制 → modal confirm → save → return newProductId |
| `platform-search` | `keyword` | SaaS fallback search: search platform list and return candidate IDs/names/text |
| `batch-read` | `productIds`, `fields`? | Read multiple product detail pages in parallel, max 3 tabs |

### Legacy Single-Invocation Mode

Still supported for simple one-off operations:

```bash
node scripts/playwright-runner.js <action> [args...]
```

| Action | Args | Description |
|---|---|---|
| `login` | — | Login |
| `read` | `<productId>` | Read values |
| `apply` | `<productId>` `<changes.json>` [`--submit`] | Apply + optionally submit |
| `submit` | `<productId>` | Click save |
| `verify` | `<productId>` | Re-read and compare |
| `screenshot` | `<label>` | Take screenshot |

## Spec & Tenancy Management

### Critical Rule: Form-Level Changes

**Spec items and tenancy periods are form-level changes.** They exist only on the
current page until "保存商品" is clicked. Navigating away or calling `read`
(which reloads from server) will lose them.

**Always use atomic actions** that modify structure and return values in one step:

```bash
# Add spec item + refresh + get new values (all on same page)
echo '{"action":"spec-add-and-refresh","productId":"761","specDimId":"1355","itemTitle":"128G"}' | daemon send

# Set tenancy periods + get new values
echo '{"action":"tenancy-set","productId":"761","days":"1,10,30,5"}' | daemon send
```

Both return `{ specs, values }` from the current page state. Use these directly
for diff generation — do NOT call `read` after spec/tenancy changes.

### Spec Workflow

```
spec-add-and-refresh → use returned values → diff → apply+submit
```

### Tenancy Workflow

```
tenancy-set → use returned values → diff → apply+submit
```

## Batch Operations

Multi-product orchestration with preview-first, serial execution.

```bash
node scripts/batch-runner.js <command> [spec.json]
```

| Command | Description |
|---|---|
| `preview <spec>` | Dry run: read all products, generate batch diff with rule checks |
| `execute <spec>` | Real execution: serial queue with progress tracking and verify |
| `resume` | Continue from last checkpoint |
| `status` | Show current batch progress |
| `delayed-verify <state>` | Re-read all products and compare with expected values |
| `report <state>` | Human-readable audit report of a completed batch |
| `rollback <state>` | Preview reverse changes from a batch state file |
| `rollback --confirm <state>` | Execute rollback with post-verify |

### Batch Spec Format

```json
{
  "items": [
    {
      "productId": 761,
      "fields": { "rent1day": "22.00", "rent10day": "55.00" }
    },
    {
      "productId": 762,
      "fields": { "rent1day": "25.00" }
    }
  ],
  "shared": {
    "tenancySet": "1,10,30,端午档期",
    "specAddItems": { "1355": ["128G"] }
  },
  "options": { "stopOnError": true }
}
```

- `items[].fields` — per-product price/stock changes
- `shared.tenancySet` — rental periods applied to ALL products
- `shared.specAddItems` — spec items added to ALL products
- `shared` is optional; each item can extend or override with its own `tenancy`/`spec`
- Item-level setup supports `tenancy.tenancySet`, `spec.specAddItems`, `setup`, `shared`, and `sharedSetup`. Item-level `tenancySet` overrides the global value; item-level `specAddItems` is appended to global `specAddItems` by dimension with de-duplication.
- Batch `preview` is blocked when merged setup contains `tenancySet` or `specAddItems`, because ordinary diff cannot safely represent refreshed form structure yet. The preview CLI exits non-zero when this happens. Do not treat old-structure diff as approval for form-level setup.
- Batch `execute` refuses form-level setup unless `options.confirmFormSetupWithoutPreview` is explicitly `true`. Only set it after the user has explicitly accepted that form setup preview is currently blocked.
- Form-level actions without `productId` must pass `allowCurrentPage: true` and `expectedProductId`; the daemon rejects current-page operations when the URL product id does not match. This applies to `apply-current`, `tenancy-set`, `spec-add-and-refresh`, `spec-refresh`, `spec-remove-item`, and `spec-remove-dim`.
- `read(fields)` returns `partial`/`error` when a requested selector is not configured, the DOM element is missing, or the field cannot be read.

### Batch Execution Flow

```
daemon start
  → login (once)
  → for each product:
      merged setup (global shared + item override tenancy/spec) → read form values → apply → submit → verify
  → report
daemon stop
```

Progress is saved to `tasks/batches/batch_*_state.json`. Failed products are
logged; `resume` skips completed ones.

## Diff Generator

```bash
node scripts/diff-generator.js <currentValues.json> <userChanges.json>
```

Compares current values with user intent, applies business rules from
`config.json`:
- Price min/max bounds
- Max change percentage (warn)
- Stock non-negative (error)

Output: diff table with old/new/change/percentage + rule violation flags.
Saves `tasks/changes_<timestamp>.json` for the apply step.

## Task Store

```bash
node scripts/task-store.js <action> [args...]
```

| Action | Description |
|---|---|
| `create <instruction> <changesFile>` | New task (status: planned) |
| `update <taskId> <field> <value>` | Update status/results |
| `add-evidence <taskId> <type> <path>` | Attach screenshot/log |
| `list [status]` | List tasks |
| `get <taskId>` | Full task details |

## Standard Workflow (Single Product)

```
1. daemon start
2. login
3. read <productId>                    → current.json
4. [optional] spec-add-and-refresh     → modify structure, get new values
5. [optional] tenancy-set             → modify periods, get new values
6. diff-generator current.json changes.json  → preview
7. Show diff table to user → WAIT FOR CONFIRMATION
8. apply <productId> changes.json --submit   → fill + save (atomic)
9. verify <productId>                  → confirm saved values
10. task-store create/update            → log operation
11. daemon stop
```

## Standard Workflow (Batch)

```
1. daemon start
2. batch-runner.js preview spec.json   → show all diffs
3. User confirms entire batch
4. batch-runner.js execute spec.json   → serial queue
5. batch-runner.js status              → check progress
6. Wait 5 minutes (platform cache delay)
7. batch-runner.js delayed-verify <state> → confirm all changes persisted
8. mirror-search.js writeback-state <state> → update mirror DB only after delayed verification passes
9. daemon stop
```

## Error Handling

- **Login failure**: Retry once. If persistent, report and stop.
- **Selector not found**: Report field name. Ask user for updated selector. Missing selectors count as apply failures, not skipped fields.
- **Read failure**: If `read` returns no specs/values, treat it as `error`; preview must surface an error diff instead of an empty diff. If explicit `fields` are requested and selectors are missing, return `partial` or `error` with structured warnings/missingFields.
- **Apply failure**: Stop before submit. Never save a page when `apply` / `apply-current` returns `partial` or `error`.
- **Form-level setup failure**: `tenancy-set` and `spec-add-and-refresh` must pass all internal checks before apply. Missing popup/table/inputs, failed refresh, missing added spec item, empty refreshed spec rows, or a refreshed spec table that does not include the added item is fatal. When multiple form-level setup steps run in one product flow, only the first step may navigate by productId; subsequent steps must stay on the current unsaved form page.
- **Submit failure**: If `submit` returns `error`, stop and mark the product failed. If it returns `unknown`, continue readback verification but keep a warning in the result.
- **Verify mismatch**: Report expected vs actual per field. Let user decide. Missing readback values count as `verify_failed`; `verifyFailed` items must be handled manually or rolled back; delayed verify does not automatically promote them to success.
- **Copy without new ID**: Treat as `unknown` with `sideEffectPossible: true` and `retrySafe: false`. Do not automatically retry because the copied product may already have been created.
- **Batch-read missing selector**: If the caller explicitly requests fields and a selector is not configured, return `partial` with warnings/missingFields instead of silently omitting the field.
- **Delist failure**: Treat missing confirmation or product still visible after delist as `error`. 下架 is high-risk and must not be considered successful unless the confirmation dialog was actually confirmed and post-check passes.
- **Batch partial failure**: Failed products logged in state file. `resume` to retry. With `stopOnError`, state remains `stopped` instead of being overwritten to `partial`. Resume writes `resumedTo` on the original state and `resumeFrom` on the new state for audit chaining.

## Task States

```
planned → confirmed → submitted → verified
              ↓            ↓          ↓
           cancelled   submit_failed  verify_failed
```

## When Mirror DB Is Available

- Query mirror by keyword → get product ID list
- Multi-match → present selection table
- After delayed verify passes → writeback confirmed values with `source: "saas_verify"` + timestamp

## Mirror-Miss Platform Fallback

If mirror search returns **zero** results, use the SaaS platform as the fallback truth source:

1. `platform-search` with the same keyword to get candidate rows from the platform list page.
2. Exclude search results that match the protected-product filters below.
3. Let the agent/user choose matching product IDs from returned `id`, `name`, and row `text`.
4. Call `batch-read` with those IDs to read real-time detail values directly from SaaS pages.
5. Build the normal batch spec from `batch-read.results` and continue with preview → user confirmation → execute.

### Protected-Product Search Filters

After mirror search or platform fallback search, automatically exclude:

- Link products whose rental/list price is `0.01` or `0.1`. These are treated as links/placeholders, not normal rentable products.
- Products whose product name starts with `MQ` (case-insensitive). For platform fallback, row text may also be used when the list row exposes the product name directly. These are maintained by a dedicated owner and must not enter generated batch specs.

Filtered products are returned in `excluded` with a reason such as `link-price` or `mq-maintained`; do not silently re-add them unless the user explicitly overrides the rule.

Notes:
- Do not trigger fallback for "possibly incomplete" mirror results. Only fallback when mirror returns zero results.
- `batch-read` intentionally limits concurrency to 3 tabs to avoid stressing the platform.
- Platform list search is only a coarse locator; final values must come from detail pages via `batch-read`/`read`.
