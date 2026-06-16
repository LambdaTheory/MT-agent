import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface IdLookupCardPayload extends FeishuCardPayload {
  schema: '2.0';
  body: { elements: Record<string, unknown>[] };
}

export function buildIdLookupCard(options: { defaultValue?: string } = {}): IdLookupCardPayload {
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

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '商品ID互查' }, template: 'blue' },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'id_lookup_form',
          elements: [
            input,
            {
              tag: 'column_set',
              flex_mode: 'none',
              background_style: 'default',
              horizontal_spacing: 'default',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  vertical_align: 'top',
                  elements: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '查询' },
                      type: 'primary',
                      action_type: 'form_submit',
                      name: 'id_lookup_submit',
                      behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }],
                    },
                  ],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  vertical_align: 'top',
                  elements: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '清空' },
                      type: 'default',
                      action_type: 'form_reset',
                      name: 'id_lookup_reset',
                    },
                  ],
                },
              ],
              margin: '0px',
            },
          ],
        },
      ],
    },
  };
}
