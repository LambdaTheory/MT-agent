import { describe, expect, it } from 'vitest';
import { collectAgentDelistEvents } from '../src/linkRegistry/delistOperationEvidence.js';

const succeededDelist = {
  planId: 'plan-1',
  at: '2026-07-14T09:00:00.000Z',
  event: 'execution_succeeded',
  toolName: 'rental.delist',
  subject: { kind: 'product' as const, id: '648' },
};

describe('collectAgentDelistEvents', () => {
  it('keeps only successful direct delists for numeric product subjects', () => {
    expect(collectAgentDelistEvents([
      succeededDelist,
      { ...succeededDelist, at: '2026-07-14T09:01:00.000Z', event: 'execution_started' },
      { ...succeededDelist, at: '2026-07-14T09:02:00.000Z', event: 'execution_failed' },
      { ...succeededDelist, at: 'not-a-date' },
      { ...succeededDelist, subject: { kind: 'sameSkuGroup' as const, id: 'group-a' } },
    ])).toEqual([{
      internalProductId: '648',
      at: '2026-07-14T09:00:00.000Z',
      toolName: 'rental.delist',
    }]);
  });

  it('recognizes successful generic confirm requests only when metadata records delist', () => {
    expect(collectAgentDelistEvents([
      {
        ...succeededDelist,
        toolName: 'rental.operationConfirmRequest',
        metadata: { rentalAction: 'delist' },
        runId: 'run-1',
        decisionId: 'decision-1',
      },
      {
        ...succeededDelist,
        toolName: 'rental.operationConfirmRequest',
        metadata: { rentalAction: 'copy' },
      },
    ])).toEqual([{
      internalProductId: '648',
      at: '2026-07-14T09:00:00.000Z',
      toolName: 'rental.operationConfirmRequest',
      runId: 'run-1',
      decisionId: 'decision-1',
    }]);
  });
});
