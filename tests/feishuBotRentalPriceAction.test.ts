import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import { createRentalPriceSkillClient, parseRentalOperationConfirmRequest, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<void>>) {
  class FakeClient {
    im = { v1: { message: { reply: async (request: unknown) => sent.push({ kind: 'reply', request }), patch: async (request: unknown) => sent.push({ kind: 'patch', request }) } } };
  }
  class FakeWSClient { start() { return undefined; } }
  class FakeEventDispatcher {
    register(handlers: Record<string, (data: unknown) => Promise<void>>) {
      Object.assign(registered, handlers);
      return this;
    }
  }
  return { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

describe('rental price card action', () => {
  it('executes the rental price skill only after confirmation', async () => {
    const executions: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() {
        throw new Error('preview should not run during confirmation');
      },
      async execute(request) {
        executions.push(request);
        return { productId: request.productId, ok: true, lines: ['rent1day 已验证'] };
      },
      async copy() {
        throw new Error('copy should not run during confirmation');
      },
      async delist() {
        throw new Error('delist should not run during confirmation');
      },
      async tenancySet() {
        throw new Error('tenancySet should not run during confirmation');
      },
      async specDiscover() {
        throw new Error('specDiscover should not run during confirmation');
      },
      async specAddAndRefresh() {
        throw new Error('specAddAndRefresh should not run during confirmation');
      },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-rental-confirm' },
        action: { value: { action: 'rental_price_confirm', request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } } } },
      },
    });

    await waitFor(() => executions.length === 1 && sent.some((item) => JSON.stringify(item).includes('租赁商品改价已完成')));
    expect(executions).toEqual([{ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } }]);
    expect(sent.some((item) => JSON.stringify(item).includes('租赁商品改价处理中'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('租赁商品改价已完成'))).toBe(true);
    expect(sent.filter((item) => JSON.stringify(item).includes('租赁商品改价已完成')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
  });

  it('rejects forged confirmation fields before execution', () => {
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22', script: 'evil' } } })).toEqual({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: 'abc', script: 'evil' } } })).toBeNull();
  });

  it('executes LLM-proposed rental operations only after confirmation', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run during operation confirmation'); },
      async execute() { throw new Error('price execute should not run during operation confirmation'); },
      async copy() { throw new Error('copy should not run for delist confirmation'); },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run for delist confirmation'); },
      async specDiscover() { throw new Error('specDiscover should not run for delist confirmation'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for delist confirmation'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-rental-operation-confirm' },
        action: { value: { action: 'rental_operation_confirm', request: { action: 'delist', productId: '761' } } },
      },
    });

    await waitFor(() => calls.length === 1 && sent.some((item) => JSON.stringify(item).includes('下架成功：商品 761')));
    expect(calls).toEqual(['delist:761']);
    expect(sent.some((item) => JSON.stringify(item).includes('租赁商品操作处理中'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('下架成功：商品 761'))).toBe(true);
    expect(sent.filter((item) => JSON.stringify(item).includes('下架成功：商品 761')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
  });

  it('does not execute a rental operation more than once when the same card is clicked repeatedly', async () => {
    let releaseCopy: (() => void) | undefined;
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run during operation confirmation'); },
      async execute() { throw new Error('price execute should not run during operation confirmation'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        await new Promise<void>((resolve) => {
          releaseCopy = resolve;
        });
        return { productId, ok: true, newProductId: '999', lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run for copy confirmation'); },
      async tenancySet() { throw new Error('tenancySet should not run for copy confirmation'); },
      async specDiscover() { throw new Error('specDiscover should not run for copy confirmation'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for copy confirmation'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', sdk: fakeSdk(sent, registered), rentalPriceClient });
    const callback = {
      event: {
        context: { open_message_id: 'om-rental-copy-confirm' },
        action: { value: { action: 'rental_operation_confirm', request: { action: 'copy', productId: '875' } } },
      },
    };

    bot.start();
    await registered['card.action.trigger'](callback);
    await waitFor(() => calls.length === 1);
    await registered['card.action.trigger'](callback);

    expect(calls).toEqual(['copy:875']);
    expect(sent.some((item) => JSON.stringify(item).includes('已经在执行中'))).toBe(true);

    releaseCopy?.();
    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('复制成功')));
    await registered['card.action.trigger'](callback);

    expect(calls).toEqual(['copy:875']);
    expect(sent.filter((item) => JSON.stringify(item).includes('复制成功')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('已经执行完成'))).toBe(true);
  });

  it('executes generic agent tool confirmations through the decoupled tool module', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for operation confirmation'); },
      async execute() { throw new Error('price execute should not run for operation confirmation'); },
      async copy() { throw new Error('copy should not run for delist confirmation'); },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run for delist confirmation'); },
      async specDiscover() { throw new Error('specDiscover should not run for delist confirmation'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for delist confirmation'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-confirm' },
        action: {
          value: {
            action: 'agent_tool_confirm',
            request: {
              toolName: 'rental.operationConfirmRequest',
              arguments: { action: 'delist', productId: '761' },
              reason: '用户要求下架商品 761',
            },
          },
        },
      },
    });

    await waitFor(() => calls.length === 1 && sent.some((item) => JSON.stringify(item).includes('Agent 操作已完成')));
    expect(calls).toEqual(['delist:761']);
    expect(sent.some((item) => JSON.stringify(item).includes('Agent 操作处理中'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('下架成功：商品 761'))).toBe(true);
    expect(sent.filter((item) => JSON.stringify(item).includes('Agent 操作已完成')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
  });

  it('executes new-link batch confirmations by copying the selected source repeatedly', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for new-link confirmation'); },
      async execute() { throw new Error('price execute should not run for new-link confirmation'); },
      async copy(productId) {
        calls.push(productId);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run for new-link confirmation'); },
      async tenancySet() { throw new Error('tenancySet should not run for new-link confirmation'); },
      async specDiscover() { throw new Error('specDiscover should not run for new-link confirmation'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for new-link confirmation'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-confirm' },
        action: {
          value: {
            action: 'new_link_batch_confirm',
            request: {
              workflowName: 'rental.newLinkBatch',
              keyword: 'pocket3',
              count: 3,
              sourceProductId: '733',
              sourceProductName: '大疆 Pocket3',
              dataDate: '2026-06-22',
              reason: '用户确认铺新链',
            },
          },
        },
      },
    });

    await waitFor(() => calls.length === 3 && sent.some((item) => JSON.stringify(item).includes('新链批量复制已完成')));
    expect(calls).toEqual(['733', '733', '733']);
    expect(sent.some((item) => JSON.stringify(item).includes('新链批量复制处理中'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('成功 3 条'))).toBe(true);
    expect(sent.filter((item) => JSON.stringify(item).includes('新链批量复制已完成')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
  });

  it('rejects forged rental operation confirmations', () => {
    expect(parseRentalOperationConfirmRequest({ request: { action: 'delist', productId: '761' } })).toEqual({ action: 'delist', productId: '761' });
    expect(parseRentalOperationConfirmRequest({ request: { action: 'delete-everything', productId: '761' } })).toBeNull();
    expect(parseRentalOperationConfirmRequest({ request: { action: 'tenancy-set', productId: '761', days: '1,abc' } })).toBeNull();
  });

  it('does not submit when the external apply step is partial', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-price-'));
    const commands: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as { action: string };
      commands.push(command.action);
      return new Response(JSON.stringify(command.action === 'apply' ? { status: 'partial' } : { status: 'ok' }));
    };

    try {
      const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:1' });
      const result = await client.execute({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });

      expect(result).toEqual({ productId: '761', ok: false, lines: ['apply: partial', 'submit: skipped', 'verify: skipped'] });
      expect(commands).toEqual(['apply']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses daemon mode when port and token files are present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-price-'));
    await writeFile(join(rootDir, '.daemon.port'), '9333\n', 'utf8');
    await writeFile(join(rootDir, '.daemon.token'), 'secret-token\n', 'utf8');

    const requests: Array<{ input: string; headers: Headers }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      requests.push({ input: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ status: 'ok', productId: '761', values: { rent1day: '22.00' } }));
    };

    try {
      const client = createRentalPriceSkillClient({ rootDir });
      const preview = await client.preview({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });

      expect(preview.fields).toEqual({ rent1day: '22.00' });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.input).toBe('http://127.0.0.1:9333');
      expect(requests[0]?.headers.get('x-rental-agent-token')).toBe('secret-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
