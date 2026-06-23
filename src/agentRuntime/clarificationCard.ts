import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface AgentClarificationOption {
  label: string;
  message: string;
  description?: string;
}

export interface AgentClarificationRequest {
  originalMessage: string;
  question: string;
  options: AgentClarificationOption[];
  reason: string;
}

export interface AgentClarificationSelection {
  originalMessage: string;
  selectedMessage: string;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compact(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function optionMarkdown(option: AgentClarificationOption, index: number): string {
  return option.description
    ? `${index + 1}. ${option.label}：${option.description}`
    : `${index + 1}. ${option.label}`;
}

export function buildAgentClarificationCard(request: AgentClarificationRequest): FeishuCardPayload {
  const optionLines = request.options.map(optionMarkdown).join('\n');
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'Agent 需要确认你的意图' }, template: 'blue' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**${request.question}**`,
            '',
            `原始指令：${compact(request.originalMessage, 160)}`,
            `判断原因：${compact(request.reason, 160)}`,
            '',
            optionLines,
          ].join('\n'),
        },
        {
          tag: 'form',
          name: 'agent_clarification_form',
          elements: [
            {
              tag: 'input',
              element_id: 'agent_clarification_custom_message',
              name: 'custom_message',
              label: { tag: 'plain_text', content: '补充说明（可选）' },
              label_position: 'top',
              placeholder: { tag: 'plain_text', content: '也可以直接输入你真正想让我做什么' },
              input_type: 'text',
              max_length: 300,
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '按输入继续' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'agent_clarify_custom',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'agent_clarify_custom',
                  originalMessage: request.originalMessage,
                },
              }],
            },
            ...request.options.map((option, index) => ({
              tag: 'button',
              text: { tag: 'plain_text', content: compact(option.label, 20) },
              type: 'default',
              form_action_type: 'submit',
              name: `agent_clarify_select_${index + 1}`,
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'agent_clarify_select',
                  originalMessage: request.originalMessage,
                  selectedMessage: option.message,
                  label: option.label,
                },
              }],
            })),
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'agent_clarify_cancel',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'agent_clarify_cancel',
                  originalMessage: request.originalMessage,
                },
              }],
            },
          ],
        },
      ],
    },
  };
}

export function parseAgentClarificationSelection(value: unknown): AgentClarificationSelection | null {
  if (!isRecord(value) || value.action !== 'agent_clarify_select') return null;
  const originalMessage = readString(value.originalMessage);
  const selectedMessage = readString(value.selectedMessage);
  const label = readString(value.label);
  if (!originalMessage || !selectedMessage || !label) return null;
  if (selectedMessage.length > 300 || label.length > 40) return null;
  return { originalMessage, selectedMessage, label };
}

export function parseAgentClarificationCustomSelection(value: unknown, customMessage: unknown): AgentClarificationSelection | null {
  if (!isRecord(value) || value.action !== 'agent_clarify_custom') return null;
  const originalMessage = readString(value.originalMessage);
  const selectedMessage = readString(customMessage);
  if (!originalMessage || !selectedMessage || selectedMessage.length > 300) return null;
  return { originalMessage, selectedMessage, label: '自定义澄清' };
}
