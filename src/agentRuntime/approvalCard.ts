import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findAgentTool } from './toolRegistry.js';
import { validateAgentToolArguments } from './planner.js';

export interface AgentToolConfirmRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function buildAgentToolConfirmCard(request: AgentToolConfirmRequest): FeishuCardPayload {
  const tool = findAgentTool(request.toolName);
  const title = tool?.description ?? request.toolName;
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'Agent 操作确认' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**是否要执行：${title}？**`,
            '',
            `工具：${request.toolName}`,
            `参数：${compactJson(request.arguments)}`,
            `LLM 理解原因：${request.reason}`,
          ].join('\n'),
        },
        {
          tag: 'form',
          name: 'agent_tool_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认执行' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'agent_tool_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'agent_tool_confirm', request } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'agent_tool_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', toolName: request.toolName } }],
            },
          ],
        },
      ],
    },
  };
}

export function parseAgentToolConfirmRequest(value: unknown): AgentToolConfirmRequest | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  const toolName = readString(request.toolName);
  const reason = readString(request.reason);
  const args = request.arguments;
  if (!toolName || !reason || !isRecord(args)) return null;
  if (!findAgentTool(toolName) || !validateAgentToolArguments(toolName, args)) return null;
  return { toolName, arguments: args, reason };
}
