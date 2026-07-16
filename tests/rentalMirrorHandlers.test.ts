import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

describe('rental mirror read-side tools', () => {
  let outputDir: string;
  let rentalRoot: string;
  let dataRoot: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-mirror-output-'));
    rentalRoot = await mkdtemp(join(tmpdir(), 'rental-mirror-root-'));
    dataRoot = join(dirname(rentalRoot), `.${basename(rentalRoot)}-data`);
    previousRoot = process.env.RENTAL_PRICE_AGENT_DIR;
    process.env.RENTAL_PRICE_AGENT_DIR = rentalRoot;
    await mkdir(join(rentalRoot, 'scripts'), { recursive: true });
    await mkdir(join(dataRoot, 'tasks', 'batches'), { recursive: true });
    await writeFile(join(rentalRoot, 'scripts', 'mirror-search.js'), [
      'const args = process.argv.slice(2);',
      'console.log(JSON.stringify({ status: "ok", args, keyword: args[1], stateFile: args[1], rows: [{ id: "648", name: args[1] }] }));',
    ].join('\n'), 'utf8');
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.RENTAL_PRICE_AGENT_DIR;
    else process.env.RENTAL_PRICE_AGENT_DIR = previousRoot;
    await rm(outputDir, { recursive: true, force: true });
    await rm(rentalRoot, { recursive: true, force: true });
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('registers only mirror search and batch-spec read-side tools', () => {
    expect(findAgentTool('rental.mirrorSearch')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.mirrorBatchSpec')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('rental.mirrorWritebackState')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
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

  it('dispatches hidden confirmed writeback-state only for safe batch state paths', async () => {
    const stateFile = join(dataRoot, 'tasks', 'batches', 'state.json');
    await writeFile(stateFile, JSON.stringify({ batchId: 'batch-1' }), 'utf8');

    const writeback = await executeAgentToolRequest({ toolName: 'rental.mirrorWritebackState', arguments: { stateFile, confirm: true }, reason: 'confirmed mirror writeback' }, outputDir);

    expect(writeback.metadata).toMatchObject({ toolName: 'rental.mirrorWritebackState', command: 'writeback-state', ok: true, stateFile });
    expect(writeback.text).toContain('writeback-state');
    await expect(executeAgentToolRequest({ toolName: 'rental.mirrorWritebackState', arguments: { stateFile: join(rentalRoot, 'state.json'), confirm: true }, reason: 'bad writeback' }, outputDir)).rejects.toThrow(/tasks\/batches/);
    await expect(executeAgentToolRequest({ toolName: 'rental.mirrorWritebackState', arguments: { stateFile, confirm: false }, reason: 'unconfirmed writeback' }, outputDir)).rejects.toThrow(/confirm=true/);
  });
});
