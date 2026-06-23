# Process Reference — 15-Step Price Modification Workflow

This document is the authoritative reference for each step of the operational
workflow. The agent follows this process for every modification task.

## Data Source Rules

| Source | Used For | Cannot Be Used For |
|---|---|---|
| Mirror DB | Product search, ID lookup, candidate display | Current price/stock values, final verification |
| SaaS detail page | Reading real-time values, pre-modification baseline, post-modification verification | Product discovery (search is unreliable) |

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
- **CRITICAL**: Wait for explicit user confirmation. Never skip.

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
- Wait for success indicator (toast, redirect, status message)
- Wait for network idle
- Take a screenshot after submission

#### Step 10 — Immediate Verification
- Re-read all modified fields from the page
- Compare with expected values from changes.json
- Report match/mismatch for each field
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

#### Step 13 — Schedule Delayed Check
- Default delay: 5 minutes (configurable via `config.rules.delayedVerifyMinutes`)
- The agent should:
  1. Create the delayed verification as a pending step
  2. Sleep/wait for the configured duration
  3. Then proceed to step 14

#### Step 14 — Delayed Verification
- Navigate to product page fresh
- Re-read all modified fields
- Compare with expected values
- If all match: status → `delayed_verified`
- If any mismatch: status → `verify_failed`, alert user

### Phase 7: Closure

#### Step 15 — Mirror DB Writeback (Future)
**Not yet implemented in MVP.**

When available:
- Only execute after `delayed_verified`
- Only update fields that were actually modified
- Check mirror's `updatedAt` before writing:
  - If mirror was updated during operation → merge only modified fields
  - If mirror is fresher than task start time → log conflict
- Mark data source as `saas_verify` with verification timestamp
- Log writeback in task history

#### Step 15 (MVP) — Final Report
- Summarize the operation:
  - Product modified
  - Fields changed
  - Old → new values
  - Verification result (immediate and delayed)
  - Any warnings or anomalies
- Task status reflects final outcome

## Task Lifecycle States

```
planned
  → confirmed (user approved the diff)
    → submitted (changes saved to platform)
      → immediate_verified (post-save re-read matched)
        → delayed_verified (5-min check matched)
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
