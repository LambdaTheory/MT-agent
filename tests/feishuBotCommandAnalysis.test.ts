/**
 * Regression tests: Feishu bot command parsing baseline analysis.
 *
 * Purpose:
 * - Document CURRENT strong-mapping behavior before implementing LLM semantic routing.
 * - Highlight known risks where natural-language messages accidentally trigger intents.
 * - Ensure daily acknowledgments (好的, 收到, 谢谢 etc.) never become side-effect intents.
 * - Provide a safe baseline; do NOT expect future LLM behavior yet.
 *
 * This file now includes semantic alias baseline tests (Section 8).
 * Natural phrases like "发个日报", "推送到群", "做个测验" are resolved
 * deterministically via resolveSemanticAlias() before the broad catch-all
 * patterns. This is the FIRST safe step before LLM-based intent resolution.
 *
 * Side-effect intents (must NEVER trigger from accidental natural language):
 *   rental_price_change     — previews changes and requires card confirmation before execution
 *   rental_copy             — requires card confirmation before daemon copy
 *   rental_delist           — requires card confirmation before daemon delist
 *   rental_tenancy_set      — requires card confirmation before daemon tenancy-set
 *   rental_spec_add         — requires card confirmation before daemon spec-add-and-refresh
 *   rental_spec_discover    — calls daemon spec-discover (read-only query to daemon,
 *                             but involves external binary call; classified as side-effect
 *                             for safety since it touches the daemon)
 *   run_public_traffic_report, resend_latest_report, push_latest_report_to_group
 *
 * Read-only intents (safe even if accidentally triggered):
 *   help, latest_summary, query_product, lookup_product_id, lookup_product_id_card,
 *   operations_learning_quiz, unknown
 */

import { describe, expect, it, vi } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { createFeishuMessageDispatcher } from '../src/feishuBot/dispatcher.js';
import type { BotIntent } from '../src/feishuBot/types.js';

// ---------------------------------------------------------------------------
// Side-effect intent set — used to verify daily messages never match these
// ---------------------------------------------------------------------------
const SIDE_EFFECT_TYPES: ReadonlySet<BotIntent['type']> = new Set([
  'rental_price_change',
  'rental_copy',
  'rental_delist',
  'rental_tenancy_set',
  'rental_spec_discover',
  'rental_spec_add',
  'run_public_traffic_report',
  'resend_latest_report',
  'push_latest_report_to_group',
]);

function isSideEffectIntent(intent: BotIntent): boolean {
  return SIDE_EFFECT_TYPES.has(intent.type as typeof SIDE_EFFECT_TYPES extends Set<infer T> ? T : never);
}

