import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep, join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { parseAgentToolConfirmContinuation, type AgentToolConfirmContinuation } from '../agentRuntime/approvalCard.js';
import { validateAgentToolArguments } from '../agentRuntime/planner.js';
import { hasPriceAdjustmentConflict } from './priceChangeContract.js';
import { readPriceMultiplierArgument } from './priceMultiplier.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

const execFileAsync = promisify(execFile);

export interface RentalPriceAuditIssue {
  level: string;
  msg: string;
}

export interface RentalPriceAuditDiff {
  specId?: string;
  specTitle?: string;
  field: string;
  label: string;
  unit?: string;
  old: string;
  new: string;
  change: string;
  changePct: string;
  issues: RentalPriceAuditIssue[];
}

export interface RentalPriceAuditReference {
  taskId?: string;
  changesFile?: string;
  rollbackFile?: string;
  previewFile?: string | null;
  currentValuesFile?: string;
  diffFile?: string;
  hasErrors?: boolean;
  hasWarnings?: boolean;
  rulesApplied?: string[];
  diff?: RentalPriceAuditDiff[];
}

export type RentalPriceChangeRequest =
  | { mode: 'explicit_fields'; productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference; reason?: string; continuation?: AgentToolConfirmContinuation }
  | { mode: 'global_discount'; productId: string; discount: number; scope: 'rent_fields' | 'all_price_fields' }
  | { mode: 'global_adjustment'; productId: string; adjustmentAmount: number; scope: 'rent_fields' };

export interface RentalPricePreview {
  productId: string;
  fields: Record<string, string>;
  lines: string[];
  warnings: string[];
  audit?: RentalPriceAuditReference;
}

export interface RentalPriceExecutionResult {
  productId: string;
  ok: boolean;
  lines: string[];
  audit?: { taskId?: string; status: 'completed' | 'verify_failed' | 'failed' | 'untracked'; resultFile?: string; rollbackFile?: string };
}

export interface RentalPriceRollbackRequest {
  productId?: string;
  rollbackFile?: string;
  taskId?: string;
}

export interface RentalPriceRollbackResult {
  productId: string;
  ok: boolean;
  lines: string[];
  audit?: { taskId?: string; status: 'rolled_back' | 'rollback_failed' | 'rollback_verify_failed' | 'untracked'; resultFile?: string; rollbackFile?: string };
}

export interface RentalPriceReadResult {
  productId: string;
  ok: boolean;
  specs: { specId: string; title: string }[];
  values: Record<string, Record<string, string>>;
  lines: string[];
  warnings?: Array<{ level?: string; specId?: string; field?: string; message?: string }>;
  missingFields?: Array<{ specId?: string; field?: string; message?: string }>;
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

export interface RentalPriceSpecRefreshResult {
  productId: string;
  ok: boolean;
  lines: string[];
}

export type RentalApplyCurrentChanges = Record<string, unknown> | Record<string, Record<string, unknown>>;

export interface RentalApplyCurrentResult {
  productId: string;
  ok: boolean;
  changesFile: string;
  lines: string[];
}

export interface RentalPriceSpecRemoveResult {
  productId: string;
  ok: boolean;
  specDimId: string;
  itemId?: string;
  itemTitle: string;
  lines: string[];
  audit?: { resultFile?: string };
}

export interface RentalDaemonStatusResult {
  ok: boolean;
  status: string;
  pong?: boolean;
  message?: string;
  lines: string[];
}

export interface RentalPlatformSearchResult {
  ok: boolean;
  status: string;
  keyword: string;
  count: number;
  rows: unknown[];
  lines: string[];
}

export interface RentalPlatformSearchAllResult {
  ok: boolean;
  status: string;
  count: number;
  rows: unknown[];
  pagesScraped?: number;
  excludedCount?: number;
  truncated: boolean;
  lines: string[];
}

export interface RentalBatchReadResult {
  ok: boolean;
  status: string;
  count: number;
  results: Record<string, unknown>;
  errors: unknown[];
  warnings: unknown[];
  lines: string[];
}

export interface RentalRawReadResult extends RentalPriceReadResult {
  status: string;
  requestedCount?: number;
  readCount?: number;
}

export interface RentalSpecDiscoverFullResult extends RentalPriceSpecDiscoverResult {
  status: string;
}

interface RentalOperationConfirmMetadata {
  continuation?: AgentToolConfirmContinuation;
  plannerToolName?: 'rental.copy' | 'rental.delist' | 'rental.tenancySet' | 'rental.specDiscover' | 'rental.specAddAndRefresh' | 'rental.specRemovePlan' | 'rental.operationConfirmRequest';
  plannerArguments?: Record<string, unknown>;
  plannerReason?: string;
}

export interface RentalOperationExecutionResult {
  ok: boolean;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RentalPriceSkillClient {
  daemonStatus?(): Promise<RentalDaemonStatusResult>;
  platformSearch?(keyword: string): Promise<RentalPlatformSearchResult>;
  platformSearchAll?(limit?: number): Promise<RentalPlatformSearchAllResult>;
  batchRead?(productIds: string[]): Promise<RentalBatchReadResult>;
  specDiscoverFull?(productId: string): Promise<RentalSpecDiscoverFullResult>;
  readRaw?(productId: string, fields?: string[]): Promise<RentalRawReadResult>;
  preview(request: RentalPriceChangeRequest): Promise<RentalPricePreview>;
  execute(request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }>): Promise<RentalPriceExecutionResult>;
  applyPerSpec?(productId: string, specFields: Record<string, Record<string, string>>): Promise<RentalPriceExecutionResult>;
  rollback?(request: RentalPriceRollbackRequest): Promise<RentalPriceRollbackResult>;
  read?(productId: string): Promise<RentalPriceReadResult>;
  copy(productId: string): Promise<RentalPriceCopyResult>;
  delist(productId: string): Promise<RentalPriceDelistResult>;
  tenancySet(productId: string, days: string): Promise<RentalPriceTenancySetResult>;
  specDiscover(productId: string): Promise<RentalPriceSpecDiscoverResult>;
  specAddAndRefresh(productId: string, specDimId: string, itemTitle: string): Promise<RentalPriceSpecAddResult>;
  specAddItem?(productId: string, specDimId: string, itemTitle: string): Promise<RentalPriceSpecAddResult>;
  specRefresh?(productId: string): Promise<RentalPriceSpecRefreshResult>;
  applyCurrent?(expectedProductId: string, changes: RentalApplyCurrentChanges): Promise<RentalApplyCurrentResult>;
  submitCurrent?(expectedProductId: string): Promise<RentalPriceSpecRefreshResult>;
  specAddDim?(productId: string, title: string): Promise<RentalPriceSpecAddResult>;
  specRemoveDim?(request: { productId: string; specDimId: string }): Promise<RentalPriceSpecRemoveResult>;
  specRemoveItem?(request: { productId: string; specDimId: string; itemId?: string; itemTitle: string }): Promise<RentalPriceSpecRemoveResult>;
}

export interface RentalSpecRemoveItemConfirmRequest {
  productId: string;
  specDimId: string;
  dimensionTitle?: string;
  itemId?: string;
  itemTitle: string;
  keyword?: string;
}

export type RentalOperationConfirmRequest = (
  | { action: 'copy'; productId: string }
  | { action: 'delist'; productId: string }
  | { action: 'tenancy-set'; productId: string; days: string }
  | { action: 'spec-discover'; productId: string }
  | { action: 'spec-add-and-refresh'; productId: string; specDimId: string; itemTitle: string }
  | { action: 'spec-add-item'; productId: string; specDimId: string; itemTitle: string }
  | { action: 'spec-refresh'; productId: string }
  | { action: 'apply-current'; productId: string; changes: RentalApplyCurrentChanges }
  | { action: 'submit-current'; productId: string }
  | { action: 'spec-remove-items'; productId: string; query?: string; keyword: string; sameSkuGroupId?: string; items: RentalSpecRemoveItemConfirmRequest[] }
) & RentalOperationConfirmMetadata;

interface RentalPriceSkillClientOptions {
  rootDir?: string;
  daemonUrl?: string;
  daemonToken?: string;
}

const RENT_FIELD_PATTERN = /(1|2|3|4|5|7|10|15|30|60|90|180)\s*(?:天|日)(?:租金|租价|价格)?\s*(?:改(?:成|为|到)?|设(?:成|为)?|调(?:成|为|到)?|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)/g;
const PRICE_FIELD_NAMES = new Set(['rent1day', 'rent2day', 'rent3day', 'rent4day', 'rent5day', 'rent7day', 'rent10day', 'rent15day', 'rent30day', 'rent60day', 'rent90day', 'rent180day', 'marketPrice', 'deposit', 'purchasePrice', 'costPrice', 'finalPayment']);
const AUDIT_TASK_ID_PATTERN = /^task_\d+_[a-f0-9]+$/i;
const SPEC_REMOVE_CONFIRM_DISPLAY_LIMIT = 30;
const SPEC_REMOVE_CONFIRM_MAX_ITEMS = 50;
const SPEC_REMOVE_BULK_WARNING_ITEMS = 12;
const PLATFORM_SEARCH_ALL_DEFAULT_LIMIT = 100;
const PLATFORM_SEARCH_ALL_MAX_LIMIT = 200;

function money(value: string | number): string {
  return Number(value).toFixed(2);
}

function isRentPriceField(field: string): boolean {
  return /^rent\d+day$/.test(field);
}

function confirmationKey(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function readConfirmationKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function hasValidConfirmationKey(value: Record<string, unknown>, request: Record<string, unknown>): boolean {
  return readConfirmationKey(value.confirmationKey) === confirmationKey(request);
}

export function parseRentalPriceChange(text: string): RentalPriceChangeRequest | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const command = /^改价\s+(?:商品)?(\d+)\s+(.+)$/.exec(normalized);
  if (!command) return null;

  const productId = command[1];
  const body = command[2];

  const globalDiscount = /全局.*?([0-9]+(?:\.[0-9]+)?)/.exec(body);
  if (globalDiscount) return { mode: 'global_discount', productId, discount: Number(globalDiscount[1]), scope: 'rent_fields' };
  if (/全部租金/.test(body)) return { mode: 'global_discount', productId, discount: 0.9, scope: 'rent_fields' };
  const allPriceDiscount = /所有价格\s*\*\s*([0-9]+(?:\.[0-9]+)?)/.exec(body);
  if (allPriceDiscount) return { mode: 'global_discount', productId, discount: Number(allPriceDiscount[1]), scope: 'rent_fields' };

  const fields = parseRentPriceFieldsFromText(body);
  return Object.keys(fields).length ? { mode: 'explicit_fields', productId, fields } : null;
}

export function parseRentPriceFieldsFromText(text: string): Record<string, string> {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const fields: Record<string, string> = {};
  for (const match of normalized.matchAll(RENT_FIELD_PATTERN)) {
    const day = match[1];
    const value = match[2];
    if (day && value) fields[`rent${day}day`] = money(value);
  }
  return fields;
}

export function compactAuditReference(audit: RentalPriceAuditReference | undefined): RentalPriceAuditReference | undefined {
  if (!audit) return undefined;
  return {
    ...(audit.taskId ? { taskId: audit.taskId } : {}),
    ...(audit.changesFile ? { changesFile: audit.changesFile } : {}),
    ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}),
    ...(audit.previewFile ? { previewFile: audit.previewFile } : {}),
    ...(audit.currentValuesFile ? { currentValuesFile: audit.currentValuesFile } : {}),
    ...(audit.diffFile ? { diffFile: audit.diffFile } : {}),
    ...(audit.hasErrors !== undefined ? { hasErrors: audit.hasErrors } : {}),
    ...(audit.hasWarnings !== undefined ? { hasWarnings: audit.hasWarnings } : {}),
    ...(audit.rulesApplied ? { rulesApplied: audit.rulesApplied } : {}),
  };
}

