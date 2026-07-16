# Process Reference — 15-Step Price Modification Workflow

This document is the authoritative reference for each step of the operational
workflow. The agent follows this process for every modification task.

## Data Source Rules

| Source | Used For | Cannot Be Used For |
|---|---|---|
| Mirror DB | Product search, ID lookup, candidate display | Current price/stock values, final verification |
| SaaS detail page | Reading real-time values, pre-modification baseline, post-modification verification | Product discovery (search is unreliable) |

## Release Lifecycle Operator Contract

Use this section for release installation, upgrade, rollback, and recovery. Keep it separate from SaaS product operations.

### Scope and prerequisites

- Run lifecycle install, upgrade, and rollback on Windows only.
- Keep Node within `>=18.0.0 <25.0.0`.
- Pass an explicit absolute `--target`. Treat `--target` as the release directory.
- Accept only `--repo lcc0628/rental-price-agent`.
- Accept only explicit immutable `v<semver>` tags.
- Treat `chrome` as system Chrome and `chromium` as Playwright-managed Chromium.
- Do not claim fallback unless the active browser policy explicitly allows it. The current release contract sets `allowFallback=false`.

### Version distinctions

Track these independently:

- Skill version: packaged skill release version
- Daemon version: daemon implementation version
- Protocol version: daemon negotiation and hello contract version
- Config schema version: `config.json.configSchemaVersion`
- State schema version: persisted task, batch, recovery schema version

Use `doctor` and the install receipt to compare them. Do not collapse them into one generic “version”.

### Data root layout and ownership

Given `--target <absolute-skill-target>`, the mutable sibling data root is `<sibling-data-root>`.

```text
<absolute-skill-target>\          release-owned tree
  README.md
  SKILL.md
  config.example.json
  package.json
  package-lock.json
  release-manifest.json
  scripts\
  references\
<sibling-data-root>\
  config.json
  .env
  browser-profile\
  browser-cache\
  tasks\
    _index.json
    batches\
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

Ownership rules:

- Keep release-owned files inside `--target` only.
- Keep mutable files inside the sibling data root only.
- Reject symlink, junction, and cross-volume activation paths.
- Do not discover or copy mutable files from arbitrary local folders.

### Lifecycle commands

```bash
node scripts/init.js --target "<absolute-skill-target>"
node scripts/lifecycle.js status --target "<absolute-skill-target>"
node scripts/lifecycle.js doctor --target "<absolute-skill-target>"
node scripts/lifecycle.js install --target "<absolute-skill-target>" --repo lcc0628/rental-price-agent --tag v1.0.0 --browser chrome
node scripts/lifecycle.js upgrade --target "<absolute-skill-target>" --repo lcc0628/rental-price-agent --tag v1.0.1 --browser chrome
node scripts/lifecycle.js rollback --target "<absolute-skill-target>" --dry-run
node scripts/lifecycle.js rollback --target "<absolute-skill-target>" --confirm v1.0.0@0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

If `init` runs without `--target`, it inspects the current skill directory only. Treat that as a local packaging diagnostic, not install-target inference.

Command meanings:

- `init`: run a read-only doctor summary, create nothing
- `status`: report current target, data root, receipt, versions, daemon identity, `restartRequired`
- `doctor`: compute `readyForReads`, `readyForWrites`, blockers, warnings, and fail nonzero on any failed check
- `install`: stage a release, prepare mutable data, migrate forward, activate, write receipt and restart marker
- `upgrade`: stop the validated daemon, stage same-volume release activation, keep one previous slot, write restart marker
- `rollback`: preview by default, activate only after exact `version@digest` confirmation

### restartRequired, daemon compatibility, and write blocking

- Treat `restart-required.json` as a hard post-activation boundary.
- Allow safe reads to continue from an old OpenCode session when protocol-compatible.
- Block lifecycle control and mutations from a pre-activation session with `SESSION_RESTART_REQUIRED`.
- Require a manual OpenCode restart. Never promise or simulate auto restart.
- Validate daemon compatibility with hello metadata, authenticated token, instance identity, release hash, and version ranges before reuse or stop.

