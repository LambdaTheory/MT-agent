import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient & { previews: unknown[]; executions: unknown[] } {
  return {
    previews: [],
    executions: [],
    async preview(request) {
      this.previews.push(request);
      return {
        productId: request.productId,
        fields: request.mode === 'explicit_fields' ? request.fields : { rent1day: '90.00', rent10day: '180.00' },
        lines: ['rent1day: 100.00 -> 90.00', 'rent10day: 200.00 -> 180.00'],
        warnings: [],
      };
    },
    async execute(request) {
      this.executions.push(request);
      return { productId: request.productId, ok: true, lines: ['rent1day 已验证', 'rent10day 已验证'] };
    },
  };
}

describe('rental price Feishu integration', () => {
  it('parses explicit rental price change commands', () => {
    expect(parseBotIntent('改价 商品761 1天22 10天55')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00', rent10day: '55.00' } } });
  });

  it('parses global discount commands', () => {
    expect(parseBotIntent('改价 商品761 全局打折 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金九折')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 所有价格 *0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'all_price_fields' } });
  });

  it('returns a confirmation card without executing the rental skill', async () => {
    const client = fakeClient();
    const intent = parseBotIntent('改价 商品761 1天22 10天55');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.previews).toHaveLength(1);
    expect(client.executions).toHaveLength(0);
    expect(response.text).toContain('请确认商品 761 改价');
    expect(JSON.stringify(response.card)).toContain('确认改价');
    expect(JSON.stringify(response.card)).toContain('rental_price_confirm');
  });
});
