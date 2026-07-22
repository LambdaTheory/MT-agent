import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditRecordInput, AuditStartInput, AuditEndInput, AuditErrorInput } from '../src/audit/auditLogger.js';
import type { AuditRecordResult, AuditToolSpanHandle } from '../src/audit/types.js';
import { buildAuditContext, pseudonymizeAuditUserId } from '../src/audit/event.js';
import {
  prepareCancelledCallbackAudit,
  prepareConfirmedCallbackAudit,
} from '../src/audit/confirmationLifecycle.js';
import {
  confirmationContextLookupId,
  confirmationContextPath,
  type ConfirmationContextRecord,
  loadConfirmationContext,
  saveConfirmationContext,
  type SaveConfirmationContextInput,
} from '../src/audit/confirmationContextStore.js';

const tempDirs: string[] = [];
const confirmationKey = '0123456789abcdef01234567';
const createdAt = '2026-07-21T08:00:00.000Z';
const pseudonymizedInitiator = 'usr_1234567890abcdef1234567890abcdef';

async function tempAuditDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-audit-confirmation-'));
  tempDirs.push(dir);
  return dir;
}

function clock(iso = createdAt): () => Date {
  return () => new Date(iso);
}

function input(overrides: Partial<SaveConfirmationContextInput> = {}): SaveConfirmationContextInput {
  return {
    confirmationKey,
    traceId: 'trace-confirm-1',
    toolName: 'publicTraffic.runReport',
    source: 'feishu',
    requestRef: 'agent_tool_202607210800_abcd1234',
    entity: { type: 'report', id: '2026-07-20' },
    initiatorUserId: pseudonymizedInitiator,
    ...overrides,
  };
}

class RecordingCallbackAuditWriter {
  records: AuditRecordInput[] = [];

  async record(input: AuditRecordInput): Promise<AuditRecordResult> {
    this.records.push(input);
    return { ok: true, payload: JSON.stringify(input) };
  }

  async recordAt(input: AuditRecordInput): Promise<AuditRecordResult> {
    return this.record(input);
  }

