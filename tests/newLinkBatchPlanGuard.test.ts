import { describe, expect, it } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

describe('new link batch plan guard', () => {
  it('returns actionable guidance when keyword is present without count or items', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.newLinkBatchPlan',
      arguments: { keyword: '处理648' },
      reason: 'planner provided an incomplete new-link batch request',
    }, 'output');

    expect(response.text).toContain('补链需要');
    expect(response.text).toContain('关键词 + 数量');
    expect(response.text).toContain('给<关键词>补3条');
    expect(response.text).not.toContain('参数无效');
    expect(response.metadata).toMatchObject({ ok: false, needsMoreInput: true, toolName: 'rental.newLinkBatchPlan' });
  });
});
