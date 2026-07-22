import type { AuditHttpSendResult } from './types.js';

export interface SendAuditPayloadOptions {
  payload: string;
  ingestUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const timeoutMarker = Symbol('audit-timeout');

export async function sendAuditPayload(options: SendAuditPayloadOptions): Promise<AuditHttpSendResult> {
  validatePayload(options.payload);
  validateIngestUrl(options.ingestUrl);
  validateTimeout(options.timeoutMs);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      activeReader?.cancel().catch((_error: unknown) => undefined);
      resolve(timeoutMarker);
    }, options.timeoutMs);
  });
  const operation = sendAndClassify(options, controller, (reader) => {
    activeReader = reader;
  });
  operation.catch(() => undefined);
  try {
    const raced = await Promise.race([operation, timeoutPromise]);
    if (raced === timeoutMarker) return { kind: 'retry', reason: 'timeout', category: 'transient' };
    return raced;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function sendAndClassify(
  options: SendAuditPayloadOptions,
  controller: AbortController,
  setActiveReader: (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => void,
): Promise<AuditHttpSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: options.payload,
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) return { kind: 'retry', reason: 'timeout', category: 'transient' };
    return { kind: 'retry', reason: 'network', category: 'transient' };
  }

  const statusCode = response.status;
  if (statusCode === 400) return { kind: 'isolate', reason: 'status_400', statusCode };
  if (statusCode === 413) return { kind: 'isolate', reason: 'status_413', statusCode };
  if (statusCode === 415) return { kind: 'isolate', reason: 'status_415', statusCode };
  if (statusCode < 200 || statusCode >= 300) return { kind: 'retry', reason: 'non_2xx', category: 'remote', statusCode };

  let ack: unknown;
  try {
    ack = JSON.parse(await readAckText(response, setActiveReader)) as unknown;
  } catch (_error) {
    if (controller.signal.aborted) return { kind: 'retry', reason: 'timeout', category: 'transient' };
    return { kind: 'retry', reason: 'malformed_response', category: 'remote', statusCode };
  }
  return classifyAck(ack, statusCode);
}

async function readAckText(response: Response, setActiveReader: (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => void): Promise<string> {
  if (response.body === null) return await response.text();
  const reader = response.body.getReader();
  setActiveReader(reader);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxAckBytes = 64 * 1024;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxAckBytes) throw new Error('audit HTTP ack exceeds maximum size');
      chunks.push(chunk.value);
    }
  } finally {
    setActiveReader(undefined);
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function classifyAck(ack: unknown, statusCode: number): AuditHttpSendResult {
  if (!isRecord(ack)) return { kind: 'retry', reason: 'malformed_response', category: 'remote', statusCode };
  const accepted = ack.accepted;
  const rejected = ack.rejected;
  const errors = ack.errors;
  if (!Number.isInteger(accepted) || !Number.isInteger(rejected) || !Array.isArray(errors)) {
    return { kind: 'retry', reason: 'malformed_response', category: 'remote', statusCode };
  }
  if (accepted === 1 && rejected === 0 && errors.length === 0) return { kind: 'accepted', statusCode };
  return { kind: 'retry', reason: 'negative_ack', category: 'remote', statusCode };
}

function validatePayload(payload: string): void {
  if (payload.length === 0 || payload.trim().length === 0) throw new Error('audit HTTP payload must be non-empty');
  if (/[\r\n]/.test(payload)) throw new Error('audit HTTP payload must be single-line');
}

function validateIngestUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('audit ingest URL must be an absolute /v1/ingest URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/v1/ingest' || url.username || url.password || url.search || url.hash) {
    throw new Error('audit ingest URL must be an absolute /v1/ingest URL');
  }
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('audit HTTP timeout must be a finite positive integer');
  }
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
