# Product Display Name Mapping Design

## Goal

Make product names in Feishu public traffic cards shorter and more readable without changing raw crawled data, analysis logic, Markdown, or Excel output.

## Problem

Product titles from Alipay can be long and noisy. They often include marketing phrases, rental terms, scenario words, platform suffixes, or partial text caused by crawler extraction limits. Long names make Feishu tables hard to read, especially on mobile.

Examples of noisy title parts:

- `70天`
- `芝麻免押`
- `租赁`
- `演唱会`
- `出游`
- `日常记录`
- `出片神器`
- `配置可选`
- `ZFB`

Some rows may also have missing or degraded names because the page exposes truncated product text.

## Chosen Approach

Use a display-only product name resolver with three layers:

1. Manual short-name mapping by internal product ID.
2. Known-name fallback from stronger sources, such as goods export or historical report context.
3. Automatic cleanup and truncation of the best available raw name.

If all name sources fail, display the product identifier, such as `端内ID 251`.

## Configuration

Add an optional config file:

`config/product-name-map.json`

Format:

```json
{
  "251": "佳能 SX70",
  "536": "佳能 G7X3",
  "624": "大疆 Pocket3"
}
```

Keys are internal product IDs without the `端内ID` prefix. Values are the short names shown in Feishu.

An example file should be committed as:

`config/product-name-map.example.json`

The real `config/product-name-map.json` can be local and optional.

## Display Name Resolution

For each `PublicTrafficProductDataRow`, resolve a Feishu display name using this order:

1. Extract internal ID from `row.displayProductId`, such as `端内ID 251 -> 251`.
2. If `product-name-map.json` has a value for that internal ID, use it directly.
3. Otherwise, use the best available source name:
   - A stronger known name from goods export or historical context if available.
   - `row.productName` from the current report context.
4. Clean the selected name by removing known noise tokens and normalizing spaces.
5. Truncate the cleaned name to the Feishu table display limit.
6. If the result is empty, use `row.displayProductId`.

## Scope

Only Feishu card display changes in this phase.

Included:

- `曝光 Top10`
- `补曝光`
- `提转化`
- `继续放量`
- `新品维护池`

Excluded:

- Raw JSON fields
- Excel workbook product names
- Markdown product names
- Analysis rules
- Crawler extraction logic

## Missing And Degraded Names

If current crawl names are missing or too generic, the resolver should not display empty names. It should fall back to:

1. Manual short-name mapping.
2. Historical name cache or report context for the same internal ID or platform product ID.
3. Cleaned current `row.productName`.
4. `row.displayProductId`.

Historical fallback can be added incrementally. The first implementation may support manual mapping plus current-name cleanup, then add history/goods-export fallback in a second task if the data source is straightforward.

## Error Handling

- Missing `config/product-name-map.json` is not an error.
- Invalid JSON should be logged and ignored rather than blocking report generation.
- Empty mapped values should be ignored.
- Manual mapped names are not cleaned or truncated unless they exceed Feishu table constraints.

## Testing

Add tests for:

- Internal ID extraction from `端内ID 251`.
- Manual mapped short name wins over raw product name.
- Missing mapping falls back to cleaned/truncated raw name.
- Noise tokens are removed.
- Empty names fall back to `displayProductId`.
- Feishu card tables use resolved names.

## Expected Result

Feishu tables show concise names such as `佳能 SX70` instead of long titles like `佳能 SX70 65倍长焦4K相机演唱会出游日常记录出片神器芝麻免押租赁 ZFB`, while source data remains unchanged.
