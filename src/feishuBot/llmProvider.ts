export type LlmReadOnlyToolName =
  | 'get_latest_summary'
  | 'query_product_performance'
  | 'rank_best_same_sku_product'
  | 'get_new_link_pool'
  | 'get_problem_products'
  | 'get_inactive_links'
  | 'get_removed_links'
  | 'get_order_fulfillment'
  | 'get_supported_questions'
  | 'none';

export interface LlmToolSelection {
  intent: string;
  tool: LlmReadOnlyToolName;
  arguments: Record<string, unknown>;
  confidence: number;
  reason: string;
}

export interface LlmToolSelectionRequest {
  message: string;
  tools: Array<{ name: Exclude<LlmReadOnlyToolName, 'none'>; description: string; argumentsSchema: Record<string, unknown> }>;
}

export interface LlmToolSelectionProvider {
  selectTool(request: LlmToolSelectionRequest): Promise<string>;
}

export type ParsedLlmToolSelection =
  | { ok: true; selection: LlmToolSelection }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unsafe_tool' };

const readOnlyToolNames = new Set<string>([
  'get_latest_summary',
  'query_product_performance',
  'rank_best_same_sku_product',
  'get_new_link_pool',
  'get_problem_products',
  'get_inactive_links',
  'get_removed_links',
  'get_order_fulfillment',
  'get_supported_questions',
  'none',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLlmToolSelection(raw: string): ParsedLlmToolSelection {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: 'invalid_shape' };
  }

  const { intent, tool, arguments: selectionArguments, confidence, reason } = parsed;

  if (
    typeof intent !== 'string' ||
    typeof tool !== 'string' ||
    !isRecord(selectionArguments) ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof reason !== 'string'
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }

  if (!readOnlyToolNames.has(tool)) {
    return { ok: false, reason: 'unsafe_tool' };
  }

  return {
    ok: true,
    selection: { intent, tool: tool as LlmReadOnlyToolName, arguments: selectionArguments, confidence, reason },
  };
}
