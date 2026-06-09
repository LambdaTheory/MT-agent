import { normalizeText } from './normalizeText.js';

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

export interface ColumnDefinition {
  sourceIndex: number;
  headers: string[];
  readKind: 'product' | 'spu' | 'plain';
}

type StructuredFieldKind = 'product' | 'spu';

const ACTION_HEADER_NAMES = new Set(['action', 'actions', '操作']);

export function sanitizeStructuredId(value: string, kind: StructuredFieldKind): string {
  let result = value;

  if (kind === 'product') {
    result = result.replace(/^商品ID[:：\s-]*/i, '');
  }

  if (kind === 'spu') {
    result = result.replace(/^SPUID[:：\s-]*/i, '');
    result = result.replace(/^SPU ID[:：\s-]*/i, '');
  }

  result = result.replace(/^ID[:：\s-]*/i, '');
  result = result.replace(/复制$/i, '');
  result = result.replace(/copy$/i, '');

  return normalizeText(result);
}

export function extractStructuredNameAndId(parts: string[], kind: StructuredFieldKind): [string, string] {
  const idMatchers = kind === 'product' ? [/商品ID/i, /^id[:：]/i] : [/SPUID/i, /SPU ID/i, /^id[:：]/i];
  const filteredParts = parts.map(normalizeText).filter((part) => part && !/^复制$|^copy$/i.test(part));
  const idPart = filteredParts.find((part) => idMatchers.some((matcher) => matcher.test(part))) ?? filteredParts[1] ?? '';
  const namePart = filteredParts.find((part) => part !== idPart) ?? filteredParts[0] ?? '';

  return [normalizeText(namePart), sanitizeStructuredId(idPart, kind)];
}

export function getColumnDefinitionsForHeaders(headers: string[]): ColumnDefinition[] {
  return headers.flatMap<ColumnDefinition>((header, index) => {
    const headerText = normalizeText(header);
    const normalizedHeaderName = headerText.toLowerCase();

    if (headerText === '' || ACTION_HEADER_NAMES.has(headerText) || ACTION_HEADER_NAMES.has(normalizedHeaderName)) {
      return [];
    }

    if (headerText === '商品信息') {
      return [{ sourceIndex: index, headers: ['商品名称', '商品ID'], readKind: 'product' }];
    }

    if (headerText === 'SPU信息') {
      return [{ sourceIndex: index, headers: ['SPU名称', 'SPUID'], readKind: 'spu' }];
    }

    return [{ sourceIndex: index, headers: [headerText], readKind: 'plain' }];
  });
}
