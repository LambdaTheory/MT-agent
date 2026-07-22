import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createAuditShutdownAdapter, DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS, type AuditShutdownTimer, type ShutdownAuditLogger } from '../src/audit/shutdown.js';
import type { FlushResult } from '../src/audit/types.js';
import { runFeishuBotCli } from '../src/cli/feishuBot.js';
import { main as runFeishuBotSdkCli } from '../src/cli/feishuBotSdk.js';
import { startFeishuBotServer } from '../src/feishuBot/server.js';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';

const require = createRequire(import.meta.url);

function flushResult(overrides: Partial<FlushResult> = {}): FlushResult {
  return {
    ok: true,
    flushed: 1,
    failed: 0,
    timedOut: false,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class ManualTimer implements AuditShutdownTimer {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();
  readonly delays: number[] = [];

  setTimeout(callback: () => void, timeoutMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    this.delays.push(timeoutMs);
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  fireNext(): void {
    const [id, callback] = this.callbacks.entries().next().value ?? [];
    if (id === undefined || callback === undefined) return;
    this.callbacks.delete(id);
    callback();
  }
}

type SignalName = 'SIGINT' | 'SIGTERM';

interface CapturedSignalRegistrar {
  handlers: Partial<Record<SignalName, Array<() => void | Promise<void>>>>;
  on: (signal: SignalName, handler: () => void | Promise<void>) => void;
}

function signalRegistrar(): CapturedSignalRegistrar {
  const handlers: CapturedSignalRegistrar['handlers'] = {};
  return {
    handlers,
    on: (signal, handler) => {
      handlers[signal] = [...(handlers[signal] ?? []), handler];
    },
  };
}

function auditEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    FEISHU_APP_ID: 'app',
    FEISHU_APP_SECRET: 'secret',
    MT_AGENT_OUTPUT_DIR: 'output-test',
    ...overrides,
  };
}

function fakeAuditLogger() {
  const logger = {
    record: vi.fn(),
    recordAt: vi.fn(),
    start: vi.fn(),
    end: vi.fn(),
    error: vi.fn(),
    flush: vi.fn(async () => flushResult({ flushed: 1 })),
  };
  return logger;
}

describe('audit shutdown adapter', () => {
  it('starts flush at most once and reuses the same in-flight completion promise', async () => {
    const pending = deferred<FlushResult>();
    const flushOptions: Array<{ timeoutMs?: number } | undefined> = [];
    const logger: ShutdownAuditLogger = {
      flush: async (options) => {
        flushOptions.push(options);
        return pending.promise;
      },
    };
    const adapter = createAuditShutdownAdapter({ logger });

    const first = adapter.shutdown();
    const second = adapter.shutdown();

    expect(second).toBe(first);
    expect(adapter.completion()).toBe(first);
    expect(flushOptions).toEqual([{ timeoutMs: DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS }]);

    pending.resolve(flushResult({ flushed: 3 }));
    await expect(first).resolves.toMatchObject({ ok: true, timedOut: false, flushed: 3, flushStarted: true });
    expect(adapter.shutdown()).toBe(first);
  });

  it('does not block beyond the shutdown deadline when flush never settles', async () => {
    const timer = new ManualTimer();
    let calls = 0;
    const logger: ShutdownAuditLogger = {
      flush: async () => {
        calls += 1;
        return new Promise<FlushResult>(() => undefined);
      },
    };
    const adapter = createAuditShutdownAdapter({ logger, timeoutMs: 25, timer });

    const completion = adapter.shutdown();
    expect(calls).toBe(1);
    expect(timer.delays).toEqual([25]);

    timer.fireNext();

    await expect(completion).resolves.toMatchObject({ ok: false, timedOut: true, failed: 1, flushStarted: true });
    expect(adapter.shutdown()).toBe(completion);
    expect(calls).toBe(1);
  });

  it('contains logger failures without throwing into business shutdown', async () => {
    const logger: ShutdownAuditLogger = {
      flush: async () => {
        throw new Error('remote flush failed');
      },
    };
    const adapter = createAuditShutdownAdapter({ logger, timeoutMs: 50 });

    await expect(adapter.shutdown()).resolves.toMatchObject({ ok: false, timedOut: false, failed: 1, flushStarted: true });
  });

  it('preserves logger flush result truthfully instead of faking success', async () => {
    const logger: ShutdownAuditLogger = {
      flush: async () => flushResult({ ok: false, flushed: 2, failed: 1, timedOut: false, queuePending: 4 }),
    };

    await expect(createAuditShutdownAdapter({ logger }).shutdown()).resolves.toMatchObject({
      ok: false,
      timedOut: false,
      flushed: 2,
      failed: 1,
      queuePending: 4,
      flushStarted: true,
    });
  });

  it('returns a safe success when no logger is present', async () => {
    const adapter = createAuditShutdownAdapter();

    await expect(adapter.shutdown()).resolves.toMatchObject({ ok: true, timedOut: false, failed: 0, flushStarted: false });
  });
});

describe('Task 10 Bot audit lifecycle wiring', () => {
  it('passes one HTTP CLI audit logger into server startup and terminates once with the first signal code while close hangs', async () => {
    const logger = fakeAuditLogger();
    const pendingFlush = deferred<FlushResult>();
    logger.flush.mockImplementation(async () => pendingFlush.promise);
    const registrar = signalRegistrar();
    let closeRequests = 0;
    const exits: number[] = [];
    const server = {
      on: vi.fn((event: string, listener: () => void) => {
        expect(event).toBe('close');
        expect(listener).toEqual(expect.any(Function));
        return server;
      }),
      close: vi.fn(() => {
        closeRequests += 1;
        return server;
      }),
    };
    const received: unknown[] = [];

    await runFeishuBotCli({
      loadEnv: async () => undefined,
      env: auditEnv(),
      createAuditLogger: (config) => {
        expect(config.flushTimeoutMs).toBe(DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS);
        return logger;
      },
      startServer: (config) => {
        received.push(config.auditLogger);
        return server;
      },
      startPriceAlertMonitor: () => undefined,
      registerSignal: registrar.on,
      exit: (code) => exits.push(code),
      log: () => undefined,
    });

    expect(received).toEqual([logger]);
    expect(server.on).toHaveBeenCalledWith('close', expect.any(Function));
    const first = registrar.handlers.SIGINT?.[0]?.();
    const second = registrar.handlers.SIGTERM?.[0]?.();

    expect(second).toBe(first);
    expect(closeRequests).toBe(1);
    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([]);

    pendingFlush.resolve(flushResult({ flushed: 2 }));
    await first;
    await second;

    expect(closeRequests).toBe(1);
    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(logger.flush).toHaveBeenCalledWith({ timeoutMs: DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS });
    expect(exits).toEqual([130]);
  });

  it('reuses the HTTP close-event shutdown completion without extra signal flushes or exits', async () => {
    const logger = fakeAuditLogger();
    const registrar = signalRegistrar();
    const closeListeners: Array<() => void> = [];
    const exits: number[] = [];
    const server = {
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'close') closeListeners.push(listener);
        return server;
      }),
      close: vi.fn(() => server),
    };

    await runFeishuBotCli({
      loadEnv: async () => undefined,
      env: auditEnv(),
      createAuditLogger: () => logger,
      startServer: () => server,
      startPriceAlertMonitor: () => undefined,
      registerSignal: registrar.on,
      exit: (code) => exits.push(code),
      log: () => undefined,
    });

    for (const listener of closeListeners) listener();
    await registrar.handlers.SIGTERM?.[0]?.();
    await registrar.handlers.SIGINT?.[0]?.();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([143]);
  });

  it('passes the HTTP server audit logger into its dispatcher for request lifecycle', async () => {
    const logger = fakeAuditLogger();
    const dispatchedLoggers: unknown[] = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      auditLogger: logger,
      handleIntent: async (_intent, _outputDir, dependencies) => {
        dispatchedLoggers.push(dependencies?.auditLogger);
        return { text: 'ok' };
      },
      replyText: async () => ({ sent: true, channel: 'app' }),
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-audit-http', message_type: 'text', content: JSON.stringify({ text: '帮助' }) } } }),
      });

      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(dispatchedLoggers).toEqual([logger]));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('passes one SDK CLI audit logger into bot startup and terminates once with the first signal code without real SDK', async () => {
    const logger = fakeAuditLogger();
    const pendingFlush = deferred<FlushResult>();
    logger.flush.mockImplementation(async () => pendingFlush.promise);
    const registrar = signalRegistrar();
    const exits: number[] = [];
    const received: unknown[] = [];

    await runFeishuBotSdkCli({
      loadEnv: async () => undefined,
      env: auditEnv(),
      createAuditLogger: (config) => {
        expect(config.logDir).toBe('output-test/audit');
        return logger;
      },
      createBot: (config) => {
        received.push(config.auditLogger);
        return { start: vi.fn() };
      },
      startPriceAlertMonitor: () => undefined,
      registerSignal: registrar.on,
      exit: (code) => exits.push(code),
      log: () => undefined,
    });

    expect(received).toEqual([logger]);
    const first = registrar.handlers.SIGTERM?.[0]?.();
    const second = registrar.handlers.SIGINT?.[0]?.();

    expect(second).toBe(first);
    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([]);

    pendingFlush.resolve(flushResult({ flushed: 4 }));
    await first;
    await second;

    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(logger.flush).toHaveBeenCalledWith({ timeoutMs: DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS });
    expect(exits).toEqual([143]);
  });

  it('passes the SDK audit logger into the default dispatcher and callback execution options', async () => {
    const logger = fakeAuditLogger();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const dispatchedLoggers: unknown[] = [];

    class FakeClient {
      im = { v1: { message: { reply: async () => undefined } } };
    }
    class FakeWSClient {
      start() { return undefined; }
    }
    class FakeEventDispatcher {
      register(handlers: Record<string, (data: unknown) => Promise<unknown>>) {
        Object.assign(registered, handlers);
        return this;
      }
    }

    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      auditLogger: logger,
      handleIntent: async (_intent, _outputDir, dependencies) => {
        dispatchedLoggers.push(dependencies?.auditLogger);
        return { text: 'ok' };
      },
      sdk: { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher },
    });

    bot.start();
    await registered['im.message.receive_v1']({
      message: { message_id: 'mid-audit-sdk', message_type: 'text', content: JSON.stringify({ text: '帮助' }) },
    });

    expect(dispatchedLoggers).toEqual([logger]);
  });

  it('sets mt-feishu-bot PM2 kill_timeout strictly greater than the audit shutdown timeout only for that app', () => {
    const ecosystem = require('../ecosystem.config.cjs') as { apps: Array<{ name: string; kill_timeout?: number }> };
    const feishuBot = ecosystem.apps.find((app) => app.name === 'mt-feishu-bot');
    const rentalAgent = ecosystem.apps.find((app) => app.name === 'mt-rental-price-agent');

    expect(feishuBot?.kill_timeout).toBeGreaterThan(DEFAULT_AUDIT_SHUTDOWN_FLUSH_TIMEOUT_MS);
    expect(rentalAgent).not.toHaveProperty('kill_timeout');
  });
});
