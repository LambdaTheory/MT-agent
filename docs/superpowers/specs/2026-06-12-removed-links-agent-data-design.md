# 下架链接 Agent 数据设计

## 背景

新链接冷启动已经使用每日商品总表生成 `goods-list-snapshot.json`，并通过轻量状态文件记录端内 ID 的首次出现。下架链接使用同一套“商品总表快照”原理判断：某个端内 ID 之前出现在商品总表，本次商品总表已经不存在，则认为该链接已下架或移除。

该信息只提供给 Agent 查询，不进入日报 Markdown、Excel、飞书文本或飞书卡片展示。

## 目标

- 每次公域日报运行时识别最近下架的端内链接。
- 只保留最近 7 天的下架链接记录。
- 将下架链接作为 Agent 可调用的数据暴露。
- 不新增多份 xlsx 历史依赖，不影响现有日报展示。

## 非目标

- 不倒推历史下架链接；状态首次建立时只作为 baseline。
- 不把下架链接显示在日报、周报、飞书卡片或 Excel 中。
- 不依赖 goods-manager 判断下架，因为本口径以支付宝商品总表是否存在为准。

## 口径

`下架链接 = 上一次状态中存在于商品总表的端内 ID，本次商品总表已不存在的端内 ID`。

端内 ID 必须是纯数字。无效 ID 不参与下架判断。

## 状态文件

新增状态文件：

`output/state/goods-link-lifecycle.json`

状态结构：

```json
{
  "active": {
    "701": {
      "platformProductId": "2026...",
      "productName": "商品名"
    }
  },
  "removedLinks": [
    {
      "productId": "701",
      "platformProductId": "2026...",
      "productName": "商品名",
      "removedDate": "2026-06-12",
      "reason": "商品总表缺失",
      "source": "goods_snapshot_diff"
    }
  ]
}
```

`active` 保存上一轮运行后仍在商品总表中的端内 ID。`removedLinks` 保存最近 7 天下架记录。

## 更新流程

1. 公域日报刷新商品总表并生成当前 `goods-list-snapshot.json`。
2. 读取 `goods-link-lifecycle.json`。
3. 如果状态文件不存在：只用当前商品总表初始化 `active`，不产生下架记录。
4. 如果状态文件存在：计算 `previous active - current active`。
5. 对差集生成下架记录，`removedDate = runDate`。
6. 合并已有下架记录，按 `productId` 去重，保留最新一次下架记录。
7. 删除超过 7 天窗口的记录。
8. 用当前商品总表重写 `active`。
9. 将最近 7 天下架记录写入日报上下文的 Agent 专用字段。

## Agent 数据暴露

在 `PublicTrafficDataReportContext` 中增加 Agent 专用数据字段：

```ts
agentData?: {
  removedLinks?: AgentRemovedLinkItem[];
}
```

Agent 查询层提供：

```ts
getRemovedLinks(context): AgentRemovedLinkItem[]
```

返回字段：

```ts
interface AgentRemovedLinkItem {
  productId: string;
  platformProductId: string;
  productName: string;
  removedDate: string;
  reason: '商品总表缺失';
  source: 'goods_snapshot_diff';
}
```

Agent 意图可以后续扩展识别“下架链接 / 移除链接 / 消失链接”。本次只需要先把数据面开放，保证工具层可调用。

## 展示约束

- 不改 `buildPublicTrafficMarkdown`。
- 不改 `buildPublicTrafficWorkbook`。
- 不改 `buildPublicTrafficFeishuText`。
- 不改 `buildPublicTrafficCard` 的可见模块。
- 如果上下文 JSON 包含 `agentData.removedLinks`，仅供 Agent 查询。

## 错误处理

- 状态文件不存在：初始化 baseline，不产生下架记录。
- 状态文件损坏：记录日志并重新 baseline，避免中断日报。
- 写状态失败：抛错，避免 Agent 数据与日报上下文不一致。

## 测试计划

- 首次运行状态不存在时，只初始化 `active`，`removedLinks` 为空。
- 第二次运行少一个端内 ID，生成一条下架记录。
- 下架记录只保留 7 天窗口内数据。
- 同一 ID 重复下架时保留最新记录。
- 日报 Markdown、Excel、飞书卡片不出现下架链接文本。
- Agent 查询函数能返回 `agentData.removedLinks`。

## 验收标准

- 公域日报运行后产生或更新 `output/state/goods-link-lifecycle.json`。
- `公域数据上下文_YYYY-MM-DD.json` 包含 `agentData.removedLinks`。
- 该字段最多包含最近 7 天下架链接。
- 日报/飞书展示不新增任何下架链接模块。
- 相关单元测试、build、全量测试通过。