function auditStatusText(audit: RentalPriceAuditReference): string {
  if (audit.hasErrors) return '🔴 有错误';
  if (audit.hasWarnings) return '🟡 有警告';
  return '✅ 通过';
}

function diffLine(diff: RentalPriceAuditDiff): string {
  const issues = diff.issues.length ? `｜${diff.issues.map((issue) => `${issue.level}: ${issue.msg}`).join('；')}` : '';
  const name = diff.specTitle ? `${diff.specTitle} / ${diff.label}` : diff.label;
  return `- ${name}: ${diff.old}${diff.unit ?? ''} -> ${diff.new}${diff.unit ?? ''}（${diff.changePct}）${issues}`;
}

function auditMarkdown(audit: RentalPriceAuditReference): string {
  const lines = [
    `**审计预览** ${auditStatusText(audit)}`,
    ...(audit.taskId ? [`审计任务：${audit.taskId}`] : []),
    ...(audit.changesFile ? [`变更文件：${audit.changesFile}`] : []),
    ...(audit.rollbackFile ? [`回滚文件：${audit.rollbackFile}`] : []),
    ...(audit.previewFile ? [`HTML预览：${audit.previewFile}`] : []),
  ];
  const diffs = audit.diff?.slice(0, 8).map(diffLine) ?? [];
  if (diffs.length > 0) lines.push('', ...diffs);
  if ((audit.diff?.length ?? 0) > diffs.length) lines.push(`还有 ${(audit.diff?.length ?? 0) - diffs.length} 条变更已写入审计文件。`);
  return lines.join('\n');
}

export function buildRentalPricePreviewCard(preview: RentalPricePreview, options: { reason?: string; continuation?: AgentToolConfirmContinuation } = {}): FeishuCardPayload {
  const audit = preview.audit;
  const request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }> = {
    mode: 'explicit_fields',
    productId: preview.productId,
    fields: preview.fields,
    ...(audit && !audit.hasErrors ? { audit: compactAuditReference(audit) } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.continuation ? { continuation: options.continuation } : {}),
  };
  const key = confirmationKey(request as unknown as Record<string, unknown>);
  const formElements: Record<string, unknown>[] = [];
  if (!audit?.hasErrors) {
    formElements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '确认改价' },
      type: 'primary',
      form_action_type: 'submit',
      name: 'rental_price_confirm_submit',
      behaviors: [{ type: 'callback', value: { action: 'rental_price_confirm', request, confirmationKey: key } }],
    });
  }
  formElements.push({
    tag: 'button',
    text: { tag: 'plain_text', content: '取消' },
    type: 'default',
    form_action_type: 'submit',
    name: 'rental_price_cancel_submit',
    behaviors: [{ type: 'callback', value: { action: 'rental_price_cancel', productId: preview.productId, confirmationKey: key } }],
  });

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁商品改价确认' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: `**商品 ${preview.productId} 改价预览**\n${preview.lines.join('\n')}` },
        ...(audit ? [{ tag: 'markdown', content: audit.hasErrors ? `${auditMarkdown(audit)}\n\n**审计发现错误，已阻断执行。** 请调整价格后重新发起。` : auditMarkdown(audit) }] : []),
        ...(preview.warnings.length ? [{ tag: 'markdown', content: `**风险提示**\n${preview.warnings.join('\n')}` }] : []),
        {
          tag: 'form',
          name: audit?.hasErrors ? 'rental_price_cancel_form' : 'rental_price_confirm_form',
          elements: formElements,
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
    case 'spec-add-item':
      return `给商品 ${request.productId} 的维度 ${request.specDimId} 添加规格项 ${request.itemTitle}`;
    case 'spec-refresh':
      return `刷新商品 ${request.productId} 规格结构`;
    case 'apply-current':
      return `在商品 ${request.productId} 当前表单页应用变更`;
    case 'submit-current':
      return `提交商品 ${request.productId} 当前表单页`;
    case 'spec-remove-items':
      return `删除 ${request.items.length} 个规格项（关键词 ${request.keyword}）`;
  }
}

