import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

describe('rental mirror read-side tools', () => {
  let outputDir: string;
  let rentalRoot: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-mirror-output-'));
    rentalRoot = await mkdtemp(join(tmpdir(), 'rental-mirror-root-'));
    previousRoot = process.env.RENTAL_PRICE_AGENT_DIR;
    process.env.RENTAL_PRICE_AGENT_DIR = rentalRoot;
    await mkdir(join(rentalRoot, 'scripts'), { recursive: true });
    await writeFile(join(rentalRoot, 'scripts', 'mirror-search.js'), [
      'const args = process.argv.slice(2);',
      'console.log(JSON.stringify({ status: "ok", args, keyword: args[1], rows: [{ id: "648", name: args[1] }] }));',
    ].join('\n'), 'utf8');
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.RENTAL_PRICE_AGENT_DIR;
    else process.env.RENTAL_PRICE_AGENT_DIR = previousRoot;
    await rm(outputDir, { recursive: true, force: true });
    await rm(rentalRoot, { recursive: true, force: true });
  });

  it('registers only mirror search and batch-spec read-side tools', () => {
    expect(findAgentTool('rental.mirrorSearch')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.mirrorBatchSpec')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.mirrorWritebackState')).toBeUndefined();
  });

  it('dispatches search and batch-spec to mirror-search without writeback', async () => {
    const search = await executeAgentToolRequest({ toolName: 'rental.mirrorSearch', arguments: { keyword: 'ipod' }, reason: 'search mirror' }, outputDir);
    const batchSpec = await executeAgentToolRequest({ toolName: 'rental.mirrorBatchSpec', arguments: { keyword: 'ipod' }, reason: 'batch spec mirror' }, outputDir);

    expect(search.metadata).toMatchObject({ toolName: 'rental.mirrorSearch', command: 'search', ok: true });
    expect(search.text).toContain('search');
    expect(search.text).toContain('ipod');
    expect(batchSpec.metadata).toMatchObject({ toolName: 'rental.mirrorBatchSpec', command: 'batch-spec', ok: true });
    expect(batchSpec.text).toContain('batch-spec');
    expect(batchSpec.text).not.toContain('writeback');
  });
});
