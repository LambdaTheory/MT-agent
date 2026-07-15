import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient, type RentalVasApplyRequest, type RentalVasCatalogReadRequest, type RentalVasReadRequest } from './rentalPrice.js';
import type { BotResponse } from './types.js';

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

function readStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  const items = value.map((item) => readString(item));
  if (items.some((item) => item === null)) throw new Error(`${fieldName} must contain only non-empty strings`);
  return items.filter((item): item is string => item !== null);
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function readVasReadRequest(args: Record<string, unknown>): RentalVasReadRequest {
  const productId = args.productId === undefined ? undefined : requireProductId(args.productId, 'productId');
  const expectedProductId = args.expectedProductId === undefined ? undefined : requireProductId(args.expectedProductId, 'expectedProductId');
  return {
    ...(productId ? { productId } : {}),
    ...(args.allowCurrentPage !== undefined ? { allowCurrentPage: args.allowCurrentPage === true } : {}),
    ...(expectedProductId ? { expectedProductId } : {}),
  };
}

function readVasCatalogReadRequest(args: Record<string, unknown>): RentalVasCatalogReadRequest {
  const productId = args.productId === undefined ? undefined : requireProductId(args.productId, 'productId');
  const expectedProductId = args.expectedProductId === undefined ? undefined : requireProductId(args.expectedProductId, 'expectedProductId');
  const ids = readStringArray(args.ids, 'ids');
  const keyword = readString(args.keyword) ?? undefined;
  return {
    ...(productId ? { productId } : {}),
    ...(args.allowCurrentPage !== undefined ? { allowCurrentPage: args.allowCurrentPage === true } : {}),
    ...(expectedProductId ? { expectedProductId } : {}),
    ...(ids ? { ids } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

function formatLines(title: string, result: { ok: boolean; status: string; lines: string[] }): string {
  return [`${title}: ${result.ok ? 'ok' : result.status}`, ...result.lines].join('\n');
}

export async function executeRentalVasTool(request: AgentToolConfirmRequest, rentalPriceClient?: RentalPriceSkillClient): Promise<BotResponse> {
  const client = rentalPriceClient ?? createRentalPriceSkillClient();
  switch (request.toolName) {
    case 'rental.vasRead': {
      if (!client.vasRead) return { text: '当前租赁客户端还没有接入 VAS 读取能力。', metadata: { toolName: request.toolName, ok: false } };
      const vasRequest = readVasReadRequest(request.arguments);
      const result = await client.vasRead(vasRequest);
      return { text: formatLines('VAS 读取', result), metadata: { toolName: request.toolName, ok: result.ok, productId: result.productId, serviceCount: result.services.length } };
    }
    case 'rental.vasCatalogRead': {
      if (!client.vasCatalogRead) return { text: '当前租赁客户端还没有接入 VAS 目录读取能力。', metadata: { toolName: request.toolName, ok: false } };
      const result = await client.vasCatalogRead(readVasCatalogReadRequest(request.arguments));
      return { text: formatLines('VAS 目录读取', result), metadata: { toolName: request.toolName, ok: result.ok, count: result.count } };
    }
    case 'rental.vasApply': {
      if (!client.vasApply) return { text: '当前租赁客户端还没有接入 VAS 应用能力。', metadata: { toolName: request.toolName, ok: false } };
      const vasRequest: RentalVasApplyRequest = {
        allowCurrentPage: request.arguments.allowCurrentPage === true,
        expectedProductId: requireProductId(request.arguments.expectedProductId, 'expectedProductId'),
        expectedVAS: requireRecord(request.arguments.expectedVAS, 'expectedVAS'),
      };
      const result = await client.vasApply(vasRequest);
      return { text: formatLines(`VAS 应用 ${vasRequest.expectedProductId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId: vasRequest.expectedProductId, status: result.status } };
    }
    case 'rental.vasVerify': {
      if (!client.vasVerify) return { text: '当前租赁客户端还没有接入 VAS 验证能力。', metadata: { toolName: request.toolName, ok: false } };
      const productId = requireProductId(request.arguments.productId, 'productId');
      const result = await client.vasVerify({ productId, expectedVAS: requireRecord(request.arguments.expectedVAS, 'expectedVAS') });
      return { text: formatLines(`VAS 验证 ${productId}`, result), metadata: { toolName: request.toolName, ok: result.ok, productId, status: result.status } };
    }
    default:
      throw new Error(`Unsupported rental VAS tool: ${request.toolName}`);
  }
}