function rentalOperationDetailMarkdown(request: RentalOperationConfirmRequest): string {
  if (request.action !== 'spec-remove-items') return '';
  const productIds = Array.from(new Set(request.items.map((item) => item.productId)));
  const lines = request.items.slice(0, SPEC_REMOVE_CONFIRM_DISPLAY_LIMIT).map((item, index) => {
    const dimension = item.dimensionTitle ? `${item.dimensionTitle} / ` : '';
    const itemId = item.itemId ? `，itemId ${item.itemId}` : '';
    return `${index + 1}. 商品 ${item.productId}：${dimension}${item.itemTitle}（维度 ${item.specDimId}${itemId}）`;
  });
  const omitted = request.items.length - lines.length;
  return [
    '',
    '**将删除以下规格项，不会删除整个规格维度：**',
    request.items.length > SPEC_REMOVE_BULK_WARNING_ITEMS ? `**大批量提示：涉及 ${productIds.length} 个商品、${request.items.length} 个规格项。确认后会逐个商品执行删除。**` : undefined,
    ...lines,
    ...(omitted > 0 ? [`还有 ${omitted} 个规格项未在卡片中展示。`] : []),
    request.sameSkuGroupId ? `同款组：${request.sameSkuGroupId}` : undefined,
    request.query ? `原始商品条件：${request.query}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function buildRentalOperationConfirmCard(request: RentalOperationConfirmRequest, reason: string): FeishuCardPayload {
  const title = rentalOperationTitle(request);
  const details = rentalOperationDetailMarkdown(request);
  const key = confirmationKey(request as unknown as Record<string, unknown>);
  const isBulkSpecRemove = request.action === 'spec-remove-items' && request.items.length > SPEC_REMOVE_BULK_WARNING_ITEMS;
  const confirmButtonText = request.action === 'spec-remove-items' ? `确认删除 ${request.items.length} 项` : '确认执行';
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁商品操作确认' }, template: isBulkSpecRemove ? 'red' : 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: `**是否要执行：${title}？**${details}\n\nLLM 理解原因：${reason}` },
        {
          tag: 'form',
          name: 'rental_operation_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: confirmButtonText },
              type: 'primary',
              form_action_type: 'submit',
              name: 'rental_operation_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_operation_confirm', request, confirmationKey: key } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'rental_operation_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_operation_cancel', productId: request.productId, confirmationKey: key } }],
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
    if (!isRentPriceField(field)) continue;
    const current = Number(raw);
    if (!Number.isFinite(current)) continue;
    fields[field] = money(request.mode === 'global_discount'
      ? current * request.discount
      : current + request.adjustmentAmount);
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

function optionalNumber(response: Record<string, unknown>, key: string): number | undefined {
  const value = response[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstStringField(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return null;
}

function summarizeRows(rows: unknown[]): string[] {
  return rows.slice(0, 5).map((row) => {
    const id = firstStringField(row, ['productId', 'internalProductId', 'id']) ?? 'unknown';
    const title = firstStringField(row, ['title', 'name', 'productName']) ?? '';
    return title ? `${id} ${title}` : id;
  });
}

function summarizeBatchReadResults(results: Record<string, unknown>): string[] {
  return Object.entries(results).slice(0, 10).map(([productId, result]) => {
    const status = isRecord(result) ? commandStatus(result) : 'unknown';
    return `${productId} ${status}`;
  });
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

function normalizePerSpecPriceFields(specFields: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const normalized: Record<string, Record<string, string>> = {};
  for (const [specId, fields] of Object.entries(specFields)) {
    const clean: Record<string, string> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (PRICE_FIELD_NAMES.has(field) && Number.isFinite(Number(value))) clean[field] = money(value);
    }
    if (Object.keys(clean).length) normalized[specId] = clean;
  }
  return normalized;
}

function verifiedPerSpecFields(response: Record<string, unknown>, specFields: Record<string, Record<string, string>>): boolean {
  const values = normalizeReadValues(response.values);
  return Object.entries(specFields).every(([specId, fields]) => {
    const actual = values[specId] ?? {};
    return Object.entries(fields).every(([field, value]) => moneyValue(actual[field]) === value);
  });
}

function moneyValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? money(numeric) : null;
}

function pathForCompare(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  const root = pathForCompare(resolve(rootDir));
  const target = pathForCompare(resolve(targetPath));
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(rootWithSep);
}

function safeAuditPath(rootDir: string, path: unknown): string | undefined {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) return undefined;
  const resolved = resolve(isAbsolute(path) ? path : join(rootDir, path));
  return isPathInside(rootDir, resolved) ? resolved : undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function runNodeJson(scriptPath: string, args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: dirname(scriptPath),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(String(stdout)) as Record<string, unknown>;
}

function normalizeAuditIssue(value: unknown): RentalPriceAuditIssue | null {
  if (!isRecord(value)) return null;
  const level = typeof value.level === 'string' && value.level.trim() ? value.level.trim() : 'info';
  const msg = typeof value.msg === 'string' ? value.msg : '';
  return { level, msg };
}

function normalizeAuditDiff(value: unknown): RentalPriceAuditDiff | null {
  if (!isRecord(value) || typeof value.field !== 'string') return null;
  const issues = Array.isArray(value.issues) ? value.issues.map(normalizeAuditIssue).filter((issue): issue is RentalPriceAuditIssue => Boolean(issue)) : [];
  return {
    ...(typeof value.specId === 'string' ? { specId: value.specId } : {}),
    ...(typeof value.specTitle === 'string' ? { specTitle: value.specTitle } : {}),
    field: value.field,
    label: typeof value.label === 'string' && value.label.trim() ? value.label : value.field,
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    old: String(value.old ?? ''),
    new: String(value.new ?? ''),
    change: String(value.change ?? ''),
    changePct: String(value.changePct ?? ''),
    issues,
  };
}

function normalizeAuditDiffs(value: unknown): RentalPriceAuditDiff[] {
  return Array.isArray(value) ? value.map(normalizeAuditDiff).filter((diff): diff is RentalPriceAuditDiff => Boolean(diff)) : [];
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  return items.length ? items : undefined;
}

function normalizePriceFields(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (PRICE_FIELD_NAMES.has(field) && (typeof raw === 'string' || typeof raw === 'number') && Number.isFinite(Number(raw))) fields[field] = money(raw);
  }
  return Object.keys(fields).length ? fields : null;
}

function buildRollbackFields(current: Record<string, unknown>, fields: Record<string, string>): Record<string, string> {
  const values = readableValues(current);
  const rollback: Record<string, string> = {};
  for (const field of Object.keys(fields)) {
    const formatted = moneyValue(values[field]);
    if (formatted !== null) rollback[field] = formatted;
    else if (typeof values[field] === 'string' && values[field].trim()) rollback[field] = values[field].trim();
  }
  return rollback;
}

function timestampToken(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function createAuditPreview(rootDir: string, productId: string, current: Record<string, unknown>, fields: Record<string, string>): Promise<RentalPriceAuditReference | null> {
  const diffScript = join(rootDir, 'scripts', 'diff-generator.js');
  const taskStoreScript = join(rootDir, 'scripts', 'task-store.js');
  const configPath = join(rootDir, 'config.json');
  const scriptsReady = await Promise.all([fileExists(diffScript), fileExists(taskStoreScript), fileExists(configPath)]);
  if (!scriptsReady.every(Boolean)) return null;

  const tasksDir = join(rootDir, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  const token = timestampToken();
  const currentValuesFile = join(tasksDir, `mt-agent-current-${productId}-${token}.json`);
  const intentFile = join(tasksDir, `mt-agent-intent-${productId}-${token}.json`);
  const diffFile = join(tasksDir, `mt-agent-diff-${productId}-${token}.json`);
  const rollbackFile = join(tasksDir, `rollback_${productId}-${token}.json`);
  const currentSnapshot = {
    ...current,
    productId,
    values: isRecord(current.values) ? current.values : {},
    specs: Array.isArray(current.specs) ? current.specs : [],
  };
  await writeJsonFile(currentValuesFile, currentSnapshot);
  await writeJsonFile(intentFile, fields);

  const diffResult = await runNodeJson(diffScript, [currentValuesFile, intentFile, '--html']);
  await writeJsonFile(diffFile, diffResult);
  const changesFile = safeAuditPath(rootDir, diffResult.changesFile) ?? undefined;
  const previewFile = typeof diffResult.previewFile === 'string' ? safeAuditPath(rootDir, diffResult.previewFile) ?? null : null;
  const rollbackFields = buildRollbackFields(currentSnapshot, fields);
  await writeJsonFile(rollbackFile, { __broadcast: true, ...rollbackFields });

  let taskId: string | undefined;
  if (changesFile) {
    try {
      const taskResult = await runNodeJson(taskStoreScript, ['create', `改价 商品 ${productId}`, changesFile]);
      taskId = typeof taskResult.taskId === 'string' && AUDIT_TASK_ID_PATTERN.test(taskResult.taskId) ? taskResult.taskId : undefined;
      if (taskId) {
        await runNodeJson(taskStoreScript, ['update', taskId, 'rollbackFile', rollbackFile]).catch(() => ({}));
        await runNodeJson(taskStoreScript, ['update', taskId, 'currentValuesFile', currentValuesFile]).catch(() => ({}));
        await runNodeJson(taskStoreScript, ['update', taskId, 'diffFile', diffFile]).catch(() => ({}));
        if (previewFile) await runNodeJson(taskStoreScript, ['update', taskId, 'previewFile', previewFile]).catch(() => ({}));
      }
    } catch {
      taskId = undefined;
    }
  }

  return {
    ...(taskId ? { taskId } : {}),
    ...(changesFile ? { changesFile } : {}),
    rollbackFile,
    previewFile,
    currentValuesFile,
    diffFile,
    diff: normalizeAuditDiffs(diffResult.diff),
    hasErrors: Boolean(diffResult.hasErrors),
    hasWarnings: Boolean(diffResult.hasWarnings),
    ...(normalizeStringArray(diffResult.rulesApplied) ? { rulesApplied: normalizeStringArray(diffResult.rulesApplied) } : {}),
  };
}

function parseAuditCallbackReference(value: unknown): RentalPriceAuditReference | undefined {
  if (!isRecord(value)) return undefined;
  const audit: RentalPriceAuditReference = {};
  if (typeof value.taskId === 'string' && AUDIT_TASK_ID_PATTERN.test(value.taskId)) audit.taskId = value.taskId;
  for (const key of ['changesFile', 'rollbackFile', 'currentValuesFile', 'diffFile'] as const) {
    const path = readString(value[key]);
    if (path && !path.includes('\0')) audit[key] = path;
  }
  const previewFile = value.previewFile === null ? null : readString(value.previewFile);
  if (previewFile !== null && !previewFile.includes('\0')) audit.previewFile = previewFile;
  if (typeof value.hasErrors === 'boolean') audit.hasErrors = value.hasErrors;
  if (typeof value.hasWarnings === 'boolean') audit.hasWarnings = value.hasWarnings;
  const rulesApplied = normalizeStringArray(value.rulesApplied);
  if (rulesApplied) audit.rulesApplied = rulesApplied;
  return Object.keys(audit).length ? audit : undefined;
}

function safeAuditForExecution(rootDir: string, audit: RentalPriceAuditReference | undefined): RentalPriceAuditReference | undefined {
  if (!audit) return undefined;
  return {
    ...(audit.taskId && AUDIT_TASK_ID_PATTERN.test(audit.taskId) ? { taskId: audit.taskId } : {}),
    ...(safeAuditPath(rootDir, audit.changesFile) ? { changesFile: safeAuditPath(rootDir, audit.changesFile) } : {}),
    ...(safeAuditPath(rootDir, audit.rollbackFile) ? { rollbackFile: safeAuditPath(rootDir, audit.rollbackFile) } : {}),
    ...(safeAuditPath(rootDir, audit.previewFile ?? undefined) ? { previewFile: safeAuditPath(rootDir, audit.previewFile ?? undefined) } : {}),
    ...(safeAuditPath(rootDir, audit.currentValuesFile) ? { currentValuesFile: safeAuditPath(rootDir, audit.currentValuesFile) } : {}),
    ...(safeAuditPath(rootDir, audit.diffFile) ? { diffFile: safeAuditPath(rootDir, audit.diffFile) } : {}),
    ...(audit.hasErrors !== undefined ? { hasErrors: audit.hasErrors } : {}),
    ...(audit.hasWarnings !== undefined ? { hasWarnings: audit.hasWarnings } : {}),
    ...(audit.rulesApplied ? { rulesApplied: audit.rulesApplied } : {}),
  };
}

async function updateAuditTask(rootDir: string, audit: RentalPriceAuditReference | undefined, status: 'completed' | 'verify_failed' | 'failed' | 'rolled_back' | 'rollback_failed' | 'rollback_verify_failed', resultFile?: string, evidenceType = 'verify_result'): Promise<void> {
  if (!audit?.taskId || !AUDIT_TASK_ID_PATTERN.test(audit.taskId)) return;
  const taskStoreScript = join(rootDir, 'scripts', 'task-store.js');
  if (!(await fileExists(taskStoreScript))) return;
  await runNodeJson(taskStoreScript, ['update', audit.taskId, 'status', status]).catch(() => ({}));
  if (resultFile) await runNodeJson(taskStoreScript, ['add-evidence', audit.taskId, evidenceType, resultFile]).catch(() => ({}));
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error(`JSON file must contain an object: ${path}`);
  return parsed;
}

function productIdFromTaskRecord(task: Record<string, unknown>): string | undefined {
  const direct = readProductId(task.productId);
  if (direct) return direct;
  const instruction = readString(task.instruction);
  const instructionMatch = instruction ? /商品\s*(\d+)/.exec(instruction) : null;
  return instructionMatch?.[1];
}

function productIdFromRollbackFile(path: string): string | undefined {
  return /(?:^|[\\/])rollback_(\d+)[-_]/.exec(path)?.[1];
}

async function resolveRollbackReference(rootDir: string, request: RentalPriceRollbackRequest): Promise<{ productId: string; audit: RentalPriceAuditReference; fields: Record<string, string> }> {
  const audit: RentalPriceAuditReference = {};
  if (request.taskId && AUDIT_TASK_ID_PATTERN.test(request.taskId)) audit.taskId = request.taskId;

  let productId = request.productId;
  let rollbackFile = safeAuditPath(rootDir, request.rollbackFile);
  if (!rollbackFile && audit.taskId) {
    const taskFile = join(rootDir, 'tasks', `${audit.taskId}.json`);
    if (!(await fileExists(taskFile))) throw new Error(`审计任务不存在：${audit.taskId}`);
    const task = await readJsonRecord(taskFile);
    productId = productId ?? productIdFromTaskRecord(task);
    const currentValuesFile = safeAuditPath(rootDir, task.currentValuesFile);
    if (!productId && currentValuesFile && await fileExists(currentValuesFile)) {
      productId = readProductId((await readJsonRecord(currentValuesFile)).productId) ?? undefined;
    }
    rollbackFile = safeAuditPath(rootDir, task.rollbackFile);
  }

  if (!rollbackFile) throw new Error('回滚需要 rollbackFile，或提供包含 rollbackFile 的 taskId。');
  if (!(await fileExists(rollbackFile))) throw new Error(`回滚文件不存在：${rollbackFile}`);
  productId = productId ?? productIdFromRollbackFile(rollbackFile);
  if (!productId) throw new Error('回滚需要 productId；如果只提供 taskId，该审计任务中必须包含商品信息。');

  const fields = normalizePriceFields(await readJsonRecord(rollbackFile));
  if (!fields) throw new Error(`回滚文件没有可执行的价格字段：${rollbackFile}`);
  audit.rollbackFile = rollbackFile;
  return { productId, audit, fields };
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return value || null;
  } catch {
    return null;
  }
}

function compactErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${error.message}; ${cause.message}`;
    return error.message;
  }
  return String(error);
}

