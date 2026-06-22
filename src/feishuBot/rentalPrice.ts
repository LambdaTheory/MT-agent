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

export interface RentalPriceSkillClient {
  preview(request: RentalPriceChangeRequest): Promise<RentalPricePreview>;
  execute(request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }>): Promise<RentalPriceExecutionResult>;
}

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

  const globalDiscount = /全局打折\s*([0-9]+(?:\.[0-9]+)?)/.exec(body);
  if (globalDiscount) return { mode: 'global_discount', productId, discount: Number(globalDiscount[1]), scope: 'rent_fields' };
  if (/全部租金九折/.test(body)) return { mode: 'global_discount', productId, discount: 0.9, scope: 'rent_fields' };
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
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认改价' },
              type: 'primary',
              behaviors: [{ type: 'callback', value: { action: 'rental_price_confirm', request } }],
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
  };
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
