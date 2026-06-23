import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { ProductIdLookupResult } from './idLookup.js';

export interface IdLookupCardPayload extends FeishuCardPayload {
  schema: '2.0';
  body: { elements: Record<string, unknown>[] };
}

export interface IdLookupCardOptions {
  defaultValue?: string;
  resultText?: string;
  lookupResult?: ProductIdLookupResult;
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function resultColumn(label: string, value: string, color: 'blue' | 'green' | 'grey' = 'blue'): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [markdown(`<text_tag color='${color}'>${label}</text_tag>\n**${value}**`)],
  };
}

function resultHint(content: string, color: 'red' | 'orange' | 'grey' = 'grey'): Record<string, unknown> {
  return markdown(`<text_tag color='${color}'>${content}</text_tag>`);
}

function lookupResultElements(result: ProductIdLookupResult): Record<string, unknown>[] {
  if (result.kind === 'internal') {
    return [
      {
        tag: 'column_set',
        flex_mode: 'bisect',
        horizontal_spacing: '8px',
        columns: [
          resultColumn('端内ID', result.internalId, 'blue'),
          resultColumn('平台商品ID', result.platformIds.join('\n'), 'green'),
        ],
      },
      ...(result.productName ? [resultHint(result.productName)] : []),
    ];
  }

  if (result.kind === 'platform') {
    return [
      {
        tag: 'column_set',
        flex_mode: 'bisect',
        horizontal_spacing: '8px',
        columns: [
          resultColumn('平台商品ID', result.input, 'green'),
          resultColumn('端内ID', result.internalId ?? '未映射', result.internalId ? 'blue' : 'grey'),
        ],
      },
      ...(result.productName ? [resultHint(result.productName)] : []),
    ];
  }

  if (result.kind === 'ambiguous') {
    return [resultHint(`请说明要查询端内ID还是平台商品ID：${result.input}`, 'orange')];
  }

  return [resultHint(`没有找到 ${result.input} 的ID映射。请确认已生成最新公域日报，或使用“端内ID 565”“平台商品ID 2000...”再试。`, 'red')];
}

export function buildIdLookupCard(options: IdLookupCardOptions = {}): IdLookupCardPayload {
  const input: Record<string, unknown> = {
    tag: 'input',
    element_id: 'id_lookup_query',
    name: 'lookup_query',
    placeholder: { tag: 'plain_text', content: '输入端内ID（如 565）或平台商品ID（如 2000...）' },
    label: { tag: 'plain_text', content: '商品ID：' },
    label_position: 'top',
    input_type: 'text',
    max_length: 64,
  };
  if (options.defaultValue !== undefined) input.default_value = options.defaultValue;

  const elements: Record<string, unknown>[] = [
    {
      tag: 'markdown',
      content: '这是常驻商品ID互查卡，可保留在会话里反复查询端内ID与平台商品ID。',
    },
    {
      tag: 'form',
      name: 'id_lookup_form',
      elements: [
        input,
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '查询' },
          type: 'primary',
          form_action_type: 'submit',
          name: 'id_lookup_submit',
          behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }],
        },
      ],
    },
  ];
  if (options.lookupResult) {
    elements.push(...lookupResultElements(options.lookupResult));
  }
  if (options.resultText) {
    elements.push(markdown(options.resultText));
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '商品ID互查' }, template: 'blue' },
    body: { elements },
  };
}
