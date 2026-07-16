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
product pricing, inventory, and SKUs. Act as an orchestrator, not a black-box
automator. Show preview evidence and get explicit operator confirmation before
proceeding with previewable changes. Do not claim a universal execute token or
artifact for every modification, because only form setup and image paths have
explicit execution flags.

Run lifecycle operations as explicit release control, not as part of ordinary
SaaS mutation work. Keep onboarding details in `README.md`. Keep recovery tables,
error-code responses, and release packaging details in `references/process.md`.

## Core Principle

**Mirror data locates; the SaaS detail page verifies.** The agent never trusts
cached or mirrored data for current values. Reading real-time page data is
mandatory before and after every modification.

## Lifecycle Guardrails

Use the lifecycle CLI only when operating the packaged skill release.

- Run `node scripts/init.js --target <absolute-skill-target>` first. Treat it as a read-only summary. Do not claim that it installs dependencies, copies config, or creates local mutable files.
- If `init` runs without `--target`, treat it only as a current-skill diagnostic. Do not present omission as install-target inference.
- Require exact lifecycle inputs: absolute `--target`, exact `--repo lcc0628/rental-price-agent`, explicit `--tag vX.Y.Z`, explicit `--browser chrome|chromium`.
- Treat `chrome` as system Chrome and `chromium` as the Playwright-managed browser. Do not claim silent fallback. The release contract defaults to `allowFallback=false`.
- Distinguish skill, daemon, protocol, config schema, and state schema versions. Do not collapse them into one “version”.
- Treat `restartRequired` as a hard write boundary. Allow safe reads only. Tell the operator to restart OpenCode manually. Do not promise auto restart.
- Distinguish release rollback from SaaS product or batch rollback. Use `node scripts/lifecycle.js rollback ...` only for release activation rollback. Use `batch-runner.js rollback` for product-level reversions.
- Treat `scripts/lib/target-migration.json` as declarative migration contract v2. Do not describe it as executable code, and do not claim that target release code executes during migration.
- State that managed recovery documents are schema-less JSON, validated only as broadcast or per-spec structures, preserved byte-for-byte across upgrade and rollback, and not reverse-migrated.
- Assume forward migrations only. Do not claim reverse migration support.
- Assume only one retained previous release slot.
- State the trust boundary clearly: exact Gitee Release assets are required, and checksum validation does not protect against a compromised Gitee account.
- Build release assets only with `node scripts/build-release.js --verify --output "<absolute-temp-dir>"`. Keep the output outside the Skill tree; never create a tag, push, or publish automatically.

## Lifecycle Workflow

Follow this order:

1. Run `node scripts/lifecycle.js status --target <absolute-skill-target>`.
2. Run `node scripts/lifecycle.js doctor --target <absolute-skill-target>`.
3. Run `install` only for a missing, empty, or recognized legacy target.
4. Run `upgrade` only to a newer release on the same volume after doctor passes and unresolved daemon/task state is cleared.
5. Run `rollback --dry-run` first.
6. Run `rollback --confirm <version@digest>` only with the exact dry-run token.
7. Re-run `doctor` after restart on the newly loaded release.

## Architecture

```text
<absolute-skill-target>\               release-owned tree
  SKILL.md
  README.md
  config.example.json
  package.json
  package-lock.json
  release-manifest.json
  scripts\
  references\
<sibling-data-root>\                   mutable data root
  config.json
  .env
  browser-profile\
  browser-cache\
  tasks\
  daemon\
    identity.json
    daemon.pid
    daemon.port
    daemon.token
  install-receipt.json
  lifecycle.lock
  lifecycle-journal.json
  restart-required.json
```

## Quick Start

```bash
# First time: check one explicit release target
node scripts/init.js --target "<absolute-skill-target>"

# Start daemon (one Chrome process, persistent session)
node scripts/playwright-runner.js daemon start [--port=9223]

# Prefer daemon send for ordinary operations.
# A) stdin pipe (Linux/Mac): echo '{"action":"login"}' | node ... daemon send
# B) JSON file (Windows, avoids PowerShell quoting issues):
echo '{"action":"read","productId":"761"}' > cmd.json
node scripts/playwright-runner.js daemon send --file cmd.json
# C) PowerShell Invoke-RestMethod for advanced diagnostics only. Compute the sibling data root from target first:
$target = "<absolute-skill-target>"
$dataRoot = Join-Path (Split-Path -Parent $target) ("." + (Split-Path -Leaf $target) + "-data")
$token = Get-Content (Join-Path $dataRoot "daemon\daemon.token")
Invoke-RestMethod -Uri http://127.0.0.1:9223 -Method POST -Headers @{"X-Rental-Agent-Token"=$token} -Body '{"action":"read","productId":"761"}' -ContentType "application/json"

# Stop daemon
node scripts/playwright-runner.js daemon stop
```

