# Feishu Summary Format Design

## Goal

Make the Feishu daily report easier to read by changing the current long plain list into an executive-summary format with planned operation actions.

## Format

Use the approved "老板摘要型" structure:

1. Header: report name and date.
2. Summary: counts for high-priority items, growth opportunities, manual review/inactive items, and unmapped IDs.
3. Planned operations: grouped action recommendations for price/stock checks, link/exposure growth, and inactive checks.
4. Key products: top products with compact evidence and suggested action.
5. Report files: Markdown and XLSX paths.

## Scope

This change only affects Feishu text formatting. It does not change analyzer rules, report files, Feishu API delivery, or product mutation behavior.

## Constraints

- Keep plain text output because both Feishu webhook and app API already send text messages.
- Prefer internal product IDs when mapped; fall back to platform product IDs.
- Keep the message short enough for daily reading by showing grouped action IDs and top product details.
- Include planned operations, but keep them advisory only.
