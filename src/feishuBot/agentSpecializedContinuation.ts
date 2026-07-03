import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { NewLinkBatchConfirmRequest, NewLinkBatchExecutionResult, NewLinkBatchMultiConfirmRequest } from '../newLinkWorkflow/batch.js';
import type { BotResponse } from './types.js';
import type { RentalOperationConfirmRequest, RentalOperationExecutionResult, RentalPriceChangeRequest, RentalPriceExecutionResult } from './rentalPrice.js';

function rentalOperationArguments(request: RentalOperationConfirmRequest): Record<string, unknown> {
  switch (request.action) {
    case 'copy':
    case 'delist':
    case 'spec-discover':
      return { action: request.action, productId: request.productId };
    case 'tenancy-set':
      return { action: request.action, productId: request.productId, days: request.days };
    case 'spec-add-and-refresh':
    case 'spec-add-item':
      return { action: request.action, productId: request.productId, specDimId: request.specDimId, itemTitle: request.itemTitle };
    case 'spec-refresh':
      return { action: request.action, productId: request.productId };
    case 'apply-current':
      return { action: request.action, productId: request.productId, changes: request.changes };
    case 'submit-current':
      return { action: request.action, productId: request.productId };
    case 'spec-remove-items':
      return {
        action: request.action,
        productId: request.productId,
        ...(request.query ? { query: request.query } : {}),
        keyword: request.keyword,
        ...(request.sameSkuGroupId ? { sameSkuGroupId: request.sameSkuGroupId } : {}),
        items: request.items,
      };
  }
}

export function agentRequestFromNewLinkBatchConfirm(request: NewLinkBatchConfirmRequest): AgentToolConfirmRequest {
  return {
    toolName: 'rental.newLinkBatchPlan',
    arguments: {
      keyword: request.keyword,
      count: request.count,
      sourceProductId: request.sourceProductId,
    },
    reason: request.reason,
    ...(request.continuation ? { continuation: request.continuation } : {}),
  };
}

export function agentRequestFromNewLinkBatchMultiConfirm(request: NewLinkBatchMultiConfirmRequest): AgentToolConfirmRequest {
  return {
    toolName: 'rental.newLinkBatchPlan',
    arguments: {
      items: request.items.map((item) => ({
        keyword: item.keyword,
        count: item.count,
        sourceProductId: item.sourceProductId,
      })),
    },
    reason: request.reason,
    ...(request.continuation ? { continuation: request.continuation } : {}),
  };
}

export function botResponseFromNewLinkBatchResult(
  request: NewLinkBatchConfirmRequest | NewLinkBatchMultiConfirmRequest,
  result: NewLinkBatchExecutionResult,
): BotResponse {
  return {
    text: result.text,
    metadata: {
      toolName: 'rental.newLinkBatchPlan',
      ok: result.ok,
      newProductIds: result.newProductIds,
      completedCount: result.completedCount,
      ...(result.failedItems?.length ? { failedItems: result.failedItems } : {}),
      ...(request.workflowName ? { workflowName: request.workflowName } : {}),
      ...('items' in request
        ? { items: request.items.map((item) => ({ keyword: item.keyword, count: item.count, sourceProductId: item.sourceProductId })) }
        : { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId }),
    },
  };
}

export function agentRequestFromRentalPriceConfirm(request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }>): AgentToolConfirmRequest {
  return {
    toolName: 'rental.priceChange',
    arguments: {
      productId: request.productId,
      fields: request.fields,
    },
    reason: request.reason ?? '用户确认租赁商品改价。',
    ...(request.continuation ? { continuation: request.continuation } : {}),
  };
}

export function botResponseFromRentalPriceExecution(result: RentalPriceExecutionResult): BotResponse {
  return {
    text: `${result.ok ? '改价执行成功' : '改价执行失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`,
    metadata: {
      toolName: 'rental.priceChange',
      ok: result.ok,
      productId: result.productId,
      ...(result.audit?.taskId ? { taskId: result.audit.taskId } : {}),
      ...(result.audit?.rollbackFile ? { rollbackFile: result.audit.rollbackFile } : {}),
      ...(result.audit?.resultFile ? { resultFile: result.audit.resultFile } : {}),
    },
  };
}

export function agentRequestFromRentalOperationConfirm(request: RentalOperationConfirmRequest): AgentToolConfirmRequest {
  return {
    toolName: request.plannerToolName ?? 'rental.operationConfirmRequest',
    arguments: request.plannerArguments ?? rentalOperationArguments(request),
    reason: request.plannerReason ?? '用户确认租赁商品操作。',
    ...(request.continuation ? { continuation: request.continuation } : {}),
  };
}

export function botResponseFromRentalOperationResult(request: RentalOperationConfirmRequest, result: RentalOperationExecutionResult): BotResponse {
  return {
    text: result.text,
    metadata: {
      ...(result.metadata ?? {}),
      toolName: request.plannerToolName ?? 'rental.operationConfirmRequest',
      ok: result.ok,
      productId: request.productId,
      action: request.action,
      ...(request.plannerArguments ? { plannerArguments: request.plannerArguments } : {}),
    },
  };
}
