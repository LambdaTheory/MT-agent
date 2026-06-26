import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('rental price skill client copy diagnostics', () => {
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
    const currentValues = { rent1day: '30.00', rent10day: '80.00' };
    const applyProductIds: unknown[] = [];
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
      return new Response(JSON.stringify({ status: 'ok' }));
    }));
    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' });

    const preview = await client.preview({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });

    expect(preview.audit?.taskId).toMatch(/^task_/);
    expect(preview.audit?.changesFile).toContain('changes_');
    expect(preview.audit?.rollbackFile).toContain('rollback_');
    expect(preview.audit!.diff![0]).toMatchObject({ field: 'rent1day', old: '30.00', new: '22.00' });
    expect(preview.lines.join('\n')).toContain('审计任务');
    expect(await readFile(preview.audit!.rollbackFile!, 'utf8')).toContain('"rent1day": "30.00"');

    const result = await client.execute({ mode: 'explicit_fields', productId: '761', fields: preview.fields, audit: preview.audit });

    expect(result.ok).toBe(true);
    expect(result.audit?.taskId).toBe(preview.audit?.taskId);
    expect(result.lines.join('\n')).toContain(`auditTask: ${preview.audit?.taskId}`);
    const task = JSON.parse(await readFile(join(rootDir, 'tasks', `${preview.audit?.taskId}.json`), 'utf8')) as { status: string; evidence: Array<{ type: string }> };
    expect(task.status).toBe('completed');
    expect(task.evidence.some((item) => item.type === 'verify_result')).toBe(true);

    const rollback = await client.rollback!({ taskId: preview.audit!.taskId! });

    expect(rollback.ok).toBe(true);
    expect(rollback.productId).toBe('761');
    expect(rollback.lines.join('\n')).toContain(`auditTask: ${preview.audit?.taskId}`);
    expect(applyProductIds).toEqual(['761', '761']);
    expect(currentValues.rent1day).toBe('30.00');
    const rolledBackTask = JSON.parse(await readFile(join(rootDir, 'tasks', `${preview.audit?.taskId}.json`), 'utf8')) as { status: string; evidence: Array<{ type: string }> };
    expect(rolledBackTask.status).toBe('rolled_back');
    expect(rolledBackTask.evidence.some((item) => item.type === 'rollback_verify_result')).toBe(true);
  });
});

async function copyRentalPriceAuditScripts(rootDir: string): Promise<void> {
  const sourceRoot = new URL('../vendor/rental-price-agent/', import.meta.url);
  const files = [
    'scripts/diff-generator.js',
    'scripts/task-store.js',
    'scripts/lib/config-loader.js',
    'scripts/lib/rule-checker.js',
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
  await writeFile(join(rootDir, 'config.json'), JSON.stringify({ rules: { minPrice: 1, maxPrice: 9999, maxChangePercent: 20 } }, null, 2), 'utf8');
}
