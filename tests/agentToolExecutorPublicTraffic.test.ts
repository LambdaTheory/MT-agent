import { describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

const mocks = vi.hoisted(() => ({
  runPublicTrafficReportCli: vi.fn(),
}));

vi.mock('../src/cli/publicTrafficReport.js', () => ({
  runPublicTrafficReportCli: mocks.runPublicTrafficReportCli,
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
});