function daemonUnavailableError(daemonUrl: string, error: unknown): Error {
  return new Error([
    `rental-price-agent daemon 不可达：${daemonUrl}`,
    '请确认 PM2 进程 mt-rental-price-agent 在线，或运行 npm run rental-price-skill:pm2:start。',
    `原始错误：${compactErrorMessage(error)}`,
  ].join('\n'));
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
    let response: Response;
    try {
      response = await fetch(daemonUrl, { method: 'POST', headers, body: JSON.stringify(command) });
    } catch (error) {
      throw daemonUnavailableError(daemonUrl, error);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async daemonStatus() {
      const result = await send({ action: 'ping' });
      const status = commandStatus(result);
      const pong = optionalBoolean(result, 'pong');
      const message = optionalString(result, 'message');
      return {
        ok: status === 'ok',
        status,
        ...(pong !== undefined ? { pong } : {}),
        ...(message ? { message } : {}),
        lines: [`ping: ${status}`, ...(pong !== undefined ? [`pong: ${pong}`] : []), ...(message ? [`message: ${message}`] : [])],
      };
    },
    async platformSearch(keyword) {
      const result = await send({ action: 'platform-search', keyword });
      const status = commandStatus(result);
      const rows = Array.isArray(result.products)
        ? result.products
        : Array.isArray(result.rows)
          ? result.rows
          : Array.isArray(result.results)
            ? result.results
            : Array.isArray(result.items)
              ? result.items
              : [];
      const count = optionalNumber(result, 'count') ?? rows.length;
      return {
        ok: status === 'ok' || status === 'partial',
        status,
        keyword,
        count,
        rows,
        lines: [`platform-search: ${status}`, `keyword: ${keyword}`, `count: ${count}`, ...summarizeRows(rows)],
      };
    },
    async platformSearchAll(limit = PLATFORM_SEARCH_ALL_DEFAULT_LIMIT) {
      const cappedLimit = Math.max(1, Math.min(Math.trunc(limit), PLATFORM_SEARCH_ALL_MAX_LIMIT));
      const result = await send({ action: 'platform-search-all' });
      const status = commandStatus(result);
      const allRows = Array.isArray(result.products)
        ? result.products
        : Array.isArray(result.rows)
          ? result.rows
          : Array.isArray(result.results)
            ? result.results
            : Array.isArray(result.items)
              ? result.items
              : [];
      const rows = allRows.slice(0, cappedLimit);
      const count = optionalNumber(result, 'count') ?? allRows.length;
      const pagesScraped = optionalNumber(result, 'pagesScraped');
      const excludedCount = optionalNumber(result, 'excludedCount');
      const truncated = allRows.length > rows.length;
      return {
        ok: status === 'ok' || status === 'partial',
        status,
        count,
        rows,
        ...(pagesScraped !== undefined ? { pagesScraped } : {}),
        ...(excludedCount !== undefined ? { excludedCount } : {}),
        truncated,
        lines: [`platform-search-all: ${status}`, `count: ${count}`, `returned: ${rows.length}`, ...(pagesScraped !== undefined ? [`pagesScraped: ${pagesScraped}`] : []), ...summarizeRows(rows)],
      };
    },
    async batchRead(productIds) {
      const result = await send({ action: 'batch-read', productIds });
      const status = commandStatus(result);
      const results = isRecord(result.results) ? result.results : {};
      const errors = Array.isArray(result.errors) ? result.errors : [];
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const count = optionalNumber(result, 'count') ?? Object.keys(results).length;
      return {
        ok: status === 'ok' || status === 'partial',
        status,
        count,
        results,
        errors,
        warnings,
        lines: [`batch-read: ${status}`, `count: ${count}`, ...summarizeBatchReadResults(results)],
      };
    },
    async specDiscoverFull(productId) {
      const result = await send({ action: 'spec-discover', productId });
      const status = commandStatus(result);
      const dimensions = Array.isArray(result.dimensions) ? result.dimensions as RentalPriceSpecDiscoverResult['dimensions'] : [];
      return { productId, ok: status === 'ok', status, dimensions, lines: [`spec-discover: ${status}`, `${dimensions.length} dimensions`] };
    },
    async readRaw(productId, fields) {
      const result = await send({ action: 'read', productId, ...(fields && fields.length > 0 ? { fields } : {}) });
      const status = commandStatus(result);
      const specs = normalizeReadSpecs(result.specs);
      const values = normalizeReadValues(result.values);
      const warnings = normalizeReadDiagnostics(result.warnings);
      const missingFields = normalizeReadDiagnostics(result.missingFields);
      const requestedCount = optionalNumber(result, 'requestedCount');
      const readCount = optionalNumber(result, 'readCount');
      const message = optionalString(result, 'message');
      return {
        productId,
        ok: status === 'ok' || status === 'partial',
        status,
        specs,
        values,
        lines: [`read: ${status}`, `${specs.length} specs`, ...(requestedCount !== undefined ? [`requestedCount: ${requestedCount}`] : []), ...(readCount !== undefined ? [`readCount: ${readCount}`] : []), ...(message ? [message] : [])],
        ...(warnings ? { warnings } : {}),
        ...(missingFields ? { missingFields } : {}),
        ...(requestedCount !== undefined ? { requestedCount } : {}),
        ...(readCount !== undefined ? { readCount } : {}),
      };
    },
    async read(productId) {
      const result = await send({ action: 'read', productId });
      const status = commandStatus(result);
      const specs = normalizeReadSpecs(result.specs);
      const values = normalizeReadValues(result.values);
      const warnings = normalizeReadDiagnostics(result.warnings);
      const missingFields = normalizeReadDiagnostics(result.missingFields);
      const message = optionalString(result, 'message');
      return {
        productId,
        ok: status === 'ok' || status === 'partial',
        specs,
        values,
        lines: [`read: ${status}`, `${specs.length} specs`, ...(message ? [message] : [])],
        ...(warnings ? { warnings } : {}),
        ...(missingFields ? { missingFields } : {}),
      };
    },
    async preview(request) {
      const current = await send({ action: 'read', productId: request.productId });
      const readStatus = commandStatus(current);
      if (readStatus !== 'ok' && readStatus !== 'partial') {
        const message = optionalString(current, 'message') ?? 'unknown read error';
        const url = optionalString(current, 'url');
        throw new Error(`read failed: ${message}${url ? `; url=${url}` : ''}`);
      }
      const values = isRecord(current.values) ? current.values : {};
      const fields = selectedFields(values, request);
      const lines = Object.entries(fields).map(([field, value]) => `${field} -> ${value}`);
      const warnings: string[] = [];
      let audit: RentalPriceAuditReference | null = null;
      if (Object.keys(fields).length > 0) {
        try {
          audit = await createAuditPreview(rootDir, request.productId, current, fields);
          if (audit?.taskId) lines.push(`审计任务: ${audit.taskId}`);
          if (audit?.rollbackFile) lines.push(`回滚文件: ${audit.rollbackFile}`);
          if (audit?.hasErrors) warnings.push('审计发现错误，已阻断执行。');
          else if (audit?.hasWarnings) warnings.push('审计发现警告，请确认后再执行。');
          else if (!audit) warnings.push('审计预览不可用：未找到 rental-price-agent 审计脚本或 config.json，已降级为普通改价预览。');
        } catch (error) {
          warnings.push(`审计预览不可用：${error instanceof Error ? error.message : String(error)}，已降级为普通改价预览。`);
        }
      }
      return { productId: request.productId, fields, lines, warnings, ...(audit ? { audit } : {}) };
    },
    async execute(request) {
      const tasksDir = join(rootDir, 'tasks');
      await mkdir(tasksDir, { recursive: true });
      if (request.audit?.hasErrors) {
        return {
          productId: request.productId,
          ok: false,
          lines: ['apply: skipped', 'submit: skipped', 'verify: skipped', 'audit: blocked_by_errors'],
          audit: { ...(request.audit.taskId ? { taskId: request.audit.taskId } : {}), status: 'failed', ...(request.audit.rollbackFile ? { rollbackFile: request.audit.rollbackFile } : {}) },
        };
      }
      const audit = safeAuditForExecution(rootDir, request.audit);
      let changesFile = audit?.changesFile;
      if (!changesFile || !(await fileExists(changesFile))) {
        changesFile = join(tasksDir, `mt-agent-changes-${Date.now()}.json`);
        await writeFile(changesFile, JSON.stringify({ __broadcast: true, ...request.fields }, null, 2), 'utf8');
      }
      const auditLines = [
        ...(audit?.taskId ? [`auditTask: ${audit.taskId}`] : []),
        ...(audit?.rollbackFile ? [`rollbackFile: ${audit.rollbackFile}`] : []),
      ];
      const apply = await send({ action: 'apply', productId: request.productId, changesFile });
      const applyStatus = commandStatus(apply);
      if (applyStatus !== 'ok') {
        await updateAuditTask(rootDir, audit, 'failed');
        return {
          productId: request.productId,
          ok: false,
          lines: [`apply: ${applyStatus}`, 'submit: skipped', 'verify: skipped', ...auditLines],
          ...(audit ? { audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? 'failed' : 'untracked', ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) } } : {}),
        };
      }

      const submit = await send({ action: 'submit', expectedProductId: request.productId });
      const submitStatus = commandStatus(submit);
      if (submitStatus !== 'ok') {
        await updateAuditTask(rootDir, audit, 'failed');
        return {
          productId: request.productId,
          ok: false,
          lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, 'verify: skipped', ...auditLines],
          ...(audit ? { audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? 'failed' : 'untracked', ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) } } : {}),
        };
      }

      const verified = await send({ action: 'read', productId: request.productId });
      const verifyStatus = commandStatus(verified);
      const fieldsMatch = verifiedFields(verified, request.fields);
      const ok = verifyStatus !== 'error' && fieldsMatch;
      const auditStatus: 'completed' | 'verify_failed' = ok ? 'completed' : 'verify_failed';
      const resultFile = join(tasksDir, `verify-${request.productId}-${timestampToken()}.json`);
      await writeJsonFile(resultFile, {
        productId: request.productId,
        ok,
        expectedFields: request.fields,
        applyStatus,
        submitStatus,
        verifyStatus,
        fieldsMatch,
        verified,
        changesFile,
        rollbackFile: audit?.rollbackFile,
        createdAt: new Date().toISOString(),
      });
      await updateAuditTask(rootDir, audit, auditStatus, resultFile);
      return {
        productId: request.productId,
        ok,
        lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, `verify: ${verifyStatus}`, `fields: ${fieldsMatch ? 'matched' : 'mismatch'}`, ...auditLines, ...(audit ? [`verifyFile: ${resultFile}`] : [])],
        ...(audit ? { audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? auditStatus : 'untracked', resultFile, ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) } } : {}),
      };
    },
    async applyPerSpec(productId, specFields) {
      const safeProductId = readProductId(productId);
      if (!safeProductId) throw new Error('productId must be a numeric string');
      const tasksDir = join(rootDir, 'tasks');
      await mkdir(tasksDir, { recursive: true });
      const normalized = normalizePerSpecPriceFields(specFields);
      if (!Object.keys(normalized).length) {
        return { productId: safeProductId, ok: false, lines: ['apply: skipped', 'submit: skipped', 'verify: skipped', 'fields: empty'] };
      }
      const changesFile = join(tasksDir, `mt-agent-per-spec-changes-${safeProductId}-${timestampToken()}.json`);
      await writeJsonFile(changesFile, normalized);

      const apply = await send({ action: 'apply', productId: safeProductId, changesFile });
      const applyStatus = commandStatus(apply);
      if (applyStatus !== 'ok') {
        return { productId: safeProductId, ok: false, lines: [`apply: ${applyStatus}`, 'submit: skipped', 'verify: skipped', `changesFile: ${changesFile}`] };
      }

      const submit = await send({ action: 'submit', expectedProductId: safeProductId });
      const submitStatus = commandStatus(submit);
      if (submitStatus !== 'ok') {
        return { productId: safeProductId, ok: false, lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, 'verify: skipped', `changesFile: ${changesFile}`] };
      }

      const verified = await send({ action: 'read', productId: safeProductId });
      const verifyStatus = commandStatus(verified);
      const fieldsMatch = verifiedPerSpecFields(verified, normalized);
      const ok = verifyStatus !== 'error' && fieldsMatch;
      const resultFile = join(tasksDir, `per-spec-verify-${safeProductId}-${timestampToken()}.json`);
      await writeJsonFile(resultFile, {
        productId: safeProductId,
        ok,
        expectedSpecFields: normalized,
        applyStatus,
        submitStatus,
        verifyStatus,
        fieldsMatch,
        verified,
        changesFile,
        createdAt: new Date().toISOString(),
      });
      return {
        productId: safeProductId,
        ok,
        lines: [`apply: ${applyStatus}`, `submit: ${submitStatus}`, `verify: ${verifyStatus}`, `fields: ${fieldsMatch ? 'matched' : 'mismatch'}`, `changesFile: ${changesFile}`, `verifyFile: ${resultFile}`],
        audit: { status: ok ? 'completed' : 'verify_failed', resultFile },
      };
    },
    async rollback(request) {
      const tasksDir = join(rootDir, 'tasks');
      await mkdir(tasksDir, { recursive: true });
      const { productId, audit, fields } = await resolveRollbackReference(rootDir, request);
      const auditLines = [
        ...(audit.taskId ? [`auditTask: ${audit.taskId}`] : []),
        ...(audit.rollbackFile ? [`rollbackFile: ${audit.rollbackFile}`] : []),
      ];
      const apply = await send({ action: 'apply', productId, changesFile: audit.rollbackFile });
      const applyStatus = commandStatus(apply);
      if (applyStatus !== 'ok') {
        await updateAuditTask(rootDir, audit, 'rollback_failed');
        return {
          productId,
          ok: false,
          lines: [`rollbackApply: ${applyStatus}`, 'submit: skipped', 'verify: skipped', ...auditLines],
          audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? 'rollback_failed' : 'untracked', ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) },
        };
      }

      const submit = await send({ action: 'submit', expectedProductId: productId });
      const submitStatus = commandStatus(submit);
      if (submitStatus !== 'ok') {
        await updateAuditTask(rootDir, audit, 'rollback_failed');
        return {
          productId,
          ok: false,
          lines: [`rollbackApply: ${applyStatus}`, `submit: ${submitStatus}`, 'verify: skipped', ...auditLines],
          audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? 'rollback_failed' : 'untracked', ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) },
        };
      }

      const verified = await send({ action: 'read', productId });
      const verifyStatus = commandStatus(verified);
      const fieldsMatch = verifiedFields(verified, fields);
      const ok = verifyStatus !== 'error' && fieldsMatch;
      const auditStatus: 'rolled_back' | 'rollback_verify_failed' = ok ? 'rolled_back' : 'rollback_verify_failed';
      const resultFile = join(tasksDir, `rollback-verify-${productId}-${timestampToken()}.json`);
      await writeJsonFile(resultFile, {
        productId,
        ok,
        expectedFields: fields,
        applyStatus,
        submitStatus,
        verifyStatus,
        fieldsMatch,
        verified,
        rollbackFile: audit.rollbackFile,
        createdAt: new Date().toISOString(),
      });
      await updateAuditTask(rootDir, audit, auditStatus, resultFile, 'rollback_verify_result');
      return {
        productId,
        ok,
        lines: [`rollbackApply: ${applyStatus}`, `submit: ${submitStatus}`, `verify: ${verifyStatus}`, `fields: ${fieldsMatch ? 'matched' : 'mismatch'}`, ...auditLines, `verifyFile: ${resultFile}`],
        audit: { ...(audit.taskId ? { taskId: audit.taskId } : {}), status: audit.taskId ? auditStatus : 'untracked', resultFile, ...(audit.rollbackFile ? { rollbackFile: audit.rollbackFile } : {}) },
      };
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
    async specAddAndRefresh(productId, specDimId, itemTitle) {
      const result = await send({ action: 'spec-add-and-refresh', productId, specDimId, itemTitle });
      const status = commandStatus(result);
      return { productId, ok: status === 'ok', itemTitle, lines: [`spec-add-and-refresh: ${status}`] };
    },
    async specAddItem(productId, specDimId, itemTitle) {
      const result = await send({ action: 'spec-add-item', productId, specDimId, itemTitle });
      const status = commandStatus(result);
      return { productId, ok: status === 'ok', itemTitle, lines: [`spec-add-item: ${status}`] };
    },
    async specRefresh(productId) {
      const result = await send({ action: 'spec-refresh', productId });
      const status = commandStatus(result);
      return { productId, ok: status === 'ok', lines: [`spec-refresh: ${status}`] };
    },
    async applyCurrent(expectedProductId, changes) {
      const safeProductId = readProductId(expectedProductId);
      if (!safeProductId) throw new Error('expectedProductId must be a numeric string');
      const tasksDir = join(rootDir, 'tasks');
      await mkdir(tasksDir, { recursive: true });
      const changesFile = join(tasksDir, `mt-agent-apply-current-${safeProductId}-${timestampToken()}.json`);
      await writeJsonFile(changesFile, changes);
      const result = await send({ action: 'apply-current', changesFile, allowCurrentPage: true, expectedProductId: safeProductId });
      const status = commandStatus(result);
      return { productId: safeProductId, ok: status === 'ok', changesFile, lines: [`apply-current: ${status}`, `changesFile: ${changesFile}`] };
    },
    async submitCurrent(expectedProductId) {
      const safeProductId = readProductId(expectedProductId);
      if (!safeProductId) throw new Error('expectedProductId must be a numeric string');
      const result = await send({ action: 'submit', expectedProductId: safeProductId });
      const status = commandStatus(result);
      return { productId: safeProductId, ok: status === 'ok', lines: [`submit: ${status}`] };
    },
    async specAddDim(productId, title) {
      const safeProductId = readProductId(productId);
      if (!safeProductId) throw new Error('productId must be a numeric string');
      const result = await send({ action: 'spec-add-dim', productId: safeProductId, itemTitle: title });
      const status = commandStatus(result);
      const submit = await send({ action: 'submit', expectedProductId: safeProductId });
      const submitStatus = commandStatus(submit);
      const discovered = await send({ action: 'spec-discover', productId: safeProductId });
      const discoverStatus = commandStatus(discovered);
      const dimensions = Array.isArray(discovered.dimensions) ? discovered.dimensions as RentalPriceSpecDiscoverResult['dimensions'] : [];
      const verified = dimensions.some((dimension) => dimension.title.replace(/\s+/g, ' ').trim() === title.replace(/\s+/g, ' ').trim());
      return {
        productId: safeProductId,
        ok: status === 'ok' && submitStatus === 'ok' && discoverStatus === 'ok' && verified,
        itemTitle: title,
        lines: [`spec-add-dim: ${status}`, `submit: ${submitStatus}`, `spec-discover: ${discoverStatus}`, `verified: ${verified}`],
      };
    },
    async specRemoveDim(request) {
      const safeProductId = readProductId(request.productId);
      if (!safeProductId) throw new Error('productId must be a numeric string');
      const remove = await send({
        action: 'spec-remove-dim',
        productId: safeProductId,
        specDimId: request.specDimId,
        expectedProductId: safeProductId,
      });
      const removeStatus = commandStatus(remove);
      const submit = await send({ action: 'submit', expectedProductId: safeProductId });
      const submitStatus = commandStatus(submit);
      const discovered = await send({ action: 'spec-discover', productId: safeProductId });
      const discoverStatus = commandStatus(discovered);
      const dimensions = Array.isArray(discovered.dimensions) ? discovered.dimensions as RentalPriceSpecDiscoverResult['dimensions'] : [];
      const verified = !dimensions.some((dimension) => String(dimension.specId) === String(request.specDimId));
      return {
        productId: safeProductId,
        ok: removeStatus === 'ok' && submitStatus === 'ok' && discoverStatus === 'ok' && verified,
        specDimId: request.specDimId,
        itemTitle: request.specDimId,
        lines: [`spec-remove-dim: ${removeStatus}`, `submit: ${submitStatus}`, `spec-discover: ${discoverStatus}`, `verified: ${verified}`],
      };
    },
    async specRemoveItem(request) {
      const before = await send({ action: 'spec-discover', productId: request.productId });
      const beforeStatus = commandStatus(before);
      if (beforeStatus !== 'ok') {
        return {
          productId: request.productId,
          ok: false,
          specDimId: request.specDimId,
          ...(request.itemId ? { itemId: request.itemId } : {}),
          itemTitle: request.itemTitle,
          lines: [`precheck: ${beforeStatus}`, optionalString(before, 'message') ?? 'spec discover failed'],
        };
      }

      const remove = await send({
        action: 'spec-remove-item',
        productId: request.productId,
        expectedProductId: request.productId,
        specDimId: request.specDimId,
        ...(request.itemId ? { itemId: request.itemId } : {}),
        itemTitle: request.itemTitle,
      });
      const removeStatus = commandStatus(remove);
      if (removeStatus !== 'ok') {
        return {
          productId: request.productId,
          ok: false,
          specDimId: request.specDimId,
          ...(request.itemId ? { itemId: request.itemId } : {}),
          itemTitle: request.itemTitle,
          lines: [`precheck: ${beforeStatus}`, `remove: ${removeStatus}`, optionalString(remove, 'message') ?? 'remove failed'],
        };
      }

      const refresh = await send({
        action: 'spec-refresh',
        allowCurrentPage: true,
        expectedProductId: request.productId,
      });
      const refreshStatus = commandStatus(refresh);
      if (refreshStatus !== 'ok') {
        return {
          productId: request.productId,
          ok: false,
          specDimId: request.specDimId,
          ...(request.itemId ? { itemId: request.itemId } : {}),
          itemTitle: request.itemTitle,
          lines: [`precheck: ${beforeStatus}`, `remove: ${removeStatus}`, `refresh: ${refreshStatus}`, optionalString(refresh, 'message') ?? 'refresh failed'],
        };
      }

      const submit = await send({ action: 'submit', expectedProductId: request.productId });
      const submitStatus = commandStatus(submit);
      if (submitStatus !== 'ok') {
        return {
          productId: request.productId,
          ok: false,
          specDimId: request.specDimId,
          ...(request.itemId ? { itemId: request.itemId } : {}),
          itemTitle: request.itemTitle,
          lines: [`precheck: ${beforeStatus}`, `remove: ${removeStatus}`, `refresh: ${refreshStatus}`, `submit: ${submitStatus}`, optionalString(submit, 'message') ?? 'submit failed'],
        };
      }

      const after = await send({ action: 'spec-discover', productId: request.productId });
      const afterStatus = commandStatus(after);
      const afterDimensions = Array.isArray(after.dimensions) ? after.dimensions as RentalPriceSpecDiscoverResult['dimensions'] : [];
      const targetDim = afterDimensions.find((dimension) => String(dimension.specId) === String(request.specDimId));
      const stillExists = Boolean(targetDim?.items.some((item) =>
        (request.itemId && String(item.id) === request.itemId) ||
        item.title.replace(/\s+/g, ' ').trim() === request.itemTitle.replace(/\s+/g, ' ').trim(),
      ));
      const ok = afterStatus === 'ok' && !stillExists;
      const resultFile = join(rootDir, 'tasks', `spec-remove-${request.productId}-${timestampToken()}.json`);
      await writeJsonFile(resultFile, {
        productId: request.productId,
        specDimId: request.specDimId,
        itemId: request.itemId,
        itemTitle: request.itemTitle,
        ok,
        before,
        remove,
        refresh,
        submit,
        after,
        createdAt: new Date().toISOString(),
      });
      return {
        productId: request.productId,
        ok,
        specDimId: request.specDimId,
        ...(request.itemId ? { itemId: request.itemId } : {}),
        itemTitle: request.itemTitle,
        lines: [`precheck: ${beforeStatus}`, `remove: ${removeStatus}`, `refresh: ${refreshStatus}`, `submit: ${submitStatus}`, `verify: ${afterStatus}`, `item: ${stillExists ? 'still_exists' : 'removed'}`, `auditFile: ${resultFile}`],
        audit: { resultFile },
      };
    },
  };
}

