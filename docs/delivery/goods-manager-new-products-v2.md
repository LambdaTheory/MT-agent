# goods-manager 新品池维护表 v2 交付说明

## 分支

- Worktree: `C:\works\MT-agent\.worktrees\goods-manager-new-products-v2`
- Branch: `feature/goods-manager-new-products-v2`
- Base: v1 commit `987121a`

## 变更

- goods-manager client 继续调用现有 `/api/goods`，本地按运行日期最近 7 天筛选 `最近提交时间`。
- 报告上下文新增 `newProductPoolItems`，保留 `newProductPoolIds`。
- xlsx `新品池维护` sheet 输出商品明细列：商品ID、商品名称、短标题、最近提交时间、商家、同步状态、支付宝编码、库存、SKU数、维护状态、备注。
- 飞书文本和卡片展示新品池数量和前 10 个 `商品ID 商品名称：待维护` 摘要。

## 配置

- `GOODS_MANAGER_BASE_URL=http://192.168.1.22:3010`

## 验证

- `npm test`: PASS，49 files / 244 tests。
- `npm run build`: PASS。
- `git status --short`: clean。
- `git rebase master`: completed without conflicts。
- `git merge-tree $(git merge-base master HEAD) master HEAD`: no conflict markers。
- Previous delivery HEAD before documentation evidence fix: `c1931e26cc450031dbf68752975bd83dd2983706`。

## 非范围

- 未修改 goods-manager。
- 未新增状态文件或历史 xlsx 维护状态继承。
- 未写回 goods-manager。
