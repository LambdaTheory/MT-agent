import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

const mocks = vi.hoisted(() => ({
  runPublicTrafficReportCli: vi.fn(),
  sendFeishuCard: vi.fn(),
}));

vi.mock('../src/cli/publicTrafficReport.js', () => ({
  runPublicTrafficReportCli: mocks.runPublicTrafficReportCli,
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

const summary = {
  exposure: 100,
  publicVisits: 20,
  dashboardVisits: 15,
  createdOrders: 2,
  shippedOrders: 1,
  amount: 99,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0.1,
  visitShipmentRate: 0.05,
};

const metric = {
  exposure: 100,
  publicVisits: 20,
  dashboardVisits: 15,
  createdOrders: 2,
  signedOrders: 1,
  reviewedOrders: 1,
  shippedOrders: 1,
  amount: 99,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0.1,
  visitShipmentRate: 0.05,
  hasExposureData: true,
  hasDashboardData: true,
};

async function writeContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-push-group-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [{
      productName: '测试商品',
      platformProductId: 'p1',
      displayProductId: '端内ID 565',
      custodyDays: 10,
      periods: { '1d': metric, '7d': metric, '30d': metric },
    }],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    newProductPoolIds: [],
    emptySectionNotes: {},
  }));
  return dir;
}

describe('push latest report to group', () => {
  beforeEach(() => {
    mocks.runPublicTrafficReportCli.mockReset();
    mocks.sendFeishuCard.mockReset();
    mocks.sendFeishuCard.mockResolvedValue({ sent: true, channel: 'app' });
  });

  it('returns a confirmation card before pushing the latest saved public traffic report to group', async () => {
    const outputDir = await writeContext();

    const response = await handleBotIntent({ type: 'push_latest_report_to_group' }, outputDir);

    expect(response.text).toBe('请确认 Agent 操作：publicTraffic.pushLatestReportToGroup');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('publicTraffic.pushLatestReportToGroup');
    expect(mocks.runPublicTrafficReportCli).not.toHaveBeenCalled();
    expect(mocks.sendFeishuCard).not.toHaveBeenCalled();
  });

  it('pushes the latest saved public traffic report to group only after confirmation', async () => {
    const outputDir = await writeContext();

    const response = await executeAgentToolRequest({
      toolName: 'publicTraffic.pushLatestReportToGroup',
      arguments: {},
      reason: '测试确认推送日报到群',
    }, outputDir);

    expect(response.text).toBe('最新公域日报已推送到群。');
    expect(mocks.runPublicTrafficReportCli).not.toHaveBeenCalled();
    expect(mocks.sendFeishuCard).toHaveBeenCalledOnce();
    expect(mocks.sendFeishuCard.mock.calls[0][0]).toEqual(expect.objectContaining({ FEISHU_SEND_TO: 'group' }));
  });
});
