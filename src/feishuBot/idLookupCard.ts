import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface IdLookupCardPayload extends FeishuCardPayload {
  schema: '2.0';
  body: { elements: Record<string, unknown>[] };
}

export function buildIdLookupCard(options: { defaultValue?: string; resultText?: string } = {}): IdLookupCardPayload {
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
  if (options.resultText) {
    elements.push({ tag: 'hr' }, { tag: 'markdown', content: `**查询结果**\n\n${options.resultText}` });
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '商品ID互查' }, template: 'blue' },
    body: { elements },
  };
}
