import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export type RentalPriceChangeRequest =
  | { mode: 'explicit_fields'; productId: string; fields: Record<string, string> }
  | { mode: 'global_discount'; productId: string; discount: number; scope: 'rent_fields' | 'all_price_fields' };

export interface RentalPricePreview {
  productId: string;
  fields: Record<string, string>;
  lines: string[];
  warnings: string[];
}

export interface RentalPriceExecutionResult {
  productId: string;
  ok: boolean;
  lines: string[];
}

export interface RentalPriceCopyResult {
  productId: string;
  ok: boolean;
  newProductId: string | null;
  lines: string[];
  status?: string;
  message?: string;
  sideEffectPossible?: boolean;
  retrySafe?: boolean;
}

export interface RentalPriceDelistResult {
  productId: string;
  ok: boolean;
  lines: string[];
}

export interface RentalPriceTenancySetResult {
  productId: string;
  ok: boolean;
  days: string;
  lines: string[];
}

export interface RentalPriceSpecDiscoverResult {
  productId: string;
  ok: boolean;
  dimensions: { specId: string; title: string; items: { id: string; title: string }[] }[];
  lines: string[];
}

export interface RentalPriceSpecAddResult {
  productId: string;
  ok: boolean;
  itemTitle: string;
  lines: string[];
}

export interface RentalPriceSkillClient {
  preview(request: RentalPriceChangeRequest): Promise<RentalPricePreview>;
  execute(request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }>): Promise<RentalPriceExecutionResult>;
  copy(productId: string): Promise<RentalPriceCopyResult>;
  delist(productId: string): Promise<RentalPriceDelistResult>;
  tenancySet(productId: string, days: string): Promise<RentalPriceTenancySetResult>;
  specDiscover(productId: string): Promise<RentalPriceSpecDiscoverResult>;
  specAddAndRefresh(productId: string, itemTitle: string): Promise<RentalPriceSpecAddResult>;
}

export type RentalOperationConfirmRequest =
  | { action: 'copy'; productId: string }
  | { action: 'delist'; productId: string }
  | { action: 'tenancy-set'; productId: string; days: string }
  | { action: 'spec-discover'; productId: string }
  | { action: 'spec-add-and-refresh'; productId: string; itemTitle: string };

interface RentalPriceSkillClientOptions {
  rootDir?: string;
  daemonUrl?: string;
  daemonToken?: string;
}

const RENT_FIELD_PATTERN = /(1|2|3|4|5|7|10|15|30|60|90|180)\s*天(?:租金)?\s*([0-9]+(?:\.[0-9]+)?)/g;
const PRICE_FIELD_NAMES = new Set(['rent1day', 'rent2day', 'rent3day', 'rent4day', 'rent5day', 'rent7day', 'rent10day', 'rent15day', 'rent30day', 'rent60day', 'rent90day', 'rent180day', 'marketPrice', 'deposit', 'purchasePrice', 'costPrice', 'finalPayment']);

function money(value: string | number): string {
  return Number(value).toFixed(2);
}

export function parseRentalPriceChange(text: string): RentalPriceChangeRequest | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const command = /^改价\s+(?:商品)?(\d+)\s+(.+)$/.exec(normalized);
  if (!command) return null;

  const productId = command[1];
  const body = command[2];

  const globalDiscount = /全局.*?([0-9]+(?:\.[0-9]+)?)/.exec(body);
  if (globalDiscount) return { mode: 'global_discount', productId, discount: Number(globalDiscount[1]), scope: 'rent_fields' };
  if (/全部租金/.test(body)) return { mode: 'global_discount', productId, discount: 0.9, scope: 'rent_fields' };
  const allPriceDiscount = /所有价格\s*\*\s*([0-9]+(?:\.[0-9]+)?)/.exec(body);
  if (allPriceDiscount) return { mode: 'global_discount', productId, discount: Number(allPriceDiscount[1]), scope: 'all_price_fields' };

  const fields: Record<string, string> = {};
  for (const match of body.matchAll(RENT_FIELD_PATTERN)) {
    fields[`rent${match[1]}day`] = money(match[2]);
  }
  return Object.keys(fields).length ? { mode: 'explicit_fields', productId, fields } : null;
}

