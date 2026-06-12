import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agent data types source', () => {
  it('exports stable Agent query type names', () => {
    const source = readFileSync('src/agentData/types.ts', 'utf8');
    expect(source).toContain('export interface AgentOverviewAnswer');
    expect(source).toContain('export interface AgentProductAnswer');
    expect(source).toContain('export interface AgentTaskItem');
    expect(source).toContain('export type AgentIntent');
  });
});
