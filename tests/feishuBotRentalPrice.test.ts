import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient & { previews: unknown[]; executions: unknown[]; copies: unknown[]; delists: unknown[]; tenancySets: unknown[]; specDiscovers: unknown[]; specAdds: unknown[] } {
  return {
    previews: [],
    executions: [],
    copies: [],
    delists: [],
    tenancySets: [],
    specDiscovers: [],
    specAdds: [],
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
    async copy(productId) {
      this.copies.push(productId);
      return { productId, ok: true, newProductId: '999', lines: ['copy: ok', 'newProductId: 999'] };
    },
    async delist(productId) {
      this.delists.push(productId);
      return { productId, ok: true, lines: ['delist: ok'] };
    },
    async tenancySet(productId, days) {
      this.tenancySets.push({ productId, days });
      return { productId, ok: true, days, lines: ['tenancy-set: ok'] };
    },
    async specDiscover(productId) {
      this.specDiscovers.push(productId);
      return { productId, ok: true, dimensions: [{ specId: '1', title: '版本', items: [{ id: '3862', title: '2+8G' }] }], lines: ['spec-discover: ok'] };
    },
    async specAddAndRefresh(productId, itemTitle) {
      this.specAdds.push({ productId, itemTitle });
      return { productId, ok: true, itemTitle, lines: ['spec-add-and-refresh: ok'] };
    },
  };
}

describe('rental price Feishu integration', () => {
  it('parses explicit rental price change commands', () => {
    expect(parseBotIntent('改价 商品761 1天22 10天55')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00', rent10day: '55.00' } } });
  });

  it('parses global discount commands', () => {
    expect(parseBotIntent('改价 商品761 全局打折 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局改价 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局折扣 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局调价 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金九折')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金打折')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金改价')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
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

  it('parses copy product commands and returns a confirmation card without executing', async () => {
    expect(parseBotIntent('复制商品 761')).toEqual({ type: 'rental_copy', productId: '761' });
    expect(parseBotIntent('商品复制 761')).toEqual({ type: 'rental_copy', productId: '761' });

    const client = fakeClient();
    const intent = parseBotIntent('复制商品 761');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.copies).toEqual([]);
    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('copy');
    expect(JSON.stringify(response.card)).toContain('761');
  });

  it('parses delist product commands and returns a confirmation card without executing', async () => {
    expect(parseBotIntent('下架商品 761')).toEqual({ type: 'rental_delist', productId: '761' });
    expect(parseBotIntent('商品下架 761')).toEqual({ type: 'rental_delist', productId: '761' });

    const client = fakeClient();
    const intent = parseBotIntent('下架商品 761');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.delists).toEqual([]);
    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('delist');
    expect(JSON.stringify(response.card)).toContain('761');
  });

  it('parses tenancy set commands and returns a confirmation card without executing', async () => {
    expect(parseBotIntent('设置租期 761 1,10,30')).toEqual({ type: 'rental_tenancy_set', productId: '761', days: '1,10,30' });
    expect(parseBotIntent('租期设置 761 1,7,30,90')).toEqual({ type: 'rental_tenancy_set', productId: '761', days: '1,7,30,90' });

    const client = fakeClient();
    const intent = parseBotIntent('设置租期 761 1,10,30');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.tenancySets).toEqual([]);
    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('tenancy-set');
    expect(JSON.stringify(response.card)).toContain('1,10,30');
  });

  it('parses and executes spec discover commands', async () => {
    expect(parseBotIntent('查看规格 761')).toEqual({ type: 'rental_spec_discover', productId: '761' });
    expect(parseBotIntent('规格查看 761')).toEqual({ type: 'rental_spec_discover', productId: '761' });

    const client = fakeClient();
    const intent = parseBotIntent('查看规格 761');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.specDiscovers).toEqual(['761']);
    expect(response.text).toContain('规格查看成功');
    expect(response.text).toContain('761');
  });

  it('parses spec add commands and returns a confirmation card without executing', async () => {
    expect(parseBotIntent('添加规格 761 128G')).toEqual({ type: 'rental_spec_add', productId: '761', itemTitle: '128G' });
    expect(parseBotIntent('规格添加 761 256G')).toEqual({ type: 'rental_spec_add', productId: '761', itemTitle: '256G' });

    const client = fakeClient();
    const intent = parseBotIntent('添加规格 761 128G');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.specAdds).toEqual([]);
    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('spec-add-and-refresh');
    expect(JSON.stringify(response.card)).toContain('128G');
  });
});