export function buildRentalPricePreviewCard(preview: RentalPricePreview): FeishuCardPayload {
  const request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }> = { mode: 'explicit_fields', productId: preview.productId, fields: preview.fields };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁商品改价确认' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: `**商品 ${preview.productId} 改价预览**\n${preview.lines.join('\n')}` },
        ...(preview.warnings.length ? [{ tag: 'markdown', content: `**风险提示**\n${preview.warnings.join('\n')}` }] : []),
        {
          tag: 'form',
          name: 'rental_price_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认改价' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'rental_price_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_price_confirm', request } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'rental_price_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_price_cancel', productId: preview.productId } }],
            },
          ],
        },
      ],
    },
  };
}

function rentalOperationTitle(request: RentalOperationConfirmRequest): string {
  switch (request.action) {
    case 'copy':
      return `复制商品 ${request.productId}`;
    case 'delist':
      return `下架商品 ${request.productId}`;
    case 'tenancy-set':
      return `设置商品 ${request.productId} 租期为 ${request.days}`;
    case 'spec-discover':
      return `查看商品 ${request.productId} 规格`;
    case 'spec-add-and-refresh':
      return `给商品 ${request.productId} 添加规格 ${request.itemTitle}`;
  }
}

export function buildRentalOperationConfirmCard(request: RentalOperationConfirmRequest, reason: string): FeishuCardPayload {
  const title = rentalOperationTitle(request);
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁商品操作确认' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: `**是否要执行：${title}？**\n\nLLM 理解原因：${reason}` },
        {
          tag: 'form',
          name: 'rental_operation_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认执行' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'rental_operation_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_operation_confirm', request } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'rental_operation_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_operation_cancel', productId: request.productId } }],
            },
          ],
        },
      ],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function selectedFields(values: Record<string, unknown>, request: RentalPriceChangeRequest): Record<string, string> {
  if (request.mode === 'explicit_fields') return request.fields;
  const fields: Record<string, string> = {};
  const firstSpec = Object.values(values).find(isRecord) as Record<string, unknown> | undefined;
  const source = firstSpec ?? values;
  for (const [field, raw] of Object.entries(source)) {
    const isRent = /^rent\d+day$/.test(field);
    if ((request.scope === 'rent_fields' && !isRent) || (request.scope === 'all_price_fields' && !PRICE_FIELD_NAMES.has(field))) continue;
    const current = Number(raw);
    if (Number.isFinite(current)) fields[field] = money(current * request.discount);
  }
  return fields;
}

function commandStatus(response: Record<string, unknown>): string {
  return typeof response.status === 'string' ? response.status : 'unknown';
}

