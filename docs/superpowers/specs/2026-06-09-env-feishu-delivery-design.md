# 飞书推送 .env 加载设计

## 目标

打通 MT-agent 本机飞书推送，让 `npm run test-feishu` 和 `npm run public-traffic-report` 可以从项目根目录 `.env` 读取飞书 App API 凭据，不再依赖每次手动设置终端环境变量。

## 范围

本阶段只做本地 `.env` 加载和飞书连通验证。

包括：

- 加载项目根目录 `.env`。
- 不覆盖已经存在的环境变量。
- 接入 `test-feishu`、`public-traffic-report` 和 `daily-report` 三个 CLI。
- 提供 `.env.example`，只包含变量名和示例值，不包含真实 secret。
- 用 `npm run test-feishu` 验证飞书测试消息。
- 用 `npm run public-traffic-report` 验证日报消息发送。

不包括：

- 提交真实 `.env`。
- 重置飞书 App Secret。
- 飞书事件订阅、Q&A、审批卡片。
- 改动飞书消息格式。

## 当前状态

代码已经支持飞书两种通道：

- App API 优先：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_RECEIVE_ID_TYPE`、`FEISHU_RECEIVE_ID`。
- Webhook 兜底：`FEISHU_WEBHOOK_URL`。

当前日报跳过飞书推送的原因是这些环境变量在运行进程里不存在。`.gitignore` 已经忽略 `.env` 和 `.env.*`，并允许提交 `.env.example`。

## 设计

新增 `src/config/loadEnv.ts`：

- 默认读取 `.env`。
- 支持简单 `KEY=VALUE` 格式。
- 忽略空行和 `#` 注释。
- 支持单引号或双引号包裹的值。
- 不覆盖 `process.env` 中已经存在的变量。
- 文件不存在时静默跳过。
- 文件存在但读取失败时抛错。

CLI 在使用 `process.env` 前调用 `loadEnv()`：

- `src/cli/testFeishu.ts`
- `src/cli/publicTrafficReport.ts`
- `src/cli/dailyReport.ts`

## 示例配置

提交 `.env.example`：

```text
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=replace-with-your-secret
FEISHU_RECEIVE_ID_TYPE=open_id
FEISHU_RECEIVE_ID=ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

用户本机复制为 `.env` 并填入真实值。`.env` 不提交。

## 错误处理

- `.env` 不存在：继续使用系统环境变量。
- `.env` 中某行没有 `=`：忽略该行。
- 环境变量已存在：保留现有值，避免 shell/CI 配置被 `.env` 覆盖。
- 飞书 token 或消息发送失败：沿用现有错误返回和 CLI 报错/日志逻辑。

## 测试

新增 `tests/loadEnv.test.ts` 覆盖：

- 能从临时 `.env` 文件加载变量。
- 不覆盖已有环境变量。
- 忽略注释、空行和无效行。
- 文件不存在时不报错。

更新 CLI 源码测试或新增轻量测试，确认 `testFeishu` 和 `publicTrafficReport` 调用 `loadEnv()`。

## 验证

实现后执行：

1. 在本地创建 `.env`，填入飞书 App API 凭据。
2. 运行 `npm run test-feishu`，预期收到测试消息。
3. 运行 `npm run public-traffic-report`，预期 `run.log` 出现 `飞书通知已发送`。
4. 运行 `npm test` 和 `npm run build`。
