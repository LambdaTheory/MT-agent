import { pathToFileURL } from 'node:url';
import { createAgentRuntime } from '../agentRuntime/runtime.js';
import type { AgentRequest, AgentResponse } from '../agentRuntime/types.js';
import { parseBotIntent } from '../feishuBot/intent.js';
import type { BotIntent } from '../feishuBot/types.js';

export interface AgentDryRunResult {
  source: 'cli';
  text: string;
  intentType: BotIntent['type'];
  intent: BotIntent;
  dryRun: true;
  response: AgentResponse;
}

export async function runAgentDryRun(text: string): Promise<AgentDryRunResult> {
  let resolvedIntent: BotIntent = { type: 'unknown', text };
  const runtime = createAgentRuntime({
    resolveIntent: (input) => {
      resolvedIntent = parseBotIntent(input);
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
    intentType: resolvedIntent.type,
    intent: resolvedIntent,
    dryRun: true,
    response,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const text = argv.join(' ').trim();
  if (!text) {
    console.error('Usage: npm run agent:dry-run -- "查询 565"');
    process.exitCode = 1;
    return;
  }

  const result = await runAgentDryRun(text);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
