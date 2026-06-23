import type { LinkRegistryAudit, LinkRegistryAuditRiskType, LinkRegistryCategoryAudit } from '../linkRegistry/audit.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

const OVERRIDE_RISK_TYPES = new Set<LinkRegistryAuditRiskType>([
  'duplicate_manual_assignment',
  'duplicate_short_name_rule',
  'duplicate_same_sku_group_alias_rule',
  'unknown_internal_product_id',
  'unknown_same_sku_group_id',
  'malformed_override',
  'disabled_override',
]);

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function metricCard(label: string, value: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '8px',
    elements: [{ tag: 'markdown', content: `${label}\n**${value}**`, text_align: 'center' }],
  };
}

function metricRow(metrics: Array<[string, string]>, elementId: string): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: elementId,
    flex_mode: 'bisect',
    horizontal_spacing: '8px',
    columns: metrics.map(([label, value]) => metricCard(label, value)),
  };
}

function countProductTypes(audit: LinkRegistryAudit): number {
  return audit.categories.reduce((sum, category) => sum + category.productTypes.filter((item) => item.productType !== 'unknown').length, 0);
}

function countClassifiedEntries(audit: LinkRegistryAudit): number {
  return audit.total - audit.unknownEntries.length;
}

function coveragePercent(audit: LinkRegistryAudit): string {
  if (audit.total === 0) return '0%';
  return `${Math.round((countClassifiedEntries(audit) / audit.total) * 100)}%`;
}

function countCategories(audit: LinkRegistryAudit): number {
  return audit.categories.filter((category) => category.categoryId !== 'unknown').length;
}

function countRisks(audit: LinkRegistryAudit, type: LinkRegistryAuditRiskType | Set<LinkRegistryAuditRiskType>): number {
  if (type instanceof Set) return audit.risks.filter((risk) => type.has(risk.type)).length;
  return audit.risks.filter((risk) => risk.type === type).length;
}

function categoryLabel(category: LinkRegistryCategoryAudit): string {
  return category.categoryName?.trim() || category.categoryId;
}

function categoryLines(audit: LinkRegistryAudit, limit = 5): string {
  const rows = audit.categories
    .filter((category) => category.categoryId !== 'unknown')
    .sort((left, right) => right.total - left.total || categoryLabel(left).localeCompare(categoryLabel(right)))
    .slice(0, limit)
    .map((category, index) => `${index + 1}. ${categoryLabel(category)}｜active ${category.active}｜removed ${category.removed}｜unknown ${category.unknown}｜total ${category.total}`);
  return rows.join('\n') || '暂无已分类品类。';
}

function entryLabel(entry: LinkRegistryEntry): string {
  return `${entry.internalProductId} ${entry.shortName?.trim() || entry.productName?.trim() || '未命名商品'}`.trim();
}

function findEntry(audit: LinkRegistryAudit, internalProductId: string): LinkRegistryEntry | undefined {
  return audit.unknownEntries.find((entry) => entry.internalProductId === internalProductId)
    ?? audit.sameSkuGroups.flatMap((group) => group.entries).find((entry) => entry.internalProductId === internalProductId);
}

function focusLines(audit: LinkRegistryAudit): string {
  const lines: string[] = [];
  for (const entry of audit.unknownEntries.slice(0, 3)) {
    lines.push(`- 未分类：${entryLabel(entry)}`);
  }

  const missingMappingIds = [...new Set(
    audit.risks
      .filter((risk) => risk.type === 'platform_id_mapping_missing' && risk.internalProductId)
      .map((risk) => risk.internalProductId as string),
  )];
  for (const internalProductId of missingMappingIds.slice(0, 3)) {
    const entry = findEntry(audit, internalProductId);
    lines.push(`- 缺平台ID：${entry ? entryLabel(entry) : internalProductId}`);
  }

  for (const group of audit.sameSkuGroups.filter((item) => item.sampleInsufficient).slice(0, 3)) {
    lines.push(`- 同款组样本不足：${group.sameSkuGroupId}（${group.sampleSize} 条）`);
  }

  return lines.join('\n') || '当前没有高优先级待处理项。';
}

function sameSkuGroupLines(audit: LinkRegistryAudit, limit = 5): string {
  return audit.sameSkuGroups
    .slice()
    .sort((left, right) => right.sampleSize - left.sampleSize || (left.sameSkuGroupId ?? '').localeCompare(right.sameSkuGroupId ?? ''))
    .slice(0, limit)
    .map((group, index) => {
      const label = group.entries[0]?.shortName?.trim() || group.entries[0]?.productName?.trim() || group.sameSkuGroupId;
      const status = group.sampleInsufficient ? `样本不足 ${group.sampleSize} 条` : `${group.sampleSize} 条`;
      return `${index + 1}. ${label}｜${group.sameSkuGroupId}｜${status}`;
    })
    .join('\n') || '暂无同款组样本。';
}

export function formatLinkRegistryOverviewText(audit: LinkRegistryAudit): string {
  return `库存情况：总链接 ${audit.total}，active ${audit.active}，removed ${audit.removed}，unknown ${audit.unknown}；分类覆盖 ${coveragePercent(audit)}；同款组 ${audit.sameSkuGroups.length} 个；风险 ${audit.risks.length} 项。`;
}

export function buildLinkRegistryOverviewCard(audit: LinkRegistryAudit): FeishuCardPayload {
  const sampleInsufficientCount = audit.sameSkuGroups.filter((group) => group.sampleInsufficient).length;
  const manualGroupCount = audit.sameSkuGroups.filter((group) => group.manual).length;
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '库存情况' },
      template: audit.risks.length > 0 ? 'orange' : 'green',
    },
    body: {
      elements: [
        metricRow([
          ['总链接', String(audit.total)],
          ['active', String(audit.active)],
          ['removed', String(audit.removed)],
          ['unknown', String(audit.unknown)],
        ], 'link_registry_inventory_status'),
        metricRow([
          ['分类覆盖', coveragePercent(audit)],
          ['品类数', String(countCategories(audit))],
          ['同款组', String(audit.sameSkuGroups.length)],
          ['风险数', String(audit.risks.length)],
        ], 'link_registry_inventory_coverage'),
        markdown(`产品类型 ${countProductTypes(audit)}｜手工覆盖组 ${manualGroupCount}｜样本不足组 ${sampleInsufficientCount}`),
        { tag: 'hr' },
        markdown(`**风险概览**
未分类 ${audit.unknownEntries.length}｜缺平台ID ${countRisks(audit, 'platform_id_mapping_missing')}｜Alias 冲突 ${countRisks(audit, 'alias_duplicate_hit')}｜Override 风险 ${countRisks(audit, OVERRIDE_RISK_TYPES)}`),
        markdown(`**品类分布**
${categoryLines(audit)}`),
        markdown(`**重点同款组**
${sameSkuGroupLines(audit)}`),
        markdown(`**待处理样本**
${focusLines(audit)}`),
      ],
    },
  };
}
