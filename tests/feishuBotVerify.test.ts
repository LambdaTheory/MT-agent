import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildFeishuSignature, handleUrlVerification, verifyFeishuSignature } from '../src/feishuBot/verify.js';

describe('feishu bot verification', () => {
  it('returns challenge for url verification payload', () => {
    expect(handleUrlVerification({ type: 'url_verification', challenge: 'abc', token: 'token' }, 'token')).toEqual({ challenge: 'abc' });
  });

  it('rejects wrong verification token', () => {
    expect(() => handleUrlVerification({ type: 'url_verification', challenge: 'abc', token: 'bad' }, 'token')).toThrow('Invalid Feishu verification token');
  });

  it('verifies request signature', () => {
    const timestamp = '1710000000';
    const nonce = 'nonce';
    const body = JSON.stringify({ event: 'x' });
    const secret = 'secret';
    const signature = createHmac('sha256', secret).update(`${timestamp}${nonce}${body}`).digest('base64');
    expect(buildFeishuSignature(timestamp, nonce, body, secret)).toBe(signature);
    expect(verifyFeishuSignature({ timestamp, nonce, body, secret, signature })).toBe(true);
  });
});
