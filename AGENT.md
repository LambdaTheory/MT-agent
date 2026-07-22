# MT-agent 开发与维护指南

> 本文面向接手 MT-agent 的开发 Agent 与维护人员，说明模块现状、文件边界、主链路、开发方向、安全约束和验证方式。
>
> **最后核对基线：2026-07-22；当前稳定集成分支：`master`。** 文档描述应优先以当前代码和测试为准，阶段性审计文档仅用于理解历史决策和剩余运行边界。

---

## 1. 项目定位

MT-agent 是一个服务于支付宝商品运营场景的 `Node.js + TypeScript` 自动化项目。已建立如下运营闭环：

```text
业务后台 / 外部业务接口
  → Playwright 抓取或 API 同步
  → 数据规范化、聚合、分析
  → Markdown / Excel / JSON / 状态文件
  → 飞书日报、Bot 查询、审批卡、运营提醒
```

项目当前的正确定位是：**以数据分析、报表、提醒、只读查询和人工确认后的半自动执行为主的运营 Agent 基座。**

截至 2026-07-22，`master` 已整合指定日期日报查询/推送、Agent outcome 学习提示与 Audit Logger 三条近期主线：飞书 Bot 可围绕最新或指定业务数据日做日报查询、重发和群推送；LLM planner 可读取经过脱敏和降权处理的历史 outcome hints，用于改善工具选择与澄清，但不得把历史文本当作授权或执行参数来源。Audit Logger Tasks 1-11 已合入本地 `master`，merge commit 为 `5e28416`，覆盖本地持久化、远程投递/重试/回放、选定工具 spans、确认回调连续性和有界 shutdown。

项目**不是**无人值守的全自动改价、下架、复制商品或上链执行器：

- LLM 的职责是理解自然语言、选择受控工具、抽取结构化参数、形成计划。
- 本地 TypeScript 代码负责数据读取、参数校验、业务计算、确认卡、执行和审计。
- 对商品/链接有副作用的操作必须经过明确的飞书确认卡。
- 依赖业务后台页面的操作必须保留登录态、页面变动和账号权限失败的人工兜底。

### 1.1 Agent 化路线基线（2026-07-22）

当前 MT-agent 更准确地说是「接入 LLM 的业务 Bot / 运营自动化基座」，还不是完整自治 Agent。后续 Agent 化的目标不是让 LLM 接管执行，而是引入受控的任务内核，让系统具备明确 task state、evidence、policy、verifier 和 experience，并在每一步仍由确定性代码守住工具契约和安全边界。

已形成的路线共识：**先瘦身，再 Agent 化。** 当前最大结构性阻塞不是模型能力，而是 `src/feishuBot/agentToolExecutor.ts` 的巨型工具执行 switch、租赁/日报/link/operations 逻辑交织，以及横切的 audit、确认、错误处理和卡片展示混在同一层。直接在这个形态上叠 AgentTask Kernel 会放大耦合和回归风险。

推荐演进顺序：

1. **Executor registry 收口**：保留 `executeAgentToolRequest()` 对外签名，把中央 100-case switch 改为 `ToolExecutorRegistry` 调度。中央入口只负责参数校验、policy/audit/verifier wrapper、handler lookup 和统一返回；业务细节下沉到领域 executor。
2. **先抽 publicTraffic 11 个日报审计工具**：这批工具已是 Audit Logger allowlist，风险较低、边界清晰，适合作为 registry 的第一批迁移样本。
3. **再抽 rental read-only executor**：包括 `rental.batchRead`、read/snapshot/spec discover 等只读能力；先统一 safe-read、登录态/daemon readiness、错误归一化，再碰真实写操作。
4. **后置 rental write / operations write**：`rental.pricePreview`、`rental.priceApply`、复制、下架、规格/租期、失活刷新等高风险链路必须在 registry、测试和 health/readiness 稳定后迁移，且保留 preview -> confirmation -> execute -> verify -> audit。
5. **AgentTask Kernel MVP**：首个试点建议选择租赁批量改价或同类强状态任务。Kernel 负责 task state、step evidence、policy decision、verifier result、recovery hint 和 experience 记录；不负责直接解释自由文本写参数，也不绕过工具 schema/确认卡。

Executor registry 的目标不是完全消灭 switch，而是把一个巨型全局 switch 拆成多个领域内的小型 handler/registry。每个领域 executor 应声明支持的 tool names，并实现统一接口，例如「canHandle/execute」或注册表映射。这样后续 AgentTask Kernel 只依赖稳定的 tool execution contract，不需要理解日报、租赁、link registry 或 operations 的内部实现。

框架选择共识：第一阶段**不建议**用 OpenAI Agents SDK、LangGraph 或其他框架接管 runtime。MT-agent 的核心风险在工具授权、确认状态机、高风险执行、任务持久化、readback verifier 和业务审计，这些必须由本地确定性代码掌控。OpenAI-compatible SDK 可以继续作为 LLM 客户端、structured output、trace adapter 或评估工具，但不能接管 tool permission、confirmation、mutation dispatch 或 verifier。

Health/readiness 是 Agent 化前置基础设施。不能只做 `process alive`，需要把 `/health` 设计成能力就绪信号：

- `GET /health`：轻量检查进程、版本、配置/env 基础完整性、output/state 可读写、Feishu/LLM/rental daemon 的浅层连通性；不得访问真实业务页面或触发外部写操作。
- `GET /health/deep`：只读深度探测，带鉴权或仅限 localhost/internal，带 timeout/cache；可检查 rental daemon ping、login/session、单品 safe read、batch-read、最新日报 context、link registry 读取、LLM lightweight call 等。
- health 结果应按 capability 返回 `ok / degraded / down / unknown`，并给出 `reason` 与 `suggestion`。例如这次 wide300 问题应能表现为 `rental.batchRead: degraded`，原因是商品详情 tab 被重定向到登录页，建议刷新登录态或重启/修复 daemon。
- AgentTask Kernel 后续只能把 health/readiness 当作执行前门禁或降级依据，不能把 health cache 当作业务事实源；真实写操作前仍需即时 read/preview/verifier。

当前 first-cut `/health` 已在 2026-07-22 落地并加载到生产 Bot 进程：

- `src/health/healthService.ts` 聚合浅层只读检查：进程、配置、`outputDir`、最新日报 context、关键 `output/state` 文件、link daemon catalog 快照、`rental-price-agent` daemon ping。它不会访问真实业务页面、不会执行 SaaS 写操作、不会生成确认卡 action。
- `src/feishuBot/server.ts` 暴露 `GET /health`，返回 JSON health report；整体 `fail` 返回 HTTP 503，`ok` / `warn` 返回 200。
- `src/feishuBot/menuConsole.ts` 支持飞书单聊自定义菜单事件 key：`/health`、`health`、`health.overview`、`health.shallow`、`console.health`，点击后返回 `/health 系统健康检查` 卡片。
- SDK 长连接与 HTTP callback 双入口均已接菜单事件；生产主入口 `mt-feishu-bot` 已在用户授权后执行 `npm run feishu-bot:pm2:restart`，重启后 PM2 显示 `mt-feishu-bot` online（pid `21020`，2026-07-22）。`mt-rental-price-agent` 未重启，保持 online。
- 当前仍是 basic readiness，不等同于完整 `/health/deep`。后续补版本/env、Feishu/LLM lightweight connectivity、能力级 `ok/degraded/down/unknown + reason/suggestion` 时，必须保持只读和超时边界。

最小必要瘦身粗估为 1-1.5 周；中等瘦身约 2-3 周；完整瘦身约 4-6 周。`switch -> registry handler` 本身约占最小瘦身的 20%-30%，如果包含第一批 publicTraffic handler 抽离和回归闭环，约占 35%-45%。这是 Agent 化前杠杆最大的第一刀。

## 2. 技术与运行环境

| 项目 | 现状 |
|---|---|
| 语言/运行时 | TypeScript 5.8、Node.js 20+（建议当前 LTS） |
| 模块模式 | ESM，`package.json` 中 `type: module` |
| TypeScript | `strict: true`、`target: ES2022`、`module/moduleResolution: NodeNext` |
| 浏览器自动化 | Playwright 1.52 |
| 测试 | Vitest 3.2，Node 环境 |
| 表格产物 | `xlsx-js-style` |
| 飞书 | `@larksuiteoapi/node-sdk` |
| TypeScript 运行 | `tsx`，CLI 无需先 build |
| 常驻进程 | PM2：`mt-feishu-bot`、`mt-rental-price-agent` |
| 推荐系统 | Windows PowerShell；需要业务网络和可复用登录态 |

根配置文件：

- `package.json`：50+ 个脚本、依赖与 PM2 相关操作入口。
- `tsconfig.json`：包含 `src/**/*.ts` 与 `tests/**/*.ts`，构建输出到 `dist/`。
- `vitest.config.ts`：Vitest Node 测试环境。
- `ecosystem.config.cjs`：PM2 配置。
- `.env.example`：飞书、LLM、输出目录、外挂技能与外部 API 的配置样例；**不得读取、打印或提交真实 `.env`。**
- `config/agent.config.json`：日报抓取页面、周期、分页、输出目录、浏览器 profile、映射文件等主配置。

---

## 3. 仓库结构

```text
MT-agent/
├─ config/                     # 主配置、商品 ID 映射、链接档案覆盖项
├─ docs/                       # 设计、交接、审计、交付、spec/plan 文档
├─ src/
│  ├─ cli/                     # 命令行入口
│  ├─ crawler/                 # Playwright 抓取与登录态
│  ├─ publicTraffic/           # 公域流量分析、产物和日报展示
│  ├─ feishuBot/               # 飞书收发、工具执行、卡片和路由
│  ├─ agentRuntime/            # Agent 规划、工具注册、审批、Daily Mission
│  ├─ audit/                   # Audit Logger 本地持久化、远程投递、重试回放与生命周期
│  ├─ agentData/               # 面向 Agent 的确定性数据查询层
│  ├─ activityAutomation/      # 差异化定价活动页半自动化
│  ├─ closedOrderFeedback/     # 关单备注同步、分析、观察
│  ├─ linkRegistry/            # 链接档案、审计、治理、维护流程
│  ├─ inventoryStatus/         # 同款库存快照
│  ├─ mapping/                 # 平台商品 ID / 内部 ID 映射
│  ├─ notify/                  # 飞书推送
│  ├─ operationsLearningLoop/  # 运营学习问答/会话
│  ├─ newLinkWorkflow/         # 新链批量工作流
│  ├─ operations/              # 运营写操作领域模块（如失活刷新计划/执行）
│  ├─ llm/                     # OpenAI-compatible LLM provider 抽象
│  ├─ config/ domain/          # 配置加载、领域类型
│  ├─ extractor/ report/       # 表格提取、通用报表生成
│  ├─ storage/ observability/  # 输出路径、运行日志、运行时日志
│  └─ agentLearning/ analyzer/ # 学习存储、商品分析
├─ tests/                      # 260+ Vitest 测试文件和 golden fixtures
├─ vendor/rental-price-agent/  # 外挂租赁价 Playwright 技能
├─ output/                     # 每日产物、状态、日志、审计数据（运行生成）
├─ .worktrees/                 # 隔离开发 worktree
├─ README.md                   # 用户侧项目概览和运行说明
└─ AGENT.md                    # 本文
```

