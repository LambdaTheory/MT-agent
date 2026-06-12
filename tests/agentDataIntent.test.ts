import { describe, expect, it } from 'vitest';
import { parseAgentDataIntent } from '../src/agentData/intent.js';

describe('parseAgentDataIntent', () => {
  it('maps common Chinese questions to deterministic intents', () => {
    expect(parseAgentDataIntent('今天怎么样')).toEqual({ type: 'overview' });
    expect(parseAgentDataIntent('查 251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('今天要处理哪些')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('新品池有哪些')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('转化差的有哪些')).toEqual({ type: 'problem_products', problemType: 'weak_conversion' });
    expect(parseAgentDataIntent('订单情况')).toEqual({ type: 'order_summary' });
  });
});
