import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { resolveQueryFullListText } from '../src/feishuBot/queryFullListAction.js';

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
      status: 'repaired',
      dataDate: '2026-06-24',
      actualPageDate: '2026-06-24',
      refreshQuality: { hasMissing: false, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } },
      refreshQualityText: '访问页抓取情况\n1日：完整',
      firstQualityText: '访问页抓取情况\n1日：缺失',
      rebuild: 'performed',
      resend: 'performed',
      rawLocation: 'output/2026-06-25',
      message: '已重建日报并重发飞书',
    });

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.refreshDashboard', arguments: { date: '2026-06-24', sendTo: 'group' }, reason: '测试补抓访问页' },
      'output',
    );

    expect(mocks.loadEnv).toHaveBeenCalled();
    expect(mocks.loadConfig).toHaveBeenCalled();
    expect(mocks.runDashboardRefresh).toHaveBeenCalledWith({ config, dataDate: '2026-06-24', sendTo: 'group' });
    expect(response.text).toContain('访问页补抓并重建完成');
    expect(response.text).toContain('已重建日报并重发飞书');
    expect(response.text).toContain('| 1日 | 完整 | 1 | - |');
    expect(response.card).toMatchObject({ header: { title: { content: '访问页补抓并重建完成' }, template: 'green' } });
    expect(response.metadata).toMatchObject({ toolName: 'publicTraffic.refreshDashboard', ok: true, status: 'repaired', dataDate: '2026-06-24', actualPageDate: '2026-06-24', rawLocation: 'output/2026-06-25', rebuild: 'performed', resend: 'performed' });
  });

  it('returns an orange specialized card while preserving operational success for still-missing data', async () => {
    const config = { targetUrl: 'https://example.test/dashboard', periods: ['1d', '7d', '30d'], preferredPageSize: 100, outputDir: 'output', browserProfileDir: 'profile' };
    mocks.loadConfig.mockResolvedValueOnce(config);
    mocks.runDashboardRefresh.mockResolvedValueOnce({
      status: 'still_missing', dataDate: '2026-06-24', actualPageDate: '2026-06-24',
      refreshQuality: { hasMissing: true, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: false, rowCount: 0, reason: 'rowCount=0' }, '30d': { complete: true, rowCount: 1 } } },
      rebuild: 'skipped', resend: 'skipped', rawLocation: 'output/2026-06-25', message: 'saved safely',
    });

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.refreshDashboard', arguments: { date: '2026-06-24' }, reason: '测试缺失访问页补抓' },
      'output',
    );

    expect(response.card).toMatchObject({ header: { title: { content: '访问页补抓完成，但数据仍未完整' }, template: 'orange' } });
    expect(JSON.stringify(response.card)).toContain('未重建、未重发');
    expect(response.metadata).toMatchObject({ toolName: 'publicTraffic.refreshDashboard', ok: true, status: 'still_missing' });
  });

  it('defaults dashboard refresh to the previous Shanghai data date when no date is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:30:00.000Z'));
    const config = {
      targetUrl: 'https://example.test/dashboard',
      periods: ['1d', '7d', '30d'],
      preferredPageSize: 100,
      outputDir: 'output',
      browserProfileDir: 'profile',
    };
    mocks.loadConfig.mockResolvedValueOnce(config);
    mocks.runDashboardRefresh.mockResolvedValueOnce({
      status: 'saved_existing_complete',
      dataDate: '2026-07-13',
      actualPageDate: '2026-07-13',
      refreshQuality: { hasMissing: false, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } },
      refreshQualityText: '访问页抓取情况\n1日：完整',
      firstQualityText: '访问页抓取情况\n1日：完整',
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: 'output/2026-07-14',
      message: '已保存访问页 raw；既有日报无需自动重发',
    });

    try {
      await executeAgentToolRequest(
        { toolName: 'publicTraffic.refreshDashboard', arguments: {}, reason: '测试默认补抓访问页' },
        'output',
      );
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.runDashboardRefresh).toHaveBeenLastCalledWith({ config, dataDate: '2026-07-13', sendTo: undefined });
  });

  it('runs generic report queries against an explicit report data date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-report-query-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 0,
      publicVisits: 0,
      dashboardVisits: 0,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: {
        '1d': { exposure: 100, publicVisits: 10, dashboardVisits: 9, createdOrders: 1, shippedOrders: 0, amount: 8, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0 },
        '7d': { exposure: 700, publicVisits: 70, dashboardVisits: 65, createdOrders: 7, shippedOrders: 2, amount: 88, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.028 },
        '30d': { exposure: 3000, publicVisits: 300, dashboardVisits: 280, createdOrders: 30, shippedOrders: 10, amount: 300, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.033 },
      },
      conclusions: [],
      rows: [
        { productName: 'Pocket 3 A', platformProductId: 'p-101', displayProductId: '端内ID 101', custodyDays: 1, periods: { '1d': metric, '7d': { ...metric, publicVisits: 30 }, '30d': metric } },
        { productName: 'Pocket 3 B', platformProductId: 'p-102', displayProductId: '端内ID 102', custodyDays: 1, periods: { '1d': metric, '7d': { ...metric, publicVisits: 90 }, '30d': metric } },
      ],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      {
        toolName: 'productLink.query',
        arguments: { queryType: 'productList', date: '2026-06-22', period: '7d', sortBy: 'publicVisits', metrics: ['publicVisits'], limit: 1 },
        reason: '查询指定日期访问最高商品',
      },
      dir,
    );

    expect(response.text).toContain('公域日报商品查询 2026-06-22');
    expect(response.text).toContain('端内ID 102');
    expect(response.text).not.toContain('端内ID 101');
  });

  it('runs productLink.query product detail through the unified query executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-product-link-detail-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 10,
      publicVisits: 2,
      dashboardVisits: 2,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0.2,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: [
        { productName: 'Pocket 3', platformProductId: 'platform-733', displayProductId: '端内ID 733', custodyDays: 1, periods: { '1d': metric, '7d': { ...metric, exposure: 70 }, '30d': { ...metric, exposure: 300 } } },
      ],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'productLink.query', arguments: { queryType: 'productDetail', productQuery: '733', date: '2026-06-22' }, reason: '统一商品查询' },
      dir,
    );

    expect(response.text).toContain('端内ID 733｜商品ID platform-733');
    expect(JSON.stringify(response.card)).toContain('商品查询结果');
    expect(response.metadata).toMatchObject({ toolName: 'productLink.query', queryType: 'productDetail', productIds: ['733'] });
  });

  it('runs productLink.query problem pools with a capped card and controlled queryRef', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-product-link-problem-pool-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 10,
      publicVisits: 2,
      dashboardVisits: 2,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0.2,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    const ids = ['701', '702', '703', '704', '705', '706'];
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: ids.map((id) => ({ productName: `托管异常商品 ${id}`, platformProductId: `platform-${id}`, displayProductId: `端内ID ${id}`, custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } })),
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      custodyAbnormal: ids.map((id) => ({ identifier: `端内ID ${id}`, action: '检查托管', reason: '托管异常', priority: 'high' })),
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'productLink.query', arguments: { queryType: 'problemPool', section: 'custodyAbnormal', date: '2026-06-22' }, reason: '统一问题池查询' },
      dir,
    );

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('托管异常');
    expect(cardText).toContain('query_full_list');
    expect(cardText).toContain('q2:');
    expect(cardText).toContain('剩余 1 条可查看完整清单');
    expect(response.metadata).toMatchObject({
      toolName: 'productLink.query',
      queryType: 'problemPool',
      section: 'custodyAbnormal',
      count: 6,
      shownCount: 5,
    });
    expect(String(response.metadata?.queryRef)).toMatch(/^q2:/);
  });

  it('runs productLink.query problem pool counts through the unified query executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-product-link-problem-counts-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 10,
      publicVisits: 2,
      dashboardVisits: 2,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0.2,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: [{ productName: '托管异常商品 701', platformProductId: 'platform-701', displayProductId: '端内ID 701', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      custodyAbnormal: [{ identifier: '端内ID 701', action: '检查托管', reason: '托管异常', priority: 'high' }],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'productLink.query', arguments: { queryType: 'problemPoolCounts', date: '2026-06-22' }, reason: '统一问题池数量查询' },
      dir,
    );

    expect(response.text).toContain('公域日报问题池数量 2026-06-22');
    expect(response.text).toContain('托管异常：1 条');
    expect(response.metadata).toMatchObject({ toolName: 'productLink.query', queryType: 'problemPoolCounts', date: '2026-06-22' });
    expect(JSON.stringify(response.card)).toContain('公域日报问题池数量 2026-06-22');
  });

  it('runs productLink.query link status against lifecycle governance by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-product-link-status-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 10,
      publicVisits: 1,
      dashboardVisits: 1,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0.1,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: [{ productName: '弱表现商品 706', platformProductId: 'platform-706', displayProductId: '端内ID 706', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': metric } }],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [{ identifier: '端内ID 706', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00', priority: 'medium' }],
      recommendedActions: [{ identifier: '端内ID 999', action: '不要返回', reason: '不是链接状态' }],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'productLink.query', arguments: { queryType: 'linkStatus', date: '2026-06-22' }, reason: '统一链接状态查询' },
      dir,
    );

    expect(response.text).toContain('公域日报生命周期治理 2026-06-22');
    expect(response.text).toContain('端内ID 706｜商品ID platform-706');
    expect(response.text).not.toContain('端内ID 999');
    expect(response.metadata).toMatchObject({ toolName: 'productLink.query', queryType: 'linkStatus', section: 'lifecycleGovernance', productIds: ['706'] });
  });

  it('keeps filtered problem-pool full-list callbacks bound to the original controlled query', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-product-link-filtered-full-list-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 10,
      publicVisits: 2,
      dashboardVisits: 2,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0.2,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: ['701', '702', '703'].map((id) => ({ productName: `托管异常商品 ${id}`, platformProductId: `platform-${id}`, displayProductId: `端内ID ${id}`, custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } })),
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      custodyAbnormal: [
        { identifier: '端内ID 701', action: '检查托管', reason: '托管异常', priority: 'high' },
        { identifier: '端内ID 702', action: '观察', reason: '托管异常', priority: 'low' },
        { identifier: '端内ID 703', action: '检查托管', reason: '托管异常', priority: 'high' },
      ],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'productLink.query', arguments: { queryType: 'problemPool', section: 'custodyAbnormal', filters: [{ field: 'priority', operator: 'eq', value: 'high' }], sortBy: 'productId', date: '2026-06-22' }, reason: '筛选高优先级问题池' },
      dir,
    );
    const fullText = await resolveQueryFullListText(dir, response.metadata?.queryRef);

    expect(response.metadata).toMatchObject({ count: 2, shownCount: 2 });
    expect(fullText).toContain('端内ID 701｜商品ID platform-701');
    expect(fullText).toContain('端内ID 703｜商品ID platform-703');
    expect(fullText).not.toContain('端内ID 702｜商品ID platform-702');
  });

  it('normalizes short report dates before querying saved report contexts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-report-query-short-date-'));
    const runDir = join(dir, '2026-06-23');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 0,
      publicVisits: 0,
      dashboardVisits: 0,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-22',
      summary: {
        '1d': { exposure: 100, publicVisits: 18, dashboardVisits: 18, createdOrders: 1, shippedOrders: 0, amount: 8, exposureVisitRate: 0.18, visitCreatedOrderRate: 0.055, visitShipmentRate: 0 },
        '7d': { exposure: 700, publicVisits: 70, dashboardVisits: 65, createdOrders: 7, shippedOrders: 2, amount: 88, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.028 },
        '30d': { exposure: 3000, publicVisits: 300, dashboardVisits: 280, createdOrders: 30, shippedOrders: 10, amount: 300, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.033 },
      },
      conclusions: [],
      rows: [{ productName: 'Pocket 3 A', platformProductId: 'p-101', displayProductId: '端内ID 101', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } }],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      {
        toolName: 'publicTraffic.reportQuery',
        arguments: { target: 'summary', date: '26.6.22', metrics: ['publicVisits'] },
        reason: '用户用短日期查询访问量',
      },
      dir,
    );

    expect(response.text).toContain('公域日报汇总 2026-06-22');
    expect(response.text).toContain('公域访问量 18');
    expect(JSON.stringify(response.card)).toContain('公域日报汇总 2026-06-22');
  });

  it('returns inactive-link id collection from lifecycle governance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-inactive-links-'));
    const runDir = join(dir, '2026-06-24');
    await mkdir(runDir, { recursive: true });
    const metric = {
      exposure: 0,
      publicVisits: 0,
      dashboardVisits: 0,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      amount: 0,
      exposureVisitRate: 0,
      visitCreatedOrderRate: 0,
      visitShipmentRate: 0,
      hasExposureData: true,
      hasDashboardData: true,
    };
    await writeFile(join(runDir, 'report-context.json'), JSON.stringify({
      date: '2026-06-24',
      summary: {
        '1d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
        '7d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
        '30d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
      },
      conclusions: [],
      rows: [{ productName: '弱表现商品', platformProductId: 'p-706', displayProductId: '端内ID 706', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': metric } }],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [{ identifier: '端内ID 706', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00' }],
      recommendedActions: [],
      agentData: { removedLinks: [{ productId: '999', platformProductId: 'p999', productName: '已下架商品', removedDate: '2026-06-23', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
      emptySectionNotes: {},
    }));

    const response = await executeAgentToolRequest(
      { toolName: 'publicTraffic.inactiveLinks', arguments: {}, reason: '整理失活链接 ID 集合' },
      dir,
    );

    expect(response.text).toContain('失活候选链接ID集合：706');
    expect(response.text).not.toContain('999');
    expect(response.text).not.toContain('暂无近7天下架链接');
  });

  it('does not expose the old crawlSources boundary through Feishu tool execution', async () => {
    await expect(executeAgentToolRequest(
      { toolName: 'publicTraffic.crawlSources', arguments: { goodsExportPath: 'output/goods.xlsx' }, reason: '旧抓源工具不应由飞书执行' },
      'output',
    )).rejects.toThrow('Unsupported agent tool: publicTraffic.crawlSources');
  });
});