All actions below can be sent as JSON commands to the daemon. The daemon
auto-initializes the browser on first command and auto-logins when needed.

If `init` is ever run without `--target`, treat it as a current-skill diagnostic only. Do not use it to imply an install target.

### Daemon Actions

| Action | JSON Fields | Description |
|---|---|---|
| `ping` | — | Health check |
| `login` | — | Login to SaaS |
| `read` | `productId`, `fields`? | Read field values from product page. Optional `fields` array to filter. |
| `apply` | `productId`, `changesFile` | Fill form fields from a changes JSON file (navigates to product) |
| `apply-current` | `changesFile`, `allowCurrentPage=true`, `expectedProductId` | Fill form fields on the current protected page without navigation (use after spec changes) |
| `submit` | `expectedProductId` | Click save button on current page after confirming the page product ID |
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
| `image-read` | `productId` | Read current product image URLs, white image URL, and current order |
| `image-upload` | `productId`, `sectionType`, `categoryName`, `uploadFile`, `confirmSelection`?, `allowDuplicateFileName`? | Upload one local file into the material library, then optionally confirm it back into the current product form |
| `image-pick` | `productId`, `categoryName`, `fileNames`, `skipIfAlreadyPresent`? | Open image library, select one or more existing materials by exact file name, confirm, and verify `thumbs[]` URL writeback |
| `image-order` | `productId`, `orderedUrls` | Reorder current product images by exact URL list and verify `thumbs[]` order |
| `white-image-set` | `productId`, `categoryName`, `fileName`, `skipIfWhiteImageMatched`? | Open white-image library, select one exact material by file name, confirm, and verify `white_ground_image` URL writeback |
| `image-verify` | `productId`, `expectedImages` | Verify saved image state (`thumbs[]`, first thumbnail, white image) against expected URLs |
| `vas-read` | `productId` or `allowCurrentPage`, `expectedProductId` | Read VAS enabled radio, checked platforms, and ordered service hidden inputs |
| `vas-catalog-read` | `productId`, `ids`?, `keyword`? | POST configured catalog endpoint and return normalized existing services; optional ID filtering |
| `vas-apply` | `expectedVAS`, current-page protection fields | Apply one complete target VAS state on the current form without submitting |
| `vas-verify` | `productId`, `expectedVAS` | Re-read the product and compare enabled/platform set/ordered services |
| `discard-current-form` | `expectedProductId` | Validate the current product, navigate it again, and discard all unsaved form DOM changes |

### Legacy Single-Invocation Mode

Still supported for simple one-off operations:

```bash
node scripts/playwright-runner.js <action> [args...]
```

