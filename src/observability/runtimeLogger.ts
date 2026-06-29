export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogEntry {
  level: RuntimeLogLevel;
  component: string;
  event: string;
  message?: string;
  [key: string]: unknown;
}

const REDACTED = '[redacted]';
const MAX_TEXT_LENGTH = 240;

function compactText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function redactString(value: string): string {
  return compactText(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/(authorization["'\s:=]+)([^"',\s}]+)/gi, `$1${REDACTED}`)
    .replace(/(api[_-]?key["'\s:=]+)([^"',\s}]+)/gi, `$1${REDACTED}`)
    .replace(/(token["'\s:=]+)([^"',\s}]+)/gi, `$1${REDACTED}`)
    .replace(/(cookie["'\s:=]+)([^"',}]+)/gi, `$1${REDACTED}`);
}

function safeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record).slice(0, 20)) {
      if (/authorization|cookie|token|secret|api[_-]?key|password|content|data|headers/i.test(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = safeValue(item, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

export function textPreview(text: string, maxLength = 120): string {
  return compactText(text, maxLength);
}

export function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const anyError = error as Error & {
      code?: unknown;
      status?: unknown;
      response?: { status?: unknown; data?: unknown };
      config?: { method?: unknown; url?: unknown };
    };
    return {
      name: error.name,
      message: redactString(error.message),
      ...(anyError.code ? { code: safeValue(anyError.code) } : {}),
      ...(anyError.status ? { status: safeValue(anyError.status) } : {}),
      ...(anyError.response?.status ? { httpStatus: safeValue(anyError.response.status) } : {}),
      ...(anyError.response?.data ? { response: safeValue(anyError.response.data) } : {}),
      ...(anyError.config?.method ? { method: safeValue(anyError.config.method) } : {}),
      ...(anyError.config?.url ? { url: safeValue(anyError.config.url) } : {}),
    };
  }
  return { message: safeValue(error) };
}

export function formatRuntimeLog(entry: RuntimeLogEntry): string {
  const normalized: RuntimeLogEntry = {
    ...entry,
    ...(entry.message ? { message: redactString(entry.message) } : {}),
  };
  return JSON.stringify(safeValue(normalized));
}