### Migration policy

- Load only the verified staged release `scripts/lib/target-migration.json`. Treat it as declarative migration contract v2. No target code executes during migration.
- Distinguish target readable schema ranges from declared migratable source ranges. Run declarative steps only against the operation-owned temporary JSON snapshot, then commit migrated config, task index, task, batch, and recovery JSON in the same journaled transaction as code activation; restore both code and original data bytes on failure.
- Validate recovery documents as schema-less JSON only. Accept the broadcast or per-spec shapes, preserve recovery files byte-for-byte across upgrade and rollback, and do not reverse-migrate them.
- Never include `.env`, browser profile/cache, evidence, daemon identity, or unrelated mutable data in the migration snapshot or data transaction.
- Do not run reverse migrations during rollback.
- Block rollback when current mutable schemas are outside the previous release readable range.

### Journal, recovery, and retained previous slot

- Keep one lifecycle journal at `<dataRoot>\lifecycle-journal.json`.
- Treat lifecycle recovery as part of the next lifecycle command. Recover first, then continue or fail closed.
- Keep at most one retained previous release at `<target>.previous`.
- Treat release rollback as switching active release trees. Do not confuse it with SaaS field rollback or batch rollback.

### Common lifecycle codes and operator response

| Code | Meaning | Operator response |
|---|---|---|
| `INVALID_INSTALL_TARGET` | Missing, relative, unsafe, or root target path | Fix `--target`; use an absolute Windows path |
| `INVALID_RELEASE_REPOSITORY` | Repo is not `lcc0628/rental-price-agent` | Correct `--repo`; do not bypass |
| `INVALID_RELEASE_TAG` | Tag is not explicit `v<semver>` | Use an exact release tag |
| `UNSUPPORTED_NODE` | Node version outside contract | Switch Node, rerun `doctor` |
| `RESTART_REQUIRED` | New release loaded but current OpenCode session is stale | Restart OpenCode manually, rerun `doctor` |
| `DAEMON_RECOVERY_REQUIRED` | Daemon identity files exist but the live daemon cannot be safely reused or cleaned | Recover or stop the daemon before retrying lifecycle control |
| `UNRESOLVED_OPERATIONS` | Task, batch, or recovery state is still pending | Resolve or clean the mutable state before `upgrade` |
| `RELEASE_TREE_DRIFT` | Release-owned files changed after install | Inspect drift; reinstall or repair before continuing |
| `DEPENDENCY_LOCK_DRIFT` | `package-lock.json` no longer matches receipt | Restore the release-owned tree; do not mutate in place |
| `LIFECYCLE_LOCKED` or `LIFECYCLE_LOCK_PRESENT` | Another lifecycle operation owns the target | Wait, clear stale lock through recovery, then rerun |
| `LIFECYCLE_LOCK_RELEASE_FAILED` | Install, upgrade, or rollback finished work but could not release its owned lifecycle lock | Treat the target as recovery-required until lock ownership is verified and cleared |
| `MIGRATION_LOCK_RELEASE_FAILED` | Declarative migration finished work but could not release its owned migration lock | Treat mutable data as recovery-required until lock ownership is verified and cleared |
| `DAEMON_STOP_LOCK_RELEASE_FAILED` | Validated daemon stop reached a terminal outcome but could not release its stop lock | Treat daemon control as recovery-required until lock ownership is verified and cleared |
| `ROLLBACK_SCHEMA_INCOMPATIBLE` | Current mutable data cannot be read by the previous release | Stay on current release or migrate forward manually; no reverse migration exists |

### Release trust boundary

- Trust only explicit Gitee Release assets for the exact owner, repo, and tag.
- Require the deterministic asset trio: archive, manifest, checksum.
- Keep all redirects on HTTPS Gitee hosts in production.
- Remember: checksum validation proves asset consistency, not Gitee account integrity.

### Manual release preparation and upload

Build twice, validate the archive with the lifecycle parser, and self-install through loopback-only fake Gitee before manual upload:

```bash
node scripts/build-release.js --verify --output "<absolute-temp-dir>"
```

Keep the output directory absolute and outside the Skill source tree. Let package and release manifests supply the canonical version/tag, or pass matching `--version X.Y.Z --tag vX.Y.Z` values explicitly. Do not create a tag, commit, push, publish, or contact real Gitee from the build command.

After successful verification, manually create the exact Gitee Release tag `vX.Y.Z` and upload:

1. `rental-price-agent-vX.Y.Z.tgz`
2. `rental-price-agent-vX.Y.Z.manifest.json`
3. `rental-price-agent-vX.Y.Z.sha256`

Rules:

- Keep asset names deterministic.
- Keep manifest `tag`, `version`, `bytes`, and `sha256` aligned with the archive.
- Preserve schema 2 manifest repository identity, five version domains, package-lock hash, release-tree hash, and the nonempty exact per-file records (`path`, `bytes`, `sha256`, `mode`, `type`) exactly as generated.
- Require the archive file entries to equal the manifest file list and its derived directory entries exactly; reject extra nested or mutable components.
- Keep the checksum file to exactly one ASCII line: `<64 lowercase hex><two spaces><archive name><LF>`.
- Do not rely on automatic local copy discovery or any hot-upgrade path.

## Full Workflow

### Phase 1: Setup

#### Step 1 — Login
- URL: `config.saas.loginUrl`
- Credentials: `config.saas.credentials`
- Use persistent browser context to maintain session across calls
- Check for success indicator after login attempt
- If already logged in (session valid), skip credential entry
- No captcha expected; if one appears, pause and ask user

#### Step 2 — Parse User Intent
- Extract: product identifier, desired field changes, any conditions
- Product identifier may be: direct ID, URL, keyword, SKU
- Field changes: price up/down/to, stock up/down/to, SKU rename
- If intent is ambiguous, ask for clarification before proceeding

### Phase 2: Locate the Product

#### Step 3 — Query Mirror DB (Future)
**Not yet implemented in MVP.**

When available:
- Search by keyword, SKU, or product name
- Return candidate list with IDs and basic info
- Show mirror freshness indicator (last sync time)
- If single match and freshness < 30min, green flag
- Multiple matches: present selection table
- Never auto-select on partial match

#### Step 3 (MVP) — Get Product ID Directly
- User provides product ID, full URL, or unique keyword
- Construct detail page URL: `config.saas.productDetailUrl` with `{productId}`
- If keyword provided without ID, ask user to confirm which product
- Validate URL format before navigating

### Phase 3: Read and Plan

#### Step 4 — Navigate to Detail Page
- Use `doNavigate` to go to the constructed URL
- Wait for `networkidle` to ensure full page load
- Handle lazy-loaded content — scroll or wait for dynamic elements
- If page returns 404 or redirects, report error immediately

#### Step 5 — Read Real-Time Values
- Use selectors from `config.selectors.product` to read each field
- Fields: price, stock, SKU, and any others configured
- Values MUST come from the SaaS detail page, never from mirror
- For each field: locate element, extract value, trim whitespace
- Record all read values for the diff report

#### Step 6 — Generate Modification Diff
- Compare user's intent with actual page values
- Calculate: old value, new value, absolute change, percentage change
- Reject no-op batch items. Count shared setup as an effective operation even when an item has no direct field delta.
- Apply business rules from `config.rules`:
  - Price floor/ceiling check
  - Max single-change percentage check
  - Stock floor check (no negative)
- Generate `changes.json`: `{field: newValue}` for each modified field
- Save changes.json to `tasks/changes_<taskId>.json`

#### Step 7 — Show Diff and Request Confirmation
- Display a table:

  | Field | Current | New | Change |
  |-------|---------|-----|--------|
  | price | 199     | 219 | +10.1% |
  | stock | 12      | 17  | +41.7% |
  | sku   | A001    | A001-B | renamed |

- Highlight rule violations in red
- **CRITICAL**: Show the preview to the operator and wait for explicit confirmation. Never skip the human approval step. Do not claim a code-enforced universal confirmation token or artifact for every batch path, because only form setup and image execution have explicit flags.

