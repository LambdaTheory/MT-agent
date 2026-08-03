import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareCustodyCleanupConfirmationCard } from '../src/custodyConflictCleanup/index.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { writeCanonicalCustodyPreviewAudit } from './custodyConflictCleanupFixture.js';

const freshNow = new Date('2026-07-31T09:00:00.000Z');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'custody-card-'));
  tempDirs.push(dir);
  return dir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectCallbackValues(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectCallbackValues(item, output);
    return output;
  }
  if (!isRecord(value)) return output;
  if (value.type === 'callback' && isRecord(value.value)) output.push(value.value);
  for (const child of Object.values(value)) collectCallbackValues(child, output);
  return output;
}

describe('custody cleanup confirmation card', () => {
  it('stores the hidden execute request server-side and keeps callbacks to requestRef plus confirmationKey', async () => {
    const outputDir = await tempDir();
    const result = await prepareCustodyCleanupConfirmationCard({ auditPath: await writeCanonicalCustodyPreviewAudit(await tempDir()), outputDir, now: freshNow });

    const callbackValues = collectCallbackValues(result.card);

    expect(callbackValues).toHaveLength(2);
    expect(callbackValues).toEqual(expect.arrayContaining([
      { action: 'agent_tool_confirm', requestRef: result.requestRef, confirmationKey: expect.stringMatching(/^[a-f0-9]{24}$/) },
      { action: 'agent_tool_cancel', requestRef: result.requestRef, confirmationKey: expect.stringMatching(/^[a-f0-9]{24}$/) },
    ]));
    for (const value of callbackValues) {
      expect(Object.keys(value).sort()).toEqual(['action', 'confirmationKey', 'requestRef']);
      expect(value).not.toHaveProperty('request');
      expect(value).not.toHaveProperty('arguments');
      expect(value).not.toHaveProperty('planRef');
    }
    expect(result.planPath).toBe(join(outputDir, 'latest', 'custody-cleanup-plans', `${result.plan.planRef}.json`));
  });

  it('is reachable through a non-mutating agent tool route while execution remains hidden', async () => {
    const outputDir = await tempDir();
    const auditPath = await writeCanonicalCustodyPreviewAudit(await tempDir(), 36, new Date().toISOString());

    const response = await executeAgentToolRequest({
      toolName: 'operations.custodyCleanupConfirm',
      arguments: { auditPath },
      reason: 'prepare custody cleanup confirmation card from explicit preview audit',
    }, outputDir);

    expect(response.metadata).toMatchObject({ toolName: 'operations.custodyCleanupConfirm', ok: true, candidateCount: 36 });
    expect(response.card).toBeDefined();
    const callbackValues = collectCallbackValues(response.card);
    expect(callbackValues).toHaveLength(2);
    for (const value of callbackValues) expect(Object.keys(value).sort()).toEqual(['action', 'confirmationKey', 'requestRef']);
  });
});
