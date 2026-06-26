import { describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

const mocks = vi.hoisted(() => ({
  runPublicTrafficReportCli: vi.fn(),
  loadEnv: vi.fn(),
  loadConfig: vi.fn(),
  runDashboardRefresh: vi.fn(),
}));

vi.mock('../src/cli/publicTrafficReport.js', () => ({
  runPublicTrafficReportCli: mocks.runPublicTrafficReportCli,
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: mocks.loadEnv,
}));

vi.mock('../src/config/loadConfig.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../src/publicTraffic/dashboardRefresh.js', () => ({
  runDashboardRefresh: mocks.runDashboardRefresh,
}));

describe('executeAgentToolRequest public traffic report', () => {
  it('includes the run log and dashboard crawl summary in the success reply', async () => {
    mocks.runPublicTrafficReportCli.mockResolvedValueOnce({
      logPath: 'output/2026-06-24/公域数据运行日志_2026-06-24.log',
      dashboardCrawlSummary: [
        '访问页抓取情况',
        '1日：页数 0，行数 0，去重 0，总数 0，完成 否（collection.complete=false）',
      ].join('\n'),
    });

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.runReport', arguments: {}, reason: '测试确认跑日报' },
      'output',
    );

    expect(response.text).toContain('公域日报已生成并发送。');
    expect(response.text).toContain('抓取日志：output/2026-06-24/公域数据运行日志_2026-06-24.log');
    expect(response.text).toContain('访问页抓取情况');
    expect(response.text).toContain('1日：页数 0，行数 0，去重 0，总数 0，完成 否（collection.complete=false）');
  });

  it('refreshes dashboard data without requiring a goods export path', async () => {
    const config = {
      targetUrl: 'https://example.test/dashboard',
      periods: ['1d', '7d', '30d'],
      preferredPageSize: 100,
      outputDir: 'output',
      browserProfileDir: 'profile',
    };
    mocks.loadConfig.mockResolvedValueOnce(config);
    mocks.runDashboardRefresh.mockResolvedValueOnce({
      decision: 'rebuilt_and_resent',
      firstQualityText: '访问页抓取情况\n1日：缺失',
      refreshQualityText: '访问页抓取情况\n1日：完整',
      message: '已重建日报并重发飞书',
    });

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.refreshDashboard', arguments: { date: '2026-06-24', sendTo: 'group' }, reason: '测试补抓访问页' },
      'output',
    );

    expect(mocks.loadEnv).toHaveBeenCalled();
    expect(mocks.loadConfig).toHaveBeenCalled();
    expect(mocks.runDashboardRefresh).toHaveBeenCalledWith({ config, date: '2026-06-24', sendTo: 'group' });
    expect(response.text).toContain('访问页补抓完成');
    expect(response.text).toContain('已重建日报并重发飞书');
    expect(response.text).toContain('1日：完整');
  });
});
