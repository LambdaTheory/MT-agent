import { copyFile, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeClient(): RentalPriceSkillClient & { previews: unknown[]; executions: unknown[]; copies: unknown[]; delists: unknown[]; tenancySets: unknown[]; specDiscovers: unknown[]; specAdds: unknown[]; specRemoves: unknown[] } {
  return {
    previews: [],
    executions: [],
    copies: [],
    delists: [],
    tenancySets: [],
    specDiscovers: [],
    specAdds: [],
    specRemoves: [],
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
    async specAddAndRefresh(productId, specDimId, itemTitle) {
      this.specAdds.push({ productId, specDimId, itemTitle });
      return { productId, ok: true, itemTitle, lines: ['spec-add-and-refresh: ok'] };
    },
    async specRemoveItem(request) {
      this.specRemoves.push(request);
      return { ...request, ok: true, lines: ['precheck: ok', 'remove: ok', 'refresh: ok', 'submit: ok', 'verify: ok'] };
    },
  };
}

describe('rental price Feishu integration', () => {
  it('parses explicit rental price change commands', () => {
    expect(parseBotIntent('改价 商品761 1天22 10天55')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00', rent10day: '55.00' } } });
    expect(parseBotIntent('改价 954 1天88 10天999')).toEqual({ type: 'rental_price_change', productId: '954', request: { mode: 'explicit_fields', productId: '954', fields: { rent1day: '88.00', rent10day: '999.00' } } });
    expect(parseBotIntent('改价 954 1天租金改成88 10天改为999')).toEqual({ type: 'rental_price_change', productId: '954', request: { mode: 'explicit_fields', productId: '954', fields: { rent1day: '88.00', rent10day: '999.00' } } });
  });

  it('parses global discount commands', () => {
    expect(parseBotIntent('改价 商品761 全局打折 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局改价 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局折扣 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全局调价 0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金九折')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金打折')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 全部租金改价')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
    expect(parseBotIntent('改价 商品761 所有价格 *0.9')).toEqual({ type: 'rental_price_change', productId: '761', request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' } });
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

  it('renders rental price audit details in the confirmation card when preview provides them', async () => {
    const client = fakeClient();
    client.preview = async (request) => {
      client.previews.push(request);
      return {
        productId: request.productId,
        fields: { rent1day: '22.00' },
        lines: ['1天租金: 30.00 -> 22.00'],
        warnings: ['变动 26.7% 超过阈值 20%'],
        audit: {
          taskId: 'task_1_abcd1234',
          changesFile: 'C:/tmp/changes.json',
          rollbackFile: 'C:/tmp/rollback.json',
          previewFile: 'C:/tmp/preview.html',
          diff: [{ field: 'rent1day', label: '1天租金', old: '30.00', new: '22.00', change: '-8.00', changePct: '-26.7%', issues: [{ level: 'warn', msg: '变动超过阈值' }] }],
          hasErrors: false,
          hasWarnings: true,
        },
      };
    };

    const response = await handleBotIntent(parseBotIntent('改价 商品761 1天22'), 'output', { rentalPriceClient: client });
    const serialized = JSON.stringify(response.card);

    expect(serialized).toContain('审计预览');
    expect(serialized).toContain('task_1_abcd1234');
    expect(serialized).toContain('回滚文件');
    expect(serialized).toContain('确认改价');
    expect(serialized).toContain('task_1_abcd1234');
  });

  it('blocks rental price confirmation when audit preview has rule errors', async () => {
    const client = fakeClient();
    client.preview = async (request) => {
      client.previews.push(request);
      return {
        productId: request.productId,
        fields: { rent1day: '0.00' },
        lines: ['1天租金: 30.00 -> 0.00'],
        warnings: ['低于最小价格'],
        audit: {
          changesFile: 'C:/tmp/changes.json',
          diff: [{ field: 'rent1day', label: '1天租金', old: '30.00', new: '0.00', change: '-30.00', changePct: '-100.0%', issues: [{ level: 'error', msg: '低于最小价格' }] }],
          hasErrors: true,
          hasWarnings: false,
        },
      };
    };

    const response = await handleBotIntent(parseBotIntent('改价 商品761 1天0'), 'output', { rentalPriceClient: client });
    const serialized = JSON.stringify(response.card);

    expect(serialized).toContain('审计发现错误，已阻断执行');
    expect(serialized).not.toContain('rental_price_confirm');
    expect(serialized).not.toContain('确认改价');
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
    expect(parseBotIntent('添加规格 761 1355 128G')).toEqual({ type: 'rental_spec_add', productId: '761', specDimId: '1355', itemTitle: '128G' });
    expect(parseBotIntent('规格添加 761 1355 256G')).toEqual({ type: 'rental_spec_add', productId: '761', specDimId: '1355', itemTitle: '256G' });

    const client = fakeClient();
    const intent = parseBotIntent('添加规格 761 1355 128G');
    const response = await handleBotIntent(intent, 'output', { rentalPriceClient: client });

    expect(client.specAdds).toEqual([]);
    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('spec-add-and-refresh');
    expect(JSON.stringify(response.card)).toContain('128G');
  });

  it('executes confirmed spec remove items through the hidden rental operation path', async () => {
    const client = fakeClient();
    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.operationConfirmRequest',
        arguments: {
          action: 'spec-remove-items',
          productId: '761',
          query: 'x300u',
          keyword: '手柄',
          sameSkuGroupId: 'vivo-x300-ultra',
          items: [
            { productId: '761', specDimId: 'kit', dimensionTitle: '套装', itemId: 'handle', itemTitle: '含手柄', keyword: '手柄' },
            { productId: '762', specDimId: 'kit', dimensionTitle: '套装', itemId: 'handle', itemTitle: '含手柄', keyword: '手柄' },
          ],
        },
        reason: '用户确认删除含手柄规格项',
      },
      'output',
      { rentalPriceClient: client },
    );

    expect(client.specRemoves).toEqual([
      { productId: '761', specDimId: 'kit', itemId: 'handle', itemTitle: '含手柄' },
      { productId: '762', specDimId: 'kit', itemId: 'handle', itemTitle: '含手柄' },
    ]);
    expect(response.text).toContain('规格项删除完成：成功 2/2');
    expect(response.text).toContain('同款组：vivo-x300-ultra');
  });
});

describe('rental price skill client copy diagnostics', () => {
  it('exposes daemon status through a read-only ping action', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ status: 'ok', pong: true }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.daemonStatus!();

    expect(calls).toEqual([{ action: 'ping' }]);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.pong).toBe(true);
    expect(result.lines.join('\n')).toContain('ping: ok');
  });

  it('exposes platform search through a read-only platform-search action', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({
        status: 'ok',
        keyword: 'x200u',
        count: 1,
        products: [{ productId: '761', title: 'vivo X200 Ultra' }],
      }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.platformSearch!('x200u');

    expect(calls).toEqual([{ action: 'hello', negotiationNonce: expect.any(String), client: expect.any(Object) }, { action: 'platform-search', keyword: 'x200u', _negotiation: expect.any(Object) }]);
    expect(result.ok).toBe(true);
    expect(result.keyword).toBe('x200u');
    expect(result.count).toBe(1);
    expect(result.rows).toEqual([{ productId: '761', title: 'vivo X200 Ultra' }]);
    expect(result.lines.join('\n')).toContain('x200u');
    expect(result.lines.join('\n')).toContain('761');
  });

  it('exposes full platform search through stable platform-search with local truncation', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({
        status: 'ok',
        count: 3,
        pagesScraped: 2,
        products: [
          { productId: '761', title: 'vivo X200 Ultra' },
          { productId: '762', title: 'vivo X200 Pro' },
          { productId: '763', title: 'vivo X200' },
        ],
        excluded: [{ productId: 'mq-1' }],
        excludedCount: 1,
      }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.platformSearchAll!(2);

    expect(calls).toEqual([{ action: 'hello', negotiationNonce: expect.any(String), client: expect.any(Object) }, { action: 'platform-search', keyword: '', _negotiation: expect.any(Object) }]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.rows).toHaveLength(2);
    expect(result.pagesScraped).toBe(2);
    expect(result.excludedCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.lines.join('\n')).toContain('platform-search-all: ok');
    expect(result.lines.join('\n')).toContain('761');
  });

  it('exposes batch read through a read-only batch-read action', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({
        status: 'ok',
        count: 2,
        results: {
          '761': { status: 'ok', productId: '761', specs: [], values: {} },
          '762': { status: 'ok', productId: '762', specs: [], values: {} },
        },
        errors: [],
        warnings: [],
      }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.batchRead!(['761', '762']);

    expect(calls).toEqual([{ action: 'hello', negotiationNonce: expect.any(String), client: expect.any(Object) }, { action: 'batch-read', productIds: ['761', '762'], _negotiation: expect.any(Object) }]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.results).toMatchObject({
      '761': { status: 'ok', productId: '761' },
      '762': { status: 'ok', productId: '762' },
    });
    expect(result.lines.join('\n')).toContain('761');
    expect(result.lines.join('\n')).toContain('762');
  });

  it('exposes full spec discovery through the read-only spec-discover action', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({
        status: 'ok',
        dimensions: [{ specId: '1355', title: '颜色', items: [{ id: '1', title: '黑色' }] }],
      }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.specDiscoverFull!('761');

    expect(calls).toEqual([{ action: 'hello', negotiationNonce: expect.any(String), client: expect.any(Object) }, { action: 'spec-discover', productId: '761', _negotiation: expect.any(Object) }]);
    expect(result.ok).toBe(true);
    expect(result.productId).toBe('761');
    expect(result.dimensions).toEqual([{ specId: '1355', title: '颜色', items: [{ id: '1', title: '黑色' }] }]);
    expect(result.lines.join('\n')).toContain('spec-discover: ok');
  });

  it('exposes raw read through a read-only read action with optional fields', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({
        status: 'partial',
        productId: '761',
        specs: [{ specId: 's1', title: '黑色' }],
        values: { s1: { rent1day: '22.00' } },
        requestedCount: 1,
        readCount: 1,
        warnings: [],
        missingFields: [],
      }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.readRaw!('761', ['rent1day']);

    expect(calls).toEqual([{ action: 'hello', negotiationNonce: expect.any(String), client: expect.any(Object) }, { action: 'read', productId: '761', fields: ['rent1day'], _negotiation: expect.any(Object) }]);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.productId).toBe('761');
    expect(result.specs).toEqual([{ specId: 's1', title: '黑色' }]);
    expect(result.values).toEqual({ s1: { rent1day: '22.00' } });
    expect(result.requestedCount).toBe(1);
    expect(result.readCount).toBe(1);
  });

  it('reports a clear daemon unavailable error when the local service is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const error = new TypeError('fetch failed') as TypeError & { cause?: Error };
      error.cause = new Error('connect ECONNREFUSED 127.0.0.1:9223');
      throw error;
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    await expect(client.read!('761')).rejects.toThrow('rental-price-agent daemon 不可达：http://127.0.0.1:9223');
    await expect(client.read!('761')).rejects.toThrow('mt-rental-price-agent');
  });

  it('keeps daemon copy error details in the bot-facing result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'error',
      message: 'Product not found: 844',
      currentUrl: 'https://example.test/goods/list',
    }))));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.copy('844');

    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toBe('Product not found: 844');
    expect(result.lines).toContain('message: Product not found: 844');
    expect(result.lines).toContain('currentUrl: https://example.test/goods/list');
  });

  it('keeps global discount previews scoped to rent fields even when all_price_fields is passed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      productId: '761',
      specs: [{ specId: '3862', title: '默认' }],
      values: {
        '3862': {
          rent1day: '20.00',
          rent10day: '50.00',
          rent30day: '80.00',
          marketPrice: '300.00',
          deposit: '300.00',
          purchasePrice: '300.00',
          costPrice: '300.00',
          finalPayment: '0.00',
        },
      },
    }))));
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rent-fields-only-'));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const preview = await client.preview({ mode: 'global_discount', productId: '761', discount: 1.1, scope: 'all_price_fields' });

    expect(preview.fields).toEqual({
      rent1day: '22.00',
      rent10day: '55.00',
      rent30day: '88.00',
    });
    expect(preview.fields).not.toHaveProperty('marketPrice');
    expect(preview.fields).not.toHaveProperty('deposit');
    expect(preview.fields).not.toHaveProperty('purchasePrice');
    expect(preview.fields).not.toHaveProperty('costPrice');
    expect(preview.fields).not.toHaveProperty('finalPayment');
  });

  it('keeps amount adjustment previews scoped to rent fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      productId: '851',
      specs: [{ specId: '3862', title: '默认' }],
      values: {
        '3862': {
          rent1day: '20.00',
          rent10day: '50.00',
          rent30day: '80.00',
          marketPrice: '300.00',
          deposit: '300.00',
        },
      },
    }))));
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rent-adjustment-'));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const preview = await client.preview({ mode: 'global_adjustment', productId: '851', adjustmentAmount: -1, scope: 'rent_fields' });

    expect(preview.fields).toEqual({
      rent1day: '19.00',
      rent10day: '49.00',
      rent30day: '79.00',
    });
    expect(preview.fields).not.toHaveProperty('marketPrice');
    expect(preview.fields).not.toHaveProperty('deposit');
  });

  it('surfaces daemon read errors during price preview instead of treating them as empty fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'error',
      productId: '914',
      message: 'no specs found; product may not exist or page structure changed',
      url: 'https://example.test/web/index.php?c=user&a=login',
    }))));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    await expect(client.preview({ mode: 'global_discount', productId: '914', discount: 0.99, scope: 'all_price_fields' }))
      .rejects.toThrow('read failed: no specs found');
    await expect(client.preview({ mode: 'global_discount', productId: '914', discount: 0.99, scope: 'all_price_fields' }))
      .rejects.toThrow('c=user');
  });

  it('marks unknown copy results as possible side effects and unsafe to retry automatically', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'unknown',
      message: 'Copy may have succeeded but newProductId could not be detected; do not retry automatically',
      sideEffectPossible: true,
      retrySafe: false,
    }))));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    const result = await client.copy('844');

    expect(result.ok).toBe(false);
    expect(result.status).toBe('unknown');
    expect(result.sideEffectPossible).toBe(true);
    expect(result.retrySafe).toBe(false);
    expect(result.lines).toContain('sideEffectPossible: true');
    expect(result.lines).toContain('retrySafe: false');
  });

  it('generates diff audit, task log, and rollback artifact for price preview and updates the task after execution', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-price-audit-'));
    await copyRentalPriceAuditScripts(rootDir);
    const dataRoot = join(dirname(rootDir), `.${basename(rootDir)}-data`);
    const currentValues = { rent1day: '30.00', rent10day: '80.00' };
    const applyProductIds: unknown[] = [];
    const submitExpectedProductIds: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body.action === 'read') {
        return new Response(JSON.stringify({
          status: 'ok',
          productId: '761',
          values: currentValues,
          specs: [],
        }));
      }
      if (body.action === 'apply' && typeof body.changesFile === 'string') {
        applyProductIds.push(body.productId);
        const changes = JSON.parse(await readFile(body.changesFile, 'utf8')) as Record<string, string>;
        if (typeof changes.rent1day === 'string') currentValues.rent1day = changes.rent1day;
        return new Response(JSON.stringify({ status: 'ok' }));
      }
      if (body.action === 'submit') submitExpectedProductIds.push(body.expectedProductId);
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    const preview = await client.preview({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });

    expect(preview.audit?.taskId).toMatch(/^task_/);
    expect(preview.audit?.changesFile).toContain('changes_');
    expect(preview.audit?.rollbackFile).toContain('rollback_');
    expect(preview.audit?.rollbackFile).toContain(join('artifacts', 'mt-agent-audit'));
    expect(preview.audit!.diff![0]).toMatchObject({ field: 'rent1day', old: '30.00', new: '22.00' });
    expect(preview.lines.join('\n')).toContain('审计任务');
    expect(await readFile(preview.audit!.rollbackFile!, 'utf8')).toContain('"rent1day": "30.00"');
    expect(await readdir(join(dataRoot, 'tasks'))).not.toContainEqual(expect.stringMatching(/^mt-agent-|^rollback_|^preview_/));

    const result = await client.execute({ mode: 'explicit_fields', productId: '761', fields: preview.fields, audit: preview.audit });

    expect(result.ok).toBe(true);
    expect(result.audit?.taskId).toBe(preview.audit?.taskId);
    expect(result.lines.join('\n')).toContain(`auditTask: ${preview.audit?.taskId}`);
    const task = JSON.parse(await readFile(join(dataRoot, 'tasks', `${preview.audit?.taskId}.json`), 'utf8')) as { status: string; evidence: Array<{ type: string }> };
    expect(task.status).toBe('completed');
    expect(task.evidence.some((item) => item.type === 'verify_result')).toBe(true);

    const rollback = await client.rollback!({ taskId: preview.audit!.taskId! });

    expect(rollback.ok).toBe(true);
    expect(rollback.productId).toBe('761');
    expect(rollback.lines.join('\n')).toContain(`auditTask: ${preview.audit?.taskId}`);
    expect(applyProductIds).toEqual(['761', '761']);
    expect(submitExpectedProductIds).toEqual(['761', '761']);
    expect(currentValues.rent1day).toBe('30.00');
    const rolledBackTask = JSON.parse(await readFile(join(dataRoot, 'tasks', `${preview.audit?.taskId}.json`), 'utf8')) as { status: string; evidence: Array<{ type: string }> };
    expect(rolledBackTask.status).toBe('rolled_back');
    expect(rolledBackTask.evidence.some((item) => item.type === 'rollback_verify_result')).toBe(true);
  }, 30000);
});

