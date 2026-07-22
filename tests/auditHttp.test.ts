import { describe, expect, it } from 'vitest';
import { sendAuditPayload } from '../src/audit/http.js';

const payload = '{"ts":"2026-07-21T08:00:00.000Z","agent_id":"mt-agent","trace_id":"trace-1","span_id":"span-1","event":"tool.end","tool_name":"publicTraffic.latestSummary","status":"OK","result_summary":"ready"}';
const ingestUrl = 'https://audit.local/v1/ingest';

function jsonResponse(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('audit HTTP sender', () => {
  it('posts exactly one raw JSON payload to the configured ingest URL without rebuilding it', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ accepted: 1, rejected: 0, errors: [] });
    };

    const result = await sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl });

    expect(result).toEqual({ kind: 'accepted', statusCode: 202 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(ingestUrl);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls[0]?.init?.body).toBe(payload);
    expect(calls[0]?.init?.redirect).toBe('manual');
  });

  it('accepts only the strict single-event ack shape', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ accepted: 1, rejected: 0, errors: [] }, 200);

    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl })).resolves.toEqual({
      kind: 'accepted',
      statusCode: 200,
    });
  });

  it('classifies negative and partial acknowledgements as remote retry', async () => {
    const bodies = [
      { accepted: 0, rejected: 1, errors: [] },
      { accepted: 1, rejected: 0, errors: [{ index: 0, message: 'bad' }] },
      { accepted: 2, rejected: 0, errors: [] },
      { accepted: 1, rejected: 1, errors: [] },
    ];

    for (const body of bodies) {
      const fetchImpl: typeof fetch = async () => jsonResponse(body, 202);
      await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl })).resolves.toEqual({
        kind: 'retry',
        reason: 'negative_ack',
        category: 'remote',
        statusCode: 202,
      });
    }
  });

  it('classifies malformed or missing ack fields as remote malformed response retry', async () => {
    const malformedCases: Response[] = [
      new Response('not-json', { status: 202 }),
      jsonResponse({ accepted: '1', rejected: 0, errors: [] }, 202),
      jsonResponse({ accepted: 1, errors: [] }, 202),
      jsonResponse({ accepted: 1, rejected: 0 }, 202),
      jsonResponse({ accepted: 1.5, rejected: 0, errors: [] }, 202),
      jsonResponse({ accepted: 1, rejected: 0, errors: {} }, 202),
    ];

    for (const response of malformedCases) {
      const fetchImpl: typeof fetch = async () => response;
      await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl })).resolves.toEqual({
        kind: 'retry',
        reason: 'malformed_response',
        category: 'remote',
        statusCode: 202,
      });
    }
  });

  it('isolates permanent 400, 413, and 415 statuses without parsing the response body', async () => {
    const cases = [
      { status: 400, reason: 'status_400' },
      { status: 413, reason: 'status_413' },
      { status: 415, reason: 'status_415' },
    ] as const;

    for (const item of cases) {
      const fetchImpl: typeof fetch = async () => new Response('not-json', { status: item.status });
      await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl })).resolves.toEqual({
        kind: 'isolate',
        reason: item.reason,
        statusCode: item.status,
      });
    }
  });

  it('classifies 500 and other non-2xx statuses as remote retry', async () => {
    for (const status of [301, 404, 429, 500, 503]) {
      const fetchImpl: typeof fetch = async () => new Response('', { status });
      await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl })).resolves.toEqual({
        kind: 'retry',
        reason: 'non_2xx',
        category: 'remote',
        statusCode: status,
      });
    }
  });

  it('classifies network throws and AbortController timeouts distinctly', async () => {
    const networkFetch: typeof fetch = async () => {
      throw new TypeError('socket closed');
    };
    const timeoutFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });

    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl: networkFetch })).resolves.toEqual({
      kind: 'retry',
      reason: 'network',
      category: 'transient',
    });
    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 5, fetchImpl: timeoutFetch })).resolves.toEqual({
      kind: 'retry',
      reason: 'timeout',
      category: 'transient',
    });
  });

  it('bounds synchronous fetch throws and hanging response bodies within the same timeout', async () => {
    const syncThrowFetch: typeof fetch = () => {
      throw new TypeError('sync socket failure');
    };
    const hangingBodyFetch: typeof fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 202 });

    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 50, fetchImpl: syncThrowFetch })).resolves.toEqual({
      kind: 'retry',
      reason: 'network',
      category: 'transient',
    });
    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 5, fetchImpl: hangingBodyFetch })).resolves.toEqual({
      kind: 'retry',
      reason: 'timeout',
      category: 'transient',
    });
  });

  it('cancels an active response body reader when the overall HTTP deadline wins', async () => {
    let cancelled = false;
    const fetchImpl: typeof fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({
        start: () => undefined,
        cancel: () => {
          cancelled = true;
        },
      }), { status: 202 });

    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 5, fetchImpl })).resolves.toEqual({
      kind: 'retry',
      reason: 'timeout',
      category: 'transient',
    });
    expect(cancelled).toBe(true);
  });

  it('rejects blank payloads, non-ingest URLs, and non-positive timeouts before fetch', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ accepted: 1, rejected: 0, errors: [] });
    };

    await expect(sendAuditPayload({ payload: '', ingestUrl, timeoutMs: 50, fetchImpl })).rejects.toThrow(/payload/i);
    await expect(sendAuditPayload({ payload: `${payload}\n`, ingestUrl, timeoutMs: 50, fetchImpl })).rejects.toThrow(/single-line/i);
    await expect(sendAuditPayload({ payload, ingestUrl: 'https://audit.local/health', timeoutMs: 50, fetchImpl })).rejects.toThrow(/ingest/i);
    await expect(sendAuditPayload({ payload, ingestUrl, timeoutMs: 0, fetchImpl })).rejects.toThrow(/timeout/i);
    expect(calls).toBe(0);
  });
});
