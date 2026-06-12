# 新链接首次出现口径设计

## 背景

goods-manager 的 `最近提交时间` 只能说明端内链接近期被维护过，不能单独证明它是新加入支付宝商品总表的链接。新链接观察入口需要同时满足“端内近期维护”和“支付宝商品总表近期首次出现”。

## 口径

新链接观察入口按端内 ID 判断，必须同时满足：

- goods-manager 最近 7 天修改过。
- goods-manager 同步状态为已同步。
- 端内 ID 当前存在于支付宝商品总表。
- 端内 ID 在商品总表的首次出现日期距运行日期不超过 7 天。

## 状态维护

不维护多份 xlsx 作为判断依据。每天下载的 xlsx 继续作为原始产物保存在 `output/YYYY-MM-DD/商品总表_YYYY-MM-DD.xlsx`。

新增轻量状态文件：`output/state/goods-first-seen.json`。

结构：

```json
{
  "701": {
    "firstSeenDate": "2026-06-12",
    "platformProductId": "202603...",
    "productName": "商品名"
  }
}
```

每次日报运行时，从当天商品总表抽取端内 ID 快照。对于状态中不存在的端内 ID，写入当天为 `firstSeenDate`；对于已存在的端内 ID，不覆盖历史首次出现日期。

## 数据流

1. 下载商品总表 xlsx。
2. 从商品总表解析当前端内 ID 快照。
3. 更新 `goods-first-seen.json`。
4. 读取 goods-manager 近 7 天修改且已同步的链接。
5. 只保留同时存在于商品总表、且 `firstSeenDate` 在近 7 天内的端内 ID。
6. 飞书卡片 `新链接冷启动` 只展示过滤后的链接。

## 降级

- 如果 first-seen 状态文件不存在，首次运行只建立 baseline：当天商品总表所有端内 ID 会写入状态并标记为 baseline，但不进入新链接观察。后续运行中新出现的端内 ID 才能进入近 7 天首次出现判断。
- 如果商品总表解析失败，保留现有 goods-manager 新品池读取失败不阻断日报的原则：记录日志，跳过新链接冷启动池。

## 不做

- 不保留或读取多天 xlsx 来做日常判断。
- 不修改 goods-manager API。
- 不改变商品总表原始下载产物。