---

## 4. 模块说明

### 4.1 `src/cli/`：命令行入口

每个主要工作流由一个 `tsx src/cli/*.ts` 入口启动。不要在 CLI 内重复业务实现；CLI 负责读取配置/环境、组织依赖、调用领域模块、输出结果与退出码。

| 入口 | npm 脚本 | 用途 |
|---|---|---|
| `publicTrafficReport.ts` | `public-traffic-report` | **主公域流量日报**：抓取、映射、分析、产物、飞书通知 |
| `dailyReport.ts` | `daily-report` | 基础版日报链路 |
| `feishuBotSdk.ts` | `feishu-bot:sdk` | 飞书 SDK 长连接服务，生产主入口 |
| `feishuBot.ts` | `feishu-bot` | 飞书 HTTP 回调服务，保留兼容入口 |
| `agentDryRun.ts` | `agent:dry-run` | 自然语言 Agent 意图/计划干跑；默认 planner-first |
| `activityAutomation.ts` | `activity-automation:scout` | 差异化定价活动页侦察与辅助配置 |
| `dailyMissionRun.ts` | `daily-mission-run` | Daily Mission collect → plan → approval 起点 |
| `dailyMissionAudit.ts` | `daily-mission-audit` | Daily Mission 审计查询 |
| `dailyMissionDaemon.ts` | `daily-mission-daemon` | Daily Mission 守护入口 |
| `dailyMissionInactiveRefreshPreview.ts` | `daily-mission:inactive-refresh-preview` | Daily Mission 失活刷新审批卡预览；独立发送，不接入真实执行 |
| `closedOrderFeedbackSync.ts` | `closed-order-feedback:sync` | 关单备注同步 |
| `closedOrderFeedbackPreview.ts` | `closed-order-feedback:preview` | 关单反馈预览 |
| `closedOrderObservationReport.ts` | `closed-order-observation:report` | 关单观察报告 |
| `linkRegistryAudit.ts` | `link-registry:audit` | 链接档案审计 |
| `linkRegistryApplyAuditReview.ts` | `link-registry:apply-audit-review` | 应用链接档案审计审批 CSV |
| `linkRegistryRefreshDaemon.ts` | `link-registry:refresh-daemon` | 链接档案刷新守护 |
| `linkRegistryGroupReview.ts` | `link-registry:group-review` | 同款组复核 |
| `linkRegistryApplyGroupReview.ts` | `link-registry:apply-group-review` | 应用同款组复核审批 CSV |
| `linkRegistryMergeReview.ts` | `link-registry:merge-review` | 档案合并复核 |
| `linkRegistryApplyMergeReview.ts` | `link-registry:apply-merge-review` | 应用档案合并复核审批 CSV |
| `syncProductIdMap.ts` | `sync-product-id-map` | 商品 ID 映射同步 |
| `refreshProductIdMap.ts` | `refresh-product-id-map` | 商品 ID 映射刷新 |
| `rebuildLatestReport.ts` | `rebuild-latest` | 重建最新日报 |
| `captureDashboard.ts` | `capture-dashboard` | 仪表盘诊断截图 / 单日访问页补抓 |
| `captureDashboardBatch.ts` | `capture-dashboard-batch` | 指定多个业务数据日的访问页批量补抓；一次 Playwright 登录循环多日 |
| `probePageSize.ts` | `probe-page-size` | 分页大小探测 |
| `probeExposurePage.ts` | `probe-exposure-page` | 曝光页结构探测 |
| `operationsLearningLoopPreview.ts` | `operations-learning-loop:preview` | 运营学习闭环预览 |

### 4.2 `src/crawler/`：页面抓取与登录态

负责从业务后台读取源数据，是报表、链接生命周期与活动自动化的底层依赖。

关键文件：

- `exposureCrawler.ts`：公域曝光数据抓取；处理表格、spinner、iframe/frame 等页面差异。
- `dashboardCrawler.ts`：仪表盘访问数据抓取。
- `goodsExportCrawler.ts`：商品总表导出。
- `orderAnalysisCrawler.ts`：订单分析抓取。
- `publicTrafficCrawler.ts`：公域流量组合抓取。
- `browserProfile.ts`：Playwright profile 路径与浏览器会话管理。
- `loginState.ts`、`loginNotification.ts`：登录失效检测和飞书提醒。
- `merchantSession.ts`、`subAccount.ts`：商户会话和子账号处理。
- `pagination.ts`、`pageSizeProbe.ts`、`exposurePageProbe.ts`：分页与页面结构探测。
- `failureHandling.ts`：抓取异常处理。

开发注意：

1. 页面抓取强依赖平台 DOM/选择器；页面改版后先写或更新 source-level 测试，再改选择器。
2. 不要把空数据直接视为成功：需要区分「页面没有数据」「登录失效」「选择器失效」「抓取中断」。
3. 超时/解析失败要保留足够诊断上下文（URL、标题、页面/Frame 信息），但不得在日志泄露 token 或隐私数据。
4. 真实抓取会触发业务后台访问；未经明确要求，不在开发中随意运行有外部副作用的 CLI。

### 4.3 `src/publicTraffic/`：公域流量分析与日报

这是最成熟的主业务链路。主入口为 `src/cli/publicTrafficReport.ts`。

数据流程：

```text
商品总表 + 曝光累计 + 1/7/30 日访问 + 订单分析
  → 规范化/合并/增量与窗口聚合
  → 低曝光、弱点击、弱转化、高潜、新品、链接生命周期等发现
  → Markdown、XLSX、JSON、飞书卡片/文本、运行日志
```

关键文件：

- `analyzePublicTraffic.ts`、`analyzePublicTrafficData.ts`：主分析。
- `buildPublicTrafficCard.ts`：飞书日报卡片。
- `buildPublicTrafficMarkdown.ts`、`buildPublicTrafficWorkbook.ts`：Markdown / Excel 产物。
- `buildPublicTrafficFeishu.ts`：飞书消息格式。
- `mergePublicTrafficData.ts`：多周期数据合并。
- `exposureAggregate.ts`、`exposureDelta.ts`、`exposureNormalize.ts`、`exposureStatus.ts`：曝光数据处理管线。
- `dashboardQuality.ts`、`dashboardRefresh.ts`：数据质量、指定业务日期访问页补抓、日报定位、raw 写入、重建/重发状态语义。
- `goodsSnapshot.ts`、`goodsLinkLifecycle.ts`、`goodsStatePersistence.ts`：商品首次出现、生命周期、持久化状态。
- `goodsManagerNewProducts.ts`：goods-manager 新品池集成。
- `orderAnalysis.ts`：订单分析。
- `productDisplayName.ts`：商品展示名解析。
- `rulesConfig.ts`：分析规则。
- `artifacts.ts`、`paths.ts`、`observationState.ts`、`publicTrafficRunState.ts`：运行产物和状态辅助。

输出默认写在 `output/`，典型包含按日期分目录的日报 Markdown/XLSX、源数据/中间 JSON、运行日志，以及 `output/state/` 下的生命周期状态。

#### 指定业务日期访问页补抓基线（2026-07-15）

已完成正式批量 CLI `npm run capture-dashboard-batch -- --dates <YYYY-MM-DD,...>`，用于一次 Playwright 登录/子账号选择后循环多个业务数据日，复用单日补抓的日报定位、raw 写入、质量判断、重建/重发和结构化状态语义。

关键语义和边界：

- `date` / `dataDate` 指支付宝后台访问页的业务截止日期，不是 `output/<runDate>/` 目录日期；查找既有日报必须读取 `公域数据上下文_<runDate>.json` 中的 `date`。
- 找到既有日报时，将 `公域访问数据_1日.json`、`公域访问数据_7日.json`、`公域访问数据_30日.json` 写入对应 `runDate` 目录，并按 `public-traffic-run-state.json` 判断是否需要重建/重发。
- 批量 CLI 的 `sendReport` 固定为 `false`：可重建本地日报，但不重发飞书日报；`--send-to` 只发送每个日期的补抓结果卡，不代表日报重发。
- 未找到既有日报上下文时，只归档到 `output/historical-dashboard-captures/<dataDate>/`，不重建、不重发。
- 结构化状态包括 `repaired`、`still_missing`、`saved_existing_complete`、`saved_already_resent`、`saved_historical_without_report`；绿色只用于真实修复并重发，橙色用于执行后仍缺失，蓝色用于安全保存但无需修复或仅归档。
- 飞书结果卡由 `src/feishuBot/dashboardRefreshCard.ts` 构建，必须保持“结论摘要 → 日期分栏 → 三周期质量标签 → 处理动作/raw 去向”的分层信息架构；不要退回单个 Markdown 表格或调试日志式长文本。fallback text 可保留表格，但 interactive card 首屏必须先讲结论和日期。
- 日期选择器回读可能显示 `MM-DD ~ MM-DD` 范围；只要范围结束日期等于请求业务日即可确认。页面推荐浮层可能遮挡日期选择器或周期 tab，`dashboardCrawler.ts` 已有受遮挡点击后备。
- 从 worktree 对主仓库 `output` 做人工回灌/补抓时，`outputDir`、`productIdMappingPath`、`browserProfileDir` 等相对配置必须显式指向主仓库绝对路径，否则会写到 worktree 或读取不到映射文件。

2026-07-15 已完成一次历史缺口回补：业务数据日 `2026-06-12`、`2026-06-13`、`2026-06-16`、`2026-06-17`、`2026-06-19`、`2026-06-22`、`2026-06-29`、`2026-07-01`、`2026-07-02`、`2026-07-08`、`2026-07-10` 的三周期访问页 raw 已写入主仓库 `C:/works/MT-agent/output` 并重建对应本地日报，未重发飞书日报。复核扫描了 35 个日报目录、34 个业务数据日，`2026-06-10` 至 `2026-07-14` 范围内有日报上下文的业务日期均无访问页 raw 缺失；`2026-06-18` 本地无对应日报上下文，不计为访问页缺失。

#### 指定日期日报查询与推送基线（2026-07-21）

飞书 Bot 和 Agent 工具已支持围绕指定业务数据日读取、查询、重发和群推送既有日报，不重新抓取、不默认重建：

