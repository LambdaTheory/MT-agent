import { describe, expect, it } from 'vitest';
import { parseAgentFirstBotIntent, parseBotIntent } from '../src/feishuBot/intent.js';

describe('parseBotIntent', () => {
  it('parses help intent', () => {
    expect(parseBotIntent('帮助')).toEqual({ type: 'help' });
    expect(parseBotIntent('/help')).toEqual({ type: 'help' });
  });

  it('parses run report intent', () => {
    expect(parseBotIntent('跑日报')).toEqual({ type: 'run_public_traffic_report', sendTo: undefined });
    expect(parseBotIntent('生成公域日报 发群')).toEqual({ type: 'run_public_traffic_report', sendTo: 'group' });
  });

  it('parses dashboard refresh intent separately from full report generation', () => {
    expect(parseBotIntent('抓取访问页数据')).toEqual({ type: 'refresh_public_traffic_dashboard', sendTo: undefined });
    expect(parseBotIntent('补抓后链路数据 发群')).toEqual({ type: 'refresh_public_traffic_dashboard', sendTo: 'group' });
  });

  it('parses resend report intent', () => {
    expect(parseBotIntent('重发日报')).toEqual({ type: 'resend_latest_report', sendTo: undefined });
    expect(parseBotIntent('重发公域日报 发全部')).toEqual({ type: 'resend_latest_report', sendTo: 'both' });
  });

  it('parses private push latest report to group intent', () => {
    expect(parseBotIntent('推送日报到群')).toEqual({ type: 'push_latest_report_to_group' });
  });

  it('parses operations learning quiz intent', () => {
    expect(parseBotIntent('运营学习')).toEqual({ type: 'operations_learning_quiz' });
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
    expect(parseBotIntent('查今天数据')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('查看日报')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('看下 今天数据')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('看下 公域日报')).toEqual({ type: 'latest_summary' });
  });

  it('parses natural read-only summary questions without triggering actions', () => {
    expect(parseBotIntent('今天咋样')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('现在公域怎么样')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('日报概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('能不能看下今天数据')).toEqual({ type: 'latest_summary' });
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

  it('parses explicit product lookup questions', () => {
    expect(parseBotIntent('这个商品 721 数据如何')).toEqual({ type: 'query_product', keyword: '721' });
  });

  it('leaves vague natural lookup questions for fallback handling', () => {
    expect(parseBotIntent('查 721')).toEqual({ type: 'unknown', text: '查 721' });
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

describe('parseAgentFirstBotIntent', () => {
  it('keeps natural commands unknown so the Agent planner chooses tools', () => {
    expect(parseAgentFirstBotIntent('查 565')).toEqual({ type: 'unknown', text: '查 565' });
    expect(parseAgentFirstBotIntent('跑日报')).toEqual({ type: 'unknown', text: '跑日报' });
    expect(parseAgentFirstBotIntent('发个日报')).toEqual({ type: 'unknown', text: '发个日报' });
    expect(parseAgentFirstBotIntent('s23最好的链接是哪条?')).toEqual({ type: 'unknown', text: 's23最好的链接是哪条?' });
  });

  it('keeps local UI and management intents deterministic', () => {
    expect(parseAgentFirstBotIntent('帮助')).toEqual({ type: 'help' });
    expect(parseAgentFirstBotIntent('商品ID互查')).toEqual({ type: 'lookup_product_id_card' });
    expect(parseAgentFirstBotIntent('库存情况')).toEqual({ type: 'inventory_status_overview' });
    expect(parseAgentFirstBotIntent('Agent学习汇总')).toEqual({ type: 'agent_learning_summary' });
  });
});
