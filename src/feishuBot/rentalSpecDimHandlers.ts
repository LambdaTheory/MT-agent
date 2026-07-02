import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import type { BotResponse } from './types.js';
import type { RentalPriceSkillClient } from './rentalPrice.js';

type SpecDimAction = 'add' | 'remove';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readAction(value: unknown): SpecDimAction | null {
  return value === 'add' || value === 'remove' ? value : null;
}

function readSpecDimArgs(args: Record<string, unknown>): { productId: string; action: SpecDimAction; title?: string; specDimId?: string } | null {
  const productId = readString(args.productId);
  const action = readAction(args.action);
  if (!productId || !action) return null;
  if (action === 'add') {
    const title = readString(args.title);
    return title ? { productId, action, title } : null;
  }
  const specDimId = readString(args.specDimId);
  return specDimId ? { productId, action, specDimId } : null;
}

export async function rentalSpecDimPlanResponse(
  args: Record<string, unknown>,
  reason: string,
  client: RentalPriceSkillClient,
  outputDir: string,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const request = readSpecDimArgs(args);
  if (!request) return { text: '规格维度变更参数无效：add 需要 title，remove 需要 specDimId。', metadata: { toolName: 'rental.specDimPlan', ok: false } };
  const current = await client.specDiscover(request.productId);
  if (!current.ok) return { text: `规格维度变更预览失败：商品 ${request.productId}\n${current.lines.join('\n')}`, metadata: { toolName: 'rental.specDimPlan', ok: false, productId: request.productId } };

  const confirmRequest: AgentToolConfirmRequest = {
    toolName: 'rental.specDimApply',
    arguments: request,
    reason,
    ...(continuation ? { continuation } : {}),
  };
  const requestRef = await saveAgentToolConfirmRequest(outputDir, confirmRequest);
  const changeLine = request.action === 'add'
    ? `添加维度：${request.title}`
    : `删除维度：${request.specDimId}`;
  return {
    text: [
      `规格维度变更预览：商品 ${request.productId}`,
      changeLine,
      `当前维度数：${current.dimensions.length}`,
      '',
      '安全边界：只执行一个规格维度 add/remove 原子动作；确认前不会修改。',
    ].join('\n'),
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef }),
    metadata: { toolName: 'rental.specDimPlan', ok: true, productId: request.productId, action: request.action },
  };
}

export async function rentalSpecDimApplyResponse(args: Record<string, unknown>, client: RentalPriceSkillClient, ledgerContext?: { runId?: string; decisionId?: string; subject?: string }): Promise<BotResponse> {
  const request = readSpecDimArgs(args);
  if (!request) throw new Error('规格维度变更执行参数无效，请重新发起预览。');
  if (request.action === 'add') {
    if (!client.specAddDim) throw new Error('当前租赁商品客户端不支持规格维度添加。');
    const result = await client.specAddDim(request.productId, request.title!);
    return {
      text: `${result.ok ? '规格维度添加成功' : '规格维度添加失败'}：商品 ${result.productId}，${result.itemTitle}\n${result.lines.join('\n')}`,
      metadata: { toolName: 'rental.specDimApply', ok: result.ok, productId: result.productId, action: request.action, ...(ledgerContext ? { ledgerContext } : {}) },
    };
  }
  if (!client.specRemoveDim) throw new Error('当前租赁商品客户端不支持规格维度删除。');
  const result = await client.specRemoveDim({ productId: request.productId, specDimId: request.specDimId! });
  return {
    text: `${result.ok ? '规格维度删除成功' : '规格维度删除失败'}：商品 ${result.productId}，维度 ${result.specDimId}\n${result.lines.join('\n')}`,
    metadata: { toolName: 'rental.specDimApply', ok: result.ok, productId: result.productId, action: request.action, ...(ledgerContext ? { ledgerContext } : {}) },
  };
}
