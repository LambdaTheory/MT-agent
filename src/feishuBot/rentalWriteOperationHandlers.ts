import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { BotResponse } from './types.js';
import {
  executeRentalOperationConfirmRequest,
  rentalOperationConfirmRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';

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

export async function executeRentalWriteOperationHandler(
  request: AgentToolConfirmRequest,
  client: RentalPriceSkillClient,
): Promise<BotResponse> {
  if (request.toolName === 'rental.operationConfirmRequest') {
    const rentalRequest = rentalOperationConfirmRequestFromToolArguments(request.arguments);
    if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
    const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
    return { text: result.text };
  }

  const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
  if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
  const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
  return {
    text: result.text,
    metadata: {
      ...(result.metadata ?? {}),
      toolName: request.toolName,
      ok: result.ok,
      productId: rentalRequest.productId,
    },
  };
}
