import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectRecentOperations, type ContextCollector } from '../agentRuntime/dailyMissionContext.js';
import { runDailyMissionPlan } from '../agentRuntime/dailyMissionOrchestrator.js';
import { writeDailyJournal } from '../agentRuntime/dailyJournalWriter.js';
import { RuleBasedDecisionBuilder } from '../agentRuntime/decisionBuilder.js';
import { FileHotspotEventProvider } from '../agentRuntime/hotspotEvents.js';
import { loadEnv } from '../config/loadEnv.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const outputDir = readArg(argv, '--output-dir') ?? process.env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const date = readArg(argv, '--date') ?? new Date().toISOString().slice(0, 10);
  const runId = readArg(argv, '--run-id') ?? `run-${date}-${Date.now()}`;
  const hotspotProvider = new FileHotspotEventProvider({
    path: join(outputDir, 'daily-mission', date, 'hotspot-events.json'),
  });
  const collectors: ContextCollector[] = [
    { name: 'exposure', collect: async () => ({ exposure: await readOptionalJson(join(outputDir, 'daily-mission', date, 'exposure.json')) }) },
    { name: 'sales', collect: async () => ({ sales: await readOptionalJson(join(outputDir, 'daily-mission', date, 'sales.json')) }) },
    { name: 'recentOperations', collect: async () => ({ recentOperations: await collectRecentOperations(outputDir, date, 7) }) },
    { name: 'hotspots', collect: async () => ({ hotspots: await hotspotProvider.listEvents({ date, lookaheadDays: 7 }) }) },
  ];

  const result = await runDailyMissionPlan({
    outputDir,
    date,
    runId,
    trigger: 'manual',
    collectors,
    decisionBuilder: new RuleBasedDecisionBuilder(),
  });
  await writeDailyJournal({
    outputDir,
    date,
    runId,
    context: result.context,
    decisions: result.decisions,
    classified: result.classified,
  });
  console.log(`Daily Mission plan 完成：${date}，状态 ${result.run.status}，待审批 ${result.classified.approvals.length} 项，观察 ${result.classified.observations.length} 项。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