| Action | Args | Description |
|---|---|---|
| `login` | — | Login |
| `read` | `<productId>` | Read values |
| `image-read` | `<productId>` | Read current product image state |
| `apply` | `<productId>` `<changes.json>` [`--submit`] | Apply + optionally submit; `--submit` runs only when apply status is `ok` |
| `submit` | `<productId>` | Click save |
| `verify` | `<productId>` `<changes.json>` | Re-read and compare against the expected changes file |
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
| `delayed-verify <state>` | Re-read all products and compare with expected field values and persisted image state (`thumbs`, first thumbnail, white image) |
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
    }
  ],
  "shared": {
    "tenancySet": "1,10,30,端午档期",
    "specAddItems": { "1355": ["128G"] }
  },
  "options": { "stopOnError": true }
}
```

VAS is a sibling of `fields` and `images`:

```json
{
  "items": [
    {
      "productId": 761,
      "vas": {
        "enabled": true,
        "platforms": ["wechat", "h5"],
        "services": {
          "set": [
            { "id": "1", "defaultSelected": true, "isForce": false, "isPopup": false }
          ]
        }
      }
    }
  ]
}
```

- `items[].fields` — per-product price/stock changes
- `items[].vas` — formal per-product VAS field; `valueAddedServices` is accepted only as a compatibility alias.
  - Services are located only by unique `id`; names are never keys because duplicate names exist.
  - `services.set` is a complete ordered snapshot. `services.upsert + remove` is an idempotent patch. Set and patch modes are mutually exclusive.
  - `platforms` is an exact set replacement when present. Service order remains significant.
  - Closing VAS preserves platforms/services unless `services.set: []` explicitly clears services.
  - At most one service may use `isPopup=true`. `isForce=true` requires `defaultSelected=true` and `isPopup=false`; omitted `defaultSelected` is inferred as true, explicit false is an error.
  - `expectedName`/`expectedMoney` may guard an ID against catalog drift and mismatches block execution.
- `items[].images` — per-product image operations. Supports:
  - `upload: { sectionType, categoryName, uploadFile, confirmSelection?, allowDuplicateFileName? }` for uploading one local file into the material library and optionally confirming it into the form immediately
  - `pick: { categoryName, fileNames[], skipIfAlreadyPresent? }` for appending existing product images by exact file name
  - `thumbnailFileName` for setting one current-page image as first thumbnail after pick/upload
  - `orderedUrls[]` for exact image order control (cannot be combined with `thumbnailFileName`)
  - `whiteImage: { categoryName, fileName, skipIfWhiteImageMatched? }` for white-image selection
- Image operations now prefer material-library search by file name and fall back to pagination scan when search controls are unavailable or miss the target.
- After `execute`, image plans run immediate `image-verify` automatically; `delayed-verify <state>` re-checks persisted `thumbs[]`, first thumbnail, and `white_ground_image` against the execution snapshot.
- Fail closed in `delayed-verify`: automatic readback covers only supported field, image, and VAS scopes. Treat read error, missing values, zero executed checks for declared expected fields, setup-only tenancy/spec flows without structural readback, missing or malformed applicable image/VAS verification blocks, and image/VAS `verifyResult` counts that are missing, nonnumeric, negative, or internally inconsistent as failures.
- `upload` writes the asset into the material library before the product form is finally submitted. If a later product `submit` fails, the uploaded material is not rolled back, so validation runs must keep file names unique unless duplicates are intentionally allowed.
- `shared.tenancySet` — rental periods applied to ALL products
- `shared.specAddItems` — spec items added to ALL products
- Batch size is enforced by `config.rules.maxBatchSize` when configured.
- `shared` is optional; each item can extend or override with its own `tenancy`/`spec`
- Item-level setup supports `tenancy.tenancySet`, `spec.specAddItems`, `setup`, `shared`, and `sharedSetup`. Item-level `tenancySet` overrides the global value; item-level `specAddItems` is appended to global `specAddItems` by dimension with de-duplication.
- Reject no-op batch items. Count shared setup as an effective operation even when the item has no direct field delta.
- Batch `preview` is blocked when merged setup contains `tenancySet` or `specAddItems`, because ordinary diff cannot safely represent refreshed form structure yet. The preview CLI exits non-zero when this happens. Do not treat old-structure diff as approval for form-level setup.
- Batch `preview` is also blocked for any `items[].images` plan, because material selection and URL writeback can only be verified on the live form page. A VAS plan on the same item is still genuinely read, catalog-resolved, validated, and diffed.
- VAS never has a `confirmVASWithoutPreview` bypass. Preview errors block execution.
- VAS execution order is `vas-read → vas-catalog-read → build target/validate → vas-apply`, after image operations and before the single product submit. Submit is followed by `vas-verify`.
- `skipSubmit=true` stores before/expected/apply preview evidence and then calls `discard-current-form` after any setup/image/VAS/form DOM change, so the reusable daemon page is not polluted. Such entries are stored as `previewOnly`, not `completed`; they never enter delayed verification, rollback, or mirror writeback.
- Delayed verification uses the complete `vasExpected` stored during execution. Rollback uses the complete `vasBefore` snapshot and considers committed `completed` plus `verifyFailed` entries, never `previewOnly`. Execute rollback preview and rollback confirm only for candidates that contain field or VAS restore data. This is field/VAS rollback with preview plus explicit confirm, not a broad one-click rollback. Fail when none remain after filtering. Require nonzero field verification or strict VAS evidence. Do not report unsupported-only candidates as `0/0` success. Image/spec/tenancy rollback is not implemented and remains unsupported.
- Batch `execute` refuses form-level setup unless `options.confirmFormSetupWithoutPreview` is explicitly `true`. Only set it after the user has explicitly accepted that form setup preview is currently blocked.
- Batch `execute` refuses image operations unless `options.confirmImageWithoutPreview` is explicitly `true`.
- Form-level actions without `productId` must pass `allowCurrentPage: true` and `expectedProductId`; the daemon rejects current-page operations when the URL product id does not match. This applies to `apply-current`, `tenancy-set`, `spec-add-and-refresh`, `spec-refresh`, `spec-remove-item`, and `spec-remove-dim`.
- After any image or VAS navigation reaches the target product, validate the canonical current page again before mutating DOM state.
- Require `expectedProductId` for daemon-mode `submit` as well. Validate a canonical current product page before clicking save: positive integer product ID, expected origin/path, `r=goods.edit`, and `id=<expectedProductId>` must all match.
- Arm the submit response observer immediately before click. Ignore pre-click responses. Disarm and clean up the observer on completion.
- Lock the observer to the first click-associated matching save request identity. Ignore later distinct matching save requests. Only the captured request's own pending body may fail closed to `unknown` on timeout.
- Run submit click in two stages: scroll/preflight `trial` while the observer is disarmed, then arm the observer and immediately dispatch `force`.
- Return immediate `ok` only for explicit matched AJAX business success. Treat redirect, URL change, toast-only, 3xx, empty response, and unfamiliar response as `unknown` and require readback.
- Use the short grace window only to wait for the captured request's final body or complete cleanup; do not merge later distinct requests back into the outcome.
- Normalize malformed, non-object, or missing-status daemon submit results to `unknown` and preserve only a bounded raw preview.
- Parse submit payloads with bounded recursive failure-first JSON inspection. Any explicit failure nested under `result` or `data` overrides top-level success. Never accept success from a truncated JSON preview alone; if truncation prevents a full decision and no explicit failure was already found, return `unknown`.
- Accept repository-backed `status=1` / `code=1` as business success. Do not accept bare `code=0` or `code=200`. Let nested failure text dominate.
- Redact sensitive URL query values before persisting submit evidence previews to batch state or reports. Apply the same protection to sensitive keys after camelCase and separator normalization. Never persist request bodies, headers, or cookies.
- Treat `trial` failure as pre-dispatch and allow at most one retry. Treat `force` timeout as dispatch-ambiguous: return `unknown` with `submitted=null`, `sideEffectPossible=true`, and `retrySafe=false`, with no automatic retry.
- If submit transport throws after the `submitting` checkpoint, mark the item `recovery_required` / `verify_failed`, keep `sideEffectPossible=true`, and block automatic re-submit.
- Resolve batch-level `unknown` only when at least one applicable readback verification succeeds and no verification check fails. Preserve the raw submit audit status even when the final batch result is resolved as successful.
- Persist a per-product `submitting` checkpoint before submit command dispatch and a `submitted` checkpoint after the submit response arrives. Block automatic re-submit on `resume` for `submitting`, `submitted`, `recovery_required`, or manually gated products. Mark the original state `recovery_required` whenever recovery is created, even if other items still remain. Apply final batch status priority with `recovery_required` highest. Do not auto-promote `verifyFailed` or `recovery_required` entries during delayed verification, and do not set `delayed_verified` while unresolved entries remain. Keep unresolved counts plus raw submit status, bounded response evidence, and readback resolution visible in audit output.
- `read(fields)` returns `partial`/`error` when a requested selector is not configured, the DOM element is missing, or the field cannot be read.
- **Dynamic rent field discovery**: Rent period fields (e.g. `rent1day`, `rent10day`, `rent30day`, `rent180day`, or any custom period like `rent45day`) are NOT hardcoded in `config.json`. Instead, `config.selectors.product._dynamicFields.rentDays` defines a scan pattern that discovers all `input.option_rent{N}day_{specId}` inputs present on the page at runtime. When `read` is called without explicit `fields`, all available rent periods are auto-discovered per spec and read. When `apply` receives a `rent{N}day` field, the selector is generated from the template. This means `tenancy-set` can add new periods and they become readable/writable immediately after `spec-refresh` without any config changes.
- Mirror writeback maps flat `rent{N}day` fields dynamically. Reject the entire item if any flat rent field cannot be mapped. Leave nested per-SKU writeback explicitly unsupported and skipped.

### Batch Execution Flow

```
daemon start
  → login (once)
  → for each product:
      merged setup (global shared + item override tenancy/spec) → read form values → apply → submit → verify
  → report
