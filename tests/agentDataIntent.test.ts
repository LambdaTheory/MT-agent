import { describe, expect, it } from 'vitest';
import { parseAgentDataIntent } from '../src/agentData/intent.js';

describe('parseAgentDataIntent', () => {
  it('maps common Chinese questions to deterministic intents', () => {
    expect(parseAgentDataIntent('今天怎么样')).toEqual({ type: 'overview' });
    expect(parseAgentDataIntent('查 251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('查251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('查询251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('商品251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('今天要处理哪些')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('新品池有哪些')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('下架链接有哪些')).toEqual({ type: 'removed_links' });
    expect(parseAgentDataIntent('转化差的有哪些')).toEqual({ type: 'problem_products', problemType: 'weak_conversion' });
    expect(parseAgentDataIntent('曝光低的有哪些')).toEqual({ type: 'problem_products', problemType: 'low_exposure' });
    expect(parseAgentDataIntent('高潜力商品')).toEqual({ type: 'problem_products', problemType: 'high_potential' });
    expect(parseAgentDataIntent('订单情况')).toEqual({ type: 'order_summary' });
    expect(parseAgentDataIntent('随便问问')).toEqual({ type: 'unknown', text: '随便问问' });
  });

  it('maps best-link questions to same-sku ranking intents before product lookup', () => {
    expect(parseAgentDataIntent('数据最好的X200Ultra是哪个id?')).toEqual({ type: 'best_product_by_same_sku', query: 'X200Ultra' });
    expect(parseAgentDataIntent('数据最好的 X200Ultra 是哪个 id')).toEqual({ type: 'best_product_by_same_sku', query: 'X200Ultra' });
    expect(parseAgentDataIntent('数据最好的 pocket3 的端内id是多少')).toEqual({ type: 'best_product_by_same_sku', query: 'pocket3' });
    expect(parseAgentDataIntent('X200Ultra 数据最好的是哪个id')).toEqual({ type: 'best_product_by_same_sku', query: 'X200Ultra' });
    expect(parseAgentDataIntent('端内ID 733 这个同款组里数据最好的是哪条')).toEqual({ type: 'best_product_by_same_sku', query: '733' });
  });

  it('maps natural read-only questions to agent data intents', () => {
    expect(parseAgentDataIntent('新链接池怎么样')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('新链有哪些')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('冷启动链接情况')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('有哪些要处理')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('今天优先处理什么')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('哪些链接不健康')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('成交少的有哪些')).toEqual({ type: 'problem_products', problemType: 'weak_conversion' });
    expect(parseAgentDataIntent('曝光低的链接')).toEqual({ type: 'problem_products', problemType: 'low_exposure' });
    expect(parseAgentDataIntent('哪些可以继续放量')).toEqual({ type: 'problem_products', problemType: 'high_potential' });
    expect(parseAgentDataIntent('最近下架了哪些')).toEqual({ type: 'removed_links' });
    expect(parseAgentDataIntent('履约情况')).toEqual({ type: 'order_summary' });
  });
});
