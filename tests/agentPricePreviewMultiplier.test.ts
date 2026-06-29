import { describe, expect, it, vi } from 'vitest';
import { continueAgentPlannerSteps } from '../src/feishuBot/agentToolContinuation.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceChangeRequest, RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeRentalPriceClient() {
  const preview = vi.fn(async (request: RentalPriceChangeRequest) => ({
    productId: request.productId,
    fields: { rent1: '18.00' },
    lines: ['preview ok'],
    warnings: [],
  }));
  return {
    client: { preview } as unknown as RentalPriceSkillClient,
    preview,
  };
}

describe('agent rental price preview multiplier handling', () => {
  it('accepts price preview multipliers above 1 and keeps them rent-field scoped', async () => {
    const { client, preview } = fakeRentalPriceClient();

    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.pricePreview',
        arguments: { productIds: ['851'], discount: 1.8, scope: 'all_price_fields' },
        reason: 'rx10m4 整体调价 1.8 倍',
      },
      'output',
      { rentalPriceClient: client },
    );

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'rent_fields' });
    expect(response.text).toContain('折扣：180%');
    expect(response.card).toBeDefined();
  });

  it('infers a missing direct price preview multiplier and keeps the scope to rent fields', async () => {
    const { client, preview } = fakeRentalPriceClient();

    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.pricePreview',
        arguments: { productIds: ['851'] },
        reason: 'rx10m4 整体调价 1.8 倍',
      },
      'output',
      { rentalPriceClient: client },
    );

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'rent_fields' });
    expect(response.text).toContain('范围：租金字段');
    expect(response.card).toBeDefined();
  });

  it('fills missing pricePreview discount from a multi-step goal with an explicit multiplier', async () => {
    const { client, preview } = fakeRentalPriceClient();

    const response = await continueAgentPlannerSteps({
      goal: '对“rx10m4”执行整体调价 1.8 倍并生成确认预览',
      reason: '用户要求对 rx10m4 整体调价 1.8 倍，需要先生成确认卡。',
      steps: [
        {
          toolName: 'rental.pricePreview',
          arguments: { productIds: ['851', '929'] },
          reason: '对解析出的商品生成改价确认预览',
        },
      ],
      baseIndex: 0,
      totalSteps: 1,
      metadataStore: {},
      textParts: ['Agent 多步骤计划：对“rx10m4”执行整体调价 1.8 倍并生成确认预览'],
      outputDir: 'output',
      options: { rentalPriceClient: client },
    });

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'rent_fields' });
    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '929', discount: 1.8, scope: 'rent_fields' });
    expect(response?.text).toContain('步骤 1/1：rental.pricePreview');
    expect(response?.text).toContain('折扣：180%');
    expect(response?.card).toBeDefined();
  });

  it('filters non-rent explicit fields when the reason does not name that field', async () => {
    const { client, preview } = fakeRentalPriceClient();

    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.pricePreview',
        arguments: { productIds: ['851'], fields: { rent1day: '22.00', marketPrice: '330.00' } },
        reason: 'rx10m4 整体调价',
      },
      'output',
      { rentalPriceClient: client },
    );

    expect(preview).toHaveBeenCalledWith({ mode: 'explicit_fields', productId: '851', fields: { rent1day: '22.00' } });
    expect(response.card).toBeDefined();
  });

  it('allows a non-rent explicit field when the reason names that exact field', async () => {
    const { client, preview } = fakeRentalPriceClient();

    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.pricePreview',
        arguments: { productIds: ['851'], fields: { marketPrice: '330.00' } },
        reason: 'rx10m4 市场价改成 330',
      },
      'output',
      { rentalPriceClient: client },
    );

    expect(preview).toHaveBeenCalledWith({ mode: 'explicit_fields', productId: '851', fields: { marketPrice: '330.00' } });
    expect(response.card).toBeDefined();
  });
});
