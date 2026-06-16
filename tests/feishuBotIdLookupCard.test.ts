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
  });

  it('contains the lookup input', () => {
    const input = findElement(buildIdLookupCard(), (entry) => entry.tag === 'input' && entry.name === 'lookup_query');
    expect(input).toMatchObject({ tag: 'input', element_id: 'id_lookup_query', name: 'lookup_query', input_type: 'text' });
  });

  it('contains a submit button that callbacks id_lookup', () => {
    const button = findElement(buildIdLookupCard(), (entry) => entry.tag === 'button' && entry.name === 'id_lookup_submit');
    expect(button).toMatchObject({ tag: 'button', action_type: 'form_submit' });
    expect(button?.behaviors).toEqual([{ type: 'callback', value: { action: 'id_lookup' } }]);
  });

  it('contains a reset button', () => {
    const button = findElement(buildIdLookupCard(), (entry) => entry.tag === 'button' && entry.name === 'id_lookup_reset');
    expect(button).toMatchObject({ tag: 'button', action_type: 'form_reset' });
  });

  it('sets a default lookup value', () => {
    const input = findElement(buildIdLookupCard({ defaultValue: '565' }), (entry) => entry.tag === 'input' && entry.name === 'lookup_query');
    expect(input?.default_value).toBe('565');
  });
});
