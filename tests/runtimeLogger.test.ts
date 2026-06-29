import { describe, expect, it } from 'vitest';
import { formatRuntimeLog, summarizeError } from '../src/observability/runtimeLogger.js';

describe('runtimeLogger', () => {
  it('redacts authorization and token-like values from formatted logs', () => {
    const line = formatRuntimeLog({
      level: 'error',
      component: 'feishu-bot',
      event: 'message.error',
      message: 'Authorization: Bearer secret-token token=abc123 apiKey=xyz',
    });

    expect(line).toContain('Authorization: [redacted]');
    expect(line).toContain('token=[redacted]');
    expect(line).toContain('apiKey=[redacted]');
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('abc123');
    expect(line).not.toContain('xyz');
  });

  it('summarizes axios-like errors without leaking headers or request body', () => {
    const error = new Error('Request failed with status code 400') as Error & {
      response: { status: number; data: unknown };
      config: { method: string; url: string; headers: unknown; data: string };
    };
    error.response = {
      status: 400,
      data: { code: 230099, msg: 'bad card', error: { detail: 'unsupported tag action' } },
    };
    error.config = {
      method: 'post',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_1/reply',
      headers: { Authorization: 'Bearer secret-token' },
      data: '{"content":"large card payload"}',
    };

    const summary = summarizeError(error);
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      name: 'Error',
      message: 'Request failed with status code 400',
      httpStatus: 400,
      method: 'post',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_1/reply',
    });
    expect(serialized).toContain('"code":230099');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('large card payload');
    expect(serialized).not.toContain('Authorization');
  });
});
