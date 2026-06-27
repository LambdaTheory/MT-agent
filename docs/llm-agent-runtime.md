# LLM Agent Runtime

This project uses an OpenAI-compatible `/chat/completions` provider for Feishu natural-language agent planning.

The LLM selects registered tools, or composes a multi-step plan from registered tools, and extracts arguments. Local code still performs data lookup, approval card generation, and execution. Write or high-risk operations must pass through a Feishu confirmation card before any side effect.

Composite workflow definitions remain in code only as legacy reference/validation artifacts. Normal Feishu planner requests intentionally expose `workflows: []`, and the Feishu planner path rejects `selectedWorkflow` responses instead of executing them. New behavior must be expressed as one registered tool call or a `steps` plan.

Multi-step plans may pass metadata from earlier steps into later steps with placeholders such as `${rank.bestProductId}`. When a normal write/high-risk step is reached, the Agent confirmation card stores the remaining plan as a continuation. After the user confirms, the bot executes that one write step and then resumes the remaining steps. If another write/high-risk step appears later, it stops again and asks for a fresh confirmation.

Plan tools can generate their own dedicated confirmation cards. Dedicated cards for `rental.priceChange`, `rental.newLinkBatchPlan`, `rental.specRemovePlan`, and `operations.refreshActivityPlan` also carry the remaining multi-step continuation. After the dedicated confirmation succeeds, the bot resumes the remaining steps; if the confirmed action fails, the remaining steps stop.

Confirmation continuations preserve the same execution context used by the original planner run, including injected rental clients, closed-order fetch implementations, and link-registry path overrides. This matters for worktrees and tests because a confirmed write can be followed by a registry-backed read such as `product.rankBestSameSku` without falling back to the main workspace defaults.

Read tools that return an interactive card, such as the product ID lookup card, inventory cards, learning quiz cards, and activity setup cards, pause remaining steps instead of continuing behind the card. This keeps the card result visible and prevents later text replies from covering the interaction. The LLM prompt tells the planner to place interactive card-opening tools last or ask for clarification.

For example, `operations.refreshActivityPlan` first builds the zero-order-link delist and replenishment plan. Only when the candidates, same-SKU groups, safe copy sources, and count limits all pass does it generate a hidden `operations.refreshActivityExecute` confirmation card. That execute tool is not exposed for direct planner selection; confirmation is required, and execution writes an audit file.

Generic Agent confirmation cards carry a `confirmationKey` derived from the exact request payload. The parser recomputes that key when present and rejects tampered card values. Dedicated high-risk cards, including rental price changes, rental operation confirmations, new-link batch confirmations, differential-pricing execution cards, price callback cards, and activity cancellation assistance cards, also require the generated `confirmationKey` before parsing. Any card carrying a continuation must have a valid generated key. Hidden runtime tools additionally require a valid generated key, and continuation steps reject hidden tools entirely; hidden tools can only be the current confirmed action produced by an internal planning tool. Step ids reserve `last` and `steps` for runtime references.

## Required Env

Set either the `MT_AGENT_LLM_*` variables or the fallback `LLM_*` variables:

```env
MT_AGENT_LLM_PROVIDER=openai-compatible
MT_AGENT_LLM_BASE_URL=https://your-provider.example/v1
MT_AGENT_LLM_API_KEY=replace_with_provider_key
MT_AGENT_LLM_MODEL=your-model-name
```

`MT_AGENT_LLM_PROVIDER=disabled` disables the planner even when URL and model are configured.

`MT_AGENT_LLM_API_KEY` may be left empty only for a trusted local provider that does not require bearer auth.

## Apply Runtime Config

PM2 runs the SDK bot from `C:\works\MT-agent`:

```powershell
pm2 restart mt-feishu-bot --update-env
pm2 status mt-feishu-bot
Get-Content -Path C:\works\MT-agent\output\feishu-bot-sdk.out.log -Tail 40
```

On startup, the bot prints one safe status line:

```text
MT-agent LLM planner: enabled (provider=openai-compatible, model=your-model-name, apiKey=set)
```

The line never prints the API key. If the planner is disabled, it prints the missing config keys.

## Production Entry Boundary

When the LLM planner is configured, both production Feishu entries (`feishuBotSdk.ts` long connection and `feishuBot.ts` HTTP server) route non-empty text through the planner-first resolver. Legacy exact commands such as `跑日报`, `运营学习`, and `复制商品 761` are no longer allowed to bypass the planner in those entries.

The shared `handleBotIntent()` entry also rejects pre-parsed exact intents when an `agentPlannerProvider` is present. This protects tests, adapters, or future callers from accidentally calling the legacy deterministic branch while production is supposed to be planner-first. Those callers must pass the raw text as `{ type: 'unknown', text }` so the planner can choose a registered tool or ask for clarification.

`npm run agent:dry-run -- "..."` also defaults to planner-first resolution. It includes a `legacyIntent` field only as a comparison aid; use `--legacy` when intentionally inspecting the old deterministic parser.

Planner validation checks the registered tool schemas recursively, including structured array items and quantity fields for multi-product new-link plans and hidden refresh-activity execution payloads. Malformed LLM output such as `items: ["wide 300"]`, `count: ["5"]`, or fractional hidden execution counts is rejected before any confirmation card or side effect path is reached.

Write or high-risk selections from these old command phrases still stop at confirmation cards. The regression tests cover SDK and HTTP text events for those examples.

## Smoke Test

After PM2 restarts, send this in Feishu:

```text
@公域数据日报 帮我铺十条 pocket3 的新链
```

Expected first response:

- a new-link batch plan,
- a recommended source product chosen from current public-traffic data,
- a confirmation card,
- no product copy before confirmation.

After clicking confirm, the card updates in place while the rental product skill copies from the selected source.
