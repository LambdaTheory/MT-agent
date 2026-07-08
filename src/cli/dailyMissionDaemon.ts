import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../config/loadEnv.js';
import { main as runDailyMission } from './dailyMissionRun.js';

const DEFAULT_RUN_TIME = '09:30';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseHhmm(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid HH:MM time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid HH:MM time: ${value}`);
  return { hour, minute };
}

function partsInTimezone(ms: number, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

function zonedWallTimeToUtcMs(parts: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string): number {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const actual = partsInTimezone(guess, timezone);
  const desiredWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
  return guess + (desiredWall - actualWall);
}

export function computeNextRunDelayMs(nowMs: number, hhmm: string, timezone = 'UTC'): number {
  const { hour, minute } = parseHhmm(hhmm);
  const today = partsInTimezone(nowMs, timezone);
  let target = zonedWallTimeToUtcMs({ ...today, hour, minute }, timezone);
  if (target <= nowMs) {
    const tomorrowUtc = Date.UTC(today.year, today.month - 1, today.day + 1, hour, minute);
    const tomorrow = partsInTimezone(tomorrowUtc, timezone);
    target = zonedWallTimeToUtcMs({ ...tomorrow, hour, minute }, timezone);
  }
  return target - nowMs;
}

function buildDailyMissionArgs(argv: string[]): { args: string[]; outputDir: string; date: string; runId: string } {
  const forwarded: string[] = [];
  const outputDir = readArg(argv, '--output-dir') ?? process.env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const date = readArg(argv, '--date') ?? new Date().toISOString().slice(0, 10);
  const runId = readArg(argv, '--run-id') ?? `run-${date}-${Date.now()}`;
  for (const name of ['--output-dir', '--date', '--run-id']) {
    const value = readArg(argv, name);
    if (value) forwarded.push(name, value);
  }
  if (!readArg(argv, '--output-dir')) forwarded.push('--output-dir', outputDir);
  if (!readArg(argv, '--date')) forwarded.push('--date', date);
  if (!readArg(argv, '--run-id')) forwarded.push('--run-id', runId);
  forwarded.push('--trigger', 'scheduled');
  return { args: forwarded, outputDir, date, runId };
}

async function writeLastRun(outputDir: string, runId: string, date: string): Promise<void> {
  const path = join(outputDir, 'state', 'daily-mission-daemon-last-run.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ runId, date, trigger: 'scheduled', at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const time = readArg(argv, '--time') ?? process.env.MT_AGENT_DAILY_MISSION_TIME ?? DEFAULT_RUN_TIME;
  const timezone = readArg(argv, '--timezone') ?? process.env.TZ ?? 'UTC';
  if (hasFlag(argv, '--once')) {
    const run = buildDailyMissionArgs(argv);
    await runDailyMission(run.args);
    const { outputDir, date, runId } = run;
    await writeLastRun(outputDir, runId, date);
    return;
  }
  while (true) {
    const delay = computeNextRunDelayMs(Date.now(), time, timezone);
    console.log(`Next Daily Mission run in ${delay}ms at ${time} (${timezone}).`);
    await new Promise((resolve) => { setTimeout(resolve, delay); });
    const run = buildDailyMissionArgs(argv);
    await runDailyMission(run.args);
    const { outputDir, date, runId } = run;
    await writeLastRun(outputDir, runId, date);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