- `publicTraffic.reportQuery`、`publicTraffic.problemProducts`、`publicTraffic.resendLatestReport`、`publicTraffic.pushLatestReportToGroup` 等 planner-visible 工具共享 `reportDateSchema`，支持 `YYYY-MM-DD` 以及常见 `YYYY/M/D`、`M-D`、`M月D日` 输入，执行侧仍以标准业务数据日定位日报上下文。
- 指定日期查找必须通过 `src/feishuBot/reportStore.ts` 的 `findReportContextByDate()`，它按 `公域数据上下文_<runDate>.json` 内的 `context.date` 匹配业务数据日，不能只用 `output/<runDate>/` 目录名推断。
- 指定日期日报重发/群推送只发送已有日报上下文；没有找到上下文时应明确返回“没有找到 <date> 的公域日报上下文”，不得静默退回最新日报。
- 多接收方推送由飞书投递层处理，`sendTo` / 群推送只改变发送目标，不改变日报生成、查询或重抓取语义。
- 日期类回归覆盖在 `tests/agentRuntimeToolRegistry.test.ts`、`tests/feishuBotTools.test.ts`、`tests/feishuBotReportStore.test.ts` 和 `tests/feishuCardDelivery.test.ts`；改动后优先跑这些定向测试。

#### 健康度与托管异常口径（2026-07-16）

公域日报健康度规则已下沉到 `src/publicTraffic/rulesConfig.ts` 的 `health` 配置，并由 `src/cli/publicTrafficReport.ts` / `src/publicTraffic/rebuildPublicTrafficReport.ts` 传入 `analyzePublicTrafficData()`。分析函数仍保持纯函数，不在内部读取配置文件。

默认口径：

- 曝光按日均判定：日均曝光 `<300` 为差，`300-999` 为正常，`>=1000` 为好。
- 访问按访问率判定：访问 / 曝光 `<2%` 为差，`2%-5%` 为正常，`>5%` 为好。
- 金额斩杀默认使用近 `14` 天累计金额 `<=0`，由 `health.amountKill.windowDays` 和 `health.amountKill.threshold` 配置；后续可按业务调整窗口和阈值。
- 缺失数据不得按 0 参与斩杀。金额窗口只有在汇总天数满足配置且未标记 `missing` / `counter_reset_or_data_error` 时才可触发斩杀；否则保持 unknown 或由 1/7 日正金额证据判定为 alive。

日报 `custodyAbnormal` 问题池只收集两类结构化组合，不再按“托管状态包含托管异常”泛化收集：

1. `上架/出售中/可售卖/已同步` + `失败/不通过/未同步/拒绝/驳回` + `托管中`。
2. `已下架/下架/停售` + `托管中`。

这两个 case 只影响公域日报的托管异常问题池、Markdown/Excel/飞书日报和 Bot 问题池查询展示，不改变链接档案的 `listingState` 仲裁，也不改变商品写操作候选过滤。

### 4.4 `src/agentData/`：Agent 数据理解层

该层把日报/状态数据转换为可被 Agent 确定性查询的能力。**不要把计算逻辑复制进 LLM prompt 或飞书 handler；新数据查询应优先落在该层。**

关键文件：

- `productRanking.ts`、`categoryRanking.ts`：商品和品类排名。
- `windowAggregate.ts`、`windowQuery.ts`、`windowedFindings.ts`：任意窗口聚合和窗口化发现。
- `publicTrafficMetricCatalog.ts`：公域日报**全指标能力目录**。
- `publicTrafficQueries.ts`：公域流量查询。
- `metricThresholdStrategy.ts`：来源感知的指标阈值策略。
- `refreshCandidateExplain.ts`：活动刷新候选解释，使用窗口语义。
- `dataHealth.ts`、`safeSource.ts`：数据健康与安全读取。
- `taskPool.ts`：任务池查询。

近期已完成/正在延续的方向：全指标能力矩阵、任意窗口聚合、参数天数校验、复合条件与来源感知阈值。新增指标时须同时维护：**能力目录、查询/聚合逻辑、阈值解释、工具 metadata/schema、回归 fixture 与测试。**

### 4.5 `src/feishuBot/`：飞书 Bot、工具执行与卡片

飞书交互中枢，既有 SDK 长连接，也保留 HTTP callback。生产优先使用 `feishuBotSdk.ts` 对应的 SDK 长连接。

关键文件：

- `sdkClient.ts`：SDK 长连接、事件处理和卡片回调。
- `server.ts`：HTTP 回调服务器。
- `menuConsole.ts`：飞书机器人自定义菜单控制台；当前只实现单聊 health 卡片，其他菜单 key 仅返回基础控制台说明。
- `../health/healthService.ts`：`GET /health` 与菜单 health 卡片共用的浅层只读 readiness 聚合服务。
- `agentToolExecutor.ts`：中央工具执行引擎；处理工具结果、审批、continuation，是当前最大的实现文件。
- `tools.ts`、`readOnlyToolRegistry.ts`：工具定义、只读工具注册。
- `reportQuery.ts`：报告查询、过滤、排序、汇总。
- `productLinkQuery.ts`：统一商品/链接/问题池查询入口；面向用户的商品列表、商品详情、问题池、问题池数量、来源覆盖、链接状态查询应优先走这里。
- `queryCards.ts`：查询结果卡片；商品详情和问题池使用专用卡片，指标/解释类查询使用轻量文本卡，同时保留 BotResponse.text 作为 fallback。
- `rentalPrice.ts`：租赁价相关读写操作协调。
- `dispatcher.ts`、`intent.ts`：消息分发与旧式命令意图识别。
- `agentToolContinuation.ts`、`agentSpecializedContinuation.ts`：多步骤与专用卡片 continuation。
- `rental*Handlers.ts`：批量、镜像、规格、只读、写操作等租赁子处理器。
- `idLookup.ts`、`idLookupCard.ts`、`inventoryStatusCard.ts`、`linkRegistryOverviewCard.ts`：查询卡片。
- `refreshActivityCard.ts`、`refreshActivityPlanStore.ts`、`refreshActivityStrategySelect.ts`：活动刷新 UI/状态。
- `inactiveRefreshExecuteSelect.ts`：失活刷新计划卡选择执行后的二段确认入口；只接受 `planRef + confirmationKey`。
- `closedOrderObservationCard.ts`、`closedOrderPriceAlertCard.ts`：关单相关卡片。
- `llmProvider.ts`、`llmReadOnlyToolAdapter.ts`、`llmToolSelector.ts`：LLM 接入适配。
- `priceAdjustment.ts`、`priceChangeContract.ts`、`priceMultiplier.ts`：价格调整参数与契约。

维护要点：

- SDK 与 HTTP 两条入口的行为必须保持一致；涉及卡片回调时应同时核对 `sdkClient.ts` 和 `server.ts`。
- `reason` 只能用于展示，不能反解析为结构化价格/范围参数。
- `productLink.query` 是普通商品/链接/问题池/来源覆盖的用户可见查询入口；`publicTraffic.reportQuery` 只面向日报汇总、对比、聚合、订单、数据质量和结论等报表类问题。
- `reportQuery` 不支持的 filter、sort 或 metric 必须显式报错，不能静默返回空结果或「声称排序却未排序」。
- 查询结果默认卡片优先：对象列表/问题池使用专用或普通列表卡，指标解释类使用轻量结果卡；直接 legacy `publicTraffic.reportQuery target=section` 保持 text-only，避免绕过 `productLink.query` 重新产问题池卡片。
- 交互卡片会暂停后续步骤；LLM 计划要把打开交互卡的工具放在最后，或先进行澄清。
- 链接维护卡的 LLM 参考建议复用 `HandleBotIntentOptions.agentExploreProvider` / raw `LlmProvider`，必须从 CLI 启动、SDK/HTTP dispatcher、Agent runtime、`executeAgentToolRequest` 和 continuation 执行路径完整透传；新增维护入口时也要显式决定是否传 `llmProvider`。
- `跑失活刷新` 是硬命令，应在 Agent-first 模式下本地直通 `run_inactive_refresh`，不得落回 LLM 选择旧 `operations.refreshActivityPlan`。
- 新增或修改卡片 action 时必须同时维护 SDK 与 HTTP 两条路径的 action name 映射、claim/幂等状态和对应测试；生产默认跑 SDK 长连接。
- 飞书后台自定义菜单已按单聊固定控制台思路配置。当前建议/已约定的事件 key：`health.overview`（健康检查，已实现）、`publicTraffic.report.run`（跑公域日报，暂未接执行确认流）、`publicTraffic.report.pushGroup`（发送/重发日报到群，暂未接执行确认流）。日报生成/群推送有副作用，后续接入菜单时必须先返回确认卡，不能菜单点击后直接执行。
- 菜单事件必须绕过自然语言 planner，直接按 `event_key` 进入确定性 handler；未知 key 只能返回说明卡或帮助卡，不能猜测执行意图。

### 4.6 `src/agentRuntime/`：Agent 运行时、审批与 Daily Mission

负责 LLM 规划、工具注册、schema 校验、通用确认卡、多步计划与 Daily Mission。

关键文件：

- `toolRegistry.ts`：中央工具注册表，定义工具 schema、可见性、结果 metadata、执行入口。
- `planner.ts`、`llmPlanner.ts`：规划器。
- `approvalCard.ts`、`clarificationCard.ts`：通用确认/澄清卡。
- `stepResolution.ts`：解析 `${step.metadata}` 占位符。
- `runtime.ts`、`policy.ts`、`tool.ts`、`types.ts`：运行时基础类型与策略。
- `dailyMissionOrchestrator.ts`、`dailyMissionExecution.ts`、`dailyMissionRun.ts`、`dailyMissionContext.ts`：Daily Mission 主链路。
- `dailyMissionApproval.ts`、`dailyMissionApprovalCallback.ts`、`dailyMissionApprovalStore.ts`：Mission 审批。
- `dailyMissionArtifacts.ts`、`dailyMissionCollectors.ts`、`dailyMissionRejection.ts`：产物、数据收集与拒绝处理。
- `dailyMissionInactiveRefreshPreviewCard.ts`：失活刷新审批卡预览构建器；当前只生成方案 B 单卡。
- `decisionBuilder.ts`、`decisionBuilderFactory.ts`、`decisionPolicy.ts`、`decisionGolden.ts`、`decisionRecord.ts`：决策构建、策略与 golden。
- `operationLedger.ts`、`operationPlan.ts`、`outcomeAttribution.ts`：操作账本与归因。
- `dailyJournalWriter.ts`：Daily Mission journal。
- `agentExploreLoop.ts`、`exploreToolset.ts`：探索循环。
- `dataFreshnessGate.ts`、`hotspotEvents.ts`、`marketPriceCollector.ts`、`publicTrafficCrawlTool.ts`：数据门控与采集工具。

#### LLM 与工具约定