export function parseRentalCopyCommand(text: string): string | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /^(?:复制商品|商品复制)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseDelistCommand(text: string): string | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /^(?:下架商品|商品下架)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseTenancySetCommand(text: string): { productId: string; days: string } | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /^(?:设置租期|租期设置)\s*(\d+)\s+([\d,]+)$/.exec(normalized);
  return match ? { productId: match[1], days: match[2] } : null;
}

export function parseSpecDiscoverCommand(text: string): string | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /^(?:查看规格|规格查看)\s*(\d+)$/.exec(normalized);
  return match ? match[1] : null;
}

export function parseSpecAddCommand(text: string): { productId: string; specDimId: string; itemTitle: string } | null {
  const normalized = text.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const match = /^(?:添加规格|规格添加)\s*(\d+)\s+(\S+)\s+(.+)$/.exec(normalized);
  return match ? { productId: match[1], specDimId: match[2].trim(), itemTitle: match[3].trim() } : null;
}

export function parseRentalPriceConfirmRequest(value: unknown): Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }> | null {
  if (!isRecord(value)) return null;
  const request = value.request;
  if (!isRecord(request) || request.mode !== 'explicit_fields' || typeof request.productId !== 'string' || !isRecord(request.fields)) return null;
  if (!hasValidConfirmationKey(value, request)) return null;
  if (isRecord(request.audit) && request.audit.hasErrors === true) return null;
  const continuation = parseAgentToolConfirmContinuation(request.continuation);
  if (request.continuation !== undefined && !continuation) return null;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(request.fields)) {
    if (PRICE_FIELD_NAMES.has(field) && typeof raw === 'string' && Number.isFinite(Number(raw))) fields[field] = money(raw);
  }
  if (!Object.keys(fields).length) return null;
  const audit = parseAuditCallbackReference(request.audit);
  const reason = readString(request.reason) ?? undefined;
  return {
    mode: 'explicit_fields',
    productId: request.productId,
    fields,
    ...(audit ? { audit } : {}),
    ...(reason ? { reason } : {}),
    ...(continuation ? { continuation } : {}),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readProductId(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d+$/.test(raw) ? raw : null;
}

function parseSpecRemoveItems(value: unknown): RentalSpecRemoveItemConfirmRequest[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > SPEC_REMOVE_CONFIRM_MAX_ITEMS) return null;
  const items: RentalSpecRemoveItemConfirmRequest[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const productId = readProductId(item.productId);
    const specDimId = readString(item.specDimId);
    const dimensionTitle = readString(item.dimensionTitle) ?? undefined;
    const itemId = readString(item.itemId) ?? undefined;
    const itemTitle = readString(item.itemTitle);
    const keyword = readString(item.keyword) ?? undefined;
    if (!productId || !specDimId || !itemTitle) return null;
    items.push({
      productId,
      specDimId,
      ...(dimensionTitle ? { dimensionTitle } : {}),
      ...(itemId ? { itemId } : {}),
      itemTitle,
      ...(keyword ? { keyword } : {}),
    });
  }
  return items;
}

