import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseAgentToolConfirmReference,
  parseAgentToolConfirmRequest,
  type AgentToolConfirmRequest,
} from '../agentRuntime/approvalCard.js';

interface StoredAgentToolConfirmRequest {
  ref: string;
  createdAt: string;
  request: AgentToolConfirmRequest;
}

function confirmRequestDir(outputDir: string): string {
  return join(outputDir, 'latest', 'agent-tool-confirm-requests');
}

function confirmRequestRef(request: AgentToolConfirmRequest): string {
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
  return `agent_tool_${Date.now()}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function saveAgentToolConfirmRequest(outputDir: string, request: AgentToolConfirmRequest): Promise<string> {
  const ref = confirmRequestRef(request);
  const dir = confirmRequestDir(outputDir);
  await mkdir(dir, { recursive: true });
  const record: StoredAgentToolConfirmRequest = { ref, createdAt: new Date().toISOString(), request };
  await writeFile(join(dir, `${ref}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return ref;
}

export async function loadAgentToolConfirmRequestFromValue(outputDir: string, value: unknown): Promise<AgentToolConfirmRequest | null> {
  const inline = parseAgentToolConfirmRequest(value);
  if (inline) return inline;

  const ref = parseAgentToolConfirmReference(value);
  if (!ref) return null;

  const file = join(confirmRequestDir(outputDir), `${ref.requestRef}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.ref !== ref.requestRef || !isRecord(parsed.request)) return null;
  return parseAgentToolConfirmRequest({ request: parsed.request, confirmationKey: ref.confirmationKey });
}
