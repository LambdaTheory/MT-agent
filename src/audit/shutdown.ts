import type { FlushResult } from './types.js';

export const DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS = 1000;

export interface ShutdownAuditLogger {
  flush(options?: { timeoutMs?: number }): Promise<FlushResult>;
}

export interface AuditShutdownResult extends FlushResult {
  flushStarted: boolean;
}

export interface AuditShutdownTimer {
  setTimeout(callback: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AuditShutdownOptions {
  logger?: ShutdownAuditLogger;
  timeoutMs?: number;
  timer?: AuditShutdownTimer;
}

export interface AuditShutdownAdapter {
  shutdown(): Promise<AuditShutdownResult>;
  completion(): Promise<AuditShutdownResult> | undefined;
}

const defaultTimer: AuditShutdownTimer = {
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export function createAuditShutdownAdapter(options: AuditShutdownOptions = {}): AuditShutdownAdapter {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const timer = options.timer ?? defaultTimer;
  let completion: Promise<AuditShutdownResult> | undefined;

  return {
    shutdown(): Promise<AuditShutdownResult> {
      if (completion === undefined) {
        completion = flushForShutdown(options.logger, timeoutMs, timer);
      }
      return completion;
    },
    completion(): Promise<AuditShutdownResult> | undefined {
      return completion;
    },
  };
}

async function flushForShutdown(logger: ShutdownAuditLogger | undefined, timeoutMs: number, timer: AuditShutdownTimer): Promise<AuditShutdownResult> {
  if (logger === undefined) {
    return shutdownResult({ ok: true, timedOut: false, failed: 0, flushStarted: false });
  }
  try {
    const result = await withShutdownDeadline(logger.flush({ timeoutMs }), timeoutMs, timer);
    if (result.timedOut) {
      return shutdownResult({ ok: false, timedOut: true, failed: 1, flushStarted: true });
    }
    return { ...result.value, flushStarted: true };
  } catch (_error) {
    return shutdownResult({ ok: false, timedOut: false, failed: 1, flushStarted: true });
  }
}

async function withShutdownDeadline<T>(promise: Promise<T>, timeoutMs: number, timer: AuditShutdownTimer): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timeoutHandle: unknown;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timeoutHandle = timer.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const settled = promise.then((value) => ({ timedOut: false as const, value }));
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timeoutHandle !== undefined) timer.clearTimeout(timeoutHandle);
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) return DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS;
  return timeoutMs;
}

function shutdownResult(input: { ok: boolean; timedOut: boolean; failed: number; flushStarted: boolean }): AuditShutdownResult {
  return {
    ok: input.ok,
    flushed: 0,
    failed: input.failed,
    timedOut: input.timedOut,
    flushStarted: input.flushStarted,
  };
}
