import { schemaAllowsArguments } from './planner.js';

export type AgentStepMetadataStore = Record<string, unknown>;

export interface AgentStepResponseLike {
  text: string;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitUndefinedProperties(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function readSegmentValue(current: unknown, part: string): unknown {
  const indexed = /^(\w+)\[(\d+)\]$/.exec(part);
  if (indexed) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    const container = (current as Record<string, unknown>)[indexed[1]];
    if (!Array.isArray(container)) return undefined;
    return container[Number(indexed[2])];
  }

  if (!isRecord(current) && !Array.isArray(current)) return undefined;
  return (current as Record<string, unknown>)[part];
}

function readPath(root: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (!part) return undefined;
    current = readSegmentValue(current, part);
    if (current === undefined) return undefined;
  }
  return current;
}

function resolvePlannerReference(path: string, store: AgentStepMetadataStore): unknown {
  const normalized = path.trim();
  if (!normalized) return undefined;
  const withoutPrefix = normalized.startsWith('steps.') ? normalized.slice('steps.'.length) : normalized;
  return readPath(store, withoutPrefix);
}

function stringifyResolvedValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function resolvePlannerArgumentValue(
  value: unknown,
  store: AgentStepMetadataStore,
): { ok: true; value: unknown } | { ok: false; reference: string } {
  if (typeof value === 'string') {
    const exact = /^\$\{([^}]+)\}$/.exec(value.trim());
    if (exact) {
      const resolved = resolvePlannerReference(exact[1], store);
      return resolved === undefined ? { ok: false, reference: exact[1] } : { ok: true, value: resolved };
    }

    const replaced = value.replace(/\$\{([^}]+)\}/g, (match, reference) => {
      const resolved = resolvePlannerReference(reference, store);
      return resolved === undefined ? match : stringifyResolvedValue(resolved);
    });
    const unresolved = /\$\{([^}]+)\}/.exec(replaced);
    return unresolved ? { ok: false, reference: unresolved[1] } : { ok: true, value: replaced };
  }

  if (Array.isArray(value)) {
    const resolvedItems: unknown[] = [];
    for (const item of value) {
      const resolved = resolvePlannerArgumentValue(item, store);
      if (!resolved.ok) return resolved;
      resolvedItems.push(resolved.value);
    }
    return { ok: true, value: resolvedItems };
  }

  if (isRecord(value)) {
    const resolvedRecord: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolvePlannerArgumentValue(item, store);
      if (!resolved.ok) return resolved;
      resolvedRecord[key] = resolved.value;
    }
    return { ok: true, value: resolvedRecord };
  }

  return { ok: true, value };
}

export function resolvePlannerArguments(
  args: Record<string, unknown>,
  store: AgentStepMetadataStore,
): { ok: true; value: Record<string, unknown> } | { ok: false; reference: string } {
  const resolved = resolvePlannerArgumentValue(args, store);
  return resolved.ok && isRecord(resolved.value) ? { ok: true, value: resolved.value } : resolved.ok ? { ok: false, reference: '<arguments>' } : resolved;
}

export function rememberStepMetadata(store: AgentStepMetadataStore, stepId: string, response: AgentStepResponseLike, resultMetadataSchema?: unknown): void {
  const candidate = response.metadata ?? { text: response.text };
  const validationCandidate = response.metadata === undefined ? undefined : omitUndefinedProperties(response.metadata);
  const metadata = resultMetadataSchema !== undefined && validationCandidate !== undefined && !schemaAllowsArguments(resultMetadataSchema, validationCandidate)
    ? { text: response.text, metadataValidationError: stepId }
    : candidate;
  store[stepId] = metadata;
  store.last = metadata;
}
