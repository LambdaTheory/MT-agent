# goods-manager 新品池直连 MT-agent 合并操作文档

日期: 2026-06-12

## 分支与 worktree

- 源分支: `feature/goods-manager-new-products`
- worktree: `C:\works\MT-agent\.worktrees\goods-manager-new-products`
- 目标分支: `master`

## 功能范围

- MT-agent 通过 `GOODS_MANAGER_BASE_URL` 读取 goods-manager 现有 `/api/goods` 接口。
- goods-manager 当前没有 `最近提交时间` 筛选参数；该字段是排序项和返回字段。
- MT-agent 使用 `sort_by=最近提交时间&sort_desc=true` 拉取商品，再在本地按运行当天日期筛选 `最近提交时间` 在最近 7 天内的商品。
- 生成去重后的商品 ID 集合。
- 公域日报上下文新增 `newProductPoolIds`。
- 公域日报 xlsx 在存在新品池 ID 时新增 `新品池维护` sheet。
- 飞书文本和卡片展示新品池维护数量及前若干商品 ID。
- 如果未配置 `GOODS_MANAGER_BASE_URL`，行为保持原样。
- 如果 goods-manager 读取失败，只写入 run log，不中断日报生成。

## 主要改动文件

- `.env.example`
- `src/cli/publicTrafficReport.ts`
- `src/publicTraffic/goodsManagerNewProducts.ts`
- `src/publicTraffic/types.ts`
- `src/publicTraffic/buildPublicTrafficWorkbook.ts`
- `src/publicTraffic/buildPublicTrafficFeishu.ts`
- `src/publicTraffic/buildPublicTrafficCard.ts`
- `tests/goodsManagerNewProducts.test.ts`
- `tests/publicTrafficReport.test.ts`
- `tests/publicTrafficReportCliBehavior.test.ts`

## 部署配置

在运行 MT-agent 的环境中配置:

```env
GOODS_MANAGER_BASE_URL=http://192.168.1.22:3010
```

该地址应能访问:

```text
GET http://192.168.1.22:3010/api/goods?page=1&limit=1
```

本功能实际调用形态:

```text
GET http://192.168.1.22:3010/api/goods?page=1&limit=500&sort_by=最近提交时间&sort_desc=true
```

已由用户在同事本地部署环境验证:

- 地址: `http://192.168.1.22:3010/api/goods?page=1&limit=5&sort_by=最近提交时间&sort_desc=true`
- 返回 `total=391`, `total_pages=79` for `limit=5`。
- 前 5 条 ID 为 `812`, `811`, `810`, `809`, `808`。
- 前 5 条 `最近提交时间` 均为 `2026-06-12 11:xx:xx`，确认线上环境支持该排序参数。
- MT-agent 当前实现使用 `limit=500`，在 `total=391` 时会一次拿完；如果后续商品数超过 500，会按 `total_pages` 自动分页。

## 合并前验证

在 worktree 中运行:

```powershell
npm test
npm run build
```

## 合并步骤建议

由另一个 session 执行:

```powershell
cd C:\works\MT-agent
git status --short
git worktree list
git fetch --all --prune
git checkout master
git merge --no-ff feature/goods-manager-new-products
npm test
npm run build
```

如主工作区 `master` 有未提交改动，先不要合并；应先让相关负责人处理或切换到干净工作区合并。

## 手工联调建议

1. 确认 goods-manager 可访问: `http://192.168.1.22:3010/api/goods?page=1&limit=1`。
2. 确认最近提交时间排序可用: `http://192.168.1.22:3010/api/goods?page=1&limit=5&sort_by=最近提交时间&sort_desc=true`。
3. 在 MT-agent `.env` 设置 `GOODS_MANAGER_BASE_URL`。
4. 运行 `npm run public-traffic-report`。
5. 检查 run log 是否包含 `goods-manager 新品池:`。
6. 检查生成的公域日报 xlsx 是否包含 `新品池维护` sheet。
7. 检查飞书日报是否出现 `新品池维护` 数量。

## 注意事项

- 不需要 goods-manager 新增 API。
- 不要把 `最近提交时间` 当作 goods-manager 服务端筛选项使用。
- 如果 goods-manager 未来新增专门新品池 API，MT-agent 可以再替换 `goodsManagerNewProducts.ts` 的数据源。
- 如果 `GOODS_MANAGER_BASE_URL` 未配置或 goods-manager 不可达，日报仍会继续生成，只是不输出 goods-manager 新品池数据。