- 通过 OpenAI-compatible `/chat/completions` 供应商接入。
- 配置优先级：`MT_AGENT_LLM_*`，其次 `LLM_*`；`MT_AGENT_LLM_PROVIDER=disabled` 可关闭规划器。
- 飞书 generic planner 会在可用时调用 `buildAgentLearningPlannerHints(outputDir, message)`，把历史澄清选择、工具 outcome 和 workflow outcome 以 `learningHints` 注入 planner request；这些 hints 只是弱反馈，不是新权限、新工具或执行参数来源。
- `learningHints` 必须被视为不可信历史数据：LLM prompt 已明确禁止跟随嵌入在 hints、arguments、labels、messages 或 summaries 中的指令；新增 planner prompt 时必须保留同等强度的 prompt-injection 边界。
- planner-visible outcome hints 不得暴露 raw `reason` 或 `resultSummary`；`arguments` 必须先经 `sanitizeHintArguments()` 脱敏，敏感 key、URL、路径类字符串要替换为 `[redacted]`。新增学习字段前先判断是否会把用户私密文本、执行证据或可诱导指令交给 LLM。
- outcome hints 当前用于提升工具选择、澄清 restatement 和参数倾向；最终仍要经过工具 schema、执行端校验、确认卡和 hidden-tool 边界。不能因为历史上某个工具成功过就跳过澄清、确认或安全源检查。
- `plannerVisible: true` 才能由 LLM 直接选择。
- `plannerVisible: false` 是内部/隐藏运行时工具，绝不能通过普通 planner 输出或 continuation 直接调用。
- 工具 schema、prompt 和执行端必须是同一份可兑现契约；schema 不能声明执行端做不到的字段或枚举。本地 planner 校验已覆盖 `anyOf`、`oneOf`、`not`、`enum`、`pattern`、数组/对象必填项和 `additionalProperties`，新增 schema 约束时必须补对应回归测试。
- 高风险租赁工具的 schema 必须贴合当前 runtime 护栏：端内 ID 使用数字字符串；批量 ID 数组逐项校验；`discount` 与 `adjustmentAmount` 不得同时出现；rollback 必须提供且只能提供 `taskId` 或 `rollbackFile` 之一。
- 多步骤计划可以使用前一步的 `resultMetadataSchema` 输出；商品写步骤会暂停，确认后只执行当前步骤，再恢复余下步骤。
- continuation 在解析 `${step.metadata}` 占位符后必须重新跑目标工具参数校验；工具返回 metadata 也要按 `resultMetadataSchema` 校验，失败时只能存 fallback 文本，不能让坏 metadata 继续驱动后续步骤。

#### 确认卡边界

- 商品复制、下架、改价、规格/租期变更等写操作必须确认。
- 日报生成与仪表盘刷新属于重抓取操作，也必须确认。
- 报表重发/推送、关单同步/报告等非商品变更操作可直接执行。
- 确认卡使用从完整请求派生的 `confirmationKey`，解析时必须复算并验证，防止卡片 payload 篡改。
- `buildAgentToolConfirmCard()` 仅在展示层把工具名包装成中文操作名，例如 `操作：复制商品（rental.copy）`；callback payload、`request.toolName`、`confirmationKey`、parser、ledger/audit 仍必须使用原始工具名，不能把中文展示文本反解析为执行参数。
- `buildAgentToolConfirmCard()` 支持 `displayElements` 作为纯展示扩展，用于表格、指标块等富信息确认卡；这些元素不得承载可执行参数。确认/取消按钮仍只能使用 `requestRef + confirmationKey` 或受校验的 inline request。

#### 可执行失活刷新当前状态（2026-07-18）

失活刷新已经有独立的可执行 Bot 工具流，入口为飞书硬命令 `跑失活刷新`，也支持 `跑失活刷新 <YYYY-MM-DD>`。该入口不走旧“活跃度刷新计划”，而是调用 `operations.inactiveRefreshPlan` 生成 14 天失活刷新计划卡。

核心文件：

- `src/operations/inactiveRefresh/planner.ts`：14 天窗口聚合、候选分类、安全源选择、同款组/全局上限。
- `src/operations/inactiveRefresh/card.ts`：正式执行计划卡；当前为安全 MVP 版，不是 Daily Mission 富预览卡。
- `src/operations/inactiveRefresh/planStore.ts`：`planRef` 持久化、白名单校验和 `confirmationKey`。
- `src/operations/inactiveRefresh/execute.ts`：hidden high-risk 执行工具；先复制安全源补链，再下架旧链接，失败不下架，写审计并加执行锁。
- `src/feishuBot/inactiveRefreshExecuteSelect.ts`：计划卡确认后生成标准 `AgentToolConfirmRequest` 二段确认卡。

执行与安全语义：

- 计划工具：`operations.inactiveRefreshPlan`，`risk: read`，`requiresConfirmation: false`，planner-visible，仅生成和持久化计划。
- 执行工具：`operations.inactiveRefreshExecute`，`risk: high`，`requiresConfirmation: true`，`plannerVisible: false`，只接受 `{ planRef, confirmationKey }`。
- 计划卡按钮不得携带 `delistProductIds`、`newLinkItems` 或任何直接执行 payload；确认/取消按钮都只携带 `planRef + confirmationKey`。
- 计划卡有两个动作：`确认执行失活刷新` 和 `取消`。取消 action 为 `inactive_refresh_execute_cancel`，会把卡替换为灰色取消状态，并与确认 action 共用 planRef 级 claim，防止取消后再确认。
- `inactive_refresh_execute_select` 只负责加载计划、校验 key 并创建标准高风险确认卡；真正复制/下架只发生在标准 `agent_tool_confirm` 之后。
- HTTP 高风险 card action 需要 callback signature；签名带 5 分钟新鲜度校验，敏感 action 有持久 claim 防进程重启后重放。

链接状态与幂等边界：

- 失活刷新名单是在触发 `operations.inactiveRefreshPlan` 时即时生成，不是 Daily Mission 或 daemon 预先固定的日名单。
- 计划阶段依赖当前 link registry；daemon catalog / 商品总表 / 生命周期已把旧链判为 `delisted` 或 `gone` 时，最终会派生为 `status=removed`，不会进入候选。
- 补链源也从 link registry 同款组里选取 `status=active` 且非本次候选的链接，并要求 14 天金额 > 0、上线满 14 天。
- 执行阶段只按已持久化 plan 顺序执行：先 `copy(sourceProductId)`，每次 copy 成功且返回 `newProductId` 后，才开始下架 `delistProductIds`；copy 失败或不返回新 ID 会中断且不下架旧链。
- 同一个 `planRef` 有本地执行锁，不能通过重复点击同一张卡二次执行同一计划。
- 当前执行前不会重新拉取 daemon catalog，不会 live preflight 校验旧链仍在架、源链仍可复制，也不会读取 `operation-observations.json` 主动排除 14 天内刚失活刷新的旧链。
- 因此如果执行后未刷新 daemon/link registry，本地仍误认为旧链 active，第二天重新生成计划时理论上可能再次进入候选；真实下架调用通常会在 daemon/SaaS 层返回失败或不可操作，但这是被动失败，不是计划阶段主动规避。
- 后续补强优先级：计划前强制刷新 daemon catalog；执行前对 `delistProductIds + sourceProductIds` 做 live preflight；把成功执行过的 `delisted_old_link` 在观察期内排除出候选，即使 registry 还未刷新。

业务筛选口径：

- 固定近 14 天窗口；active 链接；上线不足 14 天排除；上线天数缺失进入人工/不可执行。
- 金额为 0 才可能进入失活候选；金额缺失、金额口径冲突或访问数据不确定进入人工/不可执行。
- 高曝光高访问但金额为 0 视为转化异常，不刷新。
- 安全源必须是同款组内 active、非候选、金额 > 0、上线满 14 天的链接。
- 全局上限 20；同款组上限：1-3 条最多 1 条，4-10 条最多 2 条，10 条以上最多 20%。

验证基线：改动该链路后至少运行：

```powershell
npx vitest run --dir tests tests/inactiveRefreshWorkflow.test.ts tests/agentRuntimePlanner.test.ts tests/refreshActivityThreeStep.test.ts tests/targetedRefreshActivityExecuteStrategy.test.ts tests/agentRuntimeToolRegistry.test.ts tests/feishuBotIntent.test.ts
npx vitest run --dir tests tests/feishuBotServer.test.ts -t "inactive refresh|unsigned HTTP|signed HTTP|replay signed HTTP"
npx vitest run --dir tests tests/feishuBotSdkCardAction.test.ts -t "inactive refresh plan"
npm run build
```

注意：之前含饼图的失活刷新卡片仍属于 Daily Mission 预览模块（见下节），尚未接入正式 `operations.inactiveRefreshPlan`。若要把饼图/折叠证据迁入正式执行卡，必须保留当前 payload 安全边界和二段确认。

#### Daily Mission 当前状态

Daily Mission 的 collect → plan → approval 骨架已经存在，但审计文档指出其真实审批执行闭环仍有高优先级问题。在这些问题修复、补充回归测试并验证前，**不建议将 Daily Mission 接入真实运营写操作。**

#### Daily Mission 失活刷新富预览状态（2026-07-18）

Daily Mission 失活刷新富卡片目前是独立预览模块，入口为 `npm run daily-mission:inactive-refresh-preview -- --date <YYYY-MM-DD>`，真实数据模式加 `--real`。它用于把 14 天失活候选生成飞书审批卡样式预览，尚未接入 `daily-mission-run`、`dailyMissionOrchestrator` 或正式 `operations.inactiveRefreshPlan` 执行链路。

当前边界和安全约束：

- 卡片只生成 `方案 B｜标准指标` 单卡；方案 A、方案 C 和独立异常复核卡已移除。
- 卡片包含 `inactive_refresh_group_modification_ratio_chart` 饼图、折叠证据区、异常/规则区，是样式和信息架构参考，不代表生产执行卡已经使用该结构。
- 数据异常、未执行原因、判定证据和固定规则都放在折叠区；首屏只保留审批摘要、执行占比和核心 diff。
- 所有按钮必须保持 disabled/no-op，callback action 为 `daily_mission_inactive_refresh_preview_noop`；不得复用或新增真实执行 action。
- CLI 必须先校验 `--date` 为严格 `YYYY-MM-DD`，再读取 `.env` 或构造输出路径。
- CLI 只允许显式个人接收人：必须配置 `FEISHU_PERSONAL_RECEIVE_ID`，不得 fallback 到通用 `FEISHU_RECEIVE_ID`，避免误发群聊。
- `--real` 只读取本地 14 天窗口聚合、链接档案和同款组快照并发送预览卡；不得调用 `operations.refreshActivityExecute`、`rental.delist`、`rental.copy` 或其他商品写工具。
- 相关测试为 `tests/dailyMissionInactiveRefreshPreviewCard.test.ts` 和 `tests/dailyMissionInactiveRefreshPreviewCli.test.ts`；改动后至少运行这两个定向测试和 `npm run build`。

优先修复方向：

1. 审批回调必须验证 run 状态、持久化待审 decision 与请求一致性。
2. `runId + decisionId` 必须有持久化幂等保护，避免重复确认导致二次副作用。
3. DecisionPolicy 应拒绝 hidden/runtime 工具，只允许明确白名单的 plan/preview 工具。
4. 遇到工具返回二次确认卡时，结果应为 pending，而不是误记执行成功。
5. 执行后必须更新 Mission run 状态、journal、ledger 归因和 audit 视图。
6. 同日多 run 的 artifacts 需要按 `runId` 隔离，避免覆盖。
7. JSONL ledger 要能容错坏行并保持读取可用。

