# rental-price-agent

基于 Playwright 的 SaaS 租赁平台改价 Agent Skill。用于在没有 API 的后台系统中，通过浏览器自动化完成商品价格、库存、规格的批量修改。

## 能力

- **单商品改价**：读取 → 预览 → 确认 → 填入 → 保存 → 验证
- **批量改价**：镜像搜索 → 排除链接价/MQ 专人维护商品 → 生成 spec → 预览 → 串行执行 → 延迟验证 → 镜像回写
- **单商品结构覆盖**：批量 spec 支持全局 shared setup，也支持 item 级 tenancy/spec 覆盖或合并
- **规格管理**：新增/删除规格项、刷新规格表
- **租期管理**：设置租赁天数
- **审计与回滚**：操作记录、变更报告、一键回滚

## 快速开始

```bash
# 1. 初始化环境
node scripts/init.js

# 2. 配置凭据（编辑 .env 文件）
# SAAS_USERNAME=你的账号
# SAAS_PASSWORD=你的密码
# MIRROR_API_KEY=镜像API密钥

# 3. 启动 daemon
node scripts/playwright-runner.js daemon start

# 4. 单商品改价（回归测试只能使用商品 ID 761；不要替换成其他真实商品）
echo '{"action":"read","productId":"761"}' > cmd.json
node scripts/playwright-runner.js daemon send --file cmd.json

# 5. 批量改价（搜索 + 执行）
node scripts/mirror-search.js batch-spec ipod > batch.json
# 编辑 batch.json 填入目标价格
node scripts/batch-runner.js preview batch.json
node scripts/batch-runner.js execute batch.json

# 6. 停止 daemon
node scripts/playwright-runner.js daemon stop
```

## 架构

```
rental-price-agent/
├── SKILL.md                    # Agent 工作流指令
├── config.example.json         # 配置模板（复制为 config.json 后填写）
├── .env                        # 凭据文件（不入库）
├── scripts/
│   ├── playwright-runner.js    # 浏览器引擎（daemon 模式）
│   ├── batch-runner.js         # 批量编排
│   ├── diff-generator.js       # 变更预览与规则校验
│   ├── mirror-search.js        # 镜像 API 客户端
│   ├── task-store.js           # 操作日志
│   ├── init.js                 # 环境初始化
│   ├── run-tests.sh            # 回归测试
│   └── lib/
│       ├── config-loader.js    # 配置加载（含 .env 解析）
│       └── rule-checker.js     # 规则校验
└── references/
    └── process.md              # 15 步流程参考
```

## 环境要求

- Node.js 18+
- Chromium（`init.js` 自动安装）
- Windows / Linux / macOS

## 安全

- 凭据存储在 `.env` 文件，不入库
- `config.json` 使用 `${VAR}` 占位符，运行时从环境变量解析
- 所有写操作需预览确认后才执行
- 每次修改后自动回读验证

## License

MIT
