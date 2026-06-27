import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('CLI loadEnv wiring', () => {
  it('guards Feishu SDK bot startup when imported', async () => {
    const text = await source('../src/cli/feishuBotSdk.ts');
    expect(text).toContain("import { pathToFileURL } from 'node:url';");
    expect(text).toContain('export async function main(): Promise<void>');
    expect(text).toContain('await bot.start();');
    expect(text).toContain('import.meta.url === pathToFileURL(process.argv[1]).href');
  });

  it('wires the Feishu SDK bot through the planner-first runtime only', async () => {
    const text = await source('../src/cli/feishuBotSdk.ts');
    expect(text).toContain('agentPlannerProvider: createAgentPlannerProvider(llmProvider)');
    expect(text).not.toContain('createLlmToolSelector');
    expect(text).not.toContain('llmToolSelector:');
  });

  it('wires the Feishu HTTP bot through the planner-first runtime only', async () => {
    const text = await source('../src/cli/feishuBot.ts');
    expect(text).toContain('agentPlannerProvider: createAgentPlannerProvider(llmProvider)');
    expect(text).not.toContain('createLlmToolSelector');
    expect(text).not.toContain('llmToolSelector:');
  });

  it('loads .env before Feishu test send', async () => {
    const text = await source('../src/cli/testFeishu.ts');
    expect(text).toContain("import { loadEnv } from '../config/loadEnv.js';");
    expect(text.indexOf('await loadEnv();')).toBeLessThan(text.indexOf('maybeSendFeishuTestMessage()'));
  });

  it('loads .env before public traffic Feishu send', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { loadEnv } from '../config/loadEnv.js';");
    expect(text.indexOf('await loadEnv();')).toBeLessThan(text.indexOf('const config = await loadConfig();'));
    expect(text.indexOf('await loadEnv();')).toBeLessThan(text.indexOf('sendFeishuCard(env, card, fallbackText)'));
    expect(text).not.toContain('sendFeishuText(process.env, text)');
  });

  it('loads .env before daily report Feishu send', async () => {
    const text = await source('../src/cli/dailyReport.ts');
    expect(text).toContain("import { loadEnv } from '../config/loadEnv.js';");
    expect(text.indexOf('await loadEnv();')).toBeLessThan(text.indexOf('maybeSendFeishuReport(report'));
  });
});
