import { describe, expect, it } from 'vitest';
import { buildIdLookupCard } from '../src/feishuBot/idLookupCard.js';

function findElement(value: unknown, predicate: (entry: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findElement(item, predicate);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (predicate(record)) return record;
  for (const child of Object.values(record)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

describe('buildIdLookupCard', () => {
  it('builds a schema 2.0 form card', () => {
    const card = buildIdLookupCard();
    expect(card.schema).toBe('2.0');
    const form = findElement(card, (entry) => entry.tag === 'form');
    expect(form).toMatchObject({ tag: 'form', name: 'id_lookup_form' });
    expect(JSON.stringify(card)).toContain('常驻');
    expect(JSON.stringify(card)).toContain('反复查询');
  });

  it('contains the lookup input', () => {
    const input = findElement(buildIdLookupCard(), (entry) => entry.tag === 'input' && entry.name === 'lookup_query');
    expect(input).toMatchObject({ tag: 'input', element_id: 'id_lookup_query', name: 'lookup_query', input_type: 'text' });
  });

  it('contains a submit button that callbacks id_lookup', () => {
    const button = findElement(buildIdLookupCard(), (entry) => entry.tag === 'button' && entry.name === 'id_lookup_submit');
    expect(button).toMatchObject({ tag: 'button', form_action_type: 'submit' });
    expect(button?.behaviors).toEqual([{ type: 'callback', value: { action: 'id_lookup' } }]);
  });

  it('keeps the submit button as a direct form element so Feishu accepts the form', () => {
    const form = buildIdLookupCard().body.elements.find((entry) => entry.tag === 'form') as { elements?: Array<Record<string, unknown>> } | undefined;
    expect(form?.elements?.some((entry) => entry.tag === 'button' && entry.form_action_type === 'submit')).toBe(true);
  });

  it('does not contain a reset button', () => {
    const button = findElement(buildIdLookupCard(), (entry) => entry.tag === 'button' && entry.name === 'id_lookup_reset');
    expect(button).toBeUndefined();
  });

  it('sets a default lookup value', () => {
    const input = findElement(buildIdLookupCard({ defaultValue: '565' }), (entry) => entry.tag === 'input' && entry.name === 'lookup_query');
    expect(input?.default_value).toBe('565');
  });

  it('renders lookup result inside the card', () => {
    const card = buildIdLookupCard({ defaultValue: '565', resultText: '端内ID 565 对应平台商品ID 2000000000000000000001' });
    expect(JSON.stringify(card)).toContain('查询结果');
    expect(JSON.stringify(card)).toContain('端内ID 565 对应平台商品ID');
  });
});
