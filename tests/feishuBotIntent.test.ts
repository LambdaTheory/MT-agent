import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAgentFirstBotIntent, parseBotIntent } from '../src/feishuBot/intent.js';

describe('parseBotIntent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses help intent', () => {
    expect(parseBotIntent('帮助')).toEqual({ type: 'help' });
    expect(parseBotIntent('/help')).toEqual({ type: 'help' });
  });

  it('parses run report intent', () => {
    expect(parseBotIntent('跑日报')).toEqual({ type: 'run_public_traffic_report', sendTo: undefined });
    expect(parseBotIntent('生成公域日报 发群')).toEqual({ type: 'run_public_traffic_report', sendTo: 'group' });
  });

  it('parses dashboard refresh intent separately from full report generation', () => {
    expect(parseBotIntent('抓取访问页数据')).toEqual({ type: 'refresh_public_traffic_dashboard', date: undefined, sendTo: undefined });
    expect(parseBotIntent('补抓后链路数据 发群')).toEqual({ type: 'refresh_public_traffic_dashboard', date: undefined, sendTo: 'group' });
  });

  it('preserves a dashboard refresh data date from exact commands', () => {
    expect(parseBotIntent('补抓 2026-07-12 访问页')).toEqual({
      type: 'refresh_public_traffic_dashboard',
      date: '2026-07-12',
      sendTo: undefined,
    });
  });

  it('resolves dashboard refresh relative dates with the Shanghai business calendar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T16:30:00.000Z'));

    expect(parseBotIntent('补抓昨天访问页')).toEqual({
      type: 'refresh_public_traffic_dashboard',
      date: '2026-07-14',
      sendTo: undefined,
    });
    expect(parseBotIntent('补抓前天访问页')).toEqual({
      type: 'refresh_public_traffic_dashboard',
      date: '2026-07-13',
      sendTo: undefined,
    });
  });

  it('parses resend report intent', () => {
    expect(parseBotIntent('重发日报')).toEqual({ type: 'resend_latest_report', sendTo: undefined });
    expect(parseBotIntent('重发公域日报 发全部')).toEqual({ type: 'resend_latest_report', sendTo: 'both' });
    expect(parseBotIntent('重发 2026-06-22 日报 发全部')).toEqual({ type: 'resend_latest_report', sendTo: 'both', date: '2026-06-22' });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 29, 8));
    expect(parseBotIntent('\u91cd\u53d16.22\u65e5\u62a5')).toEqual({ type: 'resend_latest_report', sendTo: undefined, date: '2026-06-22' });
    expect(parseBotIntent('\u91cd\u53d126.6.22\u65e5\u62a5 \u53d1\u5168\u90e8')).toEqual({ type: 'resend_latest_report', sendTo: 'both', date: '2026-06-22' });
    expect(parseBotIntent('\u91cd\u53d16\u670822\u65e5\u62a5')).toEqual({ type: 'resend_latest_report', sendTo: undefined, date: '2026-06-22' });
  });

  it('parses private push latest report to group intent', () => {
    expect(parseBotIntent('推送日报到群')).toEqual({ type: 'push_latest_report_to_group' });
    expect(parseBotIntent('推送 2026-06-22 日报到群')).toEqual({ type: 'push_latest_report_to_group', date: '2026-06-22' });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 29, 8));
    expect(parseBotIntent('\u63a8\u90016.22\u65e5\u62a5\u5230\u7fa4')).toEqual({ type: 'push_latest_report_to_group', date: '2026-06-22' });
  });

  it('parses operations learning quiz intent', () => {
    expect(parseBotIntent('运营学习')).toEqual({ type: 'operations_learning_quiz' });
    expect(parseBotIntent('开始运营学习')).toEqual({ type: 'operations_learning_quiz' });
    expect(parseBotIntent('开始个运营学习')).toEqual({ type: 'operations_learning_quiz' });
    expect(parseBotIntent('loop测验')).toEqual({ type: 'operations_learning_quiz' });
  });

  it('parses operations learning summary intent', () => {
    expect(parseBotIntent('运营学习汇总')).toEqual({ type: 'operations_learning_summary' });
    expect(parseBotIntent('学习反馈总结')).toEqual({ type: 'operations_learning_summary' });
  });

  it('parses operations learning history intent', () => {
    expect(parseBotIntent('运营学习历史')).toEqual({ type: 'operations_learning_history' });
    expect(parseBotIntent('学习反馈历史')).toEqual({ type: 'operations_learning_history' });
  });

  it('parses Agent learning summary intent separately from operations learning', () => {
    expect(parseBotIntent('Agent学习汇总')).toEqual({ type: 'agent_learning_summary' });
    expect(parseBotIntent('语义学习统计')).toEqual({ type: 'agent_learning_summary' });
  });

  it('parses latest summary intent', () => {
    expect(parseBotIntent('今日概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('今天数据')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('查今天数据')).toEqual({ type: 'unknown', text: '查今天数据' });
    expect(parseBotIntent('查看日报')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('看下 今天数据')).toEqual({ type: 'unknown', text: '看下 今天数据' });
    expect(parseBotIntent('看下 公域日报')).toEqual({ type: 'latest_summary' });
  });

  it('parses dated report and product queries promised by help text', () => {
    expect(parseBotIntent('看 2026-06-22 的日报')).toEqual({ type: 'latest_summary', date: '2026-06-22' });
    expect(parseBotIntent('2026-06-22 查询 733')).toEqual({ type: 'query_product', keyword: '733', date: '2026-06-22' });
    expect(parseBotIntent('2026-06-22 查ID 565')).toEqual({ type: 'lookup_product_id', query: '565', date: '2026-06-22' });
    expect(parseBotIntent('2026-06-22 的转化率多少')).toEqual({ type: 'conversion_summary', date: '2026-06-22' });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 26, 8));
    expect(parseBotIntent('\u770b6.22\u65e5\u62a5')).toEqual({ type: 'latest_summary', date: '2026-06-22' });
    expect(parseBotIntent('26.6.22 \u67e5\u8be2 733')).toEqual({ type: 'query_product', keyword: '733', date: '2026-06-22' });
    expect(parseBotIntent('6\u670822\u65e5\u7684\u8f6c\u5316\u7387\u591a\u5c11')).toEqual({ type: 'conversion_summary', date: '2026-06-22' });
    expect(parseBotIntent('查昨天日报')).toEqual({ type: 'latest_summary', date: '2026-06-25' });
    expect(parseBotIntent('昨天转化数据')).toEqual({ type: 'conversion_summary', date: '2026-06-25' });
  });

  it('leaves temporal comparison questions for the Agent planner', () => {
    expect(parseBotIntent('\u4e0a\u5468\u8f6c\u5316\u7387\u4e0e\u672c\u5468\u6bd4')).toEqual({
      type: 'unknown',
      text: '\u4e0a\u5468\u8f6c\u5316\u7387\u4e0e\u672c\u5468\u6bd4',
    });
    expect(parseAgentFirstBotIntent('\u672c\u5468\u548c\u4e0a\u5468\u8f6c\u5316\u7387\u5bf9\u6bd4')).toEqual({
      type: 'unknown',
      text: '\u672c\u5468\u548c\u4e0a\u5468\u8f6c\u5316\u7387\u5bf9\u6bd4',
    });
  });

  it('declines broad natural read-only summary questions instead of guessing', () => {
    expect(parseBotIntent('今天咋样')).toEqual({ type: 'unknown', text: '今天咋样' });
    expect(parseBotIntent('现在公域怎么样')).toEqual({ type: 'unknown', text: '现在公域怎么样' });
    expect(parseBotIntent('日报概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('能不能看下今天数据')).toEqual({ type: 'unknown', text: '能不能看下今天数据' });
  });

  it('parses product query intent', () => {
    expect(parseBotIntent('查询 565')).toEqual({ type: 'query_product', keyword: '565' });
    expect(parseBotIntent('查询商品 721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('查商品 721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('商品 iPhone')).toEqual({ type: 'query_product', keyword: 'iPhone' });
    expect(parseBotIntent('查 433, 798, 872')).toEqual({ type: 'query_product', keyword: '433, 798, 872' });
    expect(parseBotIntent('查 433, 798, 872;')).toEqual({ type: 'query_product', keyword: '433, 798, 872' });
  });

  it('keeps explicit ID lookup intent distinct from operations learning', () => {
    expect(parseBotIntent('查ID 565')).toEqual({ type: 'lookup_product_id', query: '565' });
  });

  it('parses ID lookup card intent without a query', () => {
    expect(parseBotIntent('商品ID互查')).toEqual({ type: 'lookup_product_id_card' });
    expect(parseBotIntent('ID查询')).toEqual({ type: 'lookup_product_id_card' });
    expect(parseBotIntent('查ID')).toEqual({ type: 'lookup_product_id_card' });
  });

  it('parses inventory overview card intent', () => {
    expect(parseBotIntent('库存情况')).toEqual({ type: 'inventory_status_overview' });
    expect(parseBotIntent('链接档案概览')).toEqual({ type: 'link_registry_overview' });
  });

  it('parses explicit link registry maintenance card intents', () => {
    expect(parseBotIntent('链接维护')).toEqual({ type: 'link_registry_maintenance_prompt' });
    expect(parseBotIntent('组级治理')).toEqual({ type: 'link_registry_governance_prompt' });
    expect(parseBotIntent('链接档案维护')).toEqual({ type: 'link_registry_maintenance_hub' });
  });

  it('parses explicit product lookup questions', () => {
    expect(parseBotIntent('这个商品 721 数据如何')).toEqual({ type: 'query_product', keyword: '721' });
  });

  it('parses simple single-id lookup while leaving vague natural lookup questions for fallback handling', () => {
    expect(parseBotIntent('查 721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('721怎么样')).toEqual({ type: 'unknown', text: '721怎么样' });
    expect(parseBotIntent('查一下721')).toEqual({ type: 'unknown', text: '查一下721' });
    expect(parseBotIntent('帮我看下 Pocket 3')).toEqual({ type: 'unknown', text: '帮我看下 Pocket 3' });
  });

  it('does not trigger side-effect actions from vague natural language', () => {
    expect(parseBotIntent('帮我看看日报')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('要不要发群里看看')).toEqual({ type: 'unknown', text: '要不要发群里看看' });
    expect(parseBotIntent('可以重新看下日报吗')).toEqual({ type: 'latest_summary' });
  });

  it('keeps new-link write intents for the Agent planner even when the bot name contains report words', () => {
    expect(parseBotIntent('公域数据日报 端内ID 848 复制 3 条新链')).toEqual({
      type: 'unknown',
      text: '公域数据日报 端内ID 848 复制 3 条新链',
    });
    expect(parseBotIntent('@公域数据日报 端内ID 848 复制 3 条新链')).toEqual({
      type: 'unknown',
      text: '@公域数据日报 端内ID 848 复制 3 条新链',
    });
  });

  it('falls back to unknown intent', () => {
    expect(parseBotIntent('随便聊聊')).toEqual({ type: 'unknown', text: '随便聊聊' });
  });
});

it('parses daemon-only link registry maintenance commands', () => {
  expect(parseBotIntent('链接维护 daemon')).toEqual({ type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' });
  expect(parseBotIntent('链接维护 DAEMON')).toEqual({ type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' });
  expect(parseAgentFirstBotIntent('链接维护 daemon')).toEqual({ type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' });
});

describe('parseAgentFirstBotIntent', () => {
  it('keeps natural commands unknown so the Agent planner chooses tools', () => {
    expect(parseAgentFirstBotIntent('发个日报')).toEqual({ type: 'unknown', text: '发个日报' });
    expect(parseAgentFirstBotIntent('s23最好的链接是哪条?')).toEqual({ type: 'unknown', text: 's23最好的链接是哪条?' });
  });

  it('lets only hard local entry commands bypass the Agent planner', () => {
    expect(parseAgentFirstBotIntent('')).toEqual({ type: 'help' });
    expect(parseAgentFirstBotIntent('帮助')).toEqual({ type: 'help' });
    expect(parseAgentFirstBotIntent('商品ID互查')).toEqual({ type: 'lookup_product_id_card' });
    expect(parseAgentFirstBotIntent('查ID 565')).toEqual({ type: 'lookup_product_id', query: '565' });
    expect(parseAgentFirstBotIntent('库存情况')).toEqual({ type: 'inventory_status_overview' });
    expect(parseAgentFirstBotIntent('链接维护')).toEqual({ type: 'link_registry_maintenance_prompt' });
    expect(parseAgentFirstBotIntent('组级治理')).toEqual({ type: 'link_registry_governance_prompt' });
    expect(parseAgentFirstBotIntent('链接档案维护')).toEqual({ type: 'link_registry_maintenance_hub' });
    expect(parseAgentFirstBotIntent('Agent学习汇总')).toEqual({ type: 'agent_learning_summary' });
    expect(parseAgentFirstBotIntent('运营学习')).toEqual({ type: 'operations_learning_quiz' });
    expect(parseAgentFirstBotIntent('开始运营学习')).toEqual({ type: 'operations_learning_quiz' });
    expect(parseAgentFirstBotIntent('运营学习汇总')).toEqual({ type: 'operations_learning_summary' });
    expect(parseAgentFirstBotIntent('运营学习历史')).toEqual({ type: 'operations_learning_history' });
    expect(parseAgentFirstBotIntent('差异化定价')).toEqual({ type: 'differential_pricing_card' });
    expect(parseAgentFirstBotIntent('取消差异化定价')).toEqual({ type: 'cancel_differential_pricing_card' });
    expect(parseAgentFirstBotIntent('跑失活刷新')).toEqual({ type: 'run_inactive_refresh', date: undefined });
    expect(parseAgentFirstBotIntent('跑失活刷新 2026-07-17')).toEqual({ type: 'run_inactive_refresh', date: '2026-07-17' });
  });

  it('keeps mixed read and write commands planner-first even when legacy parsing can match them', () => {
    expect(parseAgentFirstBotIntent('跑日报')).toEqual({ type: 'unknown', text: '跑日报' });
    expect(parseAgentFirstBotIntent('重发6.22日报')).toEqual({ type: 'unknown', text: '重发6.22日报' });
    expect(parseAgentFirstBotIntent('2026-06-22 的转化率多少')).toEqual({ type: 'unknown', text: '2026-06-22 的转化率多少' });
    expect(parseAgentFirstBotIntent('库存情况 pocket3')).toEqual({ type: 'unknown', text: '库存情况 pocket3' });
    expect(parseAgentFirstBotIntent('同步关单')).toEqual({ type: 'unknown', text: '同步关单' });
    expect(parseAgentFirstBotIntent('复制商品 761')).toEqual({ type: 'unknown', text: '复制商品 761' });
  });

  it('keeps product queries local-direct in Agent-first mode', () => {
    expect(parseAgentFirstBotIntent('查 565')).toEqual({ type: 'query_product', keyword: '565' });
    expect(parseAgentFirstBotIntent('查 433, 798, 872')).toEqual({ type: 'query_product', keyword: '433, 798, 872' });
  });
});