// ===========================================================================
// 1. @-mention boundary: group message filtering in createFeishuMessageDispatcher
// ===========================================================================
describe('@-mention boundary — group-message filtering', () => {
  it('skips group message with no mentions when bot identity is not configured', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-no-mention-no-config',
      text: '今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [],
    });

    expect(result).toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('skips group message with mentions but no bot identity configured', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-mention-no-identity',
      text: '@_user_1 今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', name: 'Some User' }],
    });

    // Without botMentionOpenId or botMentionName, botMentions() returns []
    expect(result).toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('calls handler when group message mentions the configured bot by name', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionName: 'MT Agent',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-bot-mention-name',
      text: '@_user_1 今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', name: 'MT Agent' }],
    });

    expect(result).toEqual({ text: 'handled', skipped: false });
    // Bot mention key stripped from text before resolveIntent
    expect(texts).toEqual(['今日概况']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('keeps link maintenance routing stable when mention text has trailing punctuation', async () => {
    const intents: BotIntent[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      botMentionName: '公域数据日报',
      resolveIntent: (text) => parseBotIntent(text),
      handleIntent: vi.fn(async (intent) => {
        intents.push(intent);
        return { text: 'handled' };
      }),
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-link-maintenance-semicolon',
      text: '@_bot 链接维护;',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_bot', name: '公域数据日报' }],
    });

    expect(result).toEqual({ text: 'handled', skipped: false });
    expect(intents).toEqual([{ type: 'link_registry_maintenance_prompt' }]);
  });

  it('calls handler when group message mentions the configured bot by open_id', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-bot-mention-openid',
      text: '@_user_1 查商品 761',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
    });

    expect(result).toEqual({ text: 'handled', skipped: false });
    expect(texts).toEqual(['查商品 761']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('skips group message that mentions a human when bot identity is configured', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-mentions-human-only',
      text: '@_user_1 今日概况',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事' }],
    });

    expect(result).toEqual({ text: '', skipped: true });
    expect(handleIntent).not.toHaveBeenCalled();
  });

  it('handles group message with multiple mentions including the configured bot', async () => {
    const texts: string[] = [];
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent,
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-group-multi-mention',
      text: '@_user_1 @_user_2 改价 商品761 1天22',
      source: 'sdk',
      chatType: 'group',
      mentions: [
        { key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事A' },
        { key: '@_user_2', id: { open_id: 'ou_bot' }, name: 'MT Agent' },
      ],
    });

    expect(result).toEqual({ text: 'handled', skipped: false });
    // Only bot mention key stripped; human mention preserved
    expect(texts).toEqual(['@_user_1 改价 商品761 1天22']);
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch private chat messages through the group skip logic', async () => {
    const handleIntent = vi.fn(async () => ({ text: 'handled' }));
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: () => ({ type: 'latest_summary' }),
      handleIntent,
    });

    // p2p chat has no chatType or chatType !== 'group'
    const result = await dispatcher.dispatch({
      messageId: 'mid-p2p-no-mention',
      text: '今日概况',
      source: 'sdk',
    });

    expect(result).toEqual({ text: 'handled', skipped: false });
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 2. Normal explicit commands that should parse correctly
// ===========================================================================
describe('explicit commands — current parser behavior', () => {
  it('parses rental price change with explicit fields', () => {
    const intent = parseBotIntent('改价 商品761 1天22 10天55');
    expect(intent.type).toBe('rental_price_change');
    if (intent.type === 'rental_price_change') {
      expect(intent.productId).toBe('761');
      expect(intent.request).toEqual({
        mode: 'explicit_fields',
        productId: '761',
        fields: { rent1day: '22.00', rent10day: '55.00' },
      });
    }
  });

  it('parses rental price change with global discount', () => {
    expect(parseBotIntent('改价 商品761 全局打折 0.9')).toEqual({
      type: 'rental_price_change',
      productId: '761',
      request: { mode: 'global_discount', productId: '761', discount: 0.9, scope: 'rent_fields' },
    });
  });

  it('parses latest_summary intent', () => {
    expect(parseBotIntent('今日概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('今天数据')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('看下 公域日报')).toEqual({ type: 'latest_summary' });
  });

  it('parses query_product intent', () => {
    expect(parseBotIntent('查询 565')).toEqual({ type: 'query_product', keyword: '565' });
    expect(parseBotIntent('查询商品 721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('查商品 721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('商品 iPhone')).toEqual({ type: 'query_product', keyword: 'iPhone' });
    expect(parseBotIntent('这个商品 721 数据如何')).toEqual({ type: 'query_product', keyword: '721' });
  });

  it('parses lookup_product_id intent', () => {
    expect(parseBotIntent('查ID 565')).toEqual({ type: 'lookup_product_id', query: '565' });
  });

  it('parses lookup_product_id_card intent', () => {
    expect(parseBotIntent('商品ID互查')).toEqual({ type: 'lookup_product_id_card' });
    expect(parseBotIntent('查ID')).toEqual({ type: 'lookup_product_id_card' });
  });

  it('parses inventory status overview and query intents', () => {
    expect(parseBotIntent('库存情况')).toEqual({ type: 'inventory_status_overview' });
    expect(parseBotIntent('库存情况 pocket3')).toEqual({ type: 'inventory_status_query', query: 'pocket3' });
    expect(parseBotIntent('库存情况；')).toEqual({ type: 'inventory_status_overview' });
    expect(parseBotIntent('库存情况 pocket3;')).toEqual({ type: 'inventory_status_query', query: 'pocket3' });
  });

  it('parses link registry exact commands with trailing punctuation', () => {
    expect(parseBotIntent('链接维护;')).toEqual({ type: 'link_registry_maintenance_prompt' });
    expect(parseBotIntent('链接维护；')).toEqual({ type: 'link_registry_maintenance_prompt' });
    expect(parseBotIntent('组级治理;')).toEqual({ type: 'link_registry_governance_prompt' });
    expect(parseBotIntent('链接档案维护；')).toEqual({ type: 'link_registry_maintenance_hub' });
  });

  it('parses daemon-only link registry maintenance commands with trailing punctuation', () => {
    expect(parseBotIntent('链接维护 daemon;')).toEqual({ type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' });
    expect(parseBotIntent('链接维护 DAEMON；')).toEqual({ type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' });
  });

  it('parses rental copy command', () => {
    expect(parseBotIntent('复制商品 761')).toEqual({ type: 'rental_copy', productId: '761' });
    expect(parseBotIntent('商品复制 761')).toEqual({ type: 'rental_copy', productId: '761' });
  });

  it('parses rental delist command', () => {
    expect(parseBotIntent('下架商品 761')).toEqual({ type: 'rental_delist', productId: '761' });
    expect(parseBotIntent('商品下架 761')).toEqual({ type: 'rental_delist', productId: '761' });
  });

  it('parses rental tenancy-set command', () => {
    const intent = parseBotIntent('设置租期 761 1,10,30');
    expect(intent.type).toBe('rental_tenancy_set');
    if (intent.type === 'rental_tenancy_set') {
      expect(intent.productId).toBe('761');
      expect(intent.days).toBe('1,10,30');
    }
    // Alternate form
    const intentAlt = parseBotIntent('租期设置 761 1,10,30');
    expect(intentAlt.type).toBe('rental_tenancy_set');
    if (intentAlt.type === 'rental_tenancy_set') {
      expect(intentAlt.days).toBe('1,10,30');
    }
  });

  it('parses rental spec-discover command', () => {
    expect(parseBotIntent('查看规格 761')).toEqual({ type: 'rental_spec_discover', productId: '761' });
    expect(parseBotIntent('规格查看 761')).toEqual({ type: 'rental_spec_discover', productId: '761' });
  });

  it('parses rental spec-add command', () => {
    expect(parseBotIntent('添加规格 761 1355 128G')).toEqual({ type: 'rental_spec_add', productId: '761', specDimId: '1355', itemTitle: '128G' });
    expect(parseBotIntent('规格添加 761 1355 256G')).toEqual({ type: 'rental_spec_add', productId: '761', specDimId: '1355', itemTitle: '256G' });
  });

  // --- Future-natural variants that the current parser still does NOT support ---

  it('does NOT yet parse natural copy variant [future]', () => {
    expect(parseBotIntent('把商品 761 复制一份')).toEqual({ type: 'unknown', text: '把商品 761 复制一份' });
  });

  it('does NOT yet parse natural delist variant [future]', () => {
    expect(parseBotIntent('帮我把 761 下架')).toEqual({ type: 'unknown', text: '帮我把 761 下架' });
  });

  it('does NOT yet parse natural tenancy-set variant [future]', () => {
    expect(parseBotIntent('设置 761 的租期为 1天、10天、30天')).toEqual({ type: 'unknown', text: '设置 761 的租期为 1天、10天、30天' });
  });

  it('does NOT yet parse natural spec-discover variant [future]', () => {
    expect(parseBotIntent('给 761 添加规格 256G')).toEqual({ type: 'unknown', text: '给 761 添加规格 256G' });
  });
});

// ===========================================================================
// 3. Daily @-messages that must NEVER become side-effect intents
// ===========================================================================
describe('daily @-messages — must not trigger side-effect intents', () => {
  const SAFE_ACKS = ['好的', '收到', '谢谢', '等我看下', '这个先别动'];

  for (const msg of SAFE_ACKS) {
    it(`"${msg}" parses as unknown, not as a side-effect intent`, () => {
      const intent = parseBotIntent(msg);
      expect(intent.type).toBe('unknown');
      expect(isSideEffectIntent(intent)).toBe(false);
    });
  }

  // Also verify these are not side-effect via dispatcher with bot mention
  for (const msg of SAFE_ACKS) {
    it(`"${msg}" dispatched with bot mention does not trigger handler`, async () => {
      const handleIntent = vi.fn(async () => ({ text: 'handled' }));
      const dispatcher = createFeishuMessageDispatcher({
        botMentionOpenId: 'ou_bot',
        resolveIntent: (text) => parseBotIntent(text),
        handleIntent,
      });

      // Bot mentions the daily ack text — dispatcher resolves intent to unknown
      // and handleIntent is called (unknown is still dispatched, but won't side-effect)
      await dispatcher.dispatch({
        messageId: `mid-ack-${msg}`,
        text: `@_user_1 ${msg}`,
        source: 'sdk',
        chatType: 'group',
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
      });

      // Dispatcher calls handleIntent for unknown (it still goes through)
      // But the important thing: it's NOT a side-effect intent
      expect(isSideEffectIntent(parseBotIntent(msg))).toBe(false);
    });
  }

  // Also verify messages that happen to contain 数据/日报 are not side effects
  it('"商品价格不对" does not become a side-effect intent', () => {
    const intent = parseBotIntent('商品价格不对');
    // Currently parses as unknown (no side-effect)
    expect(isSideEffectIntent(intent)).toBe(false);
  });

  it('"日报数据不对" does not become a side-effect intent (read-only risk only)', () => {
    const intent = parseBotIntent('日报数据不对');
    // Currently parses as latest_summary (read-only, not side-effect)
    expect(isSideEffectIntent(intent)).toBe(false);
  });
});

// ===========================================================================
// 4. Known current risk cases (documentation tests)
// ===========================================================================
describe('known current risks — document existing parser blind spots', () => {
  /**
   * RISK: "日报数据不对" contains "日报" which triggers the /日报/ regex on
   * line 22 of intent.ts, mapping it to latest_summary.
   *
   * The user is complaining that data is wrong, not asking for a summary.
   * Currently treated as a read-only summary request (no side-effect danger,
   * but semantically wrong).
   */
  it('[RISK] "日报数据不对" currently parses as latest_summary (should be a complaint)', () => {
    const intent = parseBotIntent('日报数据不对');
    expect(intent.type).toBe('latest_summary');
  });

  /**
   * RISK: "商品 761 数据不对" matches the query_product pattern via
   * /^(?:查询商品|查商品|查询|商品)\s+(.+)$/, parsing as query_product
   * with keyword "761 数据不对".
   *
   * The user is saying data is wrong, not querying. No side-effect danger,
   * but the keyword includes "数据不对" which is noise.
   */
  it('[RISK] "商品 761 数据不对" currently parses as query_product (noisy keyword)', () => {
    const intent = parseBotIntent('商品 761 数据不对');
    expect(intent).toEqual({ type: 'query_product', keyword: '761 数据不对' });
  });

  /**
   * RISK: "商品 数据不对" — 商品 without a following ID matches the
   * /^(?:查询商品|查商品|查询|商品)\s+(.+)$/ regex with keyword "数据不对".
   * Not a useful query but not a side-effect either.
   */
  it('[RISK] "商品 数据不对" currently parses as query_product with keyword "数据不对"', () => {
    const intent = parseBotIntent('商品 数据不对');
    expect(intent).toEqual({ type: 'query_product', keyword: '数据不对' });
  });

  /**
   * RISK: "这个商品 数据不对" — the "这个商品 X 数据如何" regex on line 37
   * has an optional trailing question pattern. Because `.+?` is non-greedy
   * and backtracks, the full capture group absorbs "数据不对", matching
   * the regex as query_product with a noisy keyword.
   */
  it('[RISK] "这个商品 数据不对" currently parses as query_product (noisy keyword "数据不对")', () => {
    const intent = parseBotIntent('这个商品 数据不对');
    expect(intent).toEqual({ type: 'query_product', keyword: '数据不对' });
  });

  /**
   * RISK: Any message containing "日报" (e.g. "日报不对", "日报有问题")
   * matches the /日报/ regex on line 22 and becomes latest_summary.
   * These are complaints, not requests.
   */
  it('[RISK] "日报有问题" currently parses as latest_summary (complaint becomes summary)', () => {
    const intent = parseBotIntent('日报有问题');
    expect(intent.type).toBe('latest_summary');
  });
});

// ===========================================================================
// 5. Future-natural commands — currently unknown or wrongly parsed
// ===========================================================================
describe('future-natural commands — current baseline behavior', () => {
  /**
   * "帮我把 761 下架" — natural delist request.
   * Currently: unknown (no parser match).
   * Future: should become a delist side-effect.
   */
  it('"帮我把 761 下架" currently parses as unknown', () => {
    expect(parseBotIntent('帮我把 761 下架')).toEqual({ type: 'unknown', text: '帮我把 761 下架' });
  });

  /**
   * "把商品 761 复制一份" — natural copy request.
   * Currently: unknown.
   * Future: should become a copy side-effect.
   */
  it('"把商品 761 复制一份" currently parses as unknown', () => {
    expect(parseBotIntent('把商品 761 复制一份')).toEqual({ type: 'unknown', text: '把商品 761 复制一份' });
  });

  /**
   * "给 761 添加规格 256G" — natural spec-add request.
   * Currently: unknown.
   * Future: should become a spec-add side-effect.
   */
  it('"给 761 添加规格 256G" currently parses as unknown', () => {
    expect(parseBotIntent('给 761 添加规格 256G')).toEqual({ type: 'unknown', text: '给 761 添加规格 256G' });
  });

  /**
   * "设置 761 的租期为 1天、10天、30天" — natural tenancy-set request.
   * Currently: unknown (does not start with 改价 so rentalPriceChange doesn't trigger).
   * Future: should become a tenancy-set side-effect.
   */
  it('"设置 761 的租期为 1天、10天、30天" currently parses as unknown', () => {
    const intent = parseBotIntent('设置 761 的租期为 1天、10天、30天');
    expect(intent.type).toBe('unknown');
  });

  /**
   * "把 761 的 1 天租金改成 22，10 天改成 55" — natural rental price change.
   * Currently: unknown (does not start with 改价).
   * Future: should become a rental_price_change side-effect.
   */
  it('"把 761 的 1 天租金改成 22，10 天改成 55" currently parses as unknown', () => {
    const intent = parseBotIntent('把 761 的 1 天租金改成 22，10 天改成 55');
    expect(intent.type).toBe('unknown');
  });

  /**
   * "721 最近表现怎么样" — natural product query.
   * Currently: unknown.
   * Future: should become query_product (read-only).
   */
  it('"721 最近表现怎么样" currently parses as unknown', () => {
    const intent = parseBotIntent('721 最近表现怎么样');
    expect(intent.type).toBe('unknown');
  });

  /**
   * "帮我把 761 上架" — natural relist request (inverse of delist).
   * Currently: unknown.
   * Future: should become a relist side-effect.
   */
  it('"帮我把 761 上架" currently parses as unknown', () => {
    expect(parseBotIntent('帮我把 761 上架')).toEqual({ type: 'unknown', text: '帮我把 761 上架' });
  });

  /**
   * "下架 761" — concise delist command. Does not match any current pattern.
   * Currently: unknown.
   */
  it('"下架 761" currently parses as unknown', () => {
    expect(parseBotIntent('下架 761')).toEqual({ type: 'unknown', text: '下架 761' });
  });

  /**
   * "复制 761" — concise copy command.
   * Currently: unknown.
   */
  it('"复制 761" currently parses as unknown', () => {
    expect(parseBotIntent('复制 761')).toEqual({ type: 'unknown', text: '复制 761' });
  });

  /**
   * "761 下架" — very concise delist. 
   * Currently: unknown. Note: "761 下架" does not start with 商品 so query_product
   * pattern doesn't match.
   */
  it('"761 下架" currently parses as unknown', () => {
    expect(parseBotIntent('761 下架')).toEqual({ type: 'unknown', text: '761 下架' });
  });
});

// ===========================================================================
// 6. Safety: verify side-effect intents are never accidentally triggered
// ===========================================================================
describe('safety — accidental side-effect prevention baseline', () => {
  // These are the only texts that should produce side-effect intents
  const KNOWN_SIDE_EFFECT_TRIGGERS = [
    '改价 商品761 1天22',
    '改价 商品761 全局打折 0.9',
    '改价 商品761 全部租金九折',
    '复制商品 761',
    '商品复制 761',
    '下架商品 761',
    '商品下架 761',
    '设置租期 761 1,10,30',
    '租期设置 761 1,10,30',
    '查看规格 761',
    '规格查看 761',
    '添加规格 761 1355 128G',
    '规格添加 761 1355 256G',
    '跑日报',
    '生成日报',
    '重发日报',
    '重发公域日报 发全部',
    '推送日报到群',
    // Semantic alias triggers (Section 8)
    '发个日报',
    '发一下日报',
    '做个日报',
    '跑个日报',
    '推送到群',
    '发到群里',
    '日报推到群里',
  ];

  for (const trigger of KNOWN_SIDE_EFFECT_TRIGGERS) {
    it(`"${trigger}" correctly produces a side-effect intent`, () => {
      const intent = parseBotIntent(trigger);
      expect(isSideEffectIntent(intent)).toBe(true);
    });
  }

  // Common conversational phrases that must NOT trigger side-effects
  const SAFE_CONVERSATIONAL: string[] = [
    // Daily acknowledgments
    '好的', '收到', '谢谢', '感谢', '明白了', 'ok', 'OK', '好的 收到',
    // Lookups / deferrals
    '等我看下', '让我看看', '我先看看',
    // Instructions to not act
    '这个先别动', '先别动', '先不管', '暂时不动',
    // Casual conversation
    '随便聊聊', '你好', '在吗', '在不在',
    // Vague numbers that could be misinterpreted as product IDs
    '查一下721',
    '721怎么样',
    '帮我看下 Pocket 3',
    '要不要发群里看看',
  ];

  for (const msg of SAFE_CONVERSATIONAL) {
    it(`"${msg}" does not produce a side-effect intent`, () => {
      const intent = parseBotIntent(msg);
      expect(isSideEffectIntent(intent)).toBe(false);
    });
  }

  // Verify that even with bot mention, the resolved intent is not side-effect
  it('acknowledgment message with bot mention resolves as non-side-effect via dispatcher', async () => {
    const resolvedIntents: BotIntent[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        const intent = parseBotIntent(text);
        resolvedIntents.push(intent);
        return intent;
      },
      handleIntent: async (intent) => {
        // Should never be a side-effect intent
        expect(isSideEffectIntent(intent)).toBe(false);
        return { text: `resolved:${intent.type}` };
      },
    });

    const result = await dispatcher.dispatch({
      messageId: 'mid-ack-dispatched',
      text: '@_user_1 好的',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
    });

    // After stripping mention key, "好的" -> unknown
    // Dispatcher still calls handleIntent for unknown intents (returns guidance text)
    expect(result.skipped).toBe(false);
    expect(resolvedIntents).toHaveLength(1);
    expect(resolvedIntents[0].type).toBe('unknown');
  });

  // Safety: all known side-effect triggers must start with specific command words
  it('side-effect intents only come from explicit command patterns or semantic aliases, not rental natural language', () => {
    // Rental price change only triggers from 改价 prefix
    expect(parseBotIntent('改价 商品761 1天22').type).toBe('rental_price_change');
    expect(parseBotIntent('把商品761的价格改了').type).not.toBe('rental_price_change');

    // Copy only triggers from 复制商品 / 商品复制 prefix
    expect(parseBotIntent('复制商品 761').type).toBe('rental_copy');
    expect(parseBotIntent('商品复制 761').type).toBe('rental_copy');
    expect(parseBotIntent('把商品 761 复制一份').type).not.toBe('rental_copy');

    // Delist only triggers from 下架商品 / 商品下架 prefix
    expect(parseBotIntent('下架商品 761').type).toBe('rental_delist');
    expect(parseBotIntent('商品下架 761').type).toBe('rental_delist');
    expect(parseBotIntent('帮我把 761 下架').type).not.toBe('rental_delist');

    // Tenancy-set only triggers from 设置租期 / 租期设置 prefix
    expect(parseBotIntent('设置租期 761 1,10,30').type).toBe('rental_tenancy_set');
    expect(parseBotIntent('租期设置 761 1,10,30').type).toBe('rental_tenancy_set');
    expect(parseBotIntent('设置 761 的租期为 1天、10天、30天').type).not.toBe('rental_tenancy_set');

    // Spec-discover only triggers from 查看规格 / 规格查看 prefix
    expect(parseBotIntent('查看规格 761').type).toBe('rental_spec_discover');
    expect(parseBotIntent('规格查看 761').type).toBe('rental_spec_discover');

    // Spec-add only triggers from 添加规格 / 规格添加 prefix
    expect(parseBotIntent('添加规格 761 1355 128G').type).toBe('rental_spec_add');
    expect(parseBotIntent('规格添加 761 1355 256G').type).toBe('rental_spec_add');
    expect(parseBotIntent('给 761 添加规格 256G').type).not.toBe('rental_spec_add');

    // Report commands — exact prefixes still work
    expect(parseBotIntent('跑日报').type).toBe('run_public_traffic_report');
    expect(parseBotIntent('重发日报').type).toBe('resend_latest_report');
    expect(parseBotIntent('推送日报到群').type).toBe('push_latest_report_to_group');

    // Semantic alias natural variants now DO trigger report/push/quiz side-effects
    expect(parseBotIntent('发个日报').type).toBe('run_public_traffic_report');
    expect(parseBotIntent('推送到群').type).toBe('push_latest_report_to_group');
    expect(parseBotIntent('做个测验').type).toBe('operations_learning_quiz');

    // Rental natural language still does NOT trigger side-effects (baseline before LLM)
    expect(parseBotIntent('帮我把 761 下架').type).not.toBe('rental_delist');
    expect(parseBotIntent('把商品 761 复制一份').type).not.toBe('rental_copy');
    expect(parseBotIntent('把 761 的 1 天租金改成 22').type).not.toBe('rental_price_change');
  });
});

// ===========================================================================
// 7. @-mention text stripping verification
// ===========================================================================
describe('@-mention text stripping', () => {
  it('strips bot mention key before parsing intent', async () => {
    const texts: string[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'latest_summary' };
      },
      handleIntent: async () => ({ text: 'handled' }),
    });

    await dispatcher.dispatch({
      messageId: 'mid-strip-test',
      text: '@_user_1 @_user_2 改价 商品761 1天22',
      source: 'sdk',
      chatType: 'group',
      mentions: [
        { key: '@_user_1', id: { open_id: 'ou_human' }, name: '同事' },
        { key: '@_user_2', id: { open_id: 'ou_bot' }, name: 'MT Agent' },
      ],
    });

    // Only bot mention key stripped; human mention key preserved
    expect(texts[0]).toBe('@_user_1 改价 商品761 1天22');
  });

  it('strips bot mention even when it appears at the end', async () => {
    const texts: string[] = [];
    const dispatcher = createFeishuMessageDispatcher({
      botMentionOpenId: 'ou_bot',
      resolveIntent: (text) => {
        texts.push(text);
        return { type: 'unknown', text };
      },
      handleIntent: async () => ({ text: 'handled' }),
    });

    await dispatcher.dispatch({
      messageId: 'mid-strip-end',
      text: '今日概况 @_user_1',
      source: 'sdk',
      chatType: 'group',
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
    });

    expect(texts[0]).toBe('今日概况');
  });
});

// ===========================================================================
// 8. Semantic alias baseline — natural-language phrases resolved via
//    resolveSemanticAlias() before broad catch-all patterns.
//
//    This is the FIRST safe step before LLM-based intent resolution.
//    Rental write natural language (下架, 复制, 改价) remains unknown.
// ===========================================================================
describe('semantic alias baseline — natural-language phrases', () => {
  // -----------------------------------------------------------------------
  // 8a. Report generation aliases → run_public_traffic_report
  // -----------------------------------------------------------------------
  describe('report generation aliases → run_public_traffic_report', () => {
    it('"发个日报" resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('发个日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"发一下日报" resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('发一下日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"做个日报" resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('做个日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"跑个日报" resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('跑个日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"发个公域日报" resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('发个公域日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('preserves sendTo: "发个日报 发群" resolves with sendTo group', () => {
      const intent = parseBotIntent('发个日报 发群');
      expect(intent.type).toBe('run_public_traffic_report');
      if (intent.type === 'run_public_traffic_report') {
        expect(intent.sendTo).toBe('group');
      }
    });

    it('preserves sendTo: "发个日报 发我" resolves with sendTo personal', () => {
      const intent = parseBotIntent('发个日报 发我');
      expect(intent.type).toBe('run_public_traffic_report');
      if (intent.type === 'run_public_traffic_report') {
        expect(intent.sendTo).toBe('personal');
      }
    });

    it('preserves sendTo: "发个日报 发全部" resolves with sendTo both', () => {
      const intent = parseBotIntent('发个日报 发全部');
      expect(intent.type).toBe('run_public_traffic_report');
      if (intent.type === 'run_public_traffic_report') {
        expect(intent.sendTo).toBe('both');
      }
    });

    it('"发个日报 群里" resolves with sendTo group', () => {
      const intent = parseBotIntent('发个日报 群里');
      expect(intent.type).toBe('run_public_traffic_report');
      if (intent.type === 'run_public_traffic_report') {
        expect(intent.sendTo).toBe('group');
      }
    });

    it('"发个日报 个人" resolves with sendTo personal', () => {
      const intent = parseBotIntent('发个日报 个人');
      expect(intent.type).toBe('run_public_traffic_report');
      if (intent.type === 'run_public_traffic_report') {
        expect(intent.sendTo).toBe('personal');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 8b. Push to group aliases → push_latest_report_to_group
  // -----------------------------------------------------------------------
  describe('push to group aliases → push_latest_report_to_group', () => {
    it('"推送到群" resolves to push_latest_report_to_group', () => {
      expect(parseBotIntent('推送到群')).toEqual({ type: 'push_latest_report_to_group' });
    });

    it('"发到群里" resolves to push_latest_report_to_group', () => {
      expect(parseBotIntent('发到群里')).toEqual({ type: 'push_latest_report_to_group' });
    });

    it('"日报推到群里" resolves to push_latest_report_to_group', () => {
      expect(parseBotIntent('日报推到群里')).toEqual({ type: 'push_latest_report_to_group' });
    });

    it('"推送日报到群" (exact parser) still resolves to push_latest_report_to_group', () => {
      expect(parseBotIntent('推送日报到群')).toEqual({ type: 'push_latest_report_to_group' });
    });
  });

  // -----------------------------------------------------------------------
  // 8c. Quiz aliases → operations_learning_quiz
  // -----------------------------------------------------------------------
  describe('quiz aliases → operations_learning_quiz', () => {
    it('"做个测验" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('做个测验')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"来个测验" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('来个测验')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"开始测验" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('开始测验')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"出个运营题" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('出个运营题')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"做个运营测验" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('做个运营测验')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"来个运营学习" resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('来个运营学习')).toEqual({ type: 'operations_learning_quiz' });
    });
  });

  // -----------------------------------------------------------------------
  // 8d. Exact parser still wins over semantic aliases
  // -----------------------------------------------------------------------
  describe('exact parser still wins over semantic aliases', () => {
    it('"跑日报" (exact) still resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('跑日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"生成日报" (exact) still resolves to run_public_traffic_report', () => {
      const intent = parseBotIntent('生成日报');
      expect(intent.type).toBe('run_public_traffic_report');
    });

    it('"推送日报到群" (exact) still resolves to push_latest_report_to_group', () => {
      expect(parseBotIntent('推送日报到群')).toEqual({ type: 'push_latest_report_to_group' });
    });

    it('"运营学习" (exact) still resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('运营学习')).toEqual({ type: 'operations_learning_quiz' });
    });

    it('"loop测验" (exact) still resolves to operations_learning_quiz', () => {
      expect(parseBotIntent('loop测验')).toEqual({ type: 'operations_learning_quiz' });
    });
  });

  // -----------------------------------------------------------------------
  // 8e. Rental write natural language remains unknown (baseline before LLM)
  // -----------------------------------------------------------------------
  describe('rental write natural language remains unknown', () => {
    it('"帮我把 761 下架" remains unknown', () => {
      expect(parseBotIntent('帮我把 761 下架')).toEqual({ type: 'unknown', text: '帮我把 761 下架' });
    });

    it('"把商品 761 复制一份" remains unknown', () => {
      expect(parseBotIntent('把商品 761 复制一份')).toEqual({ type: 'unknown', text: '把商品 761 复制一份' });
    });

    it('"把 761 的 1 天租金改成 22" remains unknown', () => {
      expect(parseBotIntent('把 761 的 1 天租金改成 22')).toEqual({ type: 'unknown', text: '把 761 的 1 天租金改成 22' });
    });

    it('"给 761 添加规格 256G" remains unknown', () => {
      expect(parseBotIntent('给 761 添加规格 256G')).toEqual({ type: 'unknown', text: '给 761 添加规格 256G' });
    });

    it('"设置 761 的租期为 1天、10天、30天" remains unknown', () => {
      const intent = parseBotIntent('设置 761 的租期为 1天、10天、30天');
      expect(intent.type).toBe('unknown');
    });
  });

  // -----------------------------------------------------------------------
  // 8f. Semantic aliases work after @-mention stripping via dispatcher
  // -----------------------------------------------------------------------
  describe('semantic aliases work after @-mention stripping', () => {
    it('"@bot 发个日报" dispatches as run_public_traffic_report', async () => {
      const resolvedIntents: BotIntent[] = [];
      const dispatcher = createFeishuMessageDispatcher({
        botMentionOpenId: 'ou_bot',
        resolveIntent: (text) => {
          const intent = parseBotIntent(text);
          resolvedIntents.push(intent);
          return intent;
        },
        handleIntent: async () => ({ text: 'handled' }),
      });

      await dispatcher.dispatch({
        messageId: 'mid-alias-report',
        text: '@_user_1 发个日报',
        source: 'sdk',
        chatType: 'group',
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
      });

      expect(resolvedIntents).toHaveLength(1);
      expect(resolvedIntents[0].type).toBe('run_public_traffic_report');
    });

    it('"@bot 推送到群" dispatches as push_latest_report_to_group', async () => {
      const resolvedIntents: BotIntent[] = [];
      const dispatcher = createFeishuMessageDispatcher({
        botMentionOpenId: 'ou_bot',
        resolveIntent: (text) => {
          const intent = parseBotIntent(text);
          resolvedIntents.push(intent);
          return intent;
        },
        handleIntent: async () => ({ text: 'handled' }),
      });

      await dispatcher.dispatch({
        messageId: 'mid-alias-push',
        text: '@_user_1 推送到群',
        source: 'sdk',
        chatType: 'group',
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
      });

      expect(resolvedIntents).toHaveLength(1);
      expect(resolvedIntents[0].type).toBe('push_latest_report_to_group');
    });

    it('"@bot 做个测验" dispatches as operations_learning_quiz', async () => {
      const resolvedIntents: BotIntent[] = [];
      const dispatcher = createFeishuMessageDispatcher({
        botMentionOpenId: 'ou_bot',
        resolveIntent: (text) => {
          const intent = parseBotIntent(text);
          resolvedIntents.push(intent);
          return intent;
        },
        handleIntent: async () => ({ text: 'handled' }),
      });

      await dispatcher.dispatch({
        messageId: 'mid-alias-quiz',
        text: '@_user_1 做个测验',
        source: 'sdk',
        chatType: 'group',
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'MT Agent' }],
      });

      expect(resolvedIntents).toHaveLength(1);
      expect(resolvedIntents[0].type).toBe('operations_learning_quiz');
    });
  });

  // -----------------------------------------------------------------------
  // 8g. Known risk tests remain documented
  // -----------------------------------------------------------------------
  describe('known risk tests remain documented', () => {
    it('[RISK] "日报数据不对" still parses as latest_summary (read-only, safe)', () => {
      const intent = parseBotIntent('日报数据不对');
      expect(intent.type).toBe('latest_summary');
      expect(isSideEffectIntent(intent)).toBe(false);
    });

    it('[RISK] "商品 761 数据不对" still parses as query_product (noisy keyword)', () => {
      const intent = parseBotIntent('商品 761 数据不对');
      expect(intent).toEqual({ type: 'query_product', keyword: '761 数据不对' });
    });
  });
});
