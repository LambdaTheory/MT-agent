# Remove Feishu Card Conclusions

## Goal

Reduce duplicated content in the public traffic Feishu card by removing redundant section labels from the card only.

## Scope

- Remove the first card markdown block that renders `**经营结论**` and all `context.conclusions` lines.
- Remove the standalone `今日漏斗` label because the card title already establishes the report context.
- Remove the `公域` grouping label inside the funnel block while keeping the metric cards for exposure, visits, and amount.
- Keep the later `分析与建议` block unchanged, since it already summarizes the same conclusion data alongside action focus.
- Keep Markdown report output unchanged.
- Keep plain-text Feishu fallback output unchanged.

## Validation

- Update card payload tests so they no longer expect `经营结论`, `今日漏斗`, or the `公域` group label in the Feishu card.
- Keep Markdown and text fallback tests expecting `经营结论`.
- Run the targeted report tests, build, and then send one card from the existing `output/2026-06-11` context.
