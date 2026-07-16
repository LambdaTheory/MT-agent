import { execFile } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { BotResponse } from './types.js';

const execFileAsync = promisify(execFile);

type MirrorCommand = 'search' | 'batch-spec' | 'writeback-state';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readKeyword(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('keyword is required');
  return value.trim();
}

function readConfirm(value: unknown): void {
  if (value !== true) throw new Error('confirm=true is required for mirror writeback-state');
}

function pathForCompare(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const root = pathForCompare(resolve(rootDir));
  const target = pathForCompare(resolve(targetPath));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(rootWithSep);
}

function stableSiblingDataRoot(rootDir: string): string {
  return resolve(dirname(rootDir), `.${basename(rootDir)}-data`);
}

function safeBatchStatePath(rootDir: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('stateFile is required');
  const resolved = resolve(value.trim());
  if (!isPathInside(resolve(stableSiblingDataRoot(rootDir), 'tasks', 'batches'), resolved)) throw new Error('stateFile must be inside rental tasks/batches');
  return resolved;
}

function rentalRoot(): string {
  return process.env.RENTAL_PRICE_AGENT_DIR ?? resolve(process.cwd(), 'vendor', 'rental-price-agent');
}

function commandFromTool(toolName: string): MirrorCommand | null {
  if (toolName === 'rental.mirrorSearch') return 'search';
  if (toolName === 'rental.mirrorBatchSpec') return 'batch-spec';
  if (toolName === 'rental.mirrorWritebackState') return 'writeback-state';
  return null;
}

async function runMirror(rootDir: string, command: MirrorCommand, argument: string): Promise<Record<string, unknown>> {
  const script = join(rootDir, 'scripts', 'mirror-search.js');
  const { stdout } = await execFileAsync(process.execPath, [script, command, argument], { cwd: rootDir, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(String(stdout || '{}')) as unknown;
  return isRecord(parsed) ? parsed : { status: 'ok', rows: parsed };
}

export async function executeRentalMirrorTool(toolName: string, args: Record<string, unknown>): Promise<BotResponse> {
  const command = commandFromTool(toolName);
  if (!command) throw new Error('租赁 mirror 读侧工具无效。');
  const rootDir = rentalRoot();
  const argument = command === 'writeback-state'
    ? (readConfirm(args.confirm), safeBatchStatePath(rootDir, args.stateFile))
    : readKeyword(args.keyword);
  const result = await runMirror(rootDir, command, argument);
  const status = typeof result.status === 'string' ? result.status : 'ok';
  return {
    text: [`mirror ${command}: ${status}`, JSON.stringify(result)].join('\n'),
    metadata: {
      toolName,
      ok: status !== 'error',
      command,
      ...(command === 'writeback-state' ? { stateFile: argument } : { keyword: argument }),
      status,
      result,
    },
  };
}
