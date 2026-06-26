import { describe, expect, it } from 'vitest';
import {
  buildLinkRegistryGroupReviewApprovalResult,
  readLinkRegistryGroupReviewApprovalCsv,
} from '../src/linkRegistry/groupReviewApproval.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('linkRegistryGroupReviewApproval', () => {
  it('reads approval csv and builds entry overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-group-review-approval-'));
    const csvPath = join(dir, 'approval-2026-06-26.csv');
    await writeFile(csvPath, [
      '\uFEFF"priority","reviewReasons","sameSkuGroupId","currentDisplayName","suggestedShortName","decision","finalShortName","finalSameSkuGroupId","finalCategoryName","finalProductType","note","activeLinkCount","totalLinkCount","categoryName","productType","internalProductIds","aliases","risks"',
      '"P0","机器名待改","dji-pocket-3","dji-pocket-3","Pocket 3","","pocket3","","","","","65","65","","","530、533","dji-pocket-3",""',
      '"P1","机器名待改","fujifilm-instax-mini-evo","fujifilm-instax-mini-evo","Mini Evo","","mini evo","","","","","1","1","","","","fujifilm-instax-mini-evo",""',
    ].join('\n'), 'utf8');

    const rows = await readLinkRegistryGroupReviewApprovalCsv(csvPath);
    const result = buildLinkRegistryGroupReviewApprovalResult(csvPath, rows, '2026-06-26T08:00:00.000Z');

    expect(result.summary.changedRows).toBe(2);
    expect(result.summary.appliedRows).toBe(1);
    expect(result.summary.skippedRows).toBe(1);
    expect(result.overrides.entries).toEqual([
      expect.objectContaining({ internalProductId: '530', shortName: 'pocket3', aliases: expect.arrayContaining(['pocket3', 'pocket 3']) }),
      expect.objectContaining({ internalProductId: '533', shortName: 'pocket3', aliases: expect.arrayContaining(['pocket3', 'pocket 3']) }),
    ]);
  });
});
