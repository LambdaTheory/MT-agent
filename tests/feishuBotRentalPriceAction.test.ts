import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentToolConfirmCard } from '../src/agentRuntime/approvalCard.js';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import { clarificationConfirmationKey, saveClarificationContext } from '../src/feishuBot/clarificationStore.js';
import { buildRentalOperationConfirmCard, buildRentalPricePreviewCard, createRentalPriceSkillClient, parseRentalOperationConfirmRequest, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { buildNewLinkBatchConfirmCard, type NewLinkBatchPlan } from '../src/newLinkWorkflow/batch.js';

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

function readButtonValue(card: unknown, buttonName: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }>; actions?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  for (const element of body?.elements ?? []) {
    for (const item of [...(element.elements ?? []), ...(element.actions ?? [])]) {
      if (item.name === buttonName) {
        const value = item.behaviors?.[0]?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
      }
    }
  }
  throw new Error(`${buttonName} value not found`);
}

function newLinkPlan(): NewLinkBatchPlan {
  return {
    status: 'ready',
    request: { keyword: 'pocket3', count: 3, sourceProductId: '733' },
    dataDate: '2026-06-22',
    requestedSourceProductId: '733',
    selectedSource: {
      productId: '733',
      platformProductId: 'platform-733',
      productName: 'Pocket3 source',
      score: 100,
      reasons: ['fixture'],
    },
    candidates: [],
    warnings: [],
  };
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
    const confirmValue = readButtonValue(buildRentalPricePreviewCard({
      productId: '761',
      fields: { rent1day: '22.00' },
      lines: ['rent1day -> 22.00'],
      warnings: [],
    }), 'rental_price_confirm_submit');
    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-rental-confirm' },
        action: { value: confirmValue },
      },
    });

    await waitFor(() => executions.length === 1 && sent.some((item) => JSON.stringify(item).includes('租赁商品改价已完成')));
    expect(executions).toEqual([{ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } }]);
    expect(sent.some((item) => JSON.stringify(item).includes('租赁商品改价处理中'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('租赁商品改价已完成'))).toBe(true);
    expect(sent.filter((item) => JSON.stringify(item).includes('租赁商品改价已完成')).every((item) => JSON.stringify(item).includes('"kind":"patch"'))).toBe(true);
  });

  it('rejects forged confirmation fields before execution', () => {
    const value = readButtonValue(buildRentalPricePreviewCard({
      productId: '761',
      fields: { rent1day: '22', script: 'evil' },
      lines: ['rent1day -> 22'],
      warnings: [],
    }), 'rental_price_confirm_submit');

    expect(parseRentalPriceConfirmRequest(value)).toEqual({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });
    expect(parseRentalPriceConfirmRequest({ ...value, request: { ...(value.request as Record<string, unknown>), productId: '762' } })).toBeNull();
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22', script: 'evil' } } })).toBeNull();
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: 'abc', script: 'evil' } } })).toBeNull();
  });

  it('preserves safe audit references and rejects blocked audit confirmations', () => {
    const audit = {
      taskId: 'task_123_abcd1234',
      changesFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/changes.json',
      rollbackFile: 'C:/works/MT-agent/vendor/rental-price-agent/tasks/rollback.json',
      hasWarnings: true,
    };
    const value = readButtonValue(buildRentalPricePreviewCard({
      productId: '761',
      fields: { rent1day: '22' },
      lines: ['rent1day -> 22'],
      warnings: [],
      audit,
    }), 'rental_price_confirm_submit');

    expect(parseRentalPriceConfirmRequest(value)).toEqual({
      mode: 'explicit_fields',
      productId: '761',
      fields: { rent1day: '22.00' },
      audit,
    });
    expect(parseRentalPriceConfirmRequest({ request: (value.request as Record<string, unknown>) })).toBeNull();
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
    const confirmValue = readButtonValue(buildRentalOperationConfirmCard({ action: 'delist', productId: '761' }, 'test reason'), 'rental_operation_confirm_submit');

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-rental-operation-confirm' },
        action: { value: confirmValue },
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
    const confirmValue = readButtonValue(buildRentalOperationConfirmCard({ action: 'copy', productId: '875' }, 'test reason'), 'rental_operation_confirm_submit');
    const callback = {
      event: {
        context: { open_message_id: 'om-rental-copy-confirm' },
        action: { value: confirmValue },
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
    const value = readButtonValue(buildAgentToolConfirmCard({
      toolName: 'rental.delist',
      arguments: { productId: '761' },
      reason: '用户要求下架商品 761',
    }), 'agent_tool_confirm_submit');

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-confirm' },
        action: {
          value,
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
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-action-'));
    const context = {
      originalMessage: '帮我处理一下 875',
      question: '你想怎么处理 875？',
      reason: '动作不明确',
      candidates: [{ toolName: 'rental.copy', arguments: { productId: '875' }, label: '复制商品' }],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    const callbackResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify' },
        action: {
          value: {
            action: 'agent_clarify_select',
            clarificationRef,
            candidateIndex: 0,
            confirmationKey: clarificationConfirmationKey(context),
          },
        },
      },
    });

    expect(JSON.stringify(callbackResult)).toContain('agent_tool_confirm');
    expect(JSON.stringify(callbackResult)).toContain('复制商品');
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
    const context = {
      originalMessage: '帮我处理一下 875',
      question: '你想怎么处理 875？',
      reason: '动作不明确',
      candidates: [],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    let dispatched: unknown;
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      sdk: fakeSdk(sent, registered),
      rentalPriceClient,
      dispatchMessage: async (message) => {
        dispatched = message;
        return { text: '请确认复制商品', card: { schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'rental_operation_confirm' }] } }, skipped: false };
      },
    });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-custom-clarify' },
        operator: { open_id: 'ou_custom' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            clarificationRef,
            confirmationKey: clarificationConfirmationKey(context),
          },
          form_value: { custom_message: '复制商品 875' },
        },
      },
    });

    await waitFor(() => sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm')));
    expect(sent.some((item) => JSON.stringify(item).includes('Agent 已收到你的补充'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('rental_operation_confirm'))).toBe(true);
    expect(sent.some((item) => JSON.stringify(item).includes('复制成功'))).toBe(false);
    expect(dispatched).toMatchObject({ text: '复制商品 875\n原始指令：帮我处理一下 875', metadata: { clarificationDepth: 1 } });

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
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-rollback-clarify-'));
    const context = {
      originalMessage: '请回滚刚才的改价',
      question: '你要回滚哪个任务？',
      reason: '缺少任务 ID',
      candidates: [],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered), rentalPriceClient });

    bot.start();
    const callbackResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-rollback-clarify' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            clarificationRef,
            confirmationKey: clarificationConfirmationKey(context),
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
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-rollback-clarify-fallback-'));
    const context = {
      originalMessage: '请回滚刚才的改价',
      question: '你要回滚哪个任务？',
      reason: '缺少任务 ID',
      candidates: [],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered, { failPatch: true }), rentalPriceClient });

    bot.start();
    const callbackResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-rollback-clarify-fallback' },
        action: {
          value: {
            action: 'agent_clarify_custom',
            clarificationRef,
            confirmationKey: clarificationConfirmationKey(context),
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
    const confirmValue = readButtonValue(buildNewLinkBatchConfirmCard(newLinkPlan(), 'test reason'), 'new_link_batch_confirm_submit');

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-confirm' },
        action: {
          value: confirmValue,
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
    bot.start();
    const signedStaleConfirmValue = readButtonValue(buildNewLinkBatchConfirmCard(newLinkPlan(), 'test reason'), 'new_link_batch_confirm_submit');
    const cancelResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-cancel' },
        action: {
          name: 'new_link_batch_cancel_submit',
          value: signedStaleConfirmValue,
        },
      },
    });
    const duplicateResult = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-batch-cancel' },
        action: {
          name: 'new_link_batch_confirm_submit',
          value: signedStaleConfirmValue,
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
    const delistValue = readButtonValue(buildRentalOperationConfirmCard({ action: 'delist', productId: '761' }, 'test reason'), 'rental_operation_confirm_submit');

    expect(parseRentalOperationConfirmRequest(delistValue)).toEqual({ action: 'delist', productId: '761' });
    expect(parseRentalOperationConfirmRequest({ ...delistValue, request: { ...(delistValue.request as Record<string, unknown>), productId: '762' } })).toBeNull();
    expect(parseRentalOperationConfirmRequest({ request: { action: 'delist', productId: '761' } })).toBeNull();

    const specRemoveRequest = {
      action: 'spec-remove-items' as const,
      productId: '761',
      keyword: 'handle',
      items: [{ productId: '761', specDimId: 'kit', dimensionTitle: 'kit', itemId: 'handle', itemTitle: 'handle' }],
    };
    const specRemoveValue = readButtonValue(buildRentalOperationConfirmCard(specRemoveRequest, 'test reason'), 'rental_operation_confirm_submit');

    expect(parseRentalOperationConfirmRequest(specRemoveValue)).toEqual(specRemoveRequest);
    expect(parseRentalOperationConfirmRequest({ request: specRemoveRequest })).toBeNull();
    expect(parseRentalOperationConfirmRequest({ request: { action: 'delete-everything', productId: '761' } })).toBeNull();
    expect(parseRentalOperationConfirmRequest({ request: { action: 'tenancy-set', productId: '761', days: '1,abc' } })).toBeNull();
    expect(parseRentalOperationConfirmRequest({ request: { action: 'spec-remove-items', productId: '761', keyword: 'handle', items: [{ productId: 'abc', specDimId: 'kit', itemTitle: 'handle' }] } })).toBeNull();
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

  it('removes a specific spec item with refresh, submit, verify, and an audit file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-spec-remove-'));
    const commands: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      if (command.action === 'spec-discover') {
        return new Response(JSON.stringify({
          status: 'ok',
          dimensions: [{ specId: 'kit', title: '套装', items: command.productId === '761' && commands.length > 4 ? [{ id: 'std', title: '标准' }] : [{ id: 'std', title: '标准' }, { id: 'handle', title: '含手柄' }] }],
        }));
      }
      return new Response(JSON.stringify({ status: 'ok' }));
    };

    try {
      const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:1' });
      const result = await client.specRemoveItem!({ productId: '761', specDimId: 'kit', itemId: 'handle', itemTitle: '含手柄' });

      expect(result.ok).toBe(true);
      expect(commands.map((command) => command.action)).toEqual(['spec-discover', 'spec-remove-item', 'spec-refresh', 'submit', 'spec-discover']);
      expect(commands[1]).toMatchObject({
        action: 'spec-remove-item',
        productId: '761',
        expectedProductId: '761',
        specDimId: 'kit',
        itemId: 'handle',
        itemTitle: '含手柄',
      });
      expect(commands[2]).toMatchObject({ action: 'spec-refresh', allowCurrentPage: true, expectedProductId: '761' });
      expect(commands[3]).toMatchObject({ action: 'submit', expectedProductId: '761' });
      expect(result.lines).toContain('item: removed');
      expect(result.audit?.resultFile).toContain('spec-remove-761-');
      expect(await readFile(result.audit!.resultFile!, 'utf8')).toContain('"itemTitle": "含手柄"');
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
