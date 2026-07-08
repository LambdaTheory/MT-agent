import { describe, expect, it } from 'vitest';
import {
  buildAgentClarificationCard,
  parseAgentClarificationCancelRef,
  parseAgentClarificationCustomRef,
  parseAgentClarificationSelectRef,
} from '../src/agentRuntime/clarificationCard.js';

function buttonValue(card: unknown, name: string): Record<string, unknown> {
  const raw = JSON.stringify(card);
  const values: Record<string, unknown>[] = [];

  JSON.parse(raw, (key: string, value: unknown) => {
    if (key === 'elements' && Array.isArray(value)) {
      for (const element of value) {
        if (element && typeof element === 'object' && 'name' in element && element.name === name) {
          const behavior = Array.isArray(element.behaviors) ? element.behaviors[0] : undefined;
          if (behavior && typeof behavior === 'object' && 'value' in behavior && behavior.value && typeof behavior.value === 'object') {
            values.push(behavior.value as Record<string, unknown>);
          }
        }
      }
    }
    return value;
  });

  const value = values[0];
  if (!value) throw new Error(`button not found: ${name}`);
  return value;
}

describe('clarification card reference payloads', () => {
  it('builds select/custom/cancel buttons with signed clarification refs instead of selected text', () => {
    const card = buildAgentClarificationCard({
      originalMessage: '帮我处理一下 pocket3',
      question: '你想怎么处理 pocket3？',
      reason: '用户目标不明确',
      options: [
        { label: '查询数据', message: '查询 pocket3 的公域数据', description: '只读查询' },
        { label: '铺新链', message: '帮我铺十条 pocket3 的新链', description: '需要确认' },
      ],
    }, { clarificationRef: 'clarify_1_deadbeef', confirmationKey: '0123456789abcdef01234567' });

    const raw = JSON.stringify(card);
    expect(raw).toContain('agent_clarify_select');
    expect(raw).not.toContain('selectedMessage');
    expect(raw).not.toContain('帮我铺十条 pocket3 的新链');

    expect(buttonValue(card, 'agent_clarify_select_1')).toEqual({
      action: 'agent_clarify_select',
      clarificationRef: 'clarify_1_deadbeef',
      candidateIndex: 0,
      confirmationKey: '0123456789abcdef01234567',
    });
    expect(buttonValue(card, 'agent_clarify_custom')).toEqual({
      action: 'agent_clarify_custom',
      clarificationRef: 'clarify_1_deadbeef',
      confirmationKey: '0123456789abcdef01234567',
    });
    expect(buttonValue(card, 'agent_clarify_cancel')).toEqual({
      action: 'agent_clarify_cancel',
      clarificationRef: 'clarify_1_deadbeef',
      confirmationKey: '0123456789abcdef01234567',
    });
  });

  it('parses signed clarification selection refs', () => {
    expect(parseAgentClarificationSelectRef({
      action: 'agent_clarify_select',
      clarificationRef: 'clarify_1_deadbeef',
      candidateIndex: 1,
      confirmationKey: '0123456789abcdef01234567',
    })).toEqual({ clarificationRef: 'clarify_1_deadbeef', candidateIndex: 1, confirmationKey: '0123456789abcdef01234567' });

    expect(parseAgentClarificationCustomRef({
      action: 'agent_clarify_custom',
      clarificationRef: 'clarify_1_deadbeef',
      confirmationKey: '0123456789abcdef01234567',
    })).toEqual({ clarificationRef: 'clarify_1_deadbeef', confirmationKey: '0123456789abcdef01234567' });

    expect(parseAgentClarificationCancelRef({
      action: 'agent_clarify_cancel',
      clarificationRef: 'clarify_1_deadbeef',
      confirmationKey: '0123456789abcdef01234567',
    })).toEqual({ clarificationRef: 'clarify_1_deadbeef', confirmationKey: '0123456789abcdef01234567' });

    expect(parseAgentClarificationSelectRef({
      action: 'agent_clarify_select',
      clarificationRef: 'clarify_1_deadbeef',
      candidateIndex: -1,
      confirmationKey: '0123456789abcdef01234567',
    })).toBeNull();
  });
});
