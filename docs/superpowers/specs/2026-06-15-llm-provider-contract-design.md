# LLM Provider 契约设计

## 背景

飞书机器人后续需要支持自然问句的 LLM 工具路由。现有设计已经明确：规则路由优先，只有规则返回 `unknown` 时才进入 LLM 兜底；第一版 LLM 只能选择只读工具，不能触发跑日报、重发日报、浏览器采集、shell 或外部写入。

在接入 Dispatcher 和只读工具注册表前，需要先稳定 LLM Provider 契约，避免不同 session 在飞书机器人核心文件上互相冲突。

## 目标

- 新增独立 `src/llm/` 模块。
- 定义模型调用的最小接口和消息类型。
- 提供安全 JSON 解析工具，拒绝非对象 JSON、空输出和 markdown 包裹输出。
- 提供测试用 fake provider。
- 提供 OpenAI-compatible HTTP provider，支持后续对接兼容 `/chat/completions` 的服务。
- Provider 第一阶段只产出文本/JSON，不接入飞书 Dispatcher，不执行任何工具。

## 非目标

- 不调用真实模型做集成验收。
- 不新增飞书自然问句路由。
- 不修改 `src/feishuBot/dispatcher.ts`、`tools.ts`、`intent.ts`。
- 不实现工具注册表。
- 不让 LLM 执行副作用动作。

## 模块设计

### `src/llm/provider.ts`

定义稳定类型：

- `LlmRole = 'system' | 'user' | 'assistant'`
- `LlmChatMessage`
- `LlmGenerateJsonInput`
- `LlmProviderResult`
- `LlmProvider`

`LlmProvider` 只暴露一个方法：

```ts
generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult>
```

接口不绑定具体模型供应商，也不包含工具执行逻辑。

### `src/llm/json.ts`

提供：

- `parseLlmJsonObject(text: string): Record<string, unknown>`

约束：

- 空字符串报错。
- markdown fenced code block 报错。
- JSON 不是对象时报错。
- 数组、字符串、数字、null 都不能作为合法输出。

这样可以强制后续 prompt 要求模型只返回裸 JSON 对象。

### `src/llm/fakeProvider.ts`

测试 provider：

- 构造时传入固定响应文本。
- `generateJson` 返回固定文本和解析后的 JSON。
- 保存最近一次输入，便于测试调用方 prompt。

### `src/llm/openAiCompatibleProvider.ts`

OpenAI-compatible provider：

- 请求 `POST {baseUrl}/chat/completions`。
- Header 使用 `Authorization: Bearer ${apiKey}`。
- body 包含 `model`、`messages`、`temperature`。
- 读取 `choices[0].message.content`。
- 使用 `parseLlmJsonObject` 解析内容。
- HTTP 非 2xx、缺少 content、非法 JSON 都抛出明确错误。

环境变量加载函数：

- `createOpenAiCompatibleProviderFromEnv(env = process.env)`
- 需要 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`
- 缺失时返回 `null`，不抛错，方便后续在未配置 LLM 时降级。

## 安全边界

- Provider 只负责模型文本生成和 JSON 解析。
- Provider 不知道飞书、工具、日报路径或执行动作。
- Provider 不读取 `.env` 内容，只从调用方传入的 env 对象取必要配置。
- Provider 不打印请求体或 API key。
- JSON parser 拒绝 markdown 包裹，避免调用方误接受非契约输出。

## 测试策略

- 类型源文件测试：确认核心接口导出。
- JSON 解析测试：覆盖合法对象、空输出、markdown、数组、null、非法 JSON。
- Fake provider 测试：返回解析对象并记录输入。
- OpenAI-compatible provider 测试：使用 fake fetch 验证请求格式、成功解析、HTTP 错误、缺少 content。
- Env factory 测试：配置完整返回 provider，缺配置返回 null。

## 验收标准

- 新增 LLM provider 契约模块，不影响现有飞书机器人行为。
- 所有新增 focused tests 通过。
- `npm test -- --exclude ".worktrees/**"` 通过。
- `npm run build` 通过。
