import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-apply-current-'));
    rootDir = await mkdtemp(join(tmpdir(), 'rental-skill-root-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(outputDir, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  });

  it('registers applyCurrent and submitCurrent as confirmed advanced form-state tools', () => {
    expect(findAgentTool('rental.applyCurrent')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      inputSchema: {
        required: ['expectedProductId', 'changes'],
        additionalProperties: false,
      },
    });
    expect(findAgentTool('rental.submitCurrent')).toMatchObject({
      risk: 'high',
      requiresConfirmation: true,
      inputSchema: {
        required: ['expectedProductId'],
        additionalProperties: false,
      },
    });
  });

  it('sends native apply-current with a changes file and native submit', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetch);
    const changes = { '1355': { rent1day: '88.00' } };

    const client = createRentalPriceSkillClient({ rootDir, daemonUrl: 'http://127.0.0.1:9223' }) as RentalApplyCurrentClient;
    const apply = await client.applyCurrent('648', changes);
    await client.submitCurrent('648');

    const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit | undefined)?.body)) as Record<string, unknown>);
    const applyBody = bodies.find((body) => body.action === 'apply-current');
    const submitBody = bodies.find((body) => body.action === 'submit');
    expect(bodies.filter((body) => body.action === 'hello')).toHaveLength(2);
    expect(applyBody).toMatchObject({ action: 'apply-current', allowCurrentPage: true, expectedProductId: '648' });
    expect(applyBody?._negotiation).toMatchObject({ actionClass: 'mutation', client: { skillVersion: '1.0.0' } });
    expect(typeof applyBody?.changesFile).toBe('string');
    expect(JSON.parse(await readFile(String(applyBody?.changesFile), 'utf8'))).toEqual(changes);
    expect(apply.changesFile).toBe(applyBody?.changesFile);
    expect(submitBody).toMatchObject({ action: 'submit', expectedProductId: '648', _negotiation: { actionClass: 'mutation' } });
  });

  it('dispatches confirmed applyCurrent and submitCurrent to the rental client', async () => {
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

    expect(applyCurrent).toHaveBeenCalledWith('648', changes);
    expect(submitCurrent).toHaveBeenCalledWith('648');
    expect(apply.metadata).toMatchObject({ toolName: 'rental.applyCurrent', ok: true, productId: '648' });
    expect(submit.metadata).toMatchObject({ toolName: 'rental.submitCurrent', ok: true, productId: '648' });
  });
});