daemon stop
```

Progress is saved to `tasks/batches/batch_*_state.json`. Persist a `submitting`
checkpoint per product before submit command dispatch and a `submitted`
checkpoint after the submit response. Write state atomically in the same
directory. Log failed or manually gated products. Skip completed ones on
`resume`, block automatic re-submit for `submitting` / `submitted` /
`recovery_required` entries until manual verification or recovery resolves
them, and preserve parent resumed terminal linkage to prevent replaying the old
state.

Expose delayed domain counts per product and unresolved entry counts in summary
and report output. Count `submitting` / `submitted` in-flight entries as
unresolved without double-counting. Do not mark the batch `delayed_verified`
while unresolved entries still exist.

Reject duplicate or invalid product IDs before execution starts.

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

Task-store lifecycle is separate from batch-state lifecycle. Use task-store for
permissive single-operation logging and evidence; do not assume strict
transition validation there. Use batch-state files for enforced batch control
flow and recovery. Batch states include `running`, `stopped`, `partial`,
`completed`, `completed_with_mismatch`, `recovery_required`, `resumed`,
`delayed_verified`, and `delayed_verify_partial`.

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
9. verify <productId> <changes.json>   → confirm saved values against the expected changes file
10. task-store create/update            → log operation
11. daemon stop
```

