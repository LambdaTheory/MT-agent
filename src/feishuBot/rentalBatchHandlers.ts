import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';
import type { BotResponse } from './types.js';

const execFileAsync = promisify(execFile);

type BatchCommand = 'preview' | 'execute' | 'status' | 'resume' | 'report' | 'rollback';

interface BatchToolRequest {
  command: BatchCommand;
  fileArg?: string;
  confirm?: boolean;
  confirmFormSetupWithoutPreview?: boolean;
}

interface ResumeSpec {
  file: string;
  originalStateFile: string;
  resumedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function rentalRoot(): string {
  return process.env.RENTAL_PRICE_AGENT_DIR ?? resolve(process.cwd(), 'vendor', 'rental-price-agent');
}

function safeBatchPath(rootDir: string, value: unknown, fieldName: string): string {
  const raw = readString(value);
  if (!raw || raw.includes('\0')) throw new Error(`${fieldName} is required`);
  const batchesDir = resolve(rootDir, 'tasks', 'batches');
  const resolved = resolve(raw);
  if (!isPathInside(batchesDir, resolved)) throw new Error(`${fieldName} must be inside rental tasks/batches`);
  return resolved;
}

function requestFromTool(toolName: string, args: Record<string, unknown>, rootDir: string): BatchToolRequest | null {
  switch (toolName) {
    case 'rental.batchPreview':
      return { command: 'preview', fileArg: safeBatchPath(rootDir, args.specFile, 'specFile') };
    case 'rental.batchExecute':
      return { command: 'execute', fileArg: safeBatchPath(rootDir, args.specFile, 'specFile'), confirmFormSetupWithoutPreview: args.confirmFormSetupWithoutPreview === true };
    case 'rental.batchStatus':
      return { command: 'status', fileArg: safeBatchPath(rootDir, args.stateFile, 'stateFile') };
    case 'rental.batchResume':
      return { command: 'resume', fileArg: safeBatchPath(rootDir, args.stateFile, 'stateFile') };
    case 'rental.batchReport':
      return { command: 'report', fileArg: safeBatchPath(rootDir, args.stateFile, 'stateFile') };
    case 'rental.batchRollback':
      return { command: 'rollback', fileArg: safeBatchPath(rootDir, args.stateFile, 'stateFile'), confirm: args.confirm === true };
    default:
      return null;
  }
}

async function executionSpecFile(rootDir: string, specFile: string, confirmFormSetupWithoutPreview: boolean): Promise<string> {
  if (!confirmFormSetupWithoutPreview) return specFile;
  const parsed = JSON.parse(await readFile(specFile, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error('specFile must contain an object');
  const options = isRecord(parsed.options) ? parsed.options : {};
  const batchesDir = resolve(rootDir, 'tasks', 'batches');
  await mkdir(batchesDir, { recursive: true });
  const file = join(batchesDir, `mt-agent-batch-execute-${Date.now()}.json`);
  await writeFile(file, `${JSON.stringify({ ...parsed, options: { ...options, confirmFormSetupWithoutPreview: true } }, null, 2)}\n`, 'utf8');
  return file;
}

function readProductIdFromResult(value: unknown): string | null {
  return isRecord(value) && typeof value.productId === 'string' ? value.productId : null;
}

async function resumeSpecFile(rootDir: string, stateFile: string): Promise<ResumeSpec> {
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as unknown;
  if (!isRecord(state)) throw new Error('stateFile must contain an object');
  const status = readString(state.status);
  if (status === 'completed' || status === 'completed_with_mismatch' || status === 'delayed_verified') throw new Error('stateFile is already terminal');
  const spec = isRecord(state.spec) ? state.spec : null;
  const items = Array.isArray(spec?.items) ? spec.items.filter(isRecord) : [];
  if (!items.length) throw new Error('stateFile spec.items is required for exact resume');
  const doneIds = new Set([
    ...(Array.isArray(state.completed) ? state.completed : []),
    ...(Array.isArray(state.verifyFailed) ? state.verifyFailed : []),
    ...(Array.isArray(state.failed) ? state.failed : []),
  ].map(readProductIdFromResult).filter((id): id is string => id !== null));
  const remaining = items.filter((item) => {
    const productId = readString(item.productId);
    return productId !== null && !doneIds.has(productId);
  });
  if (!remaining.length) throw new Error('stateFile has no remaining batch items');
  const batchesDir = resolve(rootDir, 'tasks', 'batches');
  await mkdir(batchesDir, { recursive: true });
  const batchId = readString(state.batchId) ?? 'unknown';
  const resumedAt = new Date().toISOString();
  const file = join(batchesDir, `mt-agent-batch-resume-${batchId}-${Date.now()}.json`);
  await writeFile(file, `${JSON.stringify({
    items: remaining,
    ...(spec && spec.shared !== undefined ? { shared: spec.shared } : {}),
    ...(spec && spec.sharedSetup !== undefined ? { sharedSetup: spec.sharedSetup } : {}),
    ...(spec && isRecord(spec.options) ? { options: spec.options } : {}),
    resumeFrom: batchId,
    resumedAt,
  }, null, 2)}\n`, 'utf8');
  return { file, originalStateFile: stateFile, resumedAt };
}

function readResultStateFile(result: Record<string, unknown>): string | null {
  return readString(result.stateFile);
}

function readResultBatchId(result: Record<string, unknown>): string | null {
  if (isRecord(result.state)) {
    const stateBatchId = readString(result.state.batchId);
    if (stateBatchId) return stateBatchId;
  }
  if (isRecord(result.report)) {
    const reportBatchId = readString(result.report.batchId);
    if (reportBatchId) return reportBatchId;
  }
  return readString(result.batchId);
}

async function writeResumeLink(resume: ResumeSpec, result: Record<string, unknown>): Promise<void> {
  const resumedTo = readResultBatchId(result);
  const resumeStateFile = readResultStateFile(result);
  if (!resumedTo || !resumeStateFile) return;
  const original = JSON.parse(await readFile(resume.originalStateFile, 'utf8')) as unknown;
  if (!isRecord(original)) throw new Error('stateFile must contain an object');
  await writeFile(resume.originalStateFile, `${JSON.stringify({
    ...original,
    resumedAt: resume.resumedAt,
    resumedTo,
    resumeStateFile: basename(resumeStateFile),
  }, null, 2)}\n`, 'utf8');
}

async function runBatchRunner(rootDir: string, request: BatchToolRequest): Promise<Record<string, unknown>> {
  const script = join(rootDir, 'scripts', 'batch-runner.js');
  let resume: ResumeSpec | undefined;
  const fileArg = request.command === 'execute' && request.fileArg
    ? await executionSpecFile(rootDir, request.fileArg, request.confirmFormSetupWithoutPreview === true)
    : request.command === 'resume' && request.fileArg
      ? (resume = await resumeSpecFile(rootDir, request.fileArg)).file
      : request.fileArg;
  const command = request.command === 'resume' ? 'execute' : request.command;
  const args = request.command === 'rollback' && request.confirm && fileArg
    ? ['rollback', '--confirm', fileArg]
    : fileArg
      ? [command, fileArg]
      : [command];
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd: rootDir, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(String(stdout || '{}')) as unknown;
  const result = isRecord(parsed) ? parsed : { status: 'ok', result: parsed };
  if (resume) await writeResumeLink(resume, result);
  return result;
}

type BatchWriteEvent = 'execution_started' | 'execution_succeeded' | 'execution_failed';

function isLedgeredBatchWrite(request: BatchToolRequest): boolean {
  return request.command === 'execute' || request.command === 'resume' || (request.command === 'rollback' && request.confirm === true);
}

async function recordBatchEvent(context: RentalWriteLedgerContext | undefined, event: BatchWriteEvent, toolName: string, request: BatchToolRequest, status?: string): Promise<void> {
  if (!context || !isLedgeredBatchWrite(request)) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? 'ad-hoc',
    at: new Date().toISOString(),
    ...(context.missionDate ? { partitionDate: context.missionDate } : {}),
    event,
    toolName,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    metadata: {
      command: request.command,
      ...(request.fileArg ? { fileArg: request.fileArg } : {}),
      ...(status ? { status } : {}),
      ...(context.missionDate ? { missionDate: context.missionDate } : {}),
    },
  });
}

async function recordFailedBatchEvent(context: RentalWriteLedgerContext | undefined, toolName: string, request: BatchToolRequest): Promise<void> {
  try {
    await recordBatchEvent(context, 'execution_failed', toolName, request);
  } catch (ledgerError) {
    console.warn('Failed to record rental batch failure event.', ledgerError);
  }
}

export async function executeRentalBatchTool(toolName: string, args: Record<string, unknown>, ledgerContext?: RentalWriteLedgerContext): Promise<BotResponse> {
  const rootDir = rentalRoot();
  const request = requestFromTool(toolName, args, rootDir);
  if (!request) throw new Error('租赁批处理参数无效，请重新发起。');
  await recordBatchEvent(ledgerContext, 'execution_started', toolName, request);
  try {
    const result = await runBatchRunner(rootDir, request);
    const status = typeof result.status === 'string' ? result.status : 'ok';
    const ok = status !== 'error';
    await recordBatchEvent(ledgerContext, ok ? 'execution_succeeded' : 'execution_failed', toolName, request, status);
    return {
      text: [`batch ${request.command}: ${status}`, JSON.stringify(result)].join('\n'),
      metadata: { toolName, ok, command: request.command, status, result },
    };
  } catch (error) {
    await recordFailedBatchEvent(ledgerContext, toolName, request);
    throw error;
  }
}
