import { describe, expect, it } from 'vitest';
import { buildReadOnlyExploreTools } from '../src/agentRuntime/exploreToolset.js';

describe('buildReadOnlyExploreTools', () => {
  it('includes planner-visible read tools and excludes write tools', () => {
    const tools = buildReadOnlyExploreTools('output');
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('system.help');
    expect(names).toContain('product.query');
    expect(names).toContain('rental.readRaw');
    expect(names).toContain('publicTraffic.windowedFindings');
    expect(names).not.toContain('linkRegistry.maintenancePrompt');
    expect(names).not.toContain('linkRegistry.governancePrompt');
    expect(names).not.toContain('linkRegistry.maintenanceHub');
    expect(names).not.toContain('operations.refreshActivityPlan');
    expect(names).not.toContain('operationsLearning.startQuiz');
    expect(names).not.toContain('activity.differentialPricingCard');
    expect(names).not.toContain('activity.cancelDifferentialPricingCard');
    expect(names).not.toContain('productId.lookupCard');
    expect(names).not.toContain('rental.delist');
    expect(names).not.toContain('rental.priceApply');
    expect(names).not.toContain('operations.refreshActivityExecute');
  });

  it('runs wrapped tools through the existing executor', async () => {
    const tools = buildReadOnlyExploreTools('output');
    const help = tools.find((tool) => tool.name === 'system.help');

    const result = await help?.run({});

    expect(result).toMatchObject({ text: expect.stringContaining('可用能力概览') });
  });
});
