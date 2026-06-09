# TODO

## High Priority

- Add Feishu report delivery.
  - Configure Feishu webhook URL in config or environment.
  - Push the daily Markdown summary after report generation.
  - Include local XLSX and Markdown output paths in the message.
  - Delivery failure must not block local report generation.

- Add product ID mapping between Alipay platform product IDs and internal management platform IDs.
  - Maintain a local mapping file as the first version.
  - Join mapping data into analysis rows and workbook output.
  - Show unmapped platform product IDs clearly for manual completion.
  - Keep analysis grouped by platform product ID; internal ID is an additional reference field.
  - Treat this as a required integration anchor for the later execution agent.

- Add downstream-agent integration fields to report outputs.
  - Preserve stable fields needed by the later product execution agent: `platformProductId`, internal management platform ID, product name, recommended action, priority, confidence, reason, source date, and source period metrics.
  - Add a machine-readable action queue output, for example `output/YYYY-MM-DD/action-candidates.json`.
  - Each action candidate should be advisory only; execution must require explicit user approval in the later agent.
  - Do not implement actual上链/改价 execution in this project yet.

## Medium Priority

- Continue analysis-rule calibration.
  - Reduce over-reporting in `疑似价格问题`.
  - Split strong suggestions, weak suggestions, and manual review items.
  - Keep Markdown focused on top actionable items; put broader detail in XLSX.
  - Normalize suggested actions into stable action codes for downstream use, such as `ADD_LINK`, `ADJUST_PRICE`, `INCREASE_EXPOSURE`, `CHECK_INACTIVE`, and `REVIEW_MANUALLY`.

- Prepare Feishu approval-friendly report format.
  - Feishu messages should separate observation, recommendation, and candidate operation.
  - Include enough identifiers for manual confirmation before execution: platform product ID, internal management ID, product name, and action code.
  - Keep future approval flow in mind, but do not build interactive approval before Feishu delivery is stable.

## Future Agent Closure

- Build product operation execution agent as a separate later module.
  - Module: 商品.
  - Problem solved: extend the analysis/reporting module into actual operational execution.
  - Form: agent tool module first; later merge into a unified product operation agent.
  - Expected workflow: analysis report generates candidate operations, user reviews and approves, then the execution agent performs上链/补链/改价 through the 嘉华 management platform modules.
  - Required boundary: this MT-agent only produces recommendations and action candidates; the later execution project owns real mutations in 嘉华.
  - Required safety: no automatic mutation without explicit user permission.
  - Required feedback: execution result should return status, timestamp, target IDs, before/after values when applicable, and error reason on failure.
  - Current project should prepare stable identifiers and action codes now so the future execution agent can consume them directly.

## Deferred

- Windows scheduled task automation.
  - Current priority is low because manual triggering is acceptable for now.
  - Revisit only after report quality and delivery are accepted.

- Implement persistent browser session reuse after basic project acceptance.
  - Add a `browser-session` command that keeps the Playwright browser process open.
  - Let `daily-report` and `probe-page-size` prefer connecting to that live session.
  - Keep the current one-shot browser launch as fallback.
  - Goal: reduce repeated QR scans when Alipay keeps login state only in an active browser session.

## Low Priority

- Obsidian or other knowledge-base integration.
  - Revisit only if daily report content needs long-term note archival.
