# Public Traffic Report Design

## Goal

Upgrade MT-agent from a public-domain visit report into a public traffic operations analysis system. The first iteration should produce a stable daily public traffic report based on exposure, visit, amount, order, shipment, goods-list, and observation-state data. Execution operations, Feishu Q&A, and LLM copywriting suggestions are deferred.

## First Iteration Scope

This iteration is an incremental upgrade with local restructuring, not a rewrite.

Build:

- Exposure page probe command to inspect page structure, controls, date selectors, tables, and visible text.
- Exposure page crawler for overall 1/7/30 summary data and product-level cumulative rows.
- Daily cumulative exposure snapshots.
- Product-level daily deltas from adjacent cumulative snapshots.
- Rolling 7-day and 30-day product aggregation from local daily deltas.
- Daily goods-list refresh and goods-list snapshot storage.
- New product detection from goods-list daily differences and large/new internal product IDs.
- Product observation state machine with automatic transitions and manual overrides.
- Public traffic Markdown report, XLSX workbook, and medium-density Feishu summary.
- Continued use of the existing visit/order/shipment crawler as a supporting data source.

Do not build in this iteration:

- Product operation execution.
- Feishu natural-language Q&A.
- Interactive Feishu approval cards.
- LLM-generated title, price, or image copywriting suggestions.
- Technology stack migration.

## Technology Stack

Keep the current stack:

- Node.js and TypeScript.
- Playwright for browser automation.
- `xlsx-js-style` for workbooks and goods export parsing.
- Vitest for tests.
- Feishu server-side app API for message push.

No framework or runtime upgrade is required. The main work is data modeling, storage, aggregation, and report design.

## Architecture

The system should be organized as five layers.

### Collection Layer

Data sources:

- Existing public-domain visit/order/shipment dashboard.
- Goods list export, already automated through `refresh-product-id-map`.
- New exposure page: `https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public`.

The exposure page has two different data meanings:

- Overall 1/7/30 data is page-level summary data.
- Product table data is cumulative since listing or custody, not daily data.

The crawler must not treat product cumulative rows as direct 1/7/30 product rows.

### Storage Layer

Use a new public traffic output namespace:

```text
output/public-traffic/YYYY-MM-DD/
  exposure-overview.json
  exposure-cumulative-products.json
  exposure-daily-delta.json
  exposure-7d-summary.json
  exposure-30d-summary.json
  goods-list-snapshot.json
  new-product-observation.json
  observation-state.json
  public-traffic-report.md
  public-traffic-report.xlsx
  report-context.json
  run.log
```

Keep existing `output/YYYY-MM-DD/` visit/order/shipment reports working during the transition. The public traffic report may read existing raw visit/order/shipment data as a supporting source.

Retention policy:

- Last 35 days are hot data for daily calculation.
- Older raw snapshots and deltas should be moved to an archive area or monthly archive later.
- Daily report calculation should only need the hot 35-day window.

### Calculation Layer

Product-level exposure data is computed from cumulative snapshots:

- `today cumulative - previous cumulative = today daily delta`.
- Rolling 7/30 product summaries are produced from daily delta files.
- New products, missing products, and negative deltas must be flagged rather than silently normalized.

Delta handling:

- New product: mark `new_product`; keep it available for observation, but be careful with trend conclusions.
- Missing product: mark `missing`.
- Negative delta: mark `counter_reset_or_data_error`; do not treat it as true negative exposure or revenue.

Merge keys:

- Platform product ID is the primary cross-source join key.
- Internal product ID is the primary human-facing identifier when mapped.
- Goods list is used to refresh platform-to-internal mapping and detect new internal IDs.

### Observation State Layer

Products should not be pushed as action candidates every day only because a metric is abnormal. Use a state machine to support observation periods and cooldown.

States:

- `new_observation`: new or recently detected product under observation.
- `watching`: abnormal or developing signal, not enough evidence for action.
- `candidate_action`: enough repeated evidence to ask the operator to review.
- `cooldown`: recently handled or manually paused, should not be pushed repeatedly.
- `resolved_or_stable`: no urgent issue or stabilized after observation.

