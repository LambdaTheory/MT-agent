import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentToolConfirmCard } from '../src/agentRuntime/approvalCard.js';
import { loadAgentToolConfirmRequestFromValue, saveAgentToolConfirmRequest } from '../src/feishuBot/agentToolConfirmStore.js';

function readAgentToolConfirmValue(card: unknown): unknown {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  return button?.behaviors?.[0]?.value;
}

describe('agent tool confirm request store', () => {
  it('loads referenced confirmation requests with signature validation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-confirm-store-'));
    const request = {
      toolName: 'rental.priceApply',
      arguments: {
        items: [
          {
            productId: '653',
            fields: {
              rent1day: '21.89',
              rent10day: '54.89',
              rent30day: '86.90',
              marketPrice: '275.00',
            },
            audit: { taskId: 'task_653_preview', rollbackFile: 'rollback-653.json' },
          },
        ],
      },
      reason: 'confirmed price preview',
    };

    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    const value = readAgentToolConfirmValue(buildAgentToolConfirmCard(request, { requestRef }));

    await expect(loadAgentToolConfirmRequestFromValue(outputDir, value)).resolves.toEqual(request);
    await expect(loadAgentToolConfirmRequestFromValue(outputDir, { ...(value as Record<string, unknown>), confirmationKey: '000000000000000000000000' })).resolves.toBeNull();
  });
});
