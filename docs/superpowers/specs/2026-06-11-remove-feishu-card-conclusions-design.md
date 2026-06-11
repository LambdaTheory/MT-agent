# Remove Feishu Card Conclusions

## Goal

Reduce duplicated content in the public traffic Feishu card by removing the top `经营结论` block from the card only.

## Scope

- Remove the first card markdown block that renders `**经营结论**` and all `context.conclusions` lines.
- Keep the later `分析与建议` block unchanged, since it already summarizes the same conclusion data alongside action focus.
- Keep Markdown report output unchanged.
- Keep plain-text Feishu fallback output unchanged.

## Validation

- Update card payload tests so they no longer expect `经营结论` in the Feishu card.
- Keep Markdown and text fallback tests expecting `经营结论`.
- Run the targeted report tests, build, and then send one card from the existing `output/2026-06-11` context.