### Phase 4: Execute the Change

#### Step 8 — Apply Field Changes
- Navigate to product page (fresh navigation)
- For each field in changes.json:
  - Locate element by selector
  - Click to focus
  - Clear existing value
  - Type new value
  - Trigger change and blur events
- Report any selector not found; update config.json if needed
- Take a screenshot of the filled form

#### Step 9 — Submit
- Click the save/submit button
- In daemon mode, require `expectedProductId` and validate a canonical current product page: positive integer product ID, expected origin/path, `r=goods.edit`, and `id=<expectedProductId>` must all match
- After any image or VAS navigation reaches the target product, validate the same canonical target again before any DOM mutation
- Arm the response observer immediately before click; ignore pre-click responses; disarm and clean up on completion
- Lock the observer to the first click-associated matching save request identity and ignore later distinct matching requests
- Execute submit as scroll/preflight `trial` with the observer disarmed, then arm and immediately dispatch `force`
- Classify the immediate submit result as `ok`, `error`, or `unknown`
- Return immediate `ok` only for explicit matched AJAX business success
- Use the short grace window only to wait for the captured request's final body or finish cleanup; do not merge later distinct requests back into the outcome
- Normalize malformed, non-object, or missing-status daemon submit results to `unknown` with a bounded raw preview
- Parse submit payloads with bounded recursive failure-first JSON inspection; any explicit failure nested under `result` or `data` overrides top-level success
- Never accept success from truncated JSON inspection alone; if the payload preview is truncated and no explicit failure was already found, return `unknown`
- Accept repository-backed `status=1` / `code=1` as business success; reject bare `code=0` / `code=200`; let nested failure text dominate
- Redact sensitive URL query values before persisting submit evidence previews to state or reports; also redact sensitive keys after camelCase and separator normalization; never persist request bodies, headers, or cookies
- Treat redirect, URL change, toast-only, 3xx, empty response, and unfamiliar response as `unknown` that requires readback
- Treat `trial` failure as pre-dispatch and allow at most one retry
- Treat `force` timeout as dispatch-ambiguous: do not auto-retry, return `unknown`, set `submitted=null`, `sideEffectPossible=true`, and `retrySafe=false`
- If submit transport throws after the `submitting` checkpoint, mark the item `recovery_required` / `verify_failed`, treat side effects as possible, and block automatic re-submit
- Allow one retry only for proven pre-dispatch failure
- Wait for success indicator evidence when present, then wait for network idle
- Take a screenshot after submission

#### Step 10 — Immediate Verification
- Persist a per-product `submitting` checkpoint before submit command dispatch
- Persist a per-product `submitted` checkpoint after the submit response arrives and before starting verification
- Re-read all supported modified scopes from the page
- Compare supported field, image, and VAS results with expected values
- Report match/mismatch for each supported check
- Fail closed when expected field changes exist but zero field checks actually execute
- Require immediate image/VAS verification counts to be strict, exact, and nonzero
- Treat tenancy/spec-only structural changes as outside automatic immediate readback support
- If raw submit status is `unknown`, resolve it only when at least one applicable readback succeeds and no readback check fails
- Preserve the raw submit audit status even when readback resolves the final outcome to success
- If any field does not match:
  - Mark status as `verify_failed`
  - Show expected vs actual
  - Do not auto-retry
- If all match: mark as `immediate_verified`

### Phase 5: Record Keeping

#### Step 11 — Save Operation Records
- Create task in task store with:
  - Unique task ID
  - Original user instruction
  - Changes made
  - Before/after values
  - Execution timestamps
- Attach evidence:
  - Pre-modification screenshot
  - Post-modification screenshot
  - Verification results

#### Step 12 — Save Evidence Files
- Screenshots saved to `tasks/` directory
- Task JSON saved as `tasks/<taskId>.json`
- Changes saved as `tasks/changes_<taskId>.json`
- All evidence paths recorded in task

### Phase 6: Delayed Verification