### 4.7 `src/audit/`：Audit Logger 审计链路

Audit Logger 为选定的 Bot 工具建立本地可追溯、可回放的闭合 trace，并在配置有效时异步投递远程 ingest。Tasks 1-11 已合入本地 `master`，但审计范围仍是显式选择的工具，不代表所有 CLI 或所有工具都已接入。

关键文件：

- `config.ts`：环境变量解析、默认值、URL 校验和选定工具白名单。
- `auditLogger.ts`：事件构建、本地写入、远程投递、重试、回放和 flush 协调。
- `event.ts`：规范事件/状态、上下文、脱敏和序列化校验。
- `http.ts`：`/v1/ingest` HTTP 投递、超时、响应确认和失败分类。
- `storage.ts`：JSONL 原始日志、retry queue、isolate、回放租约及原子/有界读写。
- `confirmationLifecycle.ts`：选定确认回调的 trace 恢复、确认/取消事件和 reviewer 上下文。
- `confirmationContextStore.ts`：确认上下文 sidecar 的保存、读取、TTL 和校验。
- `domainMapper.ts`：选定工具的业务结果到审计状态、摘要、实体和 tags 的映射。
- `shutdown.ts`：有界 flush 和关闭适配器。

当前选定的 11 个审计工具：

```text
publicTraffic.latestSummary
publicTraffic.conversionSummary
publicTraffic.reportQuery
productLink.query
publicTraffic.problemProducts
publicTraffic.orderSummary
system.dataHealth
publicTraffic.resendLatestReport
publicTraffic.pushLatestReportToGroup
publicTraffic.runReport
publicTraffic.refreshDashboard
```

激活和入口边界：

- 官方 HTTP 和 SDK Bot CLI 入口始终构造并注入 logger；命中选定工具并激活审计后，本地 raw audit 始终写入。
- 只有 `AUDIT_INGEST_URL` 有效且以 `/v1/ingest` 结尾时才启用远程投递。URL 留空表示仅本地记录；URL 无效时启动失败。
- 独立的 `dailyReport` / `publicTrafficReport` CLI 不在审计范围内，除非它们通过上述选定的 Bot 工具路径被调用。

规范闭合 trace 顺序：

```text
run.start -> agent.start -> tool.start -> tool.end/tool.error
  -> agent.end/agent.error -> run.final_result/run.failed
```

产物位于 `output/audit/`：

- `audit-YYYY-MM-DD.jsonl`：本地原始审计事件。
- `retry-queue.jsonl`：远程失败后的待回放队列。
- `isolate-YYYY-MM-DD.jsonl`：不可重试或坏记录的隔离项。
- `confirmation-contexts/`：确认回调恢复 trace 所需的 sidecar。
- `replay.lease`：回放互斥租约。

retry queue 中的 payload 字符串按原始内容保存并按 byte-identical 方式回放；远程失败、超时或回放失败都不得改变业务响应。关闭时 shutdown adapter 在有界 deadline 内调用 `logger.flush()`，由 flush 统一等待 background ingest、replay 并检查队列状态，最后才由 PM2 结束进程。当前本地运行配置为 `ingest 750ms < flush 1500ms < PM2 kill_timeout 3000ms`，必须保留这个先后关系，避免进程先退出而截断本地/远程审计。

#### Audit Logger 远程 rollout 基线（2026-07-22）

根目录 `.env` 已被 git 忽略，当前运行配置为 `agent_id=mt-agent`、输出目录 `output/audit`、启用 retry、batch `50`，并配置了获授权的远程 `/v1/ingest` endpoint；跟踪文档不记录 deployment host。PM2 的 `mt-feishu-bot` SDK 进程已重启，`mt-rental-price-agent` 未改动。

两条安全闭合 trace，共 12 个事件，已被远程接受；远程 count/latest timestamp 与本地 final events 一致，未产生 retry/isolate 产物。`npm run build` 已通过，聚焦的 5 个文件、46 个测试已通过；此前已提交的聚焦矩阵为 14 个文件、274 个测试。此次 merge/work 保持在本地，未 push。

当前 endpoint 仍是 public plain HTTP；在将传输机密性和完整性视为完成前，必须迁移到 HTTPS。这是后续安全工作，不是功能 rollout 失败的证据。

### 4.8 `src/linkRegistry/`：现有链接档案与治理

该模块维护长期链接档案，不是日报里的一次性临时字段。它为审计、治理提醒、维护提示、同款组上下文和后续 Agent 决策提供事实源。

关键文件：

- `buildRegistry.ts`：从商品/状态数据建立链接档案。
- `audit.ts`、`auditReview.ts`、`auditReviewApproval.ts`：审计与复核。
- `groupReview.ts`、`groupReviewApproval.ts`：同款组复核。
- `mergeReview.ts`、`mergeReviewApproval.ts`：合并复核。
- `maintenance.ts`、`maintenanceSession.ts`：维护流程。
- `governanceSession.ts`：治理会话。
- `overrides.ts`：人工覆盖项与别名/规则。
- `daemonCatalog.ts`、`promptRefresh.ts`、`refreshHealth.ts`、`reminderState.ts`：刷新与提醒。
- `store.ts`、`persistence.ts`、`queryRegistry.ts`：存储查询。
- `listingState.ts`、`alias.ts`、`types.ts`：状态模型与类型。
- `delistAttribution.ts`、`delistOperationEvidence.ts`、`refreshSuppressionState.ts`：下架原因归因、Agent 下架证据归一化和刷新健康抑制状态。

状态语义：

| 字段 | 值 | 含义 |
|---|---|---|
| `status` | `active / removed / unknown` | 既有消费方使用的粗粒度状态 |
| `listingState` | `on_sale / delisted / gone / unknown` | 上架语义的细粒度状态 |
| `delisted` | — | 来源明确显示已下架/停售，仍可能未来恢复 |
| `gone` | — | 商品已经从总表生命周期消失 |

`delisted` 和 `gone` 都派生为 `status=removed`，不得进入改价、补链、规格删除和活动刷新等可操作候选。前端/飞书展示要区分「已下架」和「链接不存在」，不能混淆。

daemon 状态同步边界：

- `src/linkRegistry/promptRefresh.ts` 会调用 `fetchDaemonCatalogSnapshot()`，优先通过 daemon HTTP `platformSearchAll` 读取 SaaS 当前商品目录，失败时 fallback 到 CLI `platform-search ''`。
- daemon catalog 快照保存到 `output/state/link-registry-daemon-catalog.json`，再参与 `buildLinkRegistry()` 的 `listingState` 仲裁；`daemon_catalog` 是高可信状态来源。
- 这是 daemon/SaaS 到 MT-agent 的单向读入：MT-agent 不会把 link registry 的 `listingState` 回写到 daemon，也不会把本地状态判断回写到 SaaS。
- MT-agent 通过 daemon 执行 `copy`、`delist`、`priceApply` 等是真实写操作；写成功后仍需要后续 read/refresh，才能让 link registry 反映 SaaS 最新状态。

下架原因归因是 `listingState === 'delisted'` 之后的解释层，不参与状态仲裁。平台证据来自商品总表的「审核不通过原因」和「冻结原因」，分别归因为 `platform_review_rejected` / `platform_frozen`，其他平台限制归为 `platform_restricted`；仅在同一商品快照明确已下架、状态文本非空、观察时间新鲜且内外时间一致时确认。Agent 主动下架证据来自 operation ledger 中成功的 `delist` 执行，并要求后续严格更晚的已下架回读；没有平台或 Agent 证据时只能写 `external_manual_off_shelf_pending_confirmation`（外部人工下架，待确认），不得推断具体同事。刷新健康门禁（如 daemon 空结果或商品快照异常掉数）会抑制全部下架归因，并按日期持久化供同日 runtime 复用。

#### 链接维护/审计 LLM 参考建议（2026-07-20）

链接维护 daemon 卡片和 `link-registry:audit --llm-suggestions` 已支持展示 LLM 参考建议，但语义是**人工参考，不自动生效**：

- `maintenanceSession.ts` 只把 LLM 输出写入队列项的 `llmSuggestion` 展示元数据；`overrideEntryPayload`、callback payload、排序、`decision`、最终 override 写入都不得读取 `llmSuggestion`。
- `auditReview.ts` 在审批 Markdown 中把 LLM 建议放在「审计事实」和「人工填写区」之间；最终落库仍只看人工填写的 `decision/final*` 字段。
- LLM 输出进入 Feishu Markdown 或审计 Markdown 前必须用安全展示文本中和 Markdown/Feishu 特殊语法，避免 `[link](url)`、`<at ...>`、表格管道、反引号、强调符号等被渲染成可点击链接、mention 或误导性结构。原始 JSON/CSV 可保留机器字段，但渲染层不能直接输出未中和文本。
- provider 失败、无 provider、JSON 不合规、action 不在白名单、confidence 非 `0..1` 或 rationale 缺失时，只能显示「不可用」或「未启用」，不能阻断维护卡，也不能降级为猜测写入。
- 同一日期/同一 deterministic signature 的维护 session 在 `force` 重开时必须刷新展示元数据和 options；不能复用旧 queue 导致 LLM 建议缺失或陈旧，但 `reviewing/completed` session 仍不得被覆盖。
- live 入口覆盖范围包括：飞书 SDK bot、HTTP bot、dispatcher/runtime、direct intent、Agent tool executor/continuation，以及 `publicTrafficReport.ts` 日报后链接维护提醒。新增入口要补 `tests/cliLoadEnvSource.test.ts`、`tests/feishuBotTools.test.ts` 或对应 session 测试。

### 4.9 `src/activityAutomation/`：差异化定价活动自动化

它不是通用活动脚本，而是针对差异化定价活动表单的半自动执行器。

关键文件：

- `workflow.ts`：主流程。
- `scout.ts`、`scoutAnalysis.ts`：页面侦察、截图、控件分析。
- `productPicker.ts`、`productPickSession.ts`：自动/人工选品。
- `dateFilling.ts`、`discountFilling.ts`：日期和折扣填写。
- `submit.ts`、`submitSession.ts`：提交前后记录。
- `cancelAssistance.ts`、`cancelModel.ts`：活动取消辅助。
- `pageModel.ts`：页面抽象。
- `differentialPricing.ts`、`config.ts`、`recording.ts`、`workarounds.ts`：工作流辅助。

标准流程：进入页面 → 检查登录/账号 → 侦察页面 → 选商品 → 填日期/折扣 → 记录结果 → 仅在显式确认时提交。

页面结构、账号权限和登录态均可能使自动化失效。因此它适合「人工已经确定策略、希望减少机械填写」的场景，而非无人值守批量提交。

### 4.10 `src/closedOrderFeedback/`：关单信息模块

