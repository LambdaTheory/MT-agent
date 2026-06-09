import XLSX from 'xlsx-js-style';

export function writePublicTrafficWorkbookBuffer(context: unknown): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(Array.isArray(context) ? context : [context as Record<string, unknown>]);
  XLSX.utils.book_append_sheet(workbook, sheet, '公域流量日报');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
