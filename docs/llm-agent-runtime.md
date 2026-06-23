# LLM Agent Runtime

This project uses an OpenAI-compatible `/chat/completions` provider for Feishu natural-language agent planning.

The LLM only selects a registered tool or workflow and extracts arguments. Local code still performs data lookup, approval card generation, and execution. Write or high-risk operations must pass through a Feishu confirmation card before any side effect.

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
