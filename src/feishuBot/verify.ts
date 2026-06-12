import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FeishuUrlVerificationPayload } from './types.js';

export function handleUrlVerification(payload: FeishuUrlVerificationPayload, expectedToken?: string): { challenge: string } | null {
  if (payload.type !== 'url_verification') return null;
  if (expectedToken && payload.token !== expectedToken) throw new Error('Invalid Feishu verification token');
  if (!payload.challenge) throw new Error('Missing Feishu challenge');
  return { challenge: payload.challenge };
}

export function buildFeishuSignature(timestamp: string, nonce: string, body: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}${nonce}${body}`).digest('base64');
}

export function verifyFeishuSignature(input: { timestamp?: string; nonce?: string; body: string; secret?: string; signature?: string }): boolean {
  if (!input.secret) return true;
  if (!input.timestamp || !input.nonce || !input.signature) return false;
  const expected = Buffer.from(buildFeishuSignature(input.timestamp, input.nonce, input.body, input.secret));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
