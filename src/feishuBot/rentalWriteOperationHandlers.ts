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
        itemTitle: requireString(args.itemTitle, 'itemTitle'),
      };
    default:
      return null;
  }
}

async function recordWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  event: RentalWriteEvent,
  toolName: string,
  productId: string,
): Promise<void> {
  if (!context) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? 'ad-hoc',
    at: context.missionDate ? `${context.missionDate}T00:00:00.000Z` : new Date().toISOString(),
    event,
    toolName,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    subject: { kind: 'product', id: productId },
    ...(context.missionDate ? { metadata: { missionDate: context.missionDate } } : {}),
  });
}

async function recordFailedWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  toolName: string,
  productId: string,
): Promise<void> {
  try {
    await recordWriteEvent(context, 'execution_failed', toolName, productId);
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
    await recordWriteEvent(ledgerContext, 'execution_started', request.toolName, rentalRequest.productId);
    try {
      const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
      await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', request.toolName, rentalRequest.productId);
      return {
        text: result.text,
        metadata: {
          ...(result.metadata ?? {}),
          toolName: request.toolName,
          ok: result.ok,
          productId: rentalRequest.productId,
        },
      };
    } catch (error) {
      await recordFailedWriteEvent(ledgerContext, request.toolName, rentalRequest.productId);
      throw error;
    }
  }

  const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
  if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
  await recordWriteEvent(ledgerContext, 'execution_started', request.toolName, rentalRequest.productId);
  try {
    const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
    await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', request.toolName, rentalRequest.productId);
    return {
      text: result.text,
      metadata: {
        ...(result.metadata ?? {}),
        toolName: request.toolName,
        ok: result.ok,
        productId: rentalRequest.productId,
      },
    };
  } catch (error) {
    await recordFailedWriteEvent(ledgerContext, request.toolName, rentalRequest.productId);
    throw error;
  }
}