function parseRentalOperationMetadata(request: Record<string, unknown>): RentalOperationConfirmMetadata | null {
  const continuation = parseAgentToolConfirmContinuation(request.continuation);
  if (request.continuation !== undefined && !continuation) return null;

  const rawPlannerToolName = readString(request.plannerToolName);
  const plannerToolName = rawPlannerToolName === 'rental.specRemovePlan' || rawPlannerToolName === 'rental.operationConfirmRequest' ? rawPlannerToolName : undefined;
  if (rawPlannerToolName && !plannerToolName) return null;

  const plannerArguments = isRecord(request.plannerArguments) ? request.plannerArguments : undefined;
  if (request.plannerArguments !== undefined && !plannerArguments) return null;
  if (plannerToolName && plannerArguments && !validateAgentToolArguments(plannerToolName, plannerArguments)) return null;

  const plannerReason = readString(request.plannerReason) ?? undefined;
  return {
    ...(continuation ? { continuation } : {}),
    ...(plannerToolName ? { plannerToolName } : {}),
    ...(plannerArguments ? { plannerArguments } : {}),
    ...(plannerReason ? { plannerReason } : {}),
  };
}

export function rentalPriceChangeRequestFromToolArguments(args: Record<string, unknown>): RentalPriceChangeRequest | null {
  const productId = readProductId(args.productId);
  if (!productId) return null;
  if (hasPriceAdjustmentConflict(args)) return null;

  const fields = normalizePriceFields(args.fields);
  if (fields) return { mode: 'explicit_fields', productId, fields };

  const discount = readPriceMultiplierArgument(args.discount);
  if (discount !== null) {
    return { mode: 'global_discount', productId, discount, scope: 'rent_fields' };
  }

  const rawAdjustmentAmount = args.adjustmentAmount;
  const adjustmentAmount = typeof rawAdjustmentAmount === 'number'
    ? rawAdjustmentAmount
    : typeof rawAdjustmentAmount === 'string'
      ? Number(rawAdjustmentAmount.trim())
      : NaN;
  if (Number.isFinite(adjustmentAmount) && adjustmentAmount !== 0) {
    return { mode: 'global_adjustment', productId, adjustmentAmount, scope: 'rent_fields' };
  }

  return null;
}