从外部接口拉取近期开单/关单备注，避免重复摄入，将自由文本转化为可分析、可观察的运营信息。

关键文件：

- `runtime.ts`：主运行时。
- `sync.ts`、`ingest.ts`：同步与去重摄入。
- `feedback.ts`、`observation.ts`：反馈原因分析、观察报告。
- `apiProvider.ts`、`fakeProvider.ts`：真实/测试 provider。
- `priceAlertMonitor.ts`：价格告警观察。
- `types.ts`：类型契约。

需注意真实 API、token 与商户备注的敏感性；测试优先使用 `fakeProvider` 和 fixtures。

### 4.11 `src/inventoryStatus/`：同款组经营快照与库存查询

该模块把公域日报上下文与链接档案汇总为只读的同款组经营快照，供飞书“库存情况”总览/明细卡和链接档案同款组复核使用。这里的“库存情况”主要表达链接档案覆盖、在售结构、缺数据情况和同款组经营指标，不是仓储实物库存数量。

关键文件：

- `types.ts`：schema-v1 快照、同款组、周期指标、主力链接和覆盖率类型。
- `snapshot.ts`：按 `sameSkuGroupId` 汇总链接档案与日报行，计算 1/7/30 日指标、比例、主力链接和风险。
- `store.ts`：原子写入与严格读取；所有消费方必须复用 `readInventorySameSkuSnapshot()`。
- `history.ts`：读取最近历史同款组快照；仅扫描 `output` 下 `YYYY-MM-DD` 直接子目录，默认限制最近 60 天并顺序读取，避免 Bot 查询触发无界并发 I/O。
- `query.ts`：总览、端内 ID、同款组 ID、别名查询，以及歧义/未找到/快照不可用结果。
- `src/feishuBot/inventoryStatusCard.ts`：库存总览与明细卡、歧义和缺失 fallback 文本。
- `src/cli/publicTrafficReport.ts`、`src/publicTraffic/rebuildPublicTrafficReport.ts`：生成或重建 `同款组经营快照_<runDate>.json`。
- `src/cli/linkRegistryGroupReview.ts`：读取最近有效快照生成同款组复核工件。

数据契约和维护边界：

1. 快照固定使用 `schemaVersion: 1`，并保存 `generationId`、`date`、`sourceReportDate`、`generatedAt`。`generationId` 必须与日报上下文一致；展示前还要校验日报业务日期和快照运行日期。
2. `periods` 必须且只能包含 `1d / 7d / 30d`。计数字段是非负整数；周期指标与主力链接指标只能是 `null` 或非负有限数。`null` 表示来源不可用，真实零值必须保留为 `0`。
3. 缺文件、截断 JSON、旧 schema、未来 schema、非法枚举、负指标或结构缺失都会使严格 reader 返回 `null`。不得在 CLI、Bot 或复核流程中改用浅层 `JSON.parse` 绕过校验。
4. 显式指定无效快照时应失败并返回非零退出码；自动选择最新快照时应跳过无效日期并继续寻找最近的有效快照，不能用坏数据生成复核工件。
5. 查询顺序是端内 ID、直接同款组 ID、别名。别名命中多个同款组时必须返回候选让用户澄清，不得自行挑选。
6. 快照是只读派生产物，不回写链接档案。档案变更仍通过 review CSV、人工确认和 `link-registry:apply-*` 流程完成。
7. 飞书库存明细卡的贡献图使用历史快照 7 天取点，展示该同款组近 7 日曝光/访问/金额占同快照全盘近 7 日指标的比例。没有历史快照时必须降级为当前快照单点，不得伪造逐日趋势。

典型链路：

```text
npm run public-traffic-report / npm run rebuild-latest
  -> buildInventorySameSkuSnapshot
  -> output/<runDate>/同款组经营快照_<runDate>.json
  -> 严格读取 + generation/date 一致性校验
  -> 最近 60 天历史快照读取 + 7 天取点
  -> 飞书库存卡 / link-registry group review
```

### 4.12 其他模块

| 路径 | 职责 |
|---|---|
| `src/mapping/` | 商品总表中的平台/内部商品 ID 映射、Excel 补注、分析结果 enrich |
| `src/notify/` | 飞书 App、Webhook、文本/卡片投递 |
| `src/operationsLearningLoop/` | 运营学习 quiz 与 session |
| `src/newLinkWorkflow/batch.ts` | 新链批量计划与流程 |
| `src/llm/` | provider 接口、OpenAI-compatible 实现、fake provider、JSON 校验 |
| `src/extractor/` | Ant Table 提取、行/文本标准化 |
| `src/report/` | 通用 Markdown、XLSX 构建 |
| `src/storage/` | output 路径和 run log |
| `src/observability/` | 运行日志 |
| `src/agentLearning/` | Agent 学习记录存储、clarification/tool/workflow outcome 分组、planner hint relevance/confidence 与脱敏 |

### 4.13 `vendor/rental-price-agent/`：租赁价外挂技能

外部但随仓库提供的 Playwright 技能，通过独立 daemon（默认端口 9223）向 MT-agent 暴露租赁 SaaS 操作。

主要能力：商品实时读取、改价、改库存、规格增删、租期设置、复制、下架、平台搜索、批量预览/执行/验证/回滚。当前 MT-agent 的商品修改模块已完成租赁改价主线：自然语言预览、确认卡、真实执行、审计产物、readback verify 和批量预览优化。

核心原则：**Mirror 用于定位，SaaS 商品详情页才是当前值的可信来源。**

安全流程：

```text
实时 read → 生成 diff / 规则校验 → 向用户展示 → 等待确认
  → apply + submit → readback verify → 记录任务/审计
```

执行边界：确认前只允许 read/preview/audit；确认后的 `rental.priceApply` 仍按商品串行执行，不做并发写入。PM2 重启会中断正在执行的真实 apply，不会自动续跑；恢复时必须依据 `verify-*.json` 产物核对已完成商品，只补执行缺口，禁止对完整批次重复确认。

规格和租期为未保存页面的表单级变更，必须使用原子操作（如 `spec-add-and-refresh`、`tenancy-set`）；表单改变后不可随意重新导航/重新 read，否则可能丢失未保存变更。

#### rental-price-agent 稳定版接入审计基线（2026-07-15）

稳定版 `rental-price-agent` 已正式 vendored 到项目内 `vendor/rental-price-agent/`，生产运行不得依赖外部工作副本 `C:\works\rental-price-agent-new`。当前 vendored release 的 `package.json.version`、`release-manifest.json.skillVersion`、`daemonVersion`、`protocolVersion`、`configSchemaVersion`、`stateSchemaVersion` 均为 `1.0.0`，Node 范围为 `>=18.0.0 <25.0.0`，Playwright 固定为 `1.60.0`。该版本包含正式 release manifest、生命周期命令、双根目录、版本契约、daemon hello/negotiation、action registry、restart-required 和声明式迁移框架。

稳定版的发布与运行边界：

- release-owned tree 只包含发布文件；mutable data 固定在同级 sibling data root，例如 `.<target-name>-data`，其中保存 `config.json`、`.env`、browser profile/cache、tasks、daemon identity/token/port、receipt、journal、lock 和 `restart-required.json`。
- `install`、`upgrade`、`rollback` 属于发布生命周期控制，只支持显式 `--target <absolute-path>`，生产来源只信任精确 Gitee release tag 与校验资产；checksum 只证明下载内容匹配清单，不证明 Gitee 账号未被入侵。
- `install`/`upgrade`/`rollback` 成功后会写 `restart-required.json`。旧 OpenCode session 只允许 safe-read；mutation 与 lifecycle control 必须返回 `SESSION_RESTART_REQUIRED`，由操作者手动重启后再跑 `doctor`。
- daemon 复用前必须校验 hello、instanceId、token fingerprint、releaseTreeSha256、skill/daemon/protocol/config/state 五类版本范围、persisted state digest。read 与 write 的兼容性分开判定，write 要求完全兼容。
- migration 当前是 declarative contract v2，`target-migration.json` 在 v1.0.0 中 `steps: []`。升级框架只做前向迁移，不执行 target release JS；recovery JSON 按 byte-for-byte preserved，不做 reverse migration。rollback 是 release activation rollback，不是商品字段回滚。

MT-agent 当前的 rental 解耦边界：

- `src/feishuBot/rentalPrice.ts` 的 `RentalPriceSkillClient` 是主要适配层，负责 daemon HTTP JSON action、单品预览、执行、回滚、当前页操作和审计文件；所有 MT 侧生成的 mutable artifact 必须写入 stable sibling data root，不得写入 release-owned `vendor/rental-price-agent/`。改价审计、执行校验、回滚和 fallback 产物写入 `vendor/.rental-price-agent-data/artifacts/mt-agent-audit`，不得污染 lifecycle `tasks` 状态目录。
- `src/agentRuntime/toolRegistry.ts` 暴露 planner 可见/隐藏的 `rental.*` 工具 schema、风险等级和确认要求。
- `rental.bulkPricePlan` 是当前唯一 planner-visible 的业务级批量租赁改价入口；`rental.bulkPriceApply` 是 hidden runtime 工具，只能通过持久化 `planId` 和确认卡触发。
- `src/feishuBot/rentalBulkPriceHandlers.ts` 负责批量计划持久化、候选预览、执行报告和 ledger 记录；测试基线在 `tests/rentalBulkPrice.test.ts`。
- `src/feishuBot/rentalBatchHandlers.ts`、`rentalMirrorHandlers.ts` 仍直接通过 `node scripts/batch-runner.js` / `mirror-search.js` 调 CLI，不经过 `RentalPriceSkillClient`；spec/state 路径必须校验在 stable sibling data root 的 `tasks/batches` 下。
- `src/linkRegistry/daemonCatalog.ts` 会直接调用 daemon/CLI 的 `platform-search-all` 来刷新链接档案候选。

Daemon 商品列表能力核验（2026-07-18）：

- vendored skill 的 `platform-search` / `platform-search-all` 是 safe-read，daemon 与 legacy surface 均支持；MT 侧 `RentalPriceSkillClient.platformSearchAll()` 通过稳定版 hello negotiation 后发送 `{ action: 'platform-search', keyword: '' }`，`daemonCatalog.ts` 也复用该路径，HTTP 不可用时才 fallback 到 CLI。
- `vendor/rental-price-agent/scripts/playwright-runner.js` 的 `getProductSearchChannels()` 会同时生成三类列表通道：在租 `goods`、售罄 `goods.out`、仓库 `goods.stock`；`actionPlatformSearch()` 遍历全部通道、提交搜索并聚合 rows，`findProductOnList()`（复制/下架定位路径）同样按三通道搜索。
- 因此“新版 skill 能获取 daemon 中商品页、售罄商品页、仓库商品页的商品”在代码实现和单元测试层面属实：`node scripts/run-unit-tests.js` 覆盖了三通道搜索和 channel label 保留。但这次只做静态/单测核验，未启动真实 daemon、未访问 SaaS；不要把该结论写成线上 live 验证。
- 边界：这里确认的是列表/搜索层面的商品获取。单品 `read` 仍是按已知商品 ID 进入商品详情/编辑页读取当前值，没有独立的“售罄详情页读取模式”；若售罄商品 ID 已知且后台详情页可访问，才可按普通 `read` 路径读取。

