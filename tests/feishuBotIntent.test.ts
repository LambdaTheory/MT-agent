import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';

describe('parseBotIntent', () => {
  it('parses help intent', () => {
    expect(parseBotIntent('帮助')).toEqual({ type: 'help' });
    expect(parseBotIntent('/help')).toEqual({ type: 'help' });
  });

  it('parses run report intent', () => {
    expect(parseBotIntent('跑日报')).toEqual({ type: 'run_public_traffic_report', sendTo: undefined });
    expect(parseBotIntent('生成公域日报 发群')).toEqual({ type: 'run_public_traffic_report', sendTo: 'group' });
  });

  it('parses resend report intent', () => {
    expect(parseBotIntent('重发日报')).toEqual({ type: 'resend_latest_report', sendTo: undefined });
    expect(parseBotIntent('重发公域日报 发全部')).toEqual({ type: 'resend_latest_report', sendTo: 'both' });
  });

  it('parses latest summary intent', () => {
    expect(parseBotIntent('今日概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('今天数据')).toEqual({ type: 'latest_summary' });
  });

  it('parses product query intent', () => {
    expect(parseBotIntent('查询 565')).toEqual({ type: 'query_product', keyword: '565' });
    expect(parseBotIntent('商品 iPhone')).toEqual({ type: 'query_product', keyword: 'iPhone' });
  });

  it('falls back to unknown intent', () => {
    expect(parseBotIntent('随便聊聊')).toEqual({ type: 'unknown', text: '随便聊聊' });
  });
});