#### Step 13 — Prepare Delayed Check
- Delayed verification is a separate manual step; it is **not** auto-scheduled by config.
- The agent should:
  1. Record the execution state / expected values
  2. Tell the operator to run delayed verification again after an appropriate wait window
  3. Then proceed to step 14 when the operator explicitly triggers it
  4. Mark `recovery_required` when unknown submit state or verification evidence requires manual follow-up instead of automatic re-submit

#### Step 14 — Delayed Verification
- Navigate to product page fresh
- Re-read all supported modified scopes
- Compare supported field, image, and VAS results with expected values
- Automatic delayed readback covers only supported field, image, and VAS scopes
- Fail closed on read error, no values, declared expected fields with zero executed checks, setup-only tenancy/spec zero-check cases before structural readback exists, delayed applicable image/VAS `0/0` counts, missing/malformed applicable image or VAS verification data, or image/VAS `verifyResult` counts that are not non-negative integers or do not satisfy `total = matched + mismatched`
- Do not auto-promote `verifyFailed` / `recovery_required` entries, and do not set `delayed_verified` while unresolved entries still exist
- If all match and no unresolved entries remain: status → `delayed_verified`
- If any mismatch: status → `verify_failed`, alert user

### Rollback Scope

- Allow rollback only for candidates that contain field or VAS restore data.
- Treat rollback as field/VAS rollback with preview plus explicit confirm, not a broad one-click rollback.
- Exclude unsupported image/spec/tenancy-only candidates from both preview and confirm.
- Fail rollback preview/confirm when no supported candidate remains after filtering.
- Require nonzero field verification or strict VAS evidence after rollback.
- Never report unsupported-only candidates as `0/0` success.

### Phase 7: Closure

#### Step 15 — Mirror DB Writeback

- Execute guarded writeback only after `delayed_verified`
- Update only fields that were actually modified
- Map flat `rent{N}day` fields dynamically. Reject the entire item if any flat rent field is unmappable.
- Leave nested per-SKU writeback unsupported and skipped.
- Mark data source as `saas_verify`
- Record `verified_at` from delayed verification
- Require a valid `delayedVerify.at` and refuse missing or invalid timestamps; never substitute current time
- Do not promise mirror conflict timestamp checks or task-store writeback history

#### Step 15 (MVP) — Final Report
- Summarize the operation:
  - Product modified
  - Fields changed
  - Old → new values
  - Field/image/VAS/recovery details for `completed` and `verifyFailed` entries
  - Raw submit status and any readback resolution for `failed` entries
  - Per-product delayed domain counts and unresolved count, including `submitting` / `submitted` in-flight entries without duplicates
  - Bounded response evidence preview when submit/readback evidence is retained
  - Verification result (immediate and delayed)
  - Any warnings or anomalies
- Task status reflects final outcome

## State Tracking

- Treat task-store statuses as permissive operation records.
- Treat batch-state lifecycle as the separately enforced control-flow source.

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

## Task Lifecycle States

```
planned
  → confirmed (user approved the diff)
    → submitted (changes saved to platform)
      → immediate_verified (post-save re-read matched)
        → delayed_verified (manual delayed re-check matched)
      → verify_failed (post-save re-read did not match)
  → cancelled (user rejected or aborted)
```

## Recovery Procedures

### Verify Failed — Immediate
1. Show expected vs actual values
2. Take a fresh screenshot
3. Ask user: retry, revert, or investigate manually?
4. Do not auto-retry without user approval

### Verify Failed — Delayed
1. Show both immediate_verified values and current values
2. Possible causes: platform reverted, async propagation, another operator
3. Take screenshots and ask user to investigate
4. Mark task for manual review

### Selector Not Found
1. Report which field and selector failed
2. Take a screenshot of the current page
3. Ask user for updated selector
4. Update config.json with the new selector
5. Retry the failed action

### Page Structure Changed (Multiple Failures)
1. If 3+ selectors fail simultaneously, stop
2. Take a full-page screenshot
3. Ask user to review the page structure
4. Update config.json with new selectors before retrying
