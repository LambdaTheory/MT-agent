import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import { createRentalPriceSkillClient, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<void>>) {
  class FakeClient {
    im = { v1: { message: { reply: async (request: unknown) => sent.push(request) } } };
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

    expect(executions).toEqual([{ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ path: { message_id: 'om-rental-confirm' }, data: { msg_type: 'text' } });
    expect(JSON.stringify(sent[0])).toContain('改价执行成功');
  });

  it('rejects forged confirmation fields before execution', () => {
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: '22', script: 'evil' } } })).toEqual({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });
    expect(parseRentalPriceConfirmRequest({ request: { mode: 'explicit_fields', productId: '761', fields: { rent1day: 'abc', script: 'evil' } } })).toBeNull();
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
});
