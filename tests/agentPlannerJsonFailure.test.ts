import { describe, expect, it } from 'vitest';
import { handleBotIntent } from '../src/feishuBot/tools.js';

describe('Agent planner JSON failure handling', () => {
  it('returns a controlled failed response without exposing raw JSON parser details', async () => {
    const response = await handleBotIntent(
      { type: 'unknown', text: 'RX10M4整体价格 -1' },
      'output',
      {
        agentPlannerProvider: {
          async proposePlan() {
            throw new Error("Invalid LLM JSON output: Expected ',' or '}' after property value in JSON at position 20");
          },
        },
      },
    );

    expect(response.metadata).toMatchObject({ ok: false, errorType: 'llm_json_parse_failed' });
    expect(response.text).toContain('没有执行任何写操作');
    expect(response.text).not.toContain('Invalid LLM JSON output');
    expect(response.text).not.toContain('Expected');
  });
});
