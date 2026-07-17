import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

type FormChanges = Record<string, unknown> | Record<string, Record<string, unknown>>;

interface RentalApplyCurrentClient extends RentalPriceSkillClient {
  applyCurrent(expectedProductId: string, changes: FormChanges): Promise<{ productId: string; ok: boolean; changesFile: string; lines: string[] }>;
  submitCurrent(expectedProductId: string): Promise<{ productId: string; ok: boolean; lines: string[] }>;
}

function clientWith(overrides: Partial<RentalApplyCurrentClient>): RentalApplyCurrentClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy() { throw new Error('copy should not run'); },
    async delist() { throw new Error('delist should not run'); },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    async applyCurrent() { throw new Error('applyCurrent should be overridden'); },
    async submitCurrent() { throw new Error('submitCurrent should be overridden'); },
    ...overrides,
  };
}

describe('rental apply-current and submitCurrent tools', () => {
  let outputDir: string;
  let rootDir: string;
  let dataRoot: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-apply-current-'));
    rootDir = await mkdtemp(join(tmpdir(), 'rental-skill-root-'));
    dataRoot = join(dirname(rootDir), `.${basename(rootDir)}-data`);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(outputDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('does not register retired applyCurrent and submitCurrent tools', () => {
    expect(findAgentTool('rental.applyCurrent')).toBeUndefined();
    expect(findAgentTool('rental.submitCurrent')).toBeUndefined();
  });

  it('rejects native apply-current and submitCurrent before daemon mutation', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetch);
    const changes = { '1355': { rent1day: '88.00' } };

    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' }) as RentalApplyCurrentClient;
    await expect(client.applyCurrent('648', changes)).rejects.toThrow('当前页直接应用已停用');
    await expect(client.submitCurrent('648')).rejects.toThrow('当前页直接提交已停用');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects confirmed applyCurrent and submitCurrent before client dispatch', async () => {
    const changes = { rent1day: '88.00' };
    const applyCurrent = vi.fn(async () => ({ productId: '648', ok: true, changesFile: 'tasks/current.json', lines: ['apply-current: ok'] }));
    const submitCurrent = vi.fn(async () => ({ productId: '648', ok: true, lines: ['submit: ok'] }));
    const client = clientWith({ applyCurrent, submitCurrent });

    const apply = await executeAgentToolRequest(
      { toolName: 'rental.applyCurrent', arguments: { expectedProductId: '648', changes }, reason: 'confirmed current page apply' },
      outputDir,
      { rentalPriceClient: client },
    );
    const submit = await executeAgentToolRequest(
      { toolName: 'rental.submitCurrent', arguments: { expectedProductId: '648' }, reason: 'confirmed current page submit' },
      outputDir,
      { rentalPriceClient: client },
    );

    expect(applyCurrent).not.toHaveBeenCalled();
    expect(submitCurrent).not.toHaveBeenCalled();
    expect(apply.metadata).toMatchObject({ toolName: 'rental.applyCurrent', ok: false, productId: '648' });
    expect(submit.metadata).toMatchObject({ toolName: 'rental.submitCurrent', ok: false, productId: '648' });
    expect(apply.text).toContain('当前页直接应用已停用');
    expect(submit.text).toContain('当前页直接提交已停用');
  });
});