  async start(input: AuditStartInput): Promise<AuditToolSpanHandle> {
    const parentSpanId = input.parentSpanId ?? input.context?.parentSpanId;
    this.records.push({
      traceId: input.traceId,
      spanId: 'tool-span',
      event: 'tool.start',
      toolName: input.toolName,
      status: 'OK',
      resultSummary: input.resultSummary ?? 'started',
      ...(input.context !== undefined ? { context: input.context } : {}),
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    return { traceId: input.traceId, spanId: 'tool-span', ...(parentSpanId !== undefined ? { parentSpanId } : {}), toolName: input.toolName, context: input.context, startedAt: createdAt, startedAtMs: 0 };
  }

  async end(handle: AuditToolSpanHandle, input: AuditEndInput): Promise<AuditRecordResult> {
    return this.record({ traceId: handle.traceId, spanId: handle.spanId, event: 'tool.end', toolName: handle.toolName, status: input.status, resultSummary: input.resultSummary, ...(handle.context !== undefined ? { context: handle.context } : {}), ...(input.tags !== undefined ? { tags: input.tags } : {}) });
  }

  async error(handle: AuditToolSpanHandle, input: AuditErrorInput): Promise<AuditRecordResult> {
    return this.record({ traceId: handle.traceId, spanId: handle.spanId, event: 'tool.error', toolName: handle.toolName, status: input.status, resultSummary: input.resultSummary, ...(handle.context !== undefined ? { context: handle.context } : {}), ...(input.error !== undefined ? { error: input.error } : {}), ...(input.tags !== undefined ? { tags: input.tags } : {}) });
  }
}

function sidecar(overrides: Partial<ConfirmationContextRecord> = {}): ConfirmationContextRecord {
  return {
    schemaVersion: 'agent_tool_confirmation_context:v1',
    traceId: 'trace-confirm-1',
    toolName: 'publicTraffic.runReport',
    requestRef: 'agent_tool_202607210800_abcd1234',
    createdAt,
    expiresAt: '2026-07-21T09:00:00.000Z',
    source: 'feishu',
    entity: { type: 'report', id: '2026-07-20' },
    initiatorUserId: pseudonymizedInitiator,
    ...overrides,
  };
}

function reviewerUserId(rawActorId: string): string {
  return pseudonymizeAuditUserId(buildAuditContext({ source: 'feishu', actorAvailable: true, rawActorId, channel: 'sdk', traceId: 'trace-reviewer', requestStartedAt: createdAt }))!;
}

async function readStoredJson(baseDir: string): Promise<{ path: string; raw: string; parsed: unknown }> {
  const path = confirmationContextPath(baseDir, confirmationKey);
  const raw = await readFile(path, 'utf8');
  return { path, raw, parsed: JSON.parse(raw) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('confirmation audit context sidecar', () => {
  it('derives deterministic one-way lookup ids and stores files below the audit data area', async () => {
    const outputDir = await tempAuditDir();
    const baseDir = join(outputDir, 'audit');
    const expectedId = createHash('sha256').update(`agent_tool_confirmation_context:v1:${confirmationKey}`).digest('hex');

    expect(confirmationContextLookupId(confirmationKey)).toBe(expectedId);
    expect(confirmationContextPath(baseDir, confirmationKey)).toBe(join(baseDir, 'confirmation-contexts', `${expectedId}.json`));

    await saveConfirmationContext(input(), { env: { MT_AGENT_OUTPUT_DIR: outputDir }, now: clock(), ttlMs: 60_000 });

    const files = await readdir(join(outputDir, 'audit', 'confirmation-contexts'));
    expect(files).toEqual([`${expectedId}.json`]);
    expect(files[0]).not.toContain(confirmationKey);
  });

  it('saves and loads a strict versioned safe record with optional request, entity, and initiator pseudonym', async () => {
    const baseDir = await tempAuditDir();

    const saved = await saveConfirmationContext(input(), { baseDir, now: clock(), ttlMs: 120_000 });
    const loaded = await loadConfirmationContext(confirmationKey, { baseDir, now: clock('2026-07-21T08:01:00.000Z') });
    const { raw, parsed } = await readStoredJson(baseDir);

    expect(saved).toEqual({
      schemaVersion: 'agent_tool_confirmation_context:v1',
      traceId: 'trace-confirm-1',
      toolName: 'publicTraffic.runReport',
      requestRef: 'agent_tool_202607210800_abcd1234',
      createdAt,
      expiresAt: '2026-07-21T08:02:00.000Z',
      source: 'feishu',
      entity: { type: 'report', id: '2026-07-20' },
      initiatorUserId: pseudonymizedInitiator,
    });
    expect(loaded).toEqual(saved);
    expect(Object.keys(parsed as Record<string, unknown>).sort()).toEqual([
      'createdAt',
      'entity',
      'expiresAt',
      'initiatorUserId',
      'requestRef',
      'schemaVersion',
      'source',
      'toolName',
      'traceId',
    ]);
    expect(raw).toMatch(/\n$/);
  });

  it('supports refreshDashboard contexts and omits absent optional fields instead of fabricating them', async () => {
    const baseDir = await tempAuditDir();

    await saveConfirmationContext(input({ toolName: 'publicTraffic.refreshDashboard', requestRef: undefined, entity: undefined, initiatorUserId: undefined }), {
      baseDir,
      now: clock(),
      ttlMs: 60_000,
    });

    const loaded = await loadConfirmationContext(confirmationKey, { baseDir, now: clock() });
    expect(loaded).toEqual({
      schemaVersion: 'agent_tool_confirmation_context:v1',
      traceId: 'trace-confirm-1',
      toolName: 'publicTraffic.refreshDashboard',
      createdAt,
      expiresAt: '2026-07-21T08:01:00.000Z',
      source: 'feishu',
    });
  });

  it('returns undefined for missing, unknown, expired, corrupt, or invalid-shape records without throwing', async () => {
    const baseDir = await tempAuditDir();

    await expect(loadConfirmationContext(confirmationKey, { baseDir, now: clock() })).resolves.toBeUndefined();
    await saveConfirmationContext(input(), { baseDir, now: clock(), ttlMs: 1_000 });
    await expect(loadConfirmationContext('abcdefabcdefabcdefabcdef', { baseDir, now: clock() })).resolves.toBeUndefined();
    await expect(loadConfirmationContext(confirmationKey, { baseDir, now: clock('2026-07-21T08:00:01.000Z') })).resolves.toBeUndefined();

    await writeFile(confirmationContextPath(baseDir, confirmationKey), '{not json', 'utf8');
    await expect(loadConfirmationContext(confirmationKey, { baseDir, now: clock() })).resolves.toBeUndefined();

    await writeFile(confirmationContextPath(baseDir, confirmationKey), JSON.stringify({ schemaVersion: 'agent_tool_confirmation_context:v1', traceId: 'trace-confirm-1' }), 'utf8');
    await expect(loadConfirmationContext(confirmationKey, { baseDir, now: clock() })).resolves.toBeUndefined();
  });

  it('rejects unsafe writer inputs instead of silently retaining extra fields or raw identities', async () => {
    const baseDir = await tempAuditDir();
    const unsafeInputs = [
      { ...input(), toolName: 'publicTraffic.reportQuery' },
      { ...input(), source: 'ou_raw_actor' },
      { ...input(), traceId: '../trace' },
      { ...input(), requestRef: 'agent_tool_ou_raw_actor' },
      { ...input(), entity: { type: 'report', id: '2026/07/20' } },
      { ...input(), entity: { type: 'report', id: '2026-07-20', productId: '653' } },
      { ...input(), initiatorUserId: 'ou_raw_actor' },
      { ...input(), arguments: { token: 'secret' } },
      { ...input(), reason: 'run this report' },
      { ...input(), rawActorId: 'ou_raw_actor' },
    ];

    for (const unsafeInput of unsafeInputs) {
      await expect(saveConfirmationContext(unsafeInput, { baseDir, now: clock(), ttlMs: 60_000 })).rejects.toThrow(/confirmation context/i);
    }
  });

  it('keeps stored JSON free of confirmation keys, executable payload, raw IDs, card text, paths, tokens, and full errors', async () => {
    const baseDir = await tempAuditDir();
    await saveConfirmationContext(input(), { baseDir, now: clock(), ttlMs: 60_000 });

    const { path, raw } = await readStoredJson(baseDir);
    expect(path).not.toContain(confirmationKey);
    for (const forbidden of [
      confirmationKey,
      'arguments',
      'reason',
      'run this report',
      'ou_raw_actor',
      'oc_raw_channel',
      'Agent 操作确认',
      'C:/secret/report.json',
      'token',
      'Authorization',
      'stack',
      'full error',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('confirmation callback audit lifecycle', () => {
  it('restores a valid confirm sidecar before the central executor tool span on the same trace', async () => {
    const writer = new RecordingCallbackAuditWriter();
    const loaded = sidecar({ initiatorUserId: reviewerUserId('ou_reviewer_same') });

    const prepared = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, {
      source: 'feishu',
      channel: 'sdk',
      channelType: 'unknown',
      rawActorId: 'ou_reviewer_same',
      messageId: 'om_callback',
      requestRef: loaded.requestRef,
    }, {
      auditLogger: writer,
      confirmationContextLoader: { load: async () => loaded },
      now: clock(),
      makeSpanId: () => 'resume-span',
    });
    await writer.start({ traceId: prepared.auditContext!.traceId, toolName: 'publicTraffic.runReport', context: prepared.auditContext, resultSummary: 'selected_tool_started', tags: ['selected_tool'] });

    expect(writer.records.map((record) => [record.event, record.traceId, record.spanId, record.status, record.resultSummary])).toEqual([
      ['run.resume', 'trace-confirm-1', 'resume-span', 'OK', 'confirmation_resumed'],
      ['tool.start', 'trace-confirm-1', 'tool-span', 'OK', 'selected_tool_started'],
    ]);
    expect(writer.records[0]?.tags).toEqual(['confirmed']);
    expect(prepared.auditContext?.parentSpanId).toBe('resume-span');
    expect(writer.records[1]?.parentSpanId).toBe('resume-span');
    expect(writer.records[0]?.entity).toEqual({ type: 'report', id: '2026-07-20' });
    expect(pseudonymizeAuditUserId(prepared.auditContext)).toBe(loaded.initiatorUserId);
    expect(JSON.stringify(writer.records)).not.toContain(confirmationKey);
  });

  it('records cancel as CANCELLED without creating a tool span', async () => {
    const writer = new RecordingCallbackAuditWriter();

    await prepareCancelledCallbackAudit('publicTraffic.refreshDashboard', confirmationKey, {
      source: 'feishu',
      channel: 'http',
      channelType: 'unknown',
      rawActorId: 'ou_cancel_reviewer',
      messageId: 'om_cancel',
      requestRef: 'agent_tool_202607210800_abcd1234',
    }, {
      auditLogger: writer,
      confirmationContextLoader: { load: async () => sidecar({ toolName: 'publicTraffic.refreshDashboard', traceId: 'trace-refresh-cancel', entity: { type: 'report', id: '2026-07-21' }, initiatorUserId: reviewerUserId('ou_cancel_reviewer') }) },
      now: clock(),
      makeSpanId: () => 'cancel-span',
    });

    expect(writer.records.map((record) => record.event)).toEqual(['run.failed']);
    expect(writer.records[0]).toMatchObject({ traceId: 'trace-refresh-cancel', spanId: 'cancel-span', event: 'run.failed', toolName: 'publicTraffic.refreshDashboard', status: 'CANCELLED', resultSummary: 'confirmation_cancelled', tags: ['cancelled'] });
  });

  it('falls back for invalid keys or missing historical sidecars with a fresh trace and explicit tags', async () => {
    const writer = new RecordingCallbackAuditWriter();
    let loadCalls = 0;

    const prepared = await prepareConfirmedCallbackAudit('publicTraffic.runReport', 'not-a-valid-key', {
      source: 'feishu',
      channel: 'http',
      rawActorId: 'ou_historical_reviewer',
    }, {
      auditLogger: writer,
      confirmationContextLoader: { load: async () => { loadCalls += 1; throw new Error('must not authorize'); } },
      now: clock(),
      makeTraceId: () => 'trace-historical-callback',
      makeSpanId: () => 'historical-resume-span',
    });

    expect(loadCalls).toBe(0);
    expect(prepared.sidecar).toBeUndefined();
    expect(prepared.auditContext?.traceId).toBe('trace-historical-callback');
    expect(prepared.auditContext?.parentSpanId).toBe('historical-resume-span');
    expect(writer.records[0]).toMatchObject({ event: 'run.resume', traceId: 'trace-historical-callback', tags: ['confirmed', 'historical_callback', 'no_historical_sidecar'] });
  });

  it('treats mismatched tool or requestRef sidecars as unavailable historical context', async () => {
    const cases = [
      sidecar({ toolName: 'publicTraffic.refreshDashboard' }),
      sidecar({ requestRef: 'agent_tool_202607210800_otherref' }),
    ];

    for (const loaded of cases) {
      const writer = new RecordingCallbackAuditWriter();
      const prepared = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, {
        source: 'feishu',
        channel: 'sdk',
        rawActorId: 'ou_reviewer_mismatch',
        requestRef: 'agent_tool_202607210800_abcd1234',
      }, {
        auditLogger: writer,
        confirmationContextLoader: { load: async () => loaded },
        now: clock(),
        makeTraceId: () => 'trace-fallback-mismatch',
        makeSpanId: () => 'mismatch-span',
      });

      expect(prepared.sidecar).toBeUndefined();
      expect(prepared.auditContext?.traceId).toBe('trace-fallback-mismatch');
      expect(prepared.auditContext?.parentSpanId).toBe('mismatch-span');
      expect(writer.records[0]).toMatchObject({ event: 'run.resume', traceId: 'trace-fallback-mismatch', tags: ['confirmed', 'historical_callback', 'no_historical_sidecar'] });
    }
  });

  it('attributes same reviewers, delegated reviewers, missing actor fallback, and unknown actor separately', async () => {
    const sameInitiator = reviewerUserId('ou_same_reviewer');
    const same = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, { source: 'feishu', channel: 'sdk', rawActorId: 'ou_same_reviewer' }, { confirmationContextLoader: { load: async () => sidecar({ initiatorUserId: sameInitiator }) }, now: clock() });
    const delegated = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, { source: 'feishu', channel: 'sdk', rawActorId: 'ou_other_reviewer' }, { confirmationContextLoader: { load: async () => sidecar({ initiatorUserId: sameInitiator }) }, now: clock() });
    const fallback = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, { source: 'feishu', channel: 'sdk' }, { confirmationContextLoader: { load: async () => sidecar({ initiatorUserId: sameInitiator }) }, now: clock() });
    const unknown = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, { source: 'feishu', channel: 'sdk' }, { confirmationContextLoader: { load: async () => sidecar({ initiatorUserId: undefined }) }, now: clock() });

    expect(same.tags).toEqual(['confirmed']);
    expect(pseudonymizeAuditUserId(same.auditContext)).toBe(sameInitiator);
    expect(delegated.tags).toEqual(['confirmed', 'delegated_confirmation']);
    expect(pseudonymizeAuditUserId(delegated.auditContext)).toBe(reviewerUserId('ou_other_reviewer'));
    expect(fallback.tags).toEqual(['confirmed', 'initiator_fallback']);
    expect(pseudonymizeAuditUserId(fallback.auditContext)).toBe(sameInitiator);
    expect(unknown.tags).toEqual(['confirmed']);
    expect(pseudonymizeAuditUserId(unknown.auditContext)).toBeUndefined();
  });

  it('keeps HTTP and SDK callback audit sequences symmetric except for transport channel', async () => {
    const sequences = await Promise.all((['http', 'sdk'] as const).map(async (channel) => {
      const writer = new RecordingCallbackAuditWriter();
      const prepared = await prepareConfirmedCallbackAudit('publicTraffic.runReport', confirmationKey, { source: 'feishu', channel, rawActorId: 'ou_symmetry' }, { auditLogger: writer, confirmationContextLoader: { load: async () => sidecar({ initiatorUserId: reviewerUserId('ou_symmetry') }) }, now: clock(), makeSpanId: () => 'symmetry-resume' });
      await writer.start({ traceId: prepared.auditContext!.traceId, toolName: 'publicTraffic.runReport', context: prepared.auditContext, resultSummary: 'selected_tool_started', tags: ['selected_tool'] });
      return writer.records.map((record) => ({ event: record.event, traceId: record.traceId, toolName: record.toolName, status: record.status, resultSummary: record.resultSummary, parentSpanId: record.parentSpanId, channel: record.context?.channel }));
    }));

    expect(sequences[0]?.map(({ channel: _channel, ...record }) => record)).toEqual(sequences[1]?.map(({ channel: _channel, ...record }) => record));
    expect(sequences[0]?.map((record) => record.channel)).toEqual(['http', 'http']);
    expect(sequences[1]?.map((record) => record.channel)).toEqual(['sdk', 'sdk']);
  });
});
