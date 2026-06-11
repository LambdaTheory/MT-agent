# Public Traffic Card Tables Design

## Goal

Revise the public traffic daily report so Feishu shows the actionable data instead of short Top lists. Keep the report compact at the top, but put all diagnostic and action rows into paginated Feishu 2.0 tables.

## Current Issues

- Feishu card truncates business conclusions to two items, so some conclusions are hidden.
- Fulfillment only shows raw counts, not rates or comparison with yesterday.
- Diagnostic sections are cut at Top5 in the analysis layer, so Feishu, Markdown, and xlsx cannot show the complete set.
- Recommended actions are mixed and truncated, instead of grouped by operation type.
- New product observation appears among other diagnostics, but it needs to move to the end for later clarification.

## Feishu Component Constraints

- The card already uses JSON 2.0 (`schema: "2.0"`).
- Feishu 2.0 tables support pagination through `page_size`; use `page_size: 10` so rows beyond 10 are accessible by paging inside the card.
- A single card supports at most five table components.
- Feishu 2.0 tables cannot be nested in other components. They must be direct children of `body.elements`.
- Collapsible panels may still be used for markdown content, but not for the table-based detail sections in this change.

## Feishu Card Structure

1. Business conclusions: show all conclusion items, not just the first two.
2. Today's funnel: keep the existing public traffic / order / fulfillment funnel structure.
3. Fulfillment rates: show fulfillment-related ratios and compare each ratio with yesterday when previous data is available.
4. Today's exposure Top10: keep this Top10 section as the only Top list.
5. Diagnostic problems table: one root-level Feishu table containing all rows from exposure insufficient, weak click, weak conversion, high potential, and lifecycle governance.
6. Recommended actions table: one root-level Feishu table containing all recommended action rows, sorted/grouped by operation text.
7. New product observation table: one root-level Feishu table, placed last.

## Table Definitions

### Diagnostic Problems Table

- `type`: text, diagnostic category.
- `product`: text, display product id.
- `action`: text, recommended operation.
- `reason`: text or markdown, measured reason and metrics.

### Recommended Actions Table

- `action`: text, operation group.
- `type`: text, source diagnostic category.
- `product`: text, display product id.
- `reason`: text or markdown, measured reason and metrics.

### New Product Observation Table

- `product`: text, display product id.
- `action`: text, operation.
- `reason`: text or markdown, measured reason and metrics.

All tables use `page_size: 10`, `row_height: "auto"`, `row_max_height: "124px"`, `freeze_first_column: true`, and a compact grey header style.

## Analysis Changes

- Remove the fixed Top5 slicing from diagnostic section generation.
- Preserve sorting rules so the most urgent rows still appear first.
- Keep only the exposure Top10 display as a Top section.
- Recommended actions should include all source rows and retain the source diagnostic category so the table can show where each action came from.

## Fulfillment Rates

Fulfillment should show ratios rather than only counts. Use available order analysis metrics first, and fall back to report summary metrics when needed.

Initial rates:

- Signed-to-created rate: signed orders / created orders.
- Reviewed-to-signed rate: reviewed orders / signed orders.
- Shipped-to-reviewed rate: shipped orders / reviewed orders.
- Return-to-shipped rate: returned orders / shipped orders when both values are available.
- Close-to-created rate: closed orders / created orders when both values are available.

When yesterday's comparable values are present, show point changes. If not available, show a clear missing comparison note instead of inventing a delta.

## Markdown And Workbook

- Markdown mirrors the card order: conclusions, overview, exposure Top10, diagnostic problems, recommended actions, and new product observation last.
- Markdown uses full diagnostic/action lists, not Top5 truncation.
- Workbook sheets keep their current sheet structure, but receive full section data after analysis-layer truncation is removed.

## Testing

- Unit tests verify the Feishu card contains three root-level table components and no diagnostic Top5 headings.
- Unit tests verify table `page_size` is 10 and rows are not truncated.
- Unit tests verify conclusions are not truncated.
- Unit tests verify Markdown keeps Top10 only for exposure and moves new product observation last.
- Existing build and report tests must keep passing.