## Standard Workflow (Batch)

```
1. daemon start
2. batch-runner.js preview spec.json   → show all diffs
3. Agent/operator reviews the preview and records explicit confirmation before execute; do not claim a code-enforced universal confirmation artifact beyond the explicit setup/image flags
4. batch-runner.js execute spec.json   → serial queue
5. batch-runner.js status              → check progress
6. Wait for the platform cache / persistence window if needed
7. Manually run batch-runner.js delayed-verify <state> → confirm all changes persisted
8. mirror-search.js writeback-state <state> → update mirror DB only after delayed verification passes
9. daemon stop
```

## VAS Safety Boundary

VAS v1 only binds existing catalog services to a product. It must not expose or call service-library create/update/delete flows, including `incrementAdd` and `incrementDel`. VAS plan booleans must be JSON booleans; `platforms` and `services.set/upsert/remove` must be arrays. Type coercion is forbidden and invalid plan types block before apply. `vas-read` treats missing VAS controls or no checked enabled radio as an error. `vas-apply` accepts a complete `expectedVAS` state, calls the page-native `window.addGoodsIncrement` to rebuild the product binding DOM, applies options in default → popup → force order, reads hidden inputs back, and never submits by itself. `vas-verify` also requires a complete validated target state.

## Daemon Identity and OpenCode Restart

Validate the canonical daemon identity in the sibling data root before reuse, stop, or cleanup. Require the recorded Windows process creation identity, authenticated hello instance and release identity, version metadata, and token fingerprint to agree. Never terminate a PID from PID/port files alone, and never terminate a live process whose creation identity does not match.

Treat `restart-required.json` as an explicit user restart boundary after install or release activation. Preserve diagnostics and safe reads, but return `SESSION_RESTART_REQUIRED` before browser startup or handler dispatch for mutations and lifecycle control from a pre-activation process. Allow only a newly loaded matching release to clear the marker after doctor validation and a compatible daemon hello, or after proving that no daemon exists. Instruct the user to restart OpenCode manually; never promise, invoke, or simulate an automatic OpenCode restart.

## Error Handling

