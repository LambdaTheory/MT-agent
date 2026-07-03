import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { BotResponse } from './types.js';

const execFileAsync = promisify(execFile);

type MirrorCommand = 'search' | 'batch-spec';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readKeyword(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('keyword is required');
  return value.trim();
}

function rentalRoot(): string {
  return process.env.RENTAL_PRICE_AGENT_DIR ?? resolve(process.cwd(), 'vendor', 'rental-price-agent');
}

function commandFromTool(toolName: string): MirrorCommand | null {
  if (toolName === 'rental.mirrorSearch') return 'search';
  if (toolName === 'rental.mirrorBatchSpec') return 'batch-spec';
  return null;
}

async function runMirror(rootDir: string, command: MirrorCommand, keyword: string): Promise<Record<string, unknown>> {
  const script = join(rootDir, 'scripts', 'mirror-search.js');
  const { stdout } = await execFileAsync(process.execPath, [script, command, keyword], { cwd: rootDir, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(String(stdout || '{}')) as unknown;
  return isRecord(parsed) ? parsed : { status: 'ok', rows: parsed };
}

export async function executeRentalMirrorTool(toolName: string, args: Record<string, unknown>): Promise<BotResponse> {
  const command = commandFromTool(toolName);
  if (!command) throw new Error('租赁 mirror 读侧工具无效。');
  const keyword = readKeyword(args.keyword);
  const result = await runMirror(rentalRoot(), command, keyword);
  const status = typeof result.status === 'string' ? result.status : 'ok';
  return {
    text: [`mirror ${command}: ${status}`, JSON.stringify(result)].join('\n'),
    metadata: { toolName, ok: status !== 'error', command, keyword, status, result },
  };
}