function normalizeReadSpecs(value: unknown): RentalPriceReadResult['specs'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const specId = readString(item.specId);
      const title = readString(item.title);
      return specId ? { specId, title: title ?? specId } : null;
    })
    .filter((item): item is { specId: string; title: string } => Boolean(item));
}

function normalizeReadValues(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, Record<string, string>> = {};
  for (const [specId, rawFields] of Object.entries(value)) {
    if (!isRecord(rawFields)) continue;
    const fields: Record<string, string> = {};
    for (const [field, raw] of Object.entries(rawFields)) {
      if (typeof raw === 'string' || typeof raw === 'number') fields[field] = String(raw).trim();
    }
    normalized[specId] = fields;
  }
  return normalized;
}

function normalizeReadDiagnostics(value: unknown): Array<{ level?: string; specId?: string; field?: string; message?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const level = readString(item.level);
      const specId = readString(item.specId);
      const field = readString(item.field);
      const message = readString(item.message);
      return level || specId || field || message ? { ...(level ? { level } : {}), ...(specId ? { specId } : {}), ...(field ? { field } : {}), ...(message ? { message } : {}) } : null;
    })
    .filter((item): item is { level?: string; specId?: string; field?: string; message?: string } => Boolean(item));
  return items.length ? items : undefined;
}