稳定版接入的当前运行边界：

1. 稳定版 daemon `submit` 必须传 `expectedProductId` 并校验当前 canonical 商品编辑页；MT 单品改价、per-spec 改价、回滚、`submitCurrent`、规格增删等 submit 路径已经补齐该参数和回归测试。新增 submit 调用不得退回裸 `send({ action: 'submit' })`。
2. `apply-current` 必须传 `allowCurrentPage: true` 与 `expectedProductId`；MT 当前页应用路径已经适配并覆盖回归。
3. legacy `verify` 变为 `verify <productId> <changes.json>`；新增代码不要依赖旧的单参数 verify。
4. `config.json` 的租期字段应迁移到 `_dynamicFields.rentDays`，不要继续假设只存在固定 `rent1day/rent10day/rent30day` 等 selector。
5. `rental.batchExecute` 同时支持 `confirmFormSetupWithoutPreview` 和 `confirmImageWithoutPreview`；图片批量执行仍必须经显式确认，不得由 planner 自主绕过预览。
6. VAS 与图片能力已有隐藏 MT 工具和回归测试，但默认不 planner-visible；可以作为人工确认/批量 spec 试点，不建议直接交给 LLM 自主执行。
7. 新版 delayed-verify 是手动触发且 fail-closed；缺 readback、零校验、setup-only 结构校验缺失、image/VAS 证据异常都不得宣称成功。
8. 新版 rollback 明确只覆盖字段/VAS，图片/spec/tenancy 不支持自动回滚；飞书卡片和报告必须如实呈现该边界。
9. MT daemon 配置读取已适配稳定版 sibling data root 下的 `daemon/daemon.port`、`daemon/daemon.token`，并在命令中携带 hello negotiation/client 元数据；新增 mutation 必须保持 negotiated dispatch，不得绕过版本/状态协商。
10. `vendor/rental-price-agent/scripts/lib/daemon-client.js` 的 negotiated command 默认超时为 `DEFAULT_DAEMON_COMMAND_TIMEOUT_MS = 60000`；租赁价真实写操作可能被页面加载、浮层或保存等待拖慢，不得把默认值退回 3 秒。若新增调用需要更短超时，必须显式传入并确认不会影响 apply/submit/verify。
11. lifecycle 命令、PM2 daemon 启停、真实 SaaS 操作、浏览器 profile 和 `.env` 都有外部副作用；审计和开发默认只做静态检查、单元测试、schema/contract 测试，不自动执行真实操作。

改价/回滚 submit 失败诊断基线（2026-07-20）：

- `src/feishuBot/rentalPrice.ts` 的 `execute(request)` 在 apply 已执行但 submit 非 `ok` 时，必须持久化 `execution-failure-<productId>-*.json` 到 `vendor/.rental-price-agent-data/artifacts/mt-agent-audit`；`rollback(request)` 在回滚 apply 已执行但 submit 非 `ok` 时，必须持久化 `rollback-execution-failure-<productId>-*.json`。两条路径都不得只返回 `submit:error` 文本。
- failure artifact 必须包含脱敏后的 submit evidence、`phase`（普通执行为 `submit`，回滚为 `rollback-submit`）、期望字段数量、`applyStatus`、`submitStatus`、`verifyStatus: 'skipped'`、`sideEffectPossible`、`retrySafe` 和相关 changes/rollback file 引用；不得写入 URL query secret 或其他敏感 token。
- 同一失败必须更新 audit task：普通执行状态为 `failed`，evidence 类型为 `execution_result`，摘要写入 `task.results.execution`；回滚状态为 `rollback_failed`，evidence 类型为 `rollback_execution_result`，摘要写入 `task.results.rollbackExecution`。task results 只保存摘要，不嵌入 raw submit 或完整 expected fields。
- 失败返回给飞书/调用方时要暴露 `resultFile`、submit message、side-effect/retry 语义，便于后续人工定位；由于 submit 结果失败后无法保证平台保存状态，verify 必须保持 skipped，不得把未验证的回滚宣称为成功。
- 该基线由 `tests/feishuBotRentalPrice.test.ts` 中的 `persists submit failure details after apply succeeds without running verify` 和 `persists rollback submit failure details after rollback apply succeeds without running verify` 覆盖；变更后至少运行 `npx vitest run tests/feishuBotRentalPrice.test.ts -t "submit failure details"`、相关 LSP diagnostics 和 `npm run build`。
- 代码修改后如果要让飞书生产 Bot 立即生效，需要显式重启 `mt-feishu-bot`；PM2 重启属于外部副作用，不能在审计/文档更新中默认执行。

业务级批量租赁改价基线（2026-07-15 已合入 master）：

- 飞书定位为控制面和审批媒介：展示任务简报、影响范围、风险摘要、确认/取消、进度和最终报告，不承载完整上下文或执行状态。
- 大批量、高风险、多步骤任务必须落本地持久化 plan/run state，由 `planId/runId/decisionId` 关联确认卡、执行队列、operation ledger、报告和 recovery。飞书卡片只引用 plan 摘要和确认 key。
- LLM 只负责把自然语言转成结构化意图，例如商品线索、规格关键词、字段、调价方式、上下限、排除规则和说明；商品范围解析、规格/字段匹配、价格计算、diff、队列执行、checkpoint、readback 和 recovery 必须由确定性代码完成。
- 已建设 `rental.bulkPricePlan` / `rental.bulkPriceApply(planId)`：用 `scope`、`selector`、`operation`、`guards` 表达“pocket3 所有含安心保字样的规格价格上调 30 块”这类需求，plan 产出候选商品、命中规格、字段变更、排除项、预览 diff、风险和不可回滚范围。
- `bulkPriceApply` 只接受已持久化且已确认的 `planId`，执行时使用持久化 plan 逐项执行、记录 operation ledger 和 final report。不得从自由文本重新解析执行参数，也不得允许 planner/continuation 直接构造 hidden apply 参数。
- Agent Explore 只能为 `rental.delist`、`rental.delistBatch`、`rental.priceRollback` 生成低层 rental 写确认；不得让 Explore 自由串联 `rental.priceApply`、`rental.perSpecPriceApply`、`rental.specDimApply` 等低层改价/规格写工具来绕过业务级 plan/apply。
- hidden 工具确认必须依赖已存储的 `requestRef`，确认时重新加载完整请求并拒绝 inline hidden payload；这条边界由 `approvalCard` 和 `agentToolConfirmStore` 维护，防止确认卡篡改或工具参数被卡片 payload 替换。
- 租赁改价确认卡已采用表格化 diff 样式（2026-07-17）：首屏展示链接数、价格字段数、审计状态、回滚文件状态；随后使用 root-level Feishu `table` 展示商品汇总和前几条详细 diff。详细 diff 优先来自 `RentalPriceAuditReference.diff` 的 `old -> new`、`change`、`changePct`、`specTitle`，缺少审计 diff 时只能展示新值，不得临时重算或反解析自由文本。
- 多链接、多规格、多租期展示规则：汇总表分页展示全部链接；详细表默认只展开前几条链接/规格，完整执行范围以已保存请求和审计文件为准。两层规格（如“特惠期 x 套餐”）当前用审计中的 `specTitle` 作为规格行标签，不强行拆维度，除非上游明确提供结构化维度。
- 改价确认卡的表格、指标块、颜色和按钮文案只改变展示，不改变执行语义：`rental.priceApply` 仍以存储的确认请求为准，按钮 callback 不得嵌入完整 `items`、审计文件路径或其他可被篡改后直接执行的数据。
- executor adapter 应独立于业务 planner：负责稳定版 skill 路径、sibling data root、daemon token/port、hello negotiation、`expectedProductId`、batch CLI 参数、错误码归一化和 no-real-op 测试替身。
- 不同业务域可共享计划对象、审批、执行、状态机和报告规范，但不要合并成一个万能工具。批量改价、日报驱动下架/补链、新链复制、规格清理、图片/VAS 应保留各自的 plan/apply 工具。
- 图片/VAS、规格/租期结构变更、release lifecycle 暂不作为第一阶段 LLM planner-visible 写工具；等字段批量改价 plan/apply 跑通并补齐回归后，再按同一计划框架逐项开放。

2026-07-16 商品修改模块当前状态：

- `rental.pricePreview` 已支持多商品 `batchRead` 快速预览；MT 侧对 `auditPreviewFromRead` 做有界并发并保持商品顺序，vendored daemon 的 `batch-read` 默认并发为 6，可用 `RENTAL_PRICE_AGENT_BATCH_READ_CONCURRENCY` 调整。
- `rental.priceApply` 仍保持串行真实写入；这是安全约束，不是性能缺口。
- “价格8”这类裸数字不得被 planner 静默解释成 `8折`；必须要求用户明确 `8折`、`0.8倍`、`+8元`、`-8元` 或绝对价格表达。
- 当前已提交的租赁相关回归覆盖：`tests/agentPricePreviewMultiplier.test.ts` 和 `tests/feishuBotRentalPrice.test.ts`；变更后至少运行这两组测试、`npm run build` 和 `node --check vendor/rental-price-agent/scripts/playwright-runner.js`。

---

## 5. 开发规范

### 5.1 Worktree 治理：强制要求

`C:\works\MT-agent` 的 `master` 是稳定集成和 PM2 运行目录，**不承载日常功能开发**。

在任何非纯读取任务前：

1. 阅读 `docs/worktree-governance.md`。
2. 检查 `git worktree list --porcelain` 与当前工作树状态。
3. 从 master 创建隔离 worktree：

```powershell
git worktree add .worktrees/<topic> -b codex/<topic> master
```

4. 在新 worktree 中实现、测试、提交。
5. 只有用户明确要求时才合入 master。

禁止：

- 在 master 直接改功能代码。
- 跨 worktree 混入其他开发现场。
- 未经要求清理分支、worktree、`.omo` 草稿或未跟踪文件。
- 未经要求 push、重启 PM2、发送真实飞书消息、跑真实抓取或执行写操作。
- 读取、打印、提交 `.env`、真实账号凭据、浏览器 profile、token 或 secret。

### 5.2 实现原则

1. **职责下沉**：CLI/飞书 handler 不复制计算；数据计算进 `agentData` / 领域模块，卡片展示进 card builder。
2. **契约单一事实源**：新增可被 LLM 调用的字段，必须同步 schema、工具元数据、执行端、错误处理、测试；不要留「schema 支持但执行端忽略」的假能力。
3. **失败要明确**：不支持的 metric/filter/sort、缺失选择器、部分读数、无法判定的状态，必须显式返回错误/告警/unknown，不得静默降级为成功。
4. **范围显式化**：单商品与同款组范围必须由统一解析器确定；若单 ID 被扩展为 N 条，确认卡必须说明原因与数量，并进行必要的二次确认。
5. **结构化优先**：数字、价格、折扣、范围、商品 ID 只从结构化字段读取；`reason` 是展示文本，不能作为业务取值来源。
6. **写操作预览优先**：先读、再算 diff、展示确认、执行、回读验证、审计；不要跳过其中任一环节。