Automatic state principles:

- New internal IDs from goods-list daily differences enter observation.
- Large internal IDs can be treated as recent-new-product candidates.
- Products absent from exposure promotion should be marked as `new_not_in_public_promotion` when relevant.
- Consecutive abnormal days can move a product from `watching` to `candidate_action`.
- Improvement during observation can move a product to `resolved_or_stable`.

Manual overrides:

- Use `config/product-observation-overrides.json` for first iteration.
- Internal product ID is preferred; platform product ID is fallback.
- Overrides can force cooldown, extend observation, force candidate review, ignore for N days, and add operator notes.
- Feishu Q&A or interactive updates can later become a nicer interface for these overrides.

### Output Layer

The main report becomes the public traffic report.

Markdown and XLSX should include:

- Overall 1/7/30 exposure summary.
- Product daily delta table.
- Product 7-day summary.
- Product 30-day summary.
- Exposure optimization section.
- Conversion optimization section.
- New product observation section.
- Lifecycle governance section.
- Existing visit/order/shipment supporting data.
- Observation state and manual override notes.

Feishu summary should use medium density:

- Overall metrics.
- Module counts.
- Top 5 exposure optimization items.
- Top 5 conversion optimization items.
- New product observation summary.
- Lifecycle warning summary.
- Report file paths.

Do not send a very long list of dozens of products in Feishu. Details belong in Markdown/XLSX.

## Analysis Modules

### Exposure Optimization

Find products with signals such as:

- High exposure but low visit rate.
- Low exposure with evidence of conversion or revenue.
- Exposure drop after previous positive signal.
- New products not entering public promotion.

Suggestions remain rule-based in the first iteration.

### Conversion Optimization

Find products with signals such as:

- Visits but no amount or no shipment signal.
- Exposure and visits but poor revenue.
- Existing visit/order/shipment dashboard shows order intent but weak fulfillment.

Existing public-domain visit/order/shipment data remains useful here.

### New Product Observation

New products are detected mainly from goods-list differences and internal product ID recency.

Observation should answer:

- Did the product enter public promotion?
- Is exposure increasing within the first week?
- Is visit rate improving?
- Is there amount, order, or shipment signal?
- Should it stay under observation, become an action candidate, or be marked stable?

### Lifecycle Governance

Find products with long custody/listing duration and weak exposure, visits, amount, orders, or shipment signals.

These products should usually enter observation or candidate review, not immediate execution.

## Commands

Expected first-iteration commands:

- `npm run probe-exposure-page`: opens the exposure page and saves page diagnostics to `output/latest/exposure-page-probe.json`.
- `npm run public-traffic-report`: runs the full public traffic workflow.
- `npm run refresh-product-id-map`: continues to refresh goods list mapping and can also feed goods-list snapshots.

The existing `npm run daily-report` should remain usable during migration.

## Error Handling

- Exposure page probe failures should keep the browser open for inspection.
- Product cumulative snapshots with too few rows should not overwrite prior stable data.
- Delta calculation should flag missing and negative values rather than hide them.
- Feishu failure should not delete or roll back local report files.
- If the exposure page changes structure, probe output should help repair selectors.

## Testing Strategy

Use TDD for implementation.

Test areas:

- Exposure row normalization from table-like raw rows.
- Cumulative snapshot difference calculation.
- 7/30 rolling aggregation from daily deltas.
- New product detection from goods-list snapshots and internal ID recency.
- Observation state transitions.
- Manual override application.
- Public traffic Markdown/Feishu text formatting.
- Workbook sheet generation.

Live Playwright tests are not required for unit verification, but live probe/report commands must be manually verified during rollout.

## Deferred Work

- Feishu natural-language Q&A over report data.
- LLM-generated product copy suggestions.
- Operation execution and approval workflow.
- Long-term archival compression details.
- Cloud deployment for Feishu event subscription.
