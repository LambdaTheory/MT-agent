import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAgentPlannerProposal } from '../src/agentRuntime/planner.js';
import { findAgentTool, listAgentTools } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { createRentalPriceSkillClient, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('rental image and VAS tool boundaries', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-image-vas-output-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(outputDir, { recursive: true, force: true });
  });

  it('registers image and VAS surfaces as hidden, with mutations requiring confirmation', () => {
    for (const name of ['rental.imageRead', 'rental.imageVerify', 'rental.vasRead', 'rental.vasCatalogRead', 'rental.vasVerify']) {
      expect(findAgentTool(name)).toMatchObject({ risk: 'read', requiresConfirmation: false, plannerVisible: false });
    }
    for (const name of ['rental.imageUpload', 'rental.imagePick', 'rental.imageOrder', 'rental.whiteImageSet', 'rental.vasApply']) {
      expect(findAgentTool(name)).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
    }
    expect(listAgentTools().filter((tool) => /(?:image|vas)/i.test(tool.name) && tool.plannerVisible !== false)).toEqual([]);
    expect(validateAgentPlannerProposal(JSON.stringify({ goal: 'direct image mutation', selectedTool: 'rental.imagePick', arguments: { productId: '761', categoryName: '默认', fileNames: ['a.jpg'] }, confidence: 0.9, reason: 'hidden tool rejected' }))).toEqual({ ok: false, reason: 'unknown_tool' });
    expect(validateAgentPlannerProposal(JSON.stringify({ goal: 'direct vas apply', selectedTool: 'rental.vasApply', arguments: { allowCurrentPage: true, expectedProductId: '761', expectedVAS: { enabled: true } }, confidence: 0.9, reason: 'hidden tool rejected' }))).toEqual({ ok: false, reason: 'unknown_tool' });
  });

  it('dispatches image and VAS executor handlers through the provided rental client', async () => {
    const calls: string[] = [];
    const client: RentalPriceSkillClient = {
      ...createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:1' }),
      async imageRead(productId) { calls.push(`imageRead:${productId}`); return { productId, ok: true, status: 'ok', thumbs: ['u1'], whiteImage: 'w1', lines: ['image-read: ok'] }; },
      async imagePick(request) { calls.push(`imagePick:${request.productId}:${request.fileNames.join(',')}`); return { productId: request.productId, ok: true, status: 'ok', lines: ['image-pick: ok'], result: { status: 'ok' } }; },
      async imageVerify(request) { calls.push(`imageVerify:${request.productId}`); return { productId: request.productId, ok: true, status: 'ok', lines: ['image-verify: ok'], result: { status: 'ok' } }; },
      async vasRead(request) { calls.push(`vasRead:${request.productId ?? request.expectedProductId}`); return { productId: request.productId ?? request.expectedProductId, ok: true, status: 'ok', platforms: ['mt'], services: [{ id: 'svc-1' }], lines: ['vas-read: ok'], result: { status: 'ok' } }; },
      async vasCatalogRead(request) { calls.push(`vasCatalogRead:${request.ids?.join(',') ?? ''}`); return { ok: true, status: 'ok', count: 1, services: [{ id: 'svc-1' }], lines: ['vas-catalog-read: ok'], result: { status: 'ok' } }; },
      async vasApply(request) { calls.push(`vasApply:${request.expectedProductId}`); return { ok: true, status: 'ok', lines: ['vas-apply: ok'], result: { status: 'ok' } }; },
      async vasVerify(request) { calls.push(`vasVerify:${request.productId}`); return { ok: true, status: 'ok', lines: ['vas-verify: ok'], result: { status: 'ok' } }; },
    };

    await expect(executeAgentToolRequest({ toolName: 'rental.imageRead', arguments: { productId: '761' }, reason: 'read image' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true, thumbCount: 1 } });
    await expect(executeAgentToolRequest({ toolName: 'rental.imagePick', arguments: { productId: '761', categoryName: '默认', fileNames: ['a.jpg'] }, reason: 'pick image' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true, fileCount: 1 } });
    await expect(executeAgentToolRequest({ toolName: 'rental.imageVerify', arguments: { productId: '761', expectedImages: { thumbs: ['u1'] } }, reason: 'verify image' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true } });
    await expect(executeAgentToolRequest({ toolName: 'rental.vasRead', arguments: { productId: '761' }, reason: 'read vas' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true, serviceCount: 1 } });
    await expect(executeAgentToolRequest({ toolName: 'rental.vasCatalogRead', arguments: { productId: '761', ids: ['svc-1'] }, reason: 'read catalog' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true, count: 1 } });
    await expect(executeAgentToolRequest({ toolName: 'rental.vasApply', arguments: { allowCurrentPage: true, expectedProductId: '761', expectedVAS: { enabled: true } }, reason: 'apply vas' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true } });
    await expect(executeAgentToolRequest({ toolName: 'rental.vasVerify', arguments: { productId: '761', expectedVAS: { enabled: true } }, reason: 'verify vas' }, outputDir, { rentalPriceClient: client })).resolves.toMatchObject({ metadata: { ok: true } });

    expect(calls).toEqual(['imageRead:761', 'imagePick:761:a.jpg', 'imageVerify:761', 'vasRead:761', 'vasCatalogRead:svc-1', 'vasApply:761', 'vasVerify:761']);
  });

  it('rejects unsafe VAS payloads before daemon mutation', async () => {
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    await expect(client.vasApply!({ allowCurrentPage: true, expectedProductId: '761', expectedVAS: { enabled: 'true' } })).rejects.toThrow(/enabled/);
    await expect(client.vasApply!({ allowCurrentPage: true, expectedProductId: '761', expectedVAS: { services: { incrementAdd: [{ id: 'svc-1' }] } } })).rejects.toThrow(/service-library mutation/);
    await expect(client.vasVerify!({ productId: '761', expectedVAS: { platforms: 'mt' } })).rejects.toThrow(/platforms/);
    expect(validateAgentPlannerProposal(JSON.stringify({ goal: 'bad batch execute', selectedTool: 'rental.batchExecute', arguments: { specFile: 'tasks/batches/spec.json', confirmVASWithoutPreview: true }, confidence: 0.9, reason: 'no vas bypass' }))).toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('sends stable daemon image and VAS actions through negotiated client methods', async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push(body);
      if (body.action === 'hello') return new Response(JSON.stringify({ status: 'ok', instanceId: 'i1', persistedStateDigest: 'd'.repeat(64), persistedStateReady: true }));
      return new Response(JSON.stringify({ status: 'ok', thumbs: ['u1'], services: [{ id: 'svc-1' }], platforms: ['mt'], count: 1 }));
    }));
    const client = createRentalPriceSkillClient({ daemonUrl: 'http://127.0.0.1:9223', daemonToken: 'test-token' });

    await client.imageRead!('761');
    await client.imagePick!({ productId: '761', categoryName: '默认', fileNames: ['a.jpg'] });
    await client.vasRead!({ productId: '761' });
    await client.vasApply!({ allowCurrentPage: true, expectedProductId: '761', expectedVAS: { enabled: true } });

    expect(calls.map((call) => call.action)).toEqual(['hello', 'image-read', 'hello', 'image-pick', 'hello', 'vas-read', 'hello', 'vas-apply']);
    expect(calls[1]).toMatchObject({ action: 'image-read', productId: '761', _negotiation: expect.objectContaining({ actionClass: 'safe-read' }) });
    expect(calls[3]).toMatchObject({ action: 'image-pick', productId: '761', categoryName: '默认', fileNames: ['a.jpg'], _negotiation: expect.objectContaining({ actionClass: 'mutation' }) });
    expect(calls[5]).toMatchObject({ action: 'vas-read', productId: '761', _negotiation: expect.objectContaining({ actionClass: 'safe-read' }) });
    expect(calls[7]).toMatchObject({ action: 'vas-apply', expectedProductId: '761', expectedVAS: { enabled: true }, _negotiation: expect.objectContaining({ actionClass: 'mutation' }) });
  });
});
