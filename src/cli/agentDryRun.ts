import { pathToFileURL } from 'node:url';
import { createAgentRuntime } from '../agentRuntime/runtime.js';
import type { AgentRequest, AgentResponse } from '../agentRuntime/types.js';
import { parseAgentFirstBotIntent, parseBotIntent } from '../feishuBot/intent.js';
import type { BotIntent } from '../feishuBot/types.js';

export type AgentDryRunMode = 'planner-first' | 'legacy';

export interface AgentDryRunResult {
  source: 'cli';
  text: string;
  mode: AgentDryRunMode;
  intentType: BotIntent['type'];
  intent: BotIntent;
  legacyIntent?: BotIntent;
  dryRun: true;
  response: AgentResponse;
}

export interface AgentDryRunOptions {
  mode?: AgentDryRunMode;
}

export async function runAgentDryRun(text: string, options: AgentDryRunOptions = {}): Promise<AgentDryRunResult> {
  const mode = options.mode ?? 'planner-first';
  let resolvedIntent: BotIntent = { type: 'unknown', text };
  const runtime = createAgentRuntime({
    resolveIntent: (input) => {
      resolvedIntent = mode === 'legacy' ? parseBotIntent(input) : parseAgentFirstBotIntent(input);
      return resolvedIntent;
    },
    handleIntent: async (intent) => ({
      text: `DRY RUN: would handle intent ${intent.type}`,
    }),
  });
  const request: AgentRequest = { source: 'cli', text };
  const response = await runtime.handle(request);

  return {
    source: 'cli',
    text,
    mode,
    intentType: resolvedIntent.type,
    intent: resolvedIntent,
    ...(mode === 'planner-first' ? { legacyIntent: parseBotIntent(text) } : {}),
    dryRun: true,
    response,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const mode: AgentDryRunMode = argv.includes('--legacy') ? 'legacy' : 'planner-first';
  const text = argv.filter((arg) => arg !== '--legacy').join(' ').trim();
  if (!text) {
    console.error('Usage: npm run agent:dry-run -- "查询 565"');
    console.error('       npm run agent:dry-run -- --legacy "查询 565"');
    process.exitCode = 1;
    return;
  }

  const result = await runAgentDryRun(text, { mode });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
