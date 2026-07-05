import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clarificationConfirmationKey,
  loadClarificationContext,
  saveClarificationContext,
  verifyClarificationKey,
} from '../src/feishuBot/clarificationStore.js';
import type { ClarificationContext } from '../src/agentRuntime/intentResolution.js';

function ctx(): ClarificationContext {
  return {
    originalMessage: '把648下架',
    question: '你想对 648 做什么？',
    reason: '意图不明确',
    candidates: [
      { toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' },
      { toolName: 'rental.copy', arguments: { productId: '648' }, label: '复制 648' },
    ],
    depth: 1,
    confidence: 0.4,
  };
}

describe('clarification store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-clar-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a clarification context by ref', async () => {
    const ref = await saveClarificationContext(dir, ctx());

    expect(ref).toMatch(/^clarify_\d+_[a-f0-9]+$/);
    const loaded = await loadClarificationContext(dir, ref);
    expect(loaded?.candidates[0]).toEqual({ toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' });
    expect(loaded?.depth).toBe(1);
  });

  it('returns null for unknown ref', async () => {
    await expect(loadClarificationContext(dir, 'clarify_1_deadbeef')).resolves.toBeNull();
  });

  it('confirmation key round-trips and rejects tampering', async () => {
    const c = ctx();
    const key = clarificationConfirmationKey(c);

    expect(verifyClarificationKey(c, key)).toBe(true);
    expect(verifyClarificationKey(c, 'x'.repeat(24))).toBe(false);
  });
});
