import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { agentExploreResponse } from '../src/feishuBot/agentExploreResponse.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

function readConfirmRequest(card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  const request = parseAgentToolConfirmRequest(button?.behaviors?.[0]?.value);
  if (!request) throw new Error('confirm request missing');
  return request;
}

function context(date: string) {
  const metric = { exposure: 100, publicVisits: 10, dashboardVisits: 10, createdOrders: 0, signedOrders: 0, reviewedOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0.1, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true };
  return {
    date,
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [{ productName: 'A 相机', platformProductId: 'p101', displayProductId: '端内ID 101', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [], weakClick: [], weakConversion: [], highPotential: [], newProductObservation: [], lifecycleGovernance: [], recommendedActions: [],
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
  };
}

describe('Agent Brain integration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-agent-brain-'));
    for (const date of ['2026-07-01', '2026-07-02']) {
      await mkdir(join(dir, date), { recursive: true });
      await writeFile(join(dir, date, 'report-context.json'), JSON.stringify(context(date)), 'utf8');
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uses registered read tools before returning a confirmation-card decision without executing writes', async () => {
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'call_tool', tool: 'publicTraffic.windowedFindings', args: { lookbackDays: 2, predicate: 'exposure_without_orders', endDate: '2026-07-02' } }),
      JSON.stringify({
        action: 'finish',
        answer: '101 连续有曝光无成交，建议人工确认下架',
        decisions: [{
          decisionId: 'dec-1',
          runId: 'run-1',
          title: '下架 101',
          subjects: [{ kind: 'product', id: '101' }],
          operationType: 'delist',
          recommendation: 'approve_to_execute',
          risk: 'high',
          rationale: ['连续窗口有曝光无成交'],
          evidenceRefs: ['publicTraffic.windowedFindings'],
          proposedTool: { toolName: 'rental.delist', arguments: { productId: '101' } },
          uncertainties: [],
        }],
      }),
    ]);
    const delist = vi.fn(async () => ({ productId: '101', ok: true, lines: ['should not run'] }));
    const rentalPriceClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      delist,
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    } satisfies RentalPriceSkillClient;

    const response = await agentExploreResponse('查曝光再给建议', dir, { provider, executionOptions: { rentalPriceClient } });

    expect(delist).not.toHaveBeenCalled();
    expect(response.text).toContain('探索步骤：publicTraffic.windowedFindings');
    expect(response.text).toContain('待确认执行：1 项');
    expect(readConfirmRequest(response.card)).toMatchObject({ toolName: 'rental.delist', arguments: { productId: '101' } });
  });
});
