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
  it('accepts price preview multipliers above 1', async () => {
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

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'all_price_fields' });
    expect(response.text).toContain('折扣：180%');
    expect(response.card).toBeDefined();
  });

  it('infers a missing direct price preview multiplier and all-price scope from the reason', async () => {
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

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'all_price_fields' });
    expect(response.text).toContain('范围：所有价格字段');
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

    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '851', discount: 1.8, scope: 'all_price_fields' });
    expect(preview).toHaveBeenCalledWith({ mode: 'global_discount', productId: '929', discount: 1.8, scope: 'all_price_fields' });
    expect(response?.text).toContain('步骤 1/1：rental.pricePreview');
    expect(response?.text).toContain('折扣：180%');
    expect(response?.card).toBeDefined();
  });
});
