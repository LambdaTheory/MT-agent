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

export interface AgentClarificationCardOptions {
  clarificationRef: string;
  confirmationKey: string;
}

export interface AgentClarificationSelectRef {
  clarificationRef: string;
  candidateIndex: number;
  confirmationKey: string;
}

export interface AgentClarificationCustomRef {
  clarificationRef: string;
  confirmationKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readClarificationRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^clarify_\d+_[a-f0-9]{8,32}$/i.test(trimmed) ? trimmed : null;
}

function readConfirmationKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readCandidateIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function compact(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function optionMarkdown(option: AgentClarificationOption, index: number): string {
  return option.description
    ? `${index + 1}. ${option.label}：${option.description}`
    : `${index + 1}. ${option.label}`;
}

export function buildAgentClarificationCard(request: AgentClarificationRequest, options?: AgentClarificationCardOptions): FeishuCardPayload {
  const optionLines = request.options.map(optionMarkdown).join('\n');
  const baseValue = { clarificationRef: options?.clarificationRef ?? '', confirmationKey: options?.confirmationKey ?? '' };
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
                  ...baseValue,
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
                  ...baseValue,
                  candidateIndex: index,
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
                  ...baseValue,
                },
              }],
            },
          ],
        },
      ],
    },
  };
}

export function parseAgentClarificationSelectRef(value: unknown): AgentClarificationSelectRef | null {
  if (!isRecord(value) || value.action !== 'agent_clarify_select') return null;
  const clarificationRef = readClarificationRef(value.clarificationRef);
  const candidateIndex = readCandidateIndex(value.candidateIndex);
  const confirmationKey = readConfirmationKey(value.confirmationKey);
  if (!clarificationRef || candidateIndex === null || !confirmationKey) return null;
  return { clarificationRef, candidateIndex, confirmationKey };
}

function parseAgentClarificationRef(value: unknown, action: 'agent_clarify_custom' | 'agent_clarify_cancel'): AgentClarificationCustomRef | null {
  if (!isRecord(value) || value.action !== action) return null;
  const clarificationRef = readClarificationRef(value.clarificationRef);
  const confirmationKey = readConfirmationKey(value.confirmationKey);
  if (!clarificationRef || !confirmationKey) return null;
  return { clarificationRef, confirmationKey };
}

export function parseAgentClarificationCustomRef(value: unknown): AgentClarificationCustomRef | null {
  return parseAgentClarificationRef(value, 'agent_clarify_custom');
}

export function parseAgentClarificationCancelRef(value: unknown): AgentClarificationCustomRef | null {
  return parseAgentClarificationRef(value, 'agent_clarify_cancel');
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

export function buildClarifiedMessage(selection: AgentClarificationSelection): string {
  if (selection.label !== '自定义澄清') {
    return selection.selectedMessage;
  }
  return [
    selection.selectedMessage,
    `原始指令：${selection.originalMessage}`,
  ].join('\n');
}