function optionalString(response: Record<string, unknown>, key: string): string | undefined {
  const value = response[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(response: Record<string, unknown>, key: string): boolean | undefined {
  const value = response[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readableValues(response: Record<string, unknown>): Record<string, unknown> {
  const values = isRecord(response.values) ? response.values : {};
  const firstSpec = Object.values(values).find(isRecord) as Record<string, unknown> | undefined;
  return firstSpec ?? values;
}

function verifiedFields(response: Record<string, unknown>, fields: Record<string, string>): boolean {
  const values = readableValues(response);
  return Object.entries(fields).every(([field, value]) => moneyValue(values[field]) === value);
}

function moneyValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? money(numeric) : null;
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function createRentalPriceSkillClient(options: RentalPriceSkillClientOptions = {}): RentalPriceSkillClient {
  const rootDir = options.rootDir ?? process.env.RENTAL_PRICE_AGENT_DIR ?? resolve(process.cwd(), 'vendor', 'rental-price-agent');
  const configuredDaemonUrl = options.daemonUrl ?? process.env.RENTAL_PRICE_AGENT_DAEMON_URL;
  const configuredDaemonToken = options.daemonToken ?? process.env.RENTAL_PRICE_AGENT_DAEMON_TOKEN;

  async function resolveDaemonConfig(): Promise<{ daemonUrl: string; daemonToken: string | null }> {
    const [port, fileToken] = await Promise.all([
      configuredDaemonUrl ? Promise.resolve<string | null>(null) : readOptionalText(join(rootDir, '.daemon.port')),
      configuredDaemonToken ? Promise.resolve<string | null>(null) : readOptionalText(join(rootDir, '.daemon.token')),
    ]);

    return {
      daemonUrl: configuredDaemonUrl ?? (port ? `http://127.0.0.1:${port}` : 'http://127.0.0.1:9223'),
      daemonToken: configuredDaemonToken ?? fileToken,
    };
  }

  async function send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { daemonUrl, daemonToken } = await resolveDaemonConfig();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (daemonToken) headers['x-rental-agent-token'] = daemonToken;
    const response = await fetch(daemonUrl, { method: 'POST', headers, body: JSON.stringify(command) });
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async preview(request) {
      const current = await send({ action: 'read', productId: request.productId });
      const values = isRecord(current.values) ? current.values : {};
      const fields = selectedFields(values, request);
      return { productId: request.productId, fields, lines: Object.entries(fields).map(([field, value]) => `${field} -> ${value}`), warnings: [] };
    },
    async execute(request) {
      const tasksDir = join(rootDir, 'tasks');
      await mkdir(tasksDir, { recursive: true });
      const changesFile = join(tasksDir, `mt-agent-changes-${Date.now()}.json`);
      await writeFile(changesFile, JSON.stringify({ __broadcast: true, ...request.fields }, null, 2), 'utf8');
      const apply = await send({ action: 'apply', productId: request.productId, changesFile });
      const applyStatus = commandStatus(apply);
      if (applyStatus !== 'ok') return { productId: request.productId, ok: false, lines: [`apply: ${applyStatus}`, 'submit: skipped', 'verify: skipped'] };

      const submit = await send({ action: 'submit' });
      const submitStatus = commandStatus(submit);
      if (submitStatus !== 'ok') return { productId: request.productId, ok: false, lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, 'verify: skipped'] };

      const verified = await send({ action: 'read', productId: request.productId });
      const verifyStatus = commandStatus(verified);
      const fieldsMatch = verifiedFields(verified, request.fields);
      return { productId: request.productId, ok: verifyStatus !== 'error' && fieldsMatch, lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, `verify: ${verifyStatus}`, `fields: ${fieldsMatch ? 'matched' : 'mismatch'}`] };
    },
    async copy(productId) {
      const result = await send({ action: 'copy', productId });
      const status = commandStatus(result);
      const newProductId = typeof result.newProductId === 'string' ? result.newProductId : null;
      const message = optionalString(result, 'message');
      const sideEffectPossible = optionalBoolean(result, 'sideEffectPossible');
      const retrySafe = optionalBoolean(result, 'retrySafe');
      const currentUrl = optionalString(result, 'currentUrl');
      const newUrl = optionalString(result, 'newUrl');
      const lines = [
        `copy: ${status}`,
        `newProductId: ${newProductId ?? 'unknown'}`,
        ...(message ? [`message: ${message}`] : []),
        ...(sideEffectPossible !== undefined ? [`sideEffectPossible: ${sideEffectPossible}`] : []),
        ...(retrySafe !== undefined ? [`retrySafe: ${retrySafe}`] : []),
        ...(currentUrl ? [`currentUrl: ${currentUrl}`] : []),
        ...(newUrl ? [`newUrl: ${newUrl}`] : []),
      ];
      return {
        productId,
        ok: status === 'ok',
        newProductId,
        status,
        ...(message ? { message } : {}),
        ...(sideEffectPossible !== undefined ? { sideEffectPossible } : {}),
        ...(retrySafe !== undefined ? { retrySafe } : {}),
        lines,
      };
    },
    async delist(productId) {
      const result = await send({ action: 'delist', productId });
      const status = commandStatus(result);
      const message = typeof result.message === 'string' ? result.message : undefined;
      return { productId, ok: status === 'ok' || status === 'warn', lines: [`delist: ${status}`, ...(message ? [message] : [])] };
    },
    async tenancySet(productId, days) {
      const result = await send({ action: 'tenancy-set', productId, days });
      const status = commandStatus(result);
      return { productId, ok: status === 'ok', days, lines: [`tenancy-set: ${status}`, `days: ${days}`] };
    },
    async specDiscover(productId) {
      const result = await send({ action: 'spec-discover', productId });
      const status = commandStatus(result);
      const dimensions = Array.isArray(result.dimensions) ? result.dimensions as RentalPriceSpecDiscoverResult['dimensions'] : [];
      return { productId, ok: status === 'ok', dimensions, lines: [`spec-discover: ${status}`, `${dimensions.length} dimensions`] };
    },
    async specAddAndRefresh(productId, itemTitle) {
      const result = await send({ action: 'spec-add-and-refresh', productId, itemTitle });
      const status = commandStatus(result);
      return { productId, ok: status === 'ok', itemTitle, lines: [`spec-add-and-refresh: ${status}`] };
    },
  };
}

export function parseRentalCopyCommand(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:复制商品|商品复制)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseDelistCommand(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:下架商品|商品下架)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseTenancySetCommand(text: string): { productId: string; days: string } | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:设置租期|租期设置)\s*(\d+)\s+([\d,]+)$/.exec(normalized);
  return match ? { productId: match[1], days: match[2] } : null;
}

