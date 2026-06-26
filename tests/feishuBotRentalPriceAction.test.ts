import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import { createRentalPriceSkillClient, parseRentalOperationConfirmRequest, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<unknown>>, options: { failPatch?: boolean } = {}) {
  class FakeClient {
    im = {
      v1: {
        message: {
          reply: async (request: unknown) => sent.push({ kind: 'reply', request }),
          patch: async (request: unknown) => {
            sent.push({ kind: 'patch', request });
            if (options.failPatch) throw new Error('patch failed');
          },
        },
      },
    };
  }
  class FakeWSClient { start() { return undefined; } }
  class FakeEventDispatcher {
    register(handlers: Record<string, (data: unknown) => Promise<unknown>>) {
      Object.assign(registered, handlers);
      return this;
    }
  }
  return { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
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
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

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

  it('preserves safe audit references and rejects blocked audit confirmations', () => {
    expect(parseRentalPriceConfirmRequest({
      request: {
        mode: 'explicit_fields',
        productId: '761',
        fields: { rent1day: '22' },
        audit: {
          taskId: 'task_123_abcd1234',
          changesFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/changes.json',
          rollbackFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/rollback.json',
          hasWarnings: true,
        },
      },
    })).toEqual({
      mode: 'explicit_fields',
      productId: '761',
      fields: { rent1day: '22.00' },
      audit: {
        taskId: 'task_123_abcd1234',
        changesFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/changes.json',
        rollbackFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/rollback.json',
        hasWarnings: true,
      },
    });
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22' }, audit: { hasErrors: true } } })).toBeNull();
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
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

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
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });
    const callback = {
      event: {
        context: { open_message_id: 'om-rental-copy-confirm' },
        action: { value: { action: 'rental_operation_confirm', request: { action: 'copy', productId: '875' } } },
      },
    };

    bot.start();
    await registered['card.action.trigger'](callback);
    await waitFor(() => calls.length === 1);
    const processingDuplicate = await registered['card.action.trigger'](callback);

    expect(calls).toEqual(['copy:875']);
    expect(JSON.stringify(processingDuplicate)).toContain('已经在执行中');

    releaseCopy?.();
    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('复制成功')));
    const completedDuplicate = await registered['card.action.trigger'](callback);

    expect(calls).toEqual(['copy:875']);
    expect(sent.filter((item) => JSON.stringify(item).includes('复制成功')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
    expect(JSON.stringify(completedDuplicate)).toContain('已经执行完成');
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
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-confirm' },
        action: {
          value: {
            action: 'agent_tool_confirm',
            request: {
              toolName: 'rental.delist',
              arguments: { productId: '761' },
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

  it('continues from a clarification card selection without executing the selected operation', async () => {
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run from clarification selection'); },
      async execute() { throw new Error('execute should not run from clarification selection'); },
      async copy() { throw new Error('copy should not run from clarification selection'); },
      async delist() { throw new Error('delist should not run from clarification selection'); },
      async tenancySet() { throw new Error('tenancySet should not run from clarification selection'); },
      async specDiscover() { throw new Error('specDiscover should not run from clarification selection'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run from clarification selection'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify' },
        action: {
          value: {
            action: 'agent_clarify_select',
            originalMessage: '帮我处理一下 875',
            selectedMessage: '复制商品 875',
            label: '复制商品',
          },
        },
      },
    });

    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm')));
    expect(sent.some((item) => JSON.stringify(item).includes('Agent 已收到你的选择'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('复制商品'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('复制成功'))).toBe(false);
  });

  it('continues from a custom clarification input without executing the selected operation', async () => {
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run from custom clarification input'); },
      async execute() { throw new Error('execute should not run from custom clarification input'); },
      async copy() { throw new Error('copy should not run from custom clarification input'); },
      async delist() { throw new Error('delist should not run from custom clarification input'); },
      async tenancySet() { throw new Error('tenancySet should not run from custom clarification input'); },
      async specDiscover() { throw new Error('specDiscover should not run from custom clarification input'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run from custom clarification input'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-custom-clarify-'));
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-custom-clarify' },
        operator: { open_id: 'ou_custom' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            originalMessage: '帮我处理一下 875',
          },
          form_value: { custom_message: '复制商品 875' },
        },
      },
    });

    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm')));
    expect(sent.some((item) => JSON.stringify(item).includes('Agent 已收到你的补充'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('复制成功'))).toBe(false);

    let learning = '';
    await waitFor(async () => {
      try {
        learning = await readFile(join(outputDir, 'state', 'agent-learning.json'), 'utf8');
        return learning.includes('clarification_selected');
      } catch {
        return false;
      }
    });
    expect(learning).toContain('clarification_selected');
    expect(learning).toContain('自定义澄清');
    expect(learning).toContain('复制商品 875');
    expect(learning).toContain('ou_custom');
  });

  it('keeps the original rollback context when a custom clarification only provides a task id', async () => {
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run from rollback clarification'); },
      async execute() { throw new Error('execute should not run from rollback clarification'); },
      async rollback() { throw new Error('rollback should not run before confirmation'); },
      async copy() { throw new Error('copy should not run from rollback clarification'); },
      async delist() { throw new Error('delist should not run from rollback clarification'); },
      async tenancySet() { throw new Error('tenancySet should not run from rollback clarification'); },
      async specDiscover() { throw new Error('specDiscover should not run from rollback clarification'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run from rollback clarification'); },
    };
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-rollback-clarify-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    const callbackResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-rollback-clarify' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            originalMessage: '请回滚刚才的改价',
          },
          form_value: { custom_message: 'task_1782451929574_977a5f62' },
        },
      },
    });

    expect(JSON.stringify(callbackResult)).toContain('Agent 已收到你的补充');
    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('rental.priceRollback')));
    expect(sent.some((item) => JSON.stringify(item).includes('agent_tool_confirm'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('task_1782451929574_977a5f62'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('"kind":"reply"'))).toBe(false);
  });

  it('replies with the clarified result when patching the original card fails', async () => {
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run from rollback clarification'); },
      async execute() { throw new Error('execute should not run from rollback clarification'); },
      async rollback() { throw new Error('rollback should not run before confirmation'); },
      async copy() { throw new Error('copy should not run from rollback clarification'); },
      async delist() { throw new Error('delist should not run from rollback clarification'); },
      async tenancySet() { throw new Error('tenancySet should not run from rollback clarification'); },
      async specDiscover() { throw new Error('specDiscover should not run from rollback clarification'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run from rollback clarification'); },
    };
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-rollback-clarify-fallback-')), sdk: fakeSdk(sent, registered, { failPatch: true }), rentalPriceClient });

    bot.start();
    const callbackResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-rollback-clarify-fallback' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            originalMessage: '请回滚刚才的改价',
          },
          form_value: { custom_message: '回滚任务id:task_1782454161506_5c9645c5' },
        },
      },
    });

    expect(JSON.stringify(callbackResult)).toContain('Agent 已收到你的补充');
    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('"kind":"reply"') && JSON.stringify(item).includes('rental.priceRollback')));
    expect(sent.some((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('task_1782454161506_5c9645c5'))).toBe(true);
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
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-confirm' },
        action: {
          value: {
            action: 'new_link_batch_confirm',
            request: {
              safetyVersion: 2,
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

  it('does not copy when a new-link cancel click carries a stale confirm value', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for new-link cancel'); },
      async execute() { throw new Error('price execute should not run for new-link cancel'); },
      async copy(productId) {
        calls.push(productId);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run for new-link cancel'); },
      async tenancySet() { throw new Error('tenancySet should not run for new-link cancel'); },
      async specDiscover() { throw new Error('specDiscover should not run for new-link cancel'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for new-link cancel'); },
    };
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-')), sdk: fakeSdk(sent, registered), rentalPriceClient });
    const staleConfirmValue = {
      action: 'new_link_batch_confirm',
      request: {
        safetyVersion: 2,
        workflowName: 'rental.newLinkBatch',
        keyword: '848',
        count: 3,
        sourceProductId: '848',
        requestedSourceProductId: '848',
        sourceProductName: '佳能 G12',
        dataDate: '2026-06-22',
        reason: '用户取消前的旧确认值',
      },
    };

    bot.start();
    const cancelResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-cancel' },
        action: {
          name: 'new_link_batch_cancel_submit',
          value: staleConfirmValue,
        },
      },
    });
    const duplicateResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-cancel' },
        action: {
          name: 'new_link_batch_confirm_submit',
          value: staleConfirmValue,
        },
      },
    });

    expect(calls).toEqual([]);
    expect(cancelResult).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify(cancelResult)).toContain('新链批量复制已取消');
    expect(JSON.stringify(cancelResult)).not.toContain('new_link_batch_confirm');
    expect(duplicateResult).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify(duplicateResult)).toContain('该确认卡片已经取消');
    expect(JSON.stringify(duplicateResult)).not.toContain('new_link_batch_confirm');
    expect(sent.some((item) => JSON.stringify(item).includes('已取消'))).toBe(true);
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