### 5.3 LLM 语义开发方向

总体方针：**保留并强化安全骨架；将模糊理解交给 LLM 的结构化输出与 grounding；让代码只做严格校验和一次性计算；用 golden set 保证可演进。**

推荐优先级：

1. 扩展 `tests/nl-decision-golden/` 中的自然语言 → 期望工具参数 golden cases；历史修复案例、折扣歧义、同款组范围、reportQuery 错误应纳入。
2. 统一单 ID/同款组解析范围，并在确认卡回显范围推导原因。
3. 收紧价格倍数契约：LLM 只输出 `0–1 factor` 或带符号 amount；二者互斥；代码只计算一次。
4. 将平台真实支持的价格字段/档位作为单一事实源，并注入 LLM grounding。
5. 收敛 `reportQuery` 的 filter、sort、metric 契约，显式拒绝不支持项。
6. 再考虑 planner 侧的先读后规划、critic 自检和批量闭环；不要优先扩大执行端自治。

明确不要做：

- 不要为了「智能化」移除确认卡。
- 不要在没有 golden 回归保护时批量删除兼容/兜底逻辑。
- 不要让 planner 可见 hidden runtime 工具。
- 不要通过自由文本 reason 推导执行参数。
- 不要把同一句写操作因 planner 选了不同工具而解析成不同影响范围。

---

## 6. 构建、测试和验证

### 基础命令

```powershell
npm run build
npx vitest run --dir tests
```

- `npm run build`：`tsc -p tsconfig.json`。
- `npm test`：`vitest run`；在当前仓库有 `.worktrees/`、`.claude/worktrees/` 等镜像目录时，优先直接使用 `npx vitest run --dir tests ...` 限定根测试目录，避免误扫历史 worktree 测试。
- 未配置 ESLint/Prettier；保持相邻文件既有 TypeScript 风格、命名和注释密度。

按模块聚焦测试示例：

```powershell
npx vitest run --dir tests feishuBotTools.test.ts feishuBotReportStore.test.ts feishuCardDelivery.test.ts agentRuntimeToolRegistry.test.ts
npx vitest run --dir tests agentLearningStore.test.ts agentRuntimeLlmPlanner.test.ts
npx vitest run --dir tests feishuBot*.test.ts
npx vitest run --dir tests linkRegistry*.test.ts
npx vitest run --dir tests publicTraffic*.test.ts
npx vitest run --dir tests inventoryStatusSnapshot.test.ts inventoryStatusStore.test.ts inventoryStatusHistory.test.ts inventoryStatusQuery.test.ts inventoryStatusCard.test.ts linkRegistryGroupReview.test.ts linkRegistryGroupReviewCli.test.ts
npx vitest run --dir tests dailyMission*.test.ts
npx vitest run --dir tests dashboardCrawlerSource.test.ts dashboardCaptureDate.test.ts captureDashboardBatchCli.test.ts dashboardRefresh.test.ts captureDashboardCliSource.test.ts exposureCrawlerSource.test.ts
npx vitest run --dir tests tests/auditConfig.test.ts tests/auditHttp.test.ts tests/auditLogger.test.ts tests/auditFakeServiceAcceptance.test.ts tests/auditShutdown.test.ts
```

访问页补抓完成后，必须按业务数据日复核 `output`：读取每个 `公域数据上下文_<runDate>.json` 的 `date`，再检查同目录 `公域访问数据_1日.json`、`公域访问数据_7日.json`、`公域访问数据_30日.json` 是否存在、JSON 可读、`collection.complete === true` 且 `rowCount > 0`。不要只按目录名判断数据日期。

测试库覆盖 crawler、日报、报表、映射、飞书卡片/Bot、Agent runtime、链接治理、库存、活动自动化、关单信息和 LLM provider。自然语言决策相关 fixtures 位于 `tests/nl-decision-golden/`；新增语义能力应同步增加可读、稳定的 regression cases。

### 验证要求

- 只改纯函数/数据层：至少执行对应测试 + build。
- 改工具 schema/运行时/飞书路由：测试工具 contract、执行器、SDK 与 HTTP 路径（若两者共享能力）。
- 改 Agent 学习提示或 planner hint 注入：至少跑 `npx vitest run --dir tests agentLearningStore.test.ts agentRuntimeLlmPlanner.test.ts feishuBotTools.test.ts` 和 `npm run build`，并人工复核 hints 中不得出现 raw `reason`、raw `resultSummary`、URL、路径、token、secret 或可被当作指令的历史文本。
- 改链接维护 LLM 展示或 provider wiring：至少跑 `tests/linkRegistryMaintenanceSession.test.ts`、`tests/linkRegistryAuditReviewLlm.test.ts`、`tests/cliLoadEnvSource.test.ts`、相关 `tests/feishuBotTools.test.ts` 用例和 `tests/publicTrafficReportCliBehavior.test.ts`；命令同样使用 `npx vitest run --dir tests ...`，避免误扫历史 worktree 测试。
- 改 crawler：优先 source/fixture 测试；真实后台抓取需先获授权。
- 改库存快照：至少覆盖 builder、strict reader、query、card、Bot 工具和 group-review CLI；验证 `null`/零值语义及 generation/date 一致性门禁。
- 改写操作：必须补齐 preview、确认、拒绝、重复确认、失败、readback/审计测试。
- 改 Daily Mission：至少测试审批与 run 一致性、持久化幂等、二次确认卡、run artifact 隔离、journal/audit 更新。

---

## 7. 运行与 PM2

常见入口：

```powershell
npm run public-traffic-report
npm run feishu-bot:sdk
npm run agent:dry-run -- "查询 565"
npm run activity-automation:scout
```

PM2 定义见 `ecosystem.config.cjs`：

| 应用 | 实际入口 | 用途 |
|---|---|---|
| `mt-feishu-bot` | `src/cli/feishuBotSdk.ts` | 飞书 SDK 长连接服务 |
| `mt-rental-price-agent` | `vendor/rental-price-agent/scripts/playwright-runner.js` | 租赁价浏览器 daemon |

PM2 重启、真实消息发送、daemon 启停均可能产生外部影响；仅在用户明确授权后执行。不要把测试成功等同于生产可用：生产还依赖 `.env`、飞书应用配置、浏览器登录态、业务后台可达性和账号权限。

---

## 8. 环境变量与数据安全

常见变量示例见 `.env.example`；Audit Logger 变量以本文件和运行时配置为准。主要分组：

| 分组 | 典型变量 |
|---|---|
| 飞书应用/投递 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_SEND_TO` |
| 飞书 Bot | `FEISHU_BOT_USE_SDK`、`FEISHU_BOT_OPEN_ID`、`FEISHU_BOT_PORT`、验证/加密配置 |
| LLM | `MT_AGENT_LLM_PROVIDER`、`MT_AGENT_LLM_BASE_URL`、`MT_AGENT_LLM_MODEL`、`MT_AGENT_LLM_API_KEY` |
| 输出与技能 | `MT_AGENT_OUTPUT_DIR`、`RENTAL_PRICE_AGENT_DIR`、daemon URL/token |
| 外部业务接口 | `GOODS_MANAGER_BASE_URL`、`CLOSED_ORDER_REMARKS_BASE_URL`、API token |
| Audit Logger | `AUDIT_INGEST_URL`、`MT_AGENT_AUDIT_AGENT_ID`、`MT_AGENT_AUDIT_LOG_DIR`、`AUDIT_INGEST_TIMEOUT_MS`、`AUDIT_RETRY_ENABLED`、`AUDIT_RETRY_MAX_BATCH`、`AUDIT_FLUSH_TIMEOUT_MS` |

Audit Logger 变量由运行时配置使用；不要据此声称 `.env.example` 当前已经包含这些变量。

规则：

- `.env`、浏览器 profile、输出中可能含敏感数据的文件不能提交。
- 日志、异常、卡片和测试断言不得输出 API key、认证 token、完整私密业务数据。
- 真实用户/商品数据的 fixture 需要脱敏；优先构造最小测试数据。

---

## 9. 必读文档索引

| 文件 | 用途 |
|---|---|
| `README.md` | 对外项目总览、安装、环境配置、常用命令 |
| `docs/worktree-governance.md` | **开发前必读**：master/worktree 规则与历史现场说明 |
| `docs/llm-agent-runtime.md` | LLM planner、confirmation、continuation 的运行时规则 |
| `docs/agent-command-corpus-template.md` | Agent 命令语料与预期工具参数模板 |
| `docs/agent-runtime-refactor-development-audit-2026-07-02.md` | Daily Mission 已知缺口与推荐修复顺序 |
| `docs/audit-logger-integration-development-assessment-2026-07-21.md` | Audit Logger 集成开发评估与剩余运行边界 |
| `docs/superpowers/plans/2026-07-21-audit-logger-daily-report-integration.md` | Audit Logger 日报集成实现计划 |
| `docs/feishu-bot-readonly-command-agent-merge-handoff.md` | 飞书只读命令 Agent 交接资料 |
| `docs/superpowers/specs/2026-06-24-inventory-same-sku-snapshot-card-design.md` | 同款组经营快照与库存卡设计规格 |
| `docs/superpowers/plans/2026-06-24-inventory-status-card-chart.md` | 库存卡图表实现计划 |
| `docs/rental-skill-diff-report.md` | rental-price-agent 稳定版差异与适配审计 |
| `docs/delivery/` | 具体功能交付记录 |
| `docs/superpowers/specs/` | 设计规格 |
| `docs/superpowers/plans/` | 分阶段实现计划 |
| `vendor/rental-price-agent/SKILL.md` | 租赁价技能完整协议、动作和安全流程 |

---

## 10. 新 Agent 接手清单

1. 阅读本文件、`README.md`、`docs/worktree-governance.md`。
2. 确认当前目录是否为 master；非纯读取任务先创建独立 worktree。
3. 查看 `git status --short --branch`，不得覆盖未知变更。
4. 阅读目标模块及相邻测试；先理解既有数据/卡片/工具 contract，再修改。
5. 如涉及 LLM，读取 `docs/llm-agent-runtime.md`、`docs/agent-command-corpus-template.md` 和相关 specs/plans；确认工具是 planner-visible 还是 hidden。
6. 如涉及写操作，检查完整的 preview → confirmation → execute → verify → audit 路径。
7. 先写/更新失败测试，再实现最小改动；运行目标测试与 `npm run build`。
8. 汇报时准确说明：改动范围、验证命令、通过/失败情况、未运行的真实环境验证及原因。
9. 不要主动 merge、push、重启 PM2 或执行真实业务写入；等待明确指令。
