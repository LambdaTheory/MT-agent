import { describe, expect, it } from 'vitest';
import { collectAgentDelistEvents } from '../src/linkRegistry/delistOperationEvidence.js';

const succeededDelist = {
  planId: 'plan-1',
  at: '2026-07-14T09:00:00.000Z',
  event: 'execution_succeeded',
  toolName: 'rental.delist',
  subject: { kind: 'product' as const, id: '648' },
  metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
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
        metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
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

  it('recognizes successful batch delists only with the existing execution-evidence guards', () => {
    expect(collectAgentDelistEvents([
      { ...succeededDelist, toolName: 'rental.delistBatch', subject: { kind: 'product', id: '649' } },
      { ...succeededDelist, toolName: 'rental.delistBatch', event: 'execution_failed', subject: { kind: 'product', id: '650' } },
      { ...succeededDelist, toolName: 'rental.delistBatch', metadata: { rentalAction: 'delist' }, subject: { kind: 'product', id: '651' } },
      { ...succeededDelist, toolName: 'rental.delistBatch', subject: { kind: 'product', id: 'not-numeric' } },
      { ...succeededDelist, toolName: 'rental.delistBatch', at: 'not-a-date', subject: { kind: 'product', id: '652' } },
    ])).toEqual([{
      internalProductId: '649',
      at: '2026-07-14T09:00:00.000Z',
      toolName: 'rental.delistBatch',
    }]);
  });

  it('rejects legacy delist ledger events without the execution timestamp marker', () => {
    expect(collectAgentDelistEvents([
      {
        ...succeededDelist,
        at: '2026-07-14T00:00:00.000Z',
        metadata: { missionDate: '2026-07-14', rentalAction: 'delist' },
      },
    ])).toEqual([]);
  });
});
