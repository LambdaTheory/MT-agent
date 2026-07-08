import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClarificationContext, ResolutionCandidate } from '../agentRuntime/intentResolution.js';

interface StoredClarificationContext {
  ref: string;
  createdAt: string;
  context: ClarificationContext;
}

function clarificationContextDir(outputDir: string): string {
  return join(outputDir, 'latest', 'agent-clarification-contexts');
}

function clarificationContextRef(context: ClarificationContext): string {
  const hash = createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0, 16);
  return `clarify_${Date.now()}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseCandidate(value: unknown): ResolutionCandidate | null {
  if (!isRecord(value)) return null;
  const toolName = readString(value.toolName);
  const label = readString(value.label);
  const args = value.arguments;
  const description = value.description === undefined ? undefined : readString(value.description);
  if (!toolName || !label || !isRecord(args) || description === null) return null;
  return { toolName, arguments: args, label, ...(description ? { description } : {}) };
}

function parseClarificationContext(value: unknown): ClarificationContext | null {
  if (!isRecord(value)) return null;
  const originalMessage = readString(value.originalMessage);
  const question = readString(value.question);
  const reason = readString(value.reason);
  const depth = value.depth;
  const confidence = value.confidence;
  if (
    !originalMessage ||
    !question ||
    !reason ||
    typeof depth !== 'number' ||
    !Number.isInteger(depth) ||
    depth < 0 ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    !Array.isArray(value.candidates)
  ) {
    return null;
  }
  const candidates: ResolutionCandidate[] = [];
  for (const candidate of value.candidates) {
    const parsed = parseCandidate(candidate);
    if (!parsed) return null;
    candidates.push(parsed);
  }
  return { originalMessage, question, reason, candidates, depth, confidence };
}

export async function saveClarificationContext(outputDir: string, context: ClarificationContext): Promise<string> {
  const ref = clarificationContextRef(context);
  const dir = clarificationContextDir(outputDir);
  await mkdir(dir, { recursive: true });
  const record: StoredClarificationContext = { ref, createdAt: new Date().toISOString(), context };
  await writeFile(join(dir, `${ref}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return ref;
}

export async function loadClarificationContext(outputDir: string, ref: string): Promise<ClarificationContext | null> {
  const file = join(clarificationContextDir(outputDir), `${ref}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.ref !== ref) return null;
  return parseClarificationContext(parsed.context);
}

export function clarificationConfirmationKey(context: ClarificationContext): string {
  return createHash('sha256')
    .update(`${JSON.stringify(context.candidates)}${context.originalMessage}`)
    .digest('hex')
    .slice(0, 24);
}

export function verifyClarificationKey(context: ClarificationContext, suppliedKey: unknown): boolean {
  if (typeof suppliedKey !== 'string') return false;
  return suppliedKey.trim().toLowerCase() === clarificationConfirmationKey(context);
}
