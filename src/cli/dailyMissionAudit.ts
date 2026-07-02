import { pathToFileURL } from 'node:url';
import { loadDailyMissionRun } from '../agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../agentRuntime/operationLedger.js';

export interface DailyMissionAuditSummary {
  date: string;
  status: string;
  eventCounts: Record<string, number>;
  lines: string[];
}

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function buildDailyMissionAuditSummary(
  outputDir: string,
  date: string,
): Promise<DailyMissionAuditSummary> {
  const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
  const run = await loadDailyMissionRun(outputDir, date);
  const eventCounts: Record<string, number> = {};
  for (const entry of entries) eventCounts[entry.event] = (eventCounts[entry.event] ?? 0) + 1;
  const lines = [
    `Daily Mission 审计：${date}`,
    `状态：${run?.status ?? '无 run'}`,
    `事件总数：${entries.length}`,
    ...Object.entries(eventCounts).map(([event, count]) => `- ${event}: ${count}`),
  ];
  return { date, status: run?.status ?? 'none', eventCounts, lines };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const outputDir = readArg(argv, '--output-dir') ?? process.env.MT_OUTPUT_DIR ?? 'output';
  const date = readArg(argv, '--date') ?? new Date().toISOString().slice(0, 10);
  const summary = await buildDailyMissionAuditSummary(outputDir, date);
  console.log(summary.lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
