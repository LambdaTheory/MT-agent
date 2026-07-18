export function mentionsSpecKeywordPriceTarget(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /(规格|sku|SKU|套餐|租期)/u.test(compact)
    && /(含有|包含|带有|字样|关键词|关键字|名称)/u.test(compact)
    && /(改价|价格|租金|加价|降价|上调|下调|增加|减少|\+|-)/u.test(compact);
}

export function shouldSendRentalPricePreviewProgress(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /(改价|pricePreview|pricechange|价格预览)/i.test(compact)
    && !/(回滚|rollback)/i.test(compact)
    && !mentionsSpecKeywordPriceTarget(text);
}
