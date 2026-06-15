# 飞书只读工具注册表设计

## 背景

MT-agent 已经具备飞书机器人一期能力：SDK 长连接和 HTTP callback 都会进入统一 dispatcher，dispatcher 解析文本意图后调用 `handleBotIntent()`。当前 `src/feishuBot/tools.ts` 同时承担副作用命令、只读查询、Agent intent fallback 和回复格式化，后续继续扩展自然问句、LLM resolver 或 tool-calling 时会让边界变模糊。

worktree 中现有文档给出了清晰约束：飞书只是 Agent 与用户交互的媒介；本阶段只做 deterministic/read-only Q&A；LLM、审批按钮、商品 mutation 都是未来扩展点，不在当前闭环中实现。

## 目标

- 将飞书 bot 的只读查询能力收敛为显式 tool registry。
- 保持现有 deterministic 行为，不接入 LLM。
- 保持副作用命令严格隔离：跑日报、重发日报、推送日报到群不进入只读 registry。
- 让只读工具可枚举、可测试、可被未来 LLM resolver 或 tool-calling 层复用。
- 补齐现有 Agent intent 的只读工具边界：概况、商品、新链接池、任务、问题商品、下架链接、订单情况。

## 非目标

- 不新增商品修改、审批、执行动作。
- 不改变飞书 SDK/HTTP dispatcher 的收发逻辑。
- 不改变日报生成、抓取、飞书主动推送路径。
- 不把 registry 设计成通用插件系统。
- 不持久化对话历史或多轮上下文。

## 方案

新增 `src/feishuBot/readonlyToolRegistry.ts`，由飞书 bot 层拥有 registry。`src/agentData/` 继续只提供数据查询函数、Agent intent 类型和 deterministic intent parsing，不承担飞书回复格式。

Registry 中每个只读工具包含：

- `name`：稳定工具名，例如 `overview`、`product`、`new_product_pool`。
- `description`：面向未来 tool-calling 或帮助文本的简短说明。
- `intentType`：对应的 `AgentIntent['type']`。
- `run(context, intent)`：只接收最新日报上下文和匹配到的 Agent intent，返回 `{ text }`。

`handleBotIntent()` 保持总入口职责：

1. 处理 `help`。
2. 处理显式副作用命令：`run_public_traffic_report`、`resend_latest_report`、`push_latest_report_to_group`。
3. 处理 bot-level 只读命令：`latest_summary`、`query_product`。
4. 对 `unknown` 文本调用 `parseAgentDataIntent()`。
5. 如果 Agent intent 有对应只读工具，则读取最新日报上下文并调用 registry。
6. 如果无法识别，则返回可用问法提示。

## 工具范围

Registry 一期包含以下只读工具：

- `overview`：返回最新公域日报 1 日概况。
- `product`：按端内 ID、平台 ID 或商品名片段查询商品表现。
- `new_product_pool`：返回新链接池摘要。
- `tasks`：返回基于问题商品和新品池生成的待处理任务。
- `problem_products`：按问题类型返回曝光低、转化弱、高潜力等商品。
- `removed_links`：返回最近 7 天下架/移除链接。
- `order_summary`：返回订单分析概况。

直接 bot intent `latest_summary` 和 `query_product` 可以复用同一批 formatter 或 registry runner，但不应把副作用 intent 注册进 registry。

## 数据流

```text
Feishu SDK / HTTP event
  -> dispatcher
  -> parseBotIntent(text)
  -> handleBotIntent(intent)
     -> explicit side-effect command path, or
     -> direct readonly command path, or
     -> parseAgentDataIntent(text)
        -> readonlyToolRegistry
        -> latest report context query
        -> BotResponse text
```

Registry 不读取文件、不访问 `process.env`、不调用飞书 API。最新上下文读取仍由 `handleBotIntent()` 通过 `findLatestReportContext(outputDir)` 完成。

## 安全边界

- Registry 中的工具必须是只读、同步或纯计算式查询，不触发浏览器、抓取、推送、写文件或商品操作。
- 跑日报、重发日报、推送日报到群继续由 `BotIntent` 的显式命令路径处理。
- 自然问句 fallback 只能进入只读 registry。
- 未识别文本返回能力提示，不猜测执行。
- 未来如果增加 approval 或 mutation tool，应放入单独 registry，并要求显式审批和稳定 action candidate，不复用只读 registry。

## 错误处理

- 没有日报上下文时，返回现有空态：`还没有找到公域日报上下文。`
- 商品未匹配时，返回 `暂无匹配商品。`
- 新链接池、任务、问题商品、下架链接、订单情况没有数据时，返回对应空态文本。
- 单条消息处理异常继续由 dispatcher 捕获并转成 `处理失败：...`。

## 测试要求

- Registry source-level 测试：确认导出 registry、lookup helper 和稳定工具名。
- Registry 行为测试：用 fixture context 覆盖每个只读工具的输出。
- `handleBotIntent()` 测试：确认 unknown Agent intent 会通过 registry 返回数据。
- 安全测试：确认跑日报、重发日报、推送日报到群不出现在只读 registry。
- 回归测试：现有 `help`、`latest_summary`、`query_product`、任务、问题商品、下架链接测试继续通过。

## 验收标准

- `src/feishuBot/tools.ts` 不再直接内联所有 Agent intent 查询分支，而是通过只读 registry 调用。
- `src/feishuBot/readonlyToolRegistry.ts` 明确列出所有只读工具。
- Registry 不依赖飞书 SDK、HTTP server、环境变量或文件系统。
- 相关 focused tests、`npm run build` 通过。
- 全量测试可在主工作区使用 `npm test -- --exclude ".worktrees/**"` 验证。