export function rentalPriceRollbackRequestFromToolArguments(args: Record<string, unknown>): RentalPriceRollbackRequest | null {
  const productId = readProductId(args.productId) ?? undefined;
  const taskId = readString(args.taskId);
  const rollbackFile = readString(args.rollbackFile);
  if (!taskId && !rollbackFile) return null;
  if (taskId && !AUDIT_TASK_ID_PATTERN.test(taskId)) return null;
  return {
    ...(productId ? { productId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(rollbackFile ? { rollbackFile } : {}),
  };
}

function readRentalOperationConfirmRequestRecord(request: Record<string, unknown>): RentalOperationConfirmRequest | null {
  const action = readString(request.action);
  const productId = readProductId(request.productId);
  if (!action || !productId) return null;
  const metadata = parseRentalOperationMetadata(request);
  if (!metadata) return null;

  if (action === 'copy') return { action, productId, ...metadata };
  if (action === 'delist') return { action, productId, ...metadata };
  if (action === 'spec-discover') return { action, productId, ...metadata };
  if (action === 'tenancy-set') {
    const days = readString(request.days);
    return days && /^\d+(?:,\d+)*$/.test(days) ? { action, productId, days, ...metadata } : null;
  }
  if (action === 'spec-add-and-refresh') {
    const specDimId = readString(request.specDimId);
    const itemTitle = readString(request.itemTitle);
    return specDimId && itemTitle ? { action, productId, specDimId, itemTitle, ...metadata } : null;
  }
  if (action === 'spec-add-item') {
    const specDimId = readString(request.specDimId);
    const itemTitle = readString(request.itemTitle);
    return specDimId && itemTitle ? { action, productId, specDimId, itemTitle, ...metadata } : null;
  }
  if (action === 'spec-refresh') return { action, productId, ...metadata };
  if (action === 'apply-current') {
    return isRecord(request.changes) ? { action, productId, changes: request.changes, ...metadata } : null;
  }
  if (action === 'submit-current') return { action, productId, ...metadata };
  if (action === 'spec-remove-items') {
    const keyword = readString(request.keyword);
    const items = parseSpecRemoveItems(request.items);
    if (!keyword || !items || items[0]?.productId !== productId) return null;
    const query = readString(request.query) ?? undefined;
    const sameSkuGroupId = readString(request.sameSkuGroupId) ?? undefined;
    return {
      action,
      productId,
      ...(query ? { query } : {}),
      keyword,
      ...(sameSkuGroupId ? { sameSkuGroupId } : {}),
      items,
      ...metadata,
    };
  }
  return null;
}

export function rentalOperationConfirmRequestFromToolArguments(args: Record<string, unknown>): RentalOperationConfirmRequest | null {
  return readRentalOperationConfirmRequestRecord(args);
}

export function parseRentalOperationConfirmRequest(value: unknown): RentalOperationConfirmRequest | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  if (!hasValidConfirmationKey(value, request)) return null;
  return readRentalOperationConfirmRequestRecord(request);
}

export async function executeRentalOperationConfirmRequest(client: RentalPriceSkillClient, request: RentalOperationConfirmRequest): Promise<RentalOperationExecutionResult> {
  switch (request.action) {
    case 'copy': {
      const result = await client.copy(request.productId);
      if (!result.ok && (result.status === 'unknown' || result.sideEffectPossible)) {
        return {
          ok: false,
          text: `复制状态未知：商品 ${result.productId}\n${result.lines.join('\n')}\n注意：本次复制可能已经提交但未拿到新商品ID；为避免重复复制，请先到后台核对，不要直接重试。`,
          metadata: {
            productId: result.productId,
            newProductId: result.newProductId ?? undefined,
            status: result.status,
            sideEffectPossible: result.sideEffectPossible,
          },
        };
      }
      return {
        ok: result.ok,
        text: result.ok ? (result.newProductId ? `复制成功：商品 ${result.productId} → 新商品 ${result.newProductId}` : `复制成功：商品 ${result.productId} 已复制（新商品ID未能自动获取，请到后台确认）`) : `复制失败：商品 ${result.productId}\n${result.lines.join('\n')}`,
        metadata: {
          productId: result.productId,
          newProductId: result.newProductId ?? undefined,
        },
      };
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
      const result = await client.specAddAndRefresh(request.productId, request.specDimId, request.itemTitle);
      return { ok: result.ok, text: result.ok ? `规格添加成功：商品 ${result.productId}，新增 ${result.itemTitle}` : `规格添加失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'spec-add-item': {
      if (!client.specAddItem) return { ok: false, text: '当前租赁商品客户端不支持规格项添加。' };
      const result = await client.specAddItem(request.productId, request.specDimId, request.itemTitle);
      return { ok: result.ok, text: result.ok ? `规格项添加成功：商品 ${result.productId}，新增 ${result.itemTitle}` : `规格项添加失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'spec-refresh': {
      if (!client.specRefresh) return { ok: false, text: '当前租赁商品客户端不支持规格刷新。' };
      const result = await client.specRefresh(request.productId);
      return { ok: result.ok, text: result.ok ? `规格刷新成功：商品 ${result.productId}` : `规格刷新失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'apply-current': {
      if (!client.applyCurrent) return { ok: false, text: '当前租赁商品客户端不支持当前页应用变更。' };
      const result = await client.applyCurrent(request.productId, request.changes);
      return { ok: result.ok, text: result.ok ? `当前页应用成功：商品 ${result.productId}\nchangesFile: ${result.changesFile}` : `当前页应用失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'submit-current': {
      if (!client.submitCurrent) return { ok: false, text: '当前租赁商品客户端不支持当前页提交。' };
      const result = await client.submitCurrent(request.productId);
      return { ok: result.ok, text: result.ok ? `当前页提交成功：商品 ${result.productId}` : `当前页提交失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'spec-remove-items': {
      if (!client.specRemoveItem) return { ok: false, text: '当前租赁商品客户端不支持规格项删除。' };
      const results = [];
      for (const item of request.items) {
        results.push(await client.specRemoveItem({
          productId: item.productId,
          specDimId: item.specDimId,
          ...(item.itemId ? { itemId: item.itemId } : {}),
          itemTitle: item.itemTitle,
        }));
      }
      const success = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      const lines = results.map((result) => {
        const status = result.ok ? '成功' : '失败';
        return `- ${status}：商品 ${result.productId} / 维度 ${result.specDimId} / ${result.itemTitle}\n  ${result.lines.join('\n  ')}`;
      });
      return {
        ok: failed.length === 0,
        text: [
          `规格项删除完成：成功 ${success.length}/${results.length}`,
          request.sameSkuGroupId ? `同款组：${request.sameSkuGroupId}` : undefined,
          `关键词：${request.keyword}`,
          '',
          ...lines,
        ].filter((line): line is string => Boolean(line)).join('\n'),
      };
    }
  }
}
