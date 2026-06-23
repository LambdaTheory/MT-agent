# goods-manager 新品池维护表 v2 设计

日期: 2026-06-12

## 背景

v1 已让 MT-agent 通过 `GOODS_MANAGER_BASE_URL` 读取 goods-manager 现有 `/api/goods` 接口，按运行当天日期筛选 `最近提交时间` 在最近 7 天内的商品 ID，并把 ID 写入公域日报 xlsx 的 `新品池维护` sheet 和飞书摘要。

v2 目标是把 `新品池维护` 从“ID 列表”升级为可直接运营维护的商品表，减少运营在 goods-manager 中反查商品信息的成本。

## 范围

v2 继续不修改 goods-manager，不新增 goods-manager API，不引入状态持久化。

MT-agent 仍使用现有接口:

```text
GET /api/goods?page=1&limit=500&sort_by=最近提交时间&sort_desc=true
```

MT-agent 在本地筛选 `最近提交时间` 在运行当天往前 7 天内的商品。

## 数据模型

新增或扩展 MT-agent 内部新品池条目结构，字段来自 goods-manager 商品组级返回数据:

- 商品 ID: `ID`
- 商品名称: `商品名称`
- 短标题: `短标题`
- 最近提交时间: `最近提交时间`
- 商家: 优先 `merchant`，为空时使用 `商家`
- 同步状态: `是否同步支付宝`
- 支付宝编码: `支付宝编码`
- 库存: `库存`
- SKU 数: `skus.length`

维护字段由 MT-agent 输出默认值:

- 维护状态: `待维护`
- 备注: 空字符串

## xlsx 输出

`新品池维护` sheet 改为输出完整商品维护表。列顺序为:

1. 商品ID
2. 商品名称
3. 短标题
4. 最近提交时间
5. 商家
6. 同步状态
7. 支付宝编码
8. 库存
9. SKU数
10. 维护状态
11. 备注

当没有 goods-manager 新品池数据时，不新增 `新品池维护` sheet，保持 v1 的可选输出行为。

## 飞书输出

飞书文本和卡片继续以摘要为主，不输出完整维护表。

- 模块数量中显示 `新品池维护 N`。
- 新品维护池面板显示前 10 个商品，格式为 `商品ID 商品名称：待维护`。
- 过长商品名称在卡片中仍沿用简短展示，避免卡片过宽。

## 错误处理

- 未配置 `GOODS_MANAGER_BASE_URL`: 跳过 goods-manager 新品池，日报保持正常生成。
- goods-manager 请求失败: 写入 run log，日报保持正常生成。
- 商品缺少某个字段: 对应输出为空或 0，不中断。
- `最近提交时间` 无法解析: 商品不进入新品池。

## 测试

- goods-manager client 测试覆盖分页、日期窗口、去重、坏日期忽略、商品字段保留。
- workbook 测试覆盖 `新品池维护` sheet 的列顺序和字段值。
- 飞书文本/卡片测试覆盖数量和前 10 个商品摘要。
- CLI 行为测试覆盖 `GOODS_MANAGER_BASE_URL` 配置后把新品池商品写入 report context。

## 后续非 v2 范围

- 不读取历史 xlsx 延续维护状态。
- 不新增状态 JSON 文件。
- 不在 goods-manager 增加新品池维护页面或数据库表。
- 不把商品明细写回 goods-manager。
