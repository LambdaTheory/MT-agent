import type { DecisionRecord } from './decisionRecord.js';
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
  return Array.isArray(value) ? (value as DecisionRecord[]) : undefined;
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

function invalidResult(steps: ExploreStep[]): ExploreResult {
  return { steps, answer: '', stopReason: 'invalid' };
}

export async function runAgentExploreLoop(input: RunAgentExploreLoopInput): Promise<ExploreResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const steps: ExploreStep[] = [];

  while (steps.length < maxSteps) {
    let action: Record<string, unknown>;
    try {
      const result = await input.provider.generateJson({
        messages: [
          { role: 'system', content: buildSystemPrompt(input.tools) },
          { role: 'user', content: buildUserPrompt(input.instruction, steps) },
        ],
        temperature: 0,
        maxTokens: 1200,
      });
      action = result.json;
    } catch {
      return invalidResult(steps);
    }

    if (action.action === 'finish') {
      const answer = typeof action.answer === 'string' ? action.answer : '';
      const decisions = readDecisions(action.decisions);
      return { steps, answer, ...(decisions ? { decisions } : {}), stopReason: 'answered' };
    }

    if (action.action !== 'call_tool' || typeof action.tool !== 'string') return invalidResult(steps);
    const tool = toolsByName.get(action.tool);
    const args = readArgs(action.args);
    if (!tool || !args) return invalidResult(steps);

    const result = await tool.run(args);
    steps.push({ tool: tool.name, args, result });
  }

  return { steps, answer: '', stopReason: 'max_steps' };
}
