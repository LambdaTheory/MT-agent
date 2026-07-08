import { isValidDecisionRecord, type DecisionRecord } from './decisionRecord.js';
import type { LlmProvider } from '../llm/provider.js';

export interface ExploreTool {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

export interface ExploreStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ExploreResult {
  steps: ExploreStep[];
  answer: string;
  decisions?: DecisionRecord[];
  stopReason: 'answered' | 'max_steps' | 'invalid';
  invalidReason?: 'non_json' | 'unknown_action' | 'unknown_tool' | 'bad_args' | 'tool_error' | 'invalid_finish';
  rawFirstOutput?: string;
}

export interface RunAgentExploreLoopInput {
  provider: LlmProvider;
  instruction: string;
  tools: ExploreTool[];
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArgs(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readDecisions(value: unknown): DecisionRecord[] | undefined {
  return Array.isArray(value) && value.every(isValidDecisionRecord) ? value : undefined;
}

interface FinishAction extends Record<string, unknown> {
  action: 'finish';
  answer: string;
  decisions?: DecisionRecord[];
}

function hasValidFinishPayload(action: Record<string, unknown>): action is FinishAction {
  return typeof action.answer === 'string'
    && (action.decisions === undefined || readDecisions(action.decisions) !== undefined);
}

function buildSystemPrompt(tools: ExploreTool[]): string {
  return [
    '你是 MT-agent 的只读探索 loop。只能从用户给出的工具清单中选择工具。',
    '每次只输出一个 JSON 对象，不要输出 Markdown 或解释文字。',
    '调用工具时输出 {"action":"call_tool","tool":"工具名","args":{}}。',
    '完成探索时输出 {"action":"finish","answer":"结论","decisions":[]}，decisions 可省略。',
    '可用只读工具：',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join('\n');
}

function buildUserPrompt(instruction: string, steps: ExploreStep[]): string {
  return JSON.stringify({ instruction, steps });
}

function truncatedRawOutput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 300 ? value.slice(0, 300) : value;
}

function invalidResult(steps: ExploreStep[], invalidReason: NonNullable<ExploreResult['invalidReason']>, rawFirstOutput?: string): ExploreResult {
  return { steps, answer: '', stopReason: 'invalid', invalidReason, ...(steps.length === 0 && rawFirstOutput ? { rawFirstOutput: truncatedRawOutput(rawFirstOutput) } : {}) };
}

function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1)) as unknown;
          return isRecord(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function resolveAction(json: Record<string, unknown>, text: string): Record<string, unknown> | null {
  if (typeof json.action === 'string') return json;
  return parseFirstJsonObject(text);
}

export async function runAgentExploreLoop(input: RunAgentExploreLoopInput): Promise<ExploreResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const steps: ExploreStep[] = [];

  while (steps.length < maxSteps) {
    let action: Record<string, unknown>;
    let rawOutput: string | undefined;
    try {
      const result = await input.provider.generateJson({
        messages: [
          { role: 'system', content: buildSystemPrompt(input.tools) },
          { role: 'user', content: buildUserPrompt(input.instruction, steps) },
        ],
        temperature: 0,
        maxTokens: 1200,
      });
      rawOutput = result.text;
      const resolved = resolveAction(result.json, result.text);
      if (!resolved) return invalidResult(steps, 'non_json', rawOutput);
      action = resolved;
    } catch {
      return invalidResult(steps, 'non_json', rawOutput);
    }

    if (action.action === 'finish') {
      if (!hasValidFinishPayload(action)) return invalidResult(steps, 'invalid_finish', rawOutput);
      const answer = action.answer;
      const decisions = action.decisions;
      return { steps, answer, ...(decisions ? { decisions } : {}), stopReason: 'answered' };
    }

    if (action.action !== 'call_tool' || typeof action.tool !== 'string') return invalidResult(steps, 'unknown_action', rawOutput);
    const tool = toolsByName.get(action.tool);
    const args = readArgs(action.args);
    if (!tool) return invalidResult(steps, 'unknown_tool', rawOutput);
    if (!args) return invalidResult(steps, 'bad_args', rawOutput);

    let result: unknown;
    try {
      result = await tool.run(args);
    } catch {
      return invalidResult(steps, 'tool_error', rawOutput);
    }
    steps.push({ tool: tool.name, args, result });
  }

  return { steps, answer: '', stopReason: 'max_steps' };
}
