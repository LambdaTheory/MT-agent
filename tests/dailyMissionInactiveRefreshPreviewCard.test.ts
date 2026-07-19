import { describe, expect, it } from 'vitest';
import { buildInactiveRefreshPreviewDeck } from '../src/agentRuntime/dailyMissionInactiveRefreshPreviewCard.js';

function cardText(): string {
  return JSON.stringify(buildInactiveRefreshPreviewDeck('2026-07-17').cards);
}

function bodyElements(card: unknown): Array<Record<string, unknown>> {
  return ((card as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? []);
}

function collectElementsByTag(value: unknown, tag: string): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  const current = value as Record<string, unknown>;
  const matches = current.tag === tag ? [current] : [];
  return matches.concat(Object.values(current).flatMap((child) => {
    if (Array.isArray(child)) return child.flatMap((item) => collectElementsByTag(item, tag));
    return collectElementsByTag(child, tag);
  }));
}

describe('daily mission inactive refresh redesigned preview cards', () => {
  it('builds only the accepted scheme B approval card', () => {
    const deck = buildInactiveRefreshPreviewDeck('2026-07-17');
    const text = JSON.stringify(deck.cards);

    expect(deck.cards).toHaveLength(1);
    expect(text).toContain('方案 B｜标准指标');
    expect(text).not.toContain('方案 A｜极简摘要');
    expect(text).not.toContain('方案 C｜审计详情');
    expect(text).not.toContain('失活刷新异常复核卡');
  });

  it('shows a compact decision first screen with executable group-share pie chart and diff summary', () => {
    const [card] = buildInactiveRefreshPreviewDeck('2026-07-17').cards;
    const elements = bodyElements(card);
    const text = cardText();
    const chart = elements.find((element) => element.tag === 'chart');
    const chartText = JSON.stringify(chart);

    expect(text).toContain('审批摘要');
    expect(text).toContain('本次只审批下架补链 **12** 条');
    expect(text).toContain('涉及商品组');
    expect(text).not.toContain('候选总览');
    expect(text).not.toContain('执行影响');
    expect(chart).toMatchObject({
      element_id: 'inactive_refresh_group_modification_ratio_chart',
      chart_spec: { type: 'pie', valueField: 'value', categoryField: 'label' },
    });
    expect(chartText).toContain('本次下架补链商品占比（共 12 条）');
    expect(chartText).toContain('Pocket 3');
    expect(chartText).toContain('Canon R50');
    expect(chartText).toContain('R50');
    expect(chartText).not.toContain('人工复核');
    expect(chartText).not.toContain('本次不改');
    expect(text).toContain('修改 Diff 摘要');
  });

  it('folds executable product groups, judgment evidence, and fixed rules behind collapsed panels', () => {
    const [card] = buildInactiveRefreshPreviewDeck('2026-07-17').cards;
    const panels = bodyElements(card).filter((element) => element.tag === 'collapsible_panel');
    const groupPanel = panels.find((panel) => panel.element_id === 'inactive_refresh_groups_summary_standard');
    const groupPanelText = String(((groupPanel?.elements as Array<{ content?: string }> | undefined)?.[0]?.content) ?? '');
    const panelText = JSON.stringify(panels);

    expect(panels).toHaveLength(4);
    expect(panels.every((panel) => panel.expanded === false)).toBe(true);
    expect(panelText).toContain('展开：补链商品组');
    expect(panelText).toContain('展开：判定证据');
    expect(panelText).toContain('展开：数据异常/未执行原因');
    expect(panelText).toContain('展开：固定规则与审计口径');
    expect(groupPanelText).toContain('Pocket 3');
    expect(groupPanelText).toContain('Canon R50');
    expect(groupPanelText).not.toContain('Wide300');
    expect(groupPanelText).not.toContain('active');
    expect(groupPanelText).not.toContain('上限');
    expect(groupPanelText).not.toContain('原因');
    expect(groupPanelText).not.toContain('复核');
    expect(groupPanelText).not.toContain('排除');
    expect(panelText).toContain('候选结构');
    expect(panelText).toContain('双金额为0且访问弱');
  });

  it('offers standard link judgment detail inside folded evidence', () => {
    const text = cardText();

    expect(text).toContain('展开：判定证据（核心指标）');
    expect(text).toContain('曝光日均');
    expect(text).toContain('访问订单金额');
    expect(text).not.toContain('链接年龄');
  });

  it('keeps fixed rules collapsed and includes clarified rules', () => {
    const cards = buildInactiveRefreshPreviewDeck('2026-07-17').cards;
    const panels = cards.flatMap((card) => bodyElements(card).filter((element) => element.tag === 'collapsible_panel'));
    const text = JSON.stringify(panels);

    expect(panels.filter((panel) => JSON.stringify(panel).includes('固定规则')).every((panel) => panel.expanded === false)).toBe(true);
    expect(text).toContain('固定规则');
    expect(text).toContain('链接级负责发现问题，同款组级负责防误伤');
    expect(text).toContain('新链接上线不足 14 天只观察');
    expect(text).toContain('高曝光高访问但金额为 0 归为转化异常');
    expect(text).toContain('每日全局上限 20 条');
  });

  it('uses four horizontal disabled no-op preview buttons and no real execution callbacks', () => {
    const deck = buildInactiveRefreshPreviewDeck('2026-07-17');
    const text = JSON.stringify(deck.cards);
    const [card] = deck.cards;
    const actionBar = bodyElements(card).find((element) => element.element_id === 'daily_mission_inactive_refresh_preview_actions_summary_standard') as { tag?: string; columns?: Array<{ elements?: Array<Record<string, unknown>> }> } | undefined;

    expect(text).toContain('批准可执行项');
    expect(text).toContain('仅低风险');
    expect(text).toContain('转人工复核');
    expect(text).toContain('拒绝本次计划');
    expect(actionBar?.tag).toBe('column_set');
    expect(actionBar?.columns).toHaveLength(4);
    expect(actionBar?.columns?.every((column) => column.elements?.[0]?.tag === 'button')).toBe(true);
    expect(text).toContain('daily_mission_inactive_refresh_preview_noop');
    expect(text).not.toContain('agent_tool_confirm');
    expect(text).not.toContain('operations.refreshActivityExecute');
    for (const card of deck.cards) {
      const names = collectElementsByTag(card, 'button').map((button) => button.name).filter(Boolean);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