- **Login failure**: Retry once. If persistent, report and stop.
- **Lifecycle cleanup requires human recovery**: Surface `DAEMON_RECOVERY_REQUIRED` when daemon identity files exist but a live process cannot be safely reused or cleaned. Do not guess. Tell the operator to recover or stop the daemon first.
- **Lock release failures**: Surface `LIFECYCLE_LOCK_RELEASE_FAILED`, `MIGRATION_LOCK_RELEASE_FAILED`, and `DAEMON_STOP_LOCK_RELEASE_FAILED` as recovery-required lifecycle failures. Do not claim the lock state is clean after these codes.
- **Selector not found**: Report field name. Ask user for updated selector. Missing selectors count as apply failures, not skipped fields.
- **Read failure**: If `read` returns no specs/values, treat it as `error`; preview must surface an error diff instead of an empty diff. If explicit `fields` are requested and selectors are missing, return `partial` or `error` with structured warnings/missingFields.
- **Apply failure**: Stop before submit. Never save a page when `apply` / `apply-current` returns `partial` or `error`.
- **Form-level setup failure**: `tenancy-set` and `spec-add-and-refresh` must pass all internal checks before apply. Missing popup/table/inputs, failed refresh, missing added spec item, empty refreshed spec rows, or a refreshed spec table that does not include the added item is fatal. When multiple form-level setup steps run in one product flow, only the first step may navigate by productId; subsequent steps must stay on the current unsaved form page.
- **Submit failure**: If `submit` returns `error`, stop and mark the product failed. If it returns `unknown`, treat it as side-effect-possible, do not auto-retry, continue readback verification, and keep the raw warning in the result. If the unknown came from click timeout, treat it as dispatch-ambiguous with `submitted=null`. Retry only when the failure is proven pre-dispatch.
- **Verify mismatch**: Report expected vs actual per field. Let user decide. Missing readback values count as `verify_failed`; `verifyFailed` items must be handled manually or rolled back; immediate field verification with expected changes but zero executed checks also fails closed; immediate image/VAS verification also requires strict nonzero exact counts; delayed verify does not automatically promote them to success.
- **Delayed verification failure**: Automatic readback covers only supported field/image/VAS scopes. Fail closed on read error, no values, declared expected fields with zero executed checks, setup-only tenancy/spec zero-check cases before structural readback exists, delayed applicable image/VAS `0/0` counts, missing/malformed applicable image or VAS verification data, or image/VAS `verifyResult` counts that are not non-negative integers or do not satisfy `total = matched + mismatched`.
- **Rollback constraints**: Allow rollback only for candidates with field or VAS restore payloads. Exclude unsupported image/spec/tenancy-only candidates. Fail when no supported candidate remains, and require nonzero field verification or strict VAS evidence.
- **Legacy apply --submit**: Allow the submit phase only when apply status is `ok`. If nested submit returns `error` or `unknown`, propagate that status to the top level and preserve `sideEffectPossible` / `retrySafe`.
- **Legacy verify**: Accept both flat and nested spec-specific change files. Fail cleanly on read failure, no values, missing specs, or missing fields.
- **Copy without new ID**: Treat as `unknown` with `sideEffectPossible: true` and `retrySafe: false`. Do not automatically retry because the copied product may already have been created.
- **Batch-read missing selector**: If the caller explicitly requests fields and a selector is not configured, return `partial` with warnings/missingFields instead of silently omitting the field.
- **Delist failure**: Treat missing confirmation or product still visible after delist as `error`. 下架 is high-risk and must not be considered successful unless the confirmation dialog was actually confirmed and post-check passes.
- **Batch partial failure**: Failed products logged in state file. `resume` to retry. With `stopOnError`, state remains `stopped` instead of being overwritten to `partial`. Resume writes `resumedTo` on the original state and `resumeFrom` on the new state for audit chaining.

## Verification Commands

- `node scripts/run-unit-tests.js`
- `node scripts/run-lifecycle-tests.js --offline --forbid-saas --case documentation-contract`
- `node --check scripts/playwright-runner.js`
- `node --check scripts/batch-runner.js`
- `node --check scripts/mirror-search.js`

## Current Remaining Limitations

- Automatic readback covers only supported field/image/VAS scopes. Setup-only tenancy/spec modifications still lack dedicated post-submit structural readback, and delayed verification stays fail-closed when that structure check is unavailable.
- `skipSubmit` + image upload can leave material-library side effects, and cleanup after early returns is not universally guaranteed.
- Live product 653 still must capture the exact submit POST URL, status, content-type, and body before declaring the issue fully closed.

## Task States

```
planned → confirmed → submitted → verified
              ↓            ↓          ↓
           cancelled   submit_failed  verify_failed
```

## When Mirror DB Is Available

- Query mirror by keyword → get product ID list
- Multi-match → present selection table
- After delayed verify passes → perform guarded writeback of confirmed values with `source: "saas_verify"` and the delayed-verification `verified_at` timestamp. Require a valid `delayedVerify.at`; reject missing or invalid timestamps and never substitute current time. Do not assume mirror conflict timestamp checks or task-store writeback history are implemented.

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
