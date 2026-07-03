import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

describe('rental batch runner tools', () => {
  let outputDir: string;
  let rentalRoot: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-batch-output-'));
    rentalRoot = await mkdtemp(join(tmpdir(), 'rental-batch-root-'));
    previousRoot = process.env.RENTAL_PRICE_AGENT_DIR;
    process.env.RENTAL_PRICE_AGENT_DIR = rentalRoot;
    await mkdir(join(rentalRoot, 'scripts'), { recursive: true });
    await mkdir(join(rentalRoot, 'tasks', 'batches'), { recursive: true });
    await writeFile(join(rentalRoot, 'scripts', 'batch-runner.js'), [
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      'const file = args.find((arg) => arg.endsWith(".json"));',
      'const payload = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;',
      'if (args[0] === "resume") console.log(JSON.stringify({ status: "error", args, message: "resume command must not be used" }));',
      'else console.log(JSON.stringify({ status: "ok", args, payload, stateFile: file ? file.replace(/\\.json$/, "_state.json") : null, state: { batchId: "resumed-batch-2" }, summary: args.join(" ") }));',
    ].join('\n'), 'utf8');
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.RENTAL_PRICE_AGENT_DIR;
    else process.env.RENTAL_PRICE_AGENT_DIR = previousRoot;
    await rm(outputDir, { recursive: true, force: true });
    await rm(rentalRoot, { recursive: true, force: true });
  });

  it('registers batch runner control tools', () => {
    for (const name of ['batchPreview', 'batchExecute', 'batchStatus', 'batchResume', 'batchReport', 'batchRollback']) {
      expect(findAgentTool(`rental.${name}`)).toMatchObject({ risk: 'high', requiresConfirmation: true });
    }
  });

  it('dispatches preview, execute, status, resume, report, and rollback to batch-runner', async () => {
    const specFile = join(rentalRoot, 'tasks', 'batches', 'spec.json');
    const stateFile = join(rentalRoot, 'tasks', 'batches', 'state.json');
    await writeFile(specFile, JSON.stringify({ items: [{ productId: '648', fields: { rent1day: '88.00' } }] }), 'utf8');
    await writeFile(stateFile, JSON.stringify({
      batchId: 'batch-1',
      status: 'stopped',
      total: 2,
      completed: [{ productId: '648' }],
      verifyFailed: [],
      failed: [],
      spec: { items: [{ productId: '648', fields: { rent1day: '88.00' } }, { productId: '649', fields: { rent1day: '89.00' } }], options: { stopOnError: true } },
    }), 'utf8');

    const preview = await executeAgentToolRequest({ toolName: 'rental.batchPreview', arguments: { specFile }, reason: 'preview batch' }, outputDir);
    const execute = await executeAgentToolRequest({ toolName: 'rental.batchExecute', arguments: { specFile, confirmFormSetupWithoutPreview: true }, reason: 'execute batch' }, outputDir, { ledgerContext: { outputDir, runId: 'run-batch', decisionId: 'dec-batch' } });
    const status = await executeAgentToolRequest({ toolName: 'rental.batchStatus', arguments: { stateFile }, reason: 'status batch' }, outputDir);
    const resume = await executeAgentToolRequest({ toolName: 'rental.batchResume', arguments: { stateFile }, reason: 'resume batch' }, outputDir, { ledgerContext: { outputDir, runId: 'run-batch', decisionId: 'dec-batch' } });
    const report = await executeAgentToolRequest({ toolName: 'rental.batchReport', arguments: { stateFile }, reason: 'report batch' }, outputDir);
    const rollback = await executeAgentToolRequest({ toolName: 'rental.batchRollback', arguments: { stateFile, confirm: true }, reason: 'rollback batch' }, outputDir, { ledgerContext: { outputDir, runId: 'run-batch', decisionId: 'dec-batch' } });

    expect(preview.metadata).toMatchObject({ toolName: 'rental.batchPreview', command: 'preview', ok: true });
    expect(preview.text).toContain('preview');
    expect(execute.text).toContain('execute');
    expect(execute.text).toContain('confirmFormSetupWithoutPreview');
    expect(status.text).toContain('status');
    expect(resume.text).toContain('execute');
    expect(resume.text).toContain('resumeFrom');
    const resumedState = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    expect(resumedState).toMatchObject({ resumedTo: 'resumed-batch-2', resumeStateFile: expect.stringMatching(/_state\.json$/) });
    expect(typeof resumedState.resumedAt).toBe('string');
    expect(report.text).toContain('report');
    expect(rollback.text).toContain('rollback --confirm');
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
    expect(entries.filter((entry) => entry.event === 'execution_succeeded' && entry.runId === 'run-batch' && entry.decisionId === 'dec-batch')).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'rental.batchExecute' }),
      expect.objectContaining({ toolName: 'rental.batchResume' }),
      expect.objectContaining({ toolName: 'rental.batchRollback' }),
    ]));
  });
});
