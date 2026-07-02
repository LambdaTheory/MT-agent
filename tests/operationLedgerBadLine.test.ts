import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries, operationLedgerJsonlPath } from '../src/agentRuntime/operationLedger.js';

describe('ledger bad line tolerance', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-bad-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('skips corrupt lines and returns valid entries', async () => {
    const path = operationLedgerJsonlPath(dir, '2026-07-02');
    await mkdir(join(dir, 'operation-ledger'), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ planId: 'a', at: '2026-07-02T00:00:00.000Z', event: 'data_collected' })}\n{corrupt json\n${JSON.stringify({ planId: 'b', at: '2026-07-02T00:00:01.000Z', event: 'decision_created' })}\n`,
      'utf8',
    );

    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-02');

    expect(entries.map((entry) => entry.event)).toEqual(['data_collected', 'decision_created']);
  });
});