async function copyRentalPriceAuditScripts(rootDir: string): Promise<void> {
  const sourceRoot = new URL('../vendor/rental-price-agent/', import.meta.url);
  const files = [
    'scripts/diff-generator.js',
    'scripts/task-store.js',
    'scripts/lib/config-loader.js',
    'scripts/lib/daemon-protocol.js',
    'scripts/lib/daemon-client.js',
    'scripts/lib/daemon-compatibility.js',
    'scripts/lib/install-layout.js',
    'scripts/lib/lease-lock.js',
    'scripts/lib/migrations.js',
    'scripts/lib/process-inspector.js',
    'scripts/lib/rule-checker.js',
    'scripts/lib/version-contract.js',
    'package-lock.json',
    'package.json',
    'release-manifest.json',
  ];
  for (const file of files) {
    const target = join(rootDir, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(file, sourceRoot), target);
  }
  await writeAuditConfig(rootDir);
}

async function writeAuditConfig(rootDir: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const dataRoot = join(dirname(rootDir), `.${basename(rootDir)}-data`);
  const sourceRoot = new URL('../vendor/rental-price-agent/', import.meta.url);
  const config = JSON.parse(await readFile(new URL('config.example.json', sourceRoot), 'utf8')) as Record<string, unknown>;
  config.rules = { minPrice: 1, maxPrice: 9999, maxChangePercent: 20 };
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}
