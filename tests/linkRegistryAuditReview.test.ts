import { describe, expect, it } from 'vitest';
import { buildLinkRegistryAudit } from '../src/linkRegistry/audit.js';
import {
  buildLinkRegistryAuditReviewReport,
  renderLinkRegistryAuditReviewApprovalMarkdown,
  renderLinkRegistryAuditReviewCsv,
} from '../src/linkRegistry/auditReview.js';
import { buildLinkRegistryMaintenanceReport } from '../src/linkRegistry/maintenance.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

describe('linkRegistryAuditReview', () => {
  it('builds review rows from maintenance queue', () => {
    const entries: LinkRegistryEntry[] = [
      {
        internalProductId: '901',
        platformProductId: 'p901',
        productName: 'DJI Pocket 3',
        shortName: 'Pocket 3',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'gimbal-camera',
        sameSkuGroupId: 'dji-pocket-3',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '902',
        platformProductId: 'p902',
        productName: 'Unknown',
        status: 'active',
        source: ['product_id_mapping'],
      },
    ];

    const audit = buildLinkRegistryAudit(entries);
    const maintenance = buildLinkRegistryMaintenanceReport(entries, [], { referenceDate: '2026-06-26' });
    const report = buildLinkRegistryAuditReviewReport({ audit, maintenance, entries, generatedAt: '2026-06-26T00:00:00.000Z' });
    expect(report.summary.totalRows).toBeGreaterThan(0);
    expect(report.rows.some((row) => row.internalProductId === '902')).toBe(true);
    const csv = renderLinkRegistryAuditReviewCsv(report);
    const approvalMarkdown = renderLinkRegistryAuditReviewApprovalMarkdown(report);
    expect(csv).toContain('"internalProductId"');
    expect(csv).toContain('"902"');
    expect(csv).toContain('"originalProductName"');
    expect(approvalMarkdown).toContain('# 链接档案审计审批单（Markdown 填写版）');
    expect(approvalMarkdown).toContain('reviewKey: entry:902');
    expect(approvalMarkdown).toContain('originalProductName: Unknown');
    expect(approvalMarkdown).toContain('decision: ');
  });
});
