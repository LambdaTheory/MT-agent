import { describe, expect, it } from 'vitest';
import { buildAgentToolConfirmCard } from '../src/agentRuntime/approvalCard.js';

function buttonValue(card: unknown, buttonName: string): unknown {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  return form?.elements?.find((element) => element.name === buttonName)?.behaviors?.[0]?.value;
}

describe('Agent tool confirmation card requestRef cancel', () => {
  it('uses requestRef and confirmationKey for cancel when requestRef is available', () => {
    const card = buildAgentToolConfirmCard(
      { toolName: 'rental.priceApply', arguments: { items: [{ productId: '648', fields: { rent1day: '88.00' } }] }, reason: 'confirmed apply' },
      { requestRef: 'agent_tool_1234567890abcdef' },
    );

    expect(buttonValue(card, 'agent_tool_cancel_submit')).toMatchObject({
      action: 'agent_tool_cancel',
      requestRef: 'agent_tool_1234567890abcdef',
      confirmationKey: expect.any(String),
    });
    expect(buttonValue(card, 'agent_tool_cancel_submit')).not.toHaveProperty('arguments');
    expect(buttonValue(card, 'agent_tool_cancel_submit')).not.toHaveProperty('toolName');
  });
});
