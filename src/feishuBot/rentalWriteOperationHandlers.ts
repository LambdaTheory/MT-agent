import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import type { BotResponse } from './types.js';
import {
  executeRentalOperationConfirmRequest,
  rentalOperationConfirmRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';

export interface RentalWriteLedgerContext {
  outputDir: string;
  runId?: string;
  decisionId?: string;
  missionDate?: string;
}

type RentalWriteEvent = 'execution_started' | 'execution_succeeded' | 'execution_failed';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireString(value: unknown, fieldName: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`${fieldName} is required`);
  return parsed;
}

function requireProductId(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+$/.test(parsed)) throw new Error(`${fieldName} must be numeric`);
  return parsed;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function requireTenancyDays(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+(?:,\d+)*$/.test(parsed)) throw new Error(`${fieldName} must be comma-separated day numbers`);
  return parsed;
}

function rentalAgentToolRequest(toolName: string, args: Record<string, unknown>): RentalOperationConfirmRequest | null {
  switch (toolName) {
    case 'rental.copy':
      return { action: 'copy', productId: requireProductId(args.productId, 'productId') };
    case 'rental.delist':
      return { action: 'delist', productId: requireProductId(args.productId, 'productId') };
    case 'rental.tenancySet':
      return {
        action: 'tenancy-set',
        productId: requireProductId(args.productId, 'productId'),
        days: requireTenancyDays(args.days, 'days'),
      };
    case 'rental.specDiscover':
      return { action: 'spec-discover', productId: requireProductId(args.productId, 'productId') };
    case 'rental.specAddAndRefresh':
      return {
        action: 'spec-add-and-refresh',
        productId: requireProductId(args.productId, 'productId'),
        specDimId: requireString(args.specDimId, 'specDimId'),
        itemTitle: requireString(args.itemTitle, 'itemTitle'),
      };
    case 'rental.specAddItem':
      return {
        action: 'spec-add-item',
        productId: requireProductId(args.productId, 'productId'),
        specDimId: requireString(args.specDimId, 'specDimId'),
        itemTitle: requireString(args.itemTitle, 'itemTitle'),
      };
    case 'rental.specRefresh':
      return { action: 'spec-refresh', productId: requireProductId(args.productId, 'productId') };
    case 'rental.applyCurrent':
      return {
        action: 'apply-current',
        productId: requireProductId(args.expectedProductId, 'expectedProductId'),
        changes: requireRecord(args.changes, 'changes'),
      };
    case 'rental.submitCurrent':
      return { action: 'submit-current', productId: requireProductId(args.expectedProductId, 'expectedProductId') };
    default:
      return null;
  }
}

async function recordWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  event: RentalWriteEvent,
  toolName: string,
  productId: string,
  rentalAction: RentalOperationConfirmRequest['action'],
): Promise<void> {
  if (!context) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? 'ad-hoc',
    at: new Date().toISOString(),
    event,
    toolName,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    subject: { kind: 'product', id: productId },
    metadata: {
      ...(context.missionDate ? { missionDate: context.missionDate } : {}),
      rentalAction,
      executionTimestampRecorded: true,
    },
  });
}

export const RENTAL_DELIST_MAX_AUDIT_WARNINGS = 20;

function auditWarning(productId: string, error: unknown): string {
  return `商品 ${productId}：下架审计记录失败（${error instanceof Error ? error.message : String(error)}）`;
}

export async function recordSuccessfulRentalDelistEvent(
  context: RentalWriteLedgerContext | undefined,
  toolName: string,
  productId: string,
): Promise<void> {
  await recordWriteEvent(context, 'execution_succeeded', toolName, productId, 'delist');
}

export async function recordSuccessfulRentalDelistEventBestEffort(
  context: RentalWriteLedgerContext | undefined,
  toolName: string,
  productId: string,
): Promise<string | undefined> {
  try {
    await recordSuccessfulRentalDelistEvent(context, toolName, productId);
  } catch (error) {
    return auditWarning(productId, error);
  }
  return undefined;
}

export function appendRentalDelistAuditWarnings(
  response: BotResponse,
  warnings: string[],
): BotResponse {
  const auditWarnings = [
    ...(Array.isArray(response.metadata?.auditWarnings) ? response.metadata.auditWarnings.filter((value): value is string => typeof value === 'string') : []),
    ...warnings,
  ].slice(0, RENTAL_DELIST_MAX_AUDIT_WARNINGS);
  if (auditWarnings.length === 0) return response;
  return {
    ...response,
    text: `${response.text}\n审计警告：${auditWarnings.join('；')}`,
    metadata: { ...(response.metadata ?? {}), auditWarnings },
  };
}

async function recordFailedWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  toolName: string,
  productId: string,
  rentalAction: RentalOperationConfirmRequest['action'],
): Promise<void> {
  try {
    await recordWriteEvent(context, 'execution_failed', toolName, productId, rentalAction);
  } catch (ledgerError) {
    console.warn('Failed to record rental write failure event.', ledgerError);
  }
}

export async function executeRentalWriteOperationHandler(
  request: AgentToolConfirmRequest,
  client: RentalPriceSkillClient,
  ledgerContext?: RentalWriteLedgerContext,
): Promise<BotResponse> {
  if (request.toolName === 'rental.operationConfirmRequest') {
    const rentalRequest = rentalOperationConfirmRequestFromToolArguments(request.arguments);
    if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
    await recordWriteEvent(ledgerContext, 'execution_started', request.toolName, rentalRequest.productId, rentalRequest.action);
    try {
      const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
      const warning = rentalRequest.action === 'delist' && result.ok
        ? await recordSuccessfulRentalDelistEventBestEffort(ledgerContext, request.toolName, rentalRequest.productId)
        : undefined;
      if (!(rentalRequest.action === 'delist' && result.ok)) {
        await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', request.toolName, rentalRequest.productId, rentalRequest.action);
      }
      return appendRentalDelistAuditWarnings({
        text: result.text,
        metadata: {
          ...(result.metadata ?? {}),
          toolName: request.toolName,
          ok: result.ok,
          productId: rentalRequest.productId,
        },
      }, warning ? [warning] : []);
    } catch (error) {
      await recordFailedWriteEvent(ledgerContext, request.toolName, rentalRequest.productId, rentalRequest.action);
      throw error;
    }
  }

  const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
  if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
  await recordWriteEvent(ledgerContext, 'execution_started', request.toolName, rentalRequest.productId, rentalRequest.action);
  try {
    const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
    const warning = rentalRequest.action === 'delist' && result.ok
      ? await recordSuccessfulRentalDelistEventBestEffort(ledgerContext, request.toolName, rentalRequest.productId)
      : undefined;
    if (!(rentalRequest.action === 'delist' && result.ok)) {
      await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', request.toolName, rentalRequest.productId, rentalRequest.action);
    }
    return appendRentalDelistAuditWarnings({
      text: result.text,
      metadata: {
        ...(result.metadata ?? {}),
        toolName: request.toolName,
        ok: result.ok,
        productId: rentalRequest.productId,
      },
    }, warning ? [warning] : []);
  } catch (error) {
    await recordFailedWriteEvent(ledgerContext, request.toolName, rentalRequest.productId, rentalRequest.action);
    throw error;
  }
}
