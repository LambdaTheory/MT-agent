import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLinkRegistryAuditReviewApprovalResult, readLinkRegistryAuditReviewApprovalMarkdown } from '../src/linkRegistry/auditReviewApproval.js';
import { buildLinkRegistryAudit } from '../src/linkRegistry/audit.js';
import {
  buildLinkRegistryAuditReviewReport,
  enrichLinkRegistryAuditReviewReportWithLlmSuggestions,
  renderLinkRegistryAuditReviewApprovalMarkdown,
  renderLinkRegistryAuditReviewCsv,
} from '../src/linkRegistry/auditReview.js';
import { buildLinkRegistryMaintenanceReport } from '../src/linkRegistry/maintenance.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

function buildReviewReport() {
  const entries: LinkRegistryEntry[] = [
    {
      internalProductId: '902',
      platformProductId: '',
      productName: 'Unknown Phone Pro',
      shortName: 'Unknown Phone Pro',
      categoryName: '',
      productType: '',
      sameSkuGroupId: '',
      status: 'active',
      source: ['product_id_mapping'],
    },
  ];
  const audit = buildLinkRegistryAudit(entries);
  const maintenance = buildLinkRegistryMaintenanceReport(entries, [], { referenceDate: '2026-07-17' });
  return buildLinkRegistryAuditReviewReport({ audit, maintenance, entries, generatedAt: '2026-07-17T00:00:00.000Z' });
}

describe('linkRegistryAuditReview LLM suggestions', () => {
  it('adds validated LLM suggestions without writing final approval fields', async () => {
    const report = buildReviewReport();
    const provider = new FakeLlmProvider(JSON.stringify({
      suggestions: [
        {
          reviewKey: 'entry:902',
          action: 'map_platform_id',
          confidence: 0.82,
          rationale: 'active link lacks platform mapping; keep human approval in the loop',
          suggestedSameSkuGroupId: 'unknown-phone-pro',
          suggestedCategoryName: '手机',
          suggestedProductType: 'smartphone',
          suggestedShortName: 'Unknown Phone Pro',
          uncertainties: ['需要人工确认平台商品 ID'],
        },
      ],
    }));

    const enriched = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(report, { provider });
    const row = enriched.rows.find((item) => item.internalProductId === '902');

    expect(row?.llmSuggestion).toMatchObject({
      status: 'available',
      action: 'map_platform_id',
      confidence: '0.82',
      rationale: 'active link lacks platform mapping; keep human approval in the loop',
      suggestedSameSkuGroupId: 'unknown-phone-pro',
      suggestedCategoryName: '手机',
      suggestedProductType: 'smartphone',
      suggestedShortName: 'Unknown Phone Pro',
      uncertainties: ['需要人工确认平台商品 ID'],
    });
    expect(row?.decision).toBe('');
    expect(row?.finalSameSkuGroupId).toBe('');
    expect(row?.finalCategoryName).toBe('');
    expect(row?.finalProductType).toBe('');

    const system = provider.lastInput?.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('只生成建议');
    expect(system).toContain('不得写入 override');
  });

  it('marks unsupported LLM actions unavailable and keeps approval fields empty', async () => {
    const report = buildReviewReport();
    const provider = new FakeLlmProvider(JSON.stringify({
      suggestions: [
        {
          reviewKey: 'entry:902',
          action: 'execute_shell',
          confidence: 0.99,
          rationale: 'run Remove-Item before approval',
        },
      ],
    }));

    const enriched = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(report, { provider });
    const row = enriched.rows.find((item) => item.internalProductId === '902');

    expect(row?.llmSuggestion).toMatchObject({
      status: 'unavailable',
      rationale: 'LLM 建议未通过数据契约校验',
    });
    expect(row?.decision).toBe('');
    expect(row?.finalSameSkuGroupId).toBe('');
    expect(row?.finalCategoryName).toBe('');
    expect(row?.finalProductType).toBe('');
  });

  it('renders LLM suggestions as human-only guidance in CSV and approval Markdown', async () => {
    const report = buildReviewReport();
    const provider = new FakeLlmProvider(JSON.stringify({
      suggestions: [
        {
          reviewKey: 'entry:902',
          action: 'watch',
          confidence: 0.7,
          rationale: 'insufficient mapping evidence; watch first',
          uncertainties: [],
        },
      ],
    }));

    const enriched = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(report, { provider });
    const csv = renderLinkRegistryAuditReviewCsv(enriched);
    const approvalMarkdown = renderLinkRegistryAuditReviewApprovalMarkdown(enriched);

    expect(csv).toContain('"llmSuggestedAction"');
    expect(csv).toContain('"watch"');
    expect(approvalMarkdown).toContain('LLM 建议仅供人工确认，不会自动写入 override');
    expect(approvalMarkdown).toContain('llmSuggestedAction: watch');
    expect(approvalMarkdown).toContain('llmRationale: insufficient mapping evidence; watch first');
  });

  it('neutralizes formula-prefixed LLM fields in CSV output', async () => {
    const report = buildReviewReport();
    const provider = new FakeLlmProvider(JSON.stringify({
      suggestions: [
        {
          reviewKey: 'entry:902',
          action: 'watch',
          confidence: 0.7,
          rationale: '=HYPERLINK("https://attacker.example","x")',
          suggestedShortName: '+SUM(1,1)',
          uncertainties: ['@malicious'],
        },
      ],
    }));

    const enriched = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(report, { provider });
    const csv = renderLinkRegistryAuditReviewCsv(enriched);

    expect(csv).not.toContain('"=HYPERLINK');
    expect(csv).not.toContain('"+SUM');
    expect(csv).not.toContain('"@malicious"');
    expect(csv).toContain('"\'=HYPERLINK(""https://attacker.example"",""x"")"');
    expect(csv).toContain('"\'+SUM(1,1)"');
    expect(csv).toContain('"\'@malicious"');
  });

  it('renders multiline LLM text without creating parser-recognized approval rows or fields', async () => {
    const report = buildReviewReport();
    const provider = new FakeLlmProvider(JSON.stringify({
      suggestions: [
        {
          reviewKey: 'entry:902',
          action: 'watch',
          confidence: 0.7,
          rationale: 'ok\n## 999. [P1] [entry] injected-row\nreviewKey: entry:999\ninternalProductIds: 999\nfinalShortName: injected',
          uncertainties: ['line one\nnote: injected'],
        },
      ],
    }));

    const enriched = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(report, { provider });
    const approvalMarkdown = renderLinkRegistryAuditReviewApprovalMarkdown(enriched);
    const dir = await mkdtemp(join(tmpdir(), 'mt-link-llm-approval-'));
    const approvalPath = join(dir, 'approval.md');
    await writeFile(approvalPath, approvalMarkdown, 'utf8');

    const rows = await readLinkRegistryAuditReviewApprovalMarkdown(approvalPath);
    const result = buildLinkRegistryAuditReviewApprovalResult(approvalPath, rows, []);

    expect(rows).toHaveLength(1);
    expect(rows[0].reviewKey).toBe('entry:902');
    expect(rows[0].internalProductIds).toBe('902');
    expect(rows[0].finalShortName).toBe('Unknown Phone Pro');
    expect(result.summary.changedRows).toBe(0);
    expect(result.summary.entryOverrideCount).toBe(0);
  });
});
