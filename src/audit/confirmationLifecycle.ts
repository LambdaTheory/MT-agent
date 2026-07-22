import { randomUUID } from 'node:crypto';
import { buildAuditContext, pseudonymizeAuditUserId } from './event.js';
import { loadConfirmationContext, type ConfirmationContextRecord } from './confirmationContextStore.js';
import type { AuditChannel, AuditChannelType, AuditContext, AuditSource } from './types.js';
import type { AuditWriter } from './auditLogger.js';

export interface ConfirmationContextLoader {
  load(confirmationKey: string): Promise<ConfirmationContextRecord | undefined>;
}

export interface ConfirmationCallbackFacts {
  source: AuditSource;
  channel: Extract<AuditChannel, 'http' | 'sdk'>;
  channelType?: AuditChannelType;
  rawActorId?: string;
  rawChannelId?: string;
  messageId?: string;
  requestRef?: string;
}

export interface ConfirmationLifecycleDependencies {
  auditLogger?: AuditWriter;
  confirmationContextLoader?: ConfirmationContextLoader;
  now?: () => Date;
  makeTraceId?: () => string;
  makeSpanId?: () => string;
}

export interface ConfirmationLifecycleResult {
  auditContext?: AuditContext;
  auditLogger?: AuditWriter;
  tags: string[];
  sidecar?: ConfirmationContextRecord;
}

const selectedCallbackTools = new Set<string>(['publicTraffic.runReport', 'publicTraffic.refreshDashboard']);
const confirmationKeyPattern = /^[a-f0-9]{24}$/i;

export function isSelectedConfirmationCallbackTool(toolName: string | undefined): toolName is 'publicTraffic.runReport' | 'publicTraffic.refreshDashboard' {
  return toolName !== undefined && selectedCallbackTools.has(toolName);
}

export function confirmationKeyFromCallbackValue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const key = value.confirmationKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

export async function prepareConfirmedCallbackAudit(
  toolName: string,
  confirmationKey: string | undefined,
  facts: ConfirmationCallbackFacts,
  dependencies: ConfirmationLifecycleDependencies = {},
): Promise<ConfirmationLifecycleResult> {
  return prepareCallbackAudit('confirmed', toolName, confirmationKey, facts, dependencies);
}

export async function prepareCancelledCallbackAudit(
  toolName: string,
  confirmationKey: string | undefined,
  facts: ConfirmationCallbackFacts,
  dependencies: ConfirmationLifecycleDependencies = {},
): Promise<ConfirmationLifecycleResult> {
  return prepareCallbackAudit('cancelled', toolName, confirmationKey, facts, dependencies);
}

async function prepareCallbackAudit(
  actionTag: 'confirmed' | 'cancelled',
  toolName: string,
  confirmationKey: string | undefined,
  facts: ConfirmationCallbackFacts,
  dependencies: ConfirmationLifecycleDependencies,
): Promise<ConfirmationLifecycleResult> {
  if (!isSelectedConfirmationCallbackTool(toolName)) return { tags: [] };
  const sidecar = await loadMatchingSidecar(confirmationKey, toolName, facts.requestRef, dependencies.confirmationContextLoader);
  const callbackSpanId = dependencies.makeSpanId?.() ?? randomUUID();
  const lifecycleContext = buildCallbackAuditContext(sidecar, facts, dependencies);
  const auditContext = buildAuditContext({ ...lifecycleContext, parentSpanId: callbackSpanId });
  const tags = callbackTags(actionTag, auditContext, sidecar);
  await recordCallbackLifecycle(actionTag, toolName, lifecycleContext, callbackSpanId, sidecar, tags, dependencies);
  return {
    auditContext,
    ...(dependencies.auditLogger !== undefined ? { auditLogger: dependencies.auditLogger } : {}),
    tags,
    ...(sidecar !== undefined ? { sidecar } : {}),
  };
}

async function loadMatchingSidecar(
  confirmationKey: string | undefined,
  toolName: 'publicTraffic.runReport' | 'publicTraffic.refreshDashboard',
  requestRef: string | undefined,
  loader: ConfirmationContextLoader | undefined,
): Promise<ConfirmationContextRecord | undefined> {
  if (confirmationKey === undefined || !confirmationKeyPattern.test(confirmationKey.trim())) return undefined;
  try {
    const sidecar = loader ? await loader.load(confirmationKey) : await loadConfirmationContext(confirmationKey);
    if (sidecar === undefined) return undefined;
    if (sidecar.toolName !== toolName) return undefined;
    if (requestRef !== undefined && sidecar.requestRef !== undefined && requestRef !== sidecar.requestRef) return undefined;
    return sidecar;
  } catch (_error) {
    return undefined;
  }
}

function buildCallbackAuditContext(
  sidecar: ConfirmationContextRecord | undefined,
  facts: ConfirmationCallbackFacts,
  dependencies: ConfirmationLifecycleDependencies,
): AuditContext {
  const actor = facts.rawActorId?.trim();
  const baseContext: AuditContext = {
    source: facts.source,
    actorAvailable: actor !== undefined && actor.length > 0,
    ...(actor ? { rawActorId: actor } : sidecar?.initiatorUserId ? { userIdOverride: sidecar.initiatorUserId } : {}),
    channel: facts.channel,
    ...(facts.channelType !== undefined ? { channelType: facts.channelType } : {}),
    ...(facts.rawChannelId !== undefined ? { rawChannelId: facts.rawChannelId } : {}),
    ...(facts.messageId !== undefined ? { messageId: facts.messageId } : {}),
    ...(facts.requestRef !== undefined ? { requestRef: facts.requestRef } : sidecar?.requestRef !== undefined ? { requestRef: sidecar.requestRef } : {}),
    traceId: sidecar?.traceId ?? (dependencies.makeTraceId?.() ?? randomUUID()),
    requestStartedAt: (dependencies.now?.() ?? new Date()).toISOString(),
  };
  return buildAuditContext(baseContext);
}

function callbackTags(actionTag: 'confirmed' | 'cancelled', context: AuditContext, sidecar: ConfirmationContextRecord | undefined): string[] {
  const tags: string[] = [actionTag];
  if (sidecar === undefined) tags.push('historical_callback', 'no_historical_sidecar');
  if (context.userIdOverride !== undefined) tags.push('initiator_fallback');
  const reviewer = context.rawActorId !== undefined ? pseudonymizeAuditUserId(context) : undefined;
  if (reviewer !== undefined && sidecar?.initiatorUserId !== undefined && reviewer !== sidecar.initiatorUserId) tags.push('delegated_confirmation');
  return tags;
}

async function recordCallbackLifecycle(
  actionTag: 'confirmed' | 'cancelled',
  toolName: 'publicTraffic.runReport' | 'publicTraffic.refreshDashboard',
  context: AuditContext,
  spanId: string,
  sidecar: ConfirmationContextRecord | undefined,
  tags: string[],
  dependencies: ConfirmationLifecycleDependencies,
): Promise<void> {
  const writer = dependencies.auditLogger;
  if (writer === undefined) return;
  try {
    await writer.record({
      traceId: context.traceId,
      spanId,
      event: actionTag === 'confirmed' ? 'run.resume' : 'run.failed',
      toolName,
      status: actionTag === 'confirmed' ? 'OK' : 'CANCELLED',
      resultSummary: actionTag === 'confirmed' ? 'confirmation_resumed' : 'confirmation_cancelled',
      context,
      ...(sidecar?.entity !== undefined ? { entity: sidecar.entity } : {}),
      tags,
    });
  } catch (_error) {
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