export function parseSpecDiscoverCommand(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:查看规格|规格查看)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseSpecAddCommand(text: string): { productId: string; itemTitle: string } | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:添加规格|规格添加)\s*(\d+)\s+(.+)$/.exec(normalized);
  return match ? { productId: match[1], itemTitle: match[2].trim() } : null;
}

export function parseRentalPriceConfirmRequest(value: unknown): Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }> | null {
  if (!isRecord(value)) return null;
  const request = value.request;
  if (!isRecord(request) || request.mode !== 'explicit_fields' || typeof request.productId !== 'string' || !isRecord(request.fields)) return null;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(request.fields)) {
    if (PRICE_FIELD_NAMES.has(field) && typeof raw === 'string' && Number.isFinite(Number(raw))) fields[field] = money(raw);
  }
  return Object.keys(fields).length ? { mode: 'explicit_fields', productId: request.productId, fields } : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readProductId(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d+$/.test(raw) ? raw : null;
}

export function parseRentalOperationConfirmRequest(value: unknown): RentalOperationConfirmRequest | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  const action = readString(request.action);
  const productId = readProductId(request.productId);
  if (!action || !productId) return null;

  if (action === 'copy') return { action, productId };
  if (action === 'delist') return { action, productId };
  if (action === 'spec-discover') return { action, productId };
  if (action === 'tenancy-set') {
    const days = readString(request.days);
    return days && /^\d+(?:,\d+)*$/.test(days) ? { action, productId, days } : null;
  }
  if (action === 'spec-add-and-refresh') {
    const itemTitle = readString(request.itemTitle);
    return itemTitle ? { action, productId, itemTitle } : null;
  }
  return null;
}

export async function executeRentalOperationConfirmRequest(client: RentalPriceSkillClient, request: RentalOperationConfirmRequest): Promise<{ ok: boolean; text: string }> {
  switch (request.action) {
    case 'copy': {
      const result = await client.copy(request.productId);
      if (!result.ok && (result.status === 'unknown' || result.sideEffectPossible)) {
        return {
          ok: false,
          text: `复制状态未知：商品 ${result.productId}\n${result.lines.join('\n')}\n注意：本次复制可能已经提交但未拿到新商品ID；为避免重复复制，请先到后台核对，不要直接重试。`,
        };
      }
      return { ok: result.ok, text: result.ok ? (result.newProductId ? `复制成功：商品 ${result.productId} → 新商品 ${result.newProductId}` : `复制成功：商品 ${result.productId} 已复制（新商品ID未能自动获取，请到后台确认）`) : `复制失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'delist': {
      const result = await client.delist(request.productId);
      return { ok: result.ok, text: result.ok ? `下架成功：商品 ${result.productId}` : `下架失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'tenancy-set': {
      const result = await client.tenancySet(request.productId, request.days);
      return { ok: result.ok, text: result.ok ? `租期设置成功：商品 ${result.productId}，租期 ${result.days}` : `租期设置失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'spec-discover': {
      const result = await client.specDiscover(request.productId);
      if (!result.ok) return { ok: false, text: `规格查看失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
      const dims = result.dimensions.map(d => `  ${d.title}（${d.items.map(i => i.title).join('、')}）`).join('\n');
      return { ok: true, text: `规格查看成功：商品 ${result.productId}\n${dims || '（无规格维度）'}` };
    }
    case 'spec-add-and-refresh': {
      const result = await client.specAddAndRefresh(request.productId, request.itemTitle);
      return { ok: result.ok, text: result.ok ? `规格添加成功：商品 ${result.productId}，新增 ${result.itemTitle}` : `规格添加失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
  }
}
