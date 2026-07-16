# rental-price-agent

基于 Playwright 的 SaaS 租赁平台改价 Agent Skill。用于在没有 API 的后台系统中，通过浏览器自动化完成商品价格、库存、规格的批量修改。

## 能力

- **单商品改价**：读取 → 预览 → 确认 → 填入 → 保存 → 验证
- **批量改价**：镜像搜索 → 排除链接价/MQ 专人维护商品 → 生成 spec → 预览 → 串行执行 → 延迟验证 → 镜像回写
- **单商品结构覆盖**：批量 spec 支持全局 shared setup，也支持 item 级 tenancy/spec 覆盖或合并
- **规格管理**：新增/删除规格项、刷新规格表
- **租期管理**：设置租赁天数
- **图片管理 v2**：读取商品图/白底图、按分类+文件名选择已有素材、上传新素材并可选立即回写、设置首图、调整顺序
- **商品增值服务 VAS v1**：按唯一服务 ID 绑定现有服务，管理开关、适用平台、服务顺序及默认/强制/弹窗选项
- **审计与回滚**：操作记录、变更报告、字段/VAS 回滚预览与显式确认执行

## 生命周期与发布范围

- 运行时 Node 范围以 `release-manifest.json` 和 `package.json` 为准，当前是 `>=18.0.0 <25.0.0`。
- 日常 SaaS 自动化命令按当前仓库脚本运行。`install`、`upgrade`、`rollback` 这组发布生命周期命令目前只支持 Windows。
- 所有生命周期命令都要求显式 `--target <absolute-path>`。`--target` 指向发布目录，不指向 data root。
- 发布来源只信任精确仓库 `lcc0628/rental-price-agent` 和显式 Gitee Release tag。不会自动发现本地副本，不支持热升级。
- `sha256` 只证明下载内容和发布清单一致，不证明 Gitee 账号本身没有被入侵。

## 版本边界

区分以下版本，不要混用：

- Skill version: 发布包本身版本，来自 `package.json.version` 和 `release-manifest.json.skillVersion`
- Daemon version: daemon 协议实现版本
- Protocol version: daemon hello / negotiation 协议版本
- Config schema version: `config.json.configSchemaVersion`
- State schema version: `tasks/`、`tasks/batches/`、recovery 文档中的 `stateSchemaVersion`

生命周期只支持前向迁移。`upgrade` 从已校验的 staged release 读取 `scripts/lib/target-migration.json`，它是 declarative migration contract v2，不加载可执行 target 代码，也不会执行 target release 自带 JS。release manifest 分别声明 target 可读 schema 范围和可迁移 source 范围。迁移只作用在 operation-owned 临时 JSON 快照上，提交时把 config、task index、task、batch 与 recovery JSON 和代码激活放进同一个 durable transaction。recovery 文档按 schema-less JSON 校验，只要求 broadcast 或 per-spec 结构合法，升级与回滚期间都按原始字节 preserved byte-for-byte，不参与 reverse migration。任一 code/data/doctor/metadata 故障都会恢复原始代码和原始字节。`.env`、browser profile/cache、evidence 与 daemon identity 不参与迁移。`rollback` 不做 reverse migration，只在当前 mutable data 仍落在上一个 release 的可读范围内时允许切回。

## 安装目标与 data root

给定 `--target <absolute-skill-target>` 时，mutable data 固定放在同级目录 `<sibling-data-root>`。

```text
<absolute-skill-target>\               release-owned tree
  README.md
  SKILL.md
  config.example.json
  package.json
  package-lock.json
  release-manifest.json
  scripts\
  references\
<sibling-data-root>\                   mutable data root
  config.json
  .env
  browser-profile\
  browser-cache\
  tasks\
    _index.json
    batches\
  daemon\
    identity.json
    daemon.pid
    daemon.port
    daemon.token
  install-receipt.json
  lifecycle.lock
  lifecycle-journal.json
  restart-required.json
```

所有权规则：

- release-owned 文件只在发布目录内，哈希由 install receipt 固定
- mutable data 只在 sibling data root 内
- 生命周期拒绝 symlink、junction、跨卷 staging、未识别的非空目标
- `.env`、daemon token、browser profile/cache、tasks、journal、lock 都属于 mutable data，不属于 release inventory

## 浏览器策略

- `--browser chrome` 表示 system Chrome，对应 release policy `system-chrome`
- `--browser chromium` 表示 Playwright managed Chromium，对应 release policy `managed-chromium`
- 当前 release policy 默认 `chrome`，`allowFallback=false`
- `doctor` 会验证配置中的 browser policy、实际可启动 source、install receipt 中记录的 selectedSource，以及版本漂移告警

## 生命周期命令

先跑只读检查，再做安装或切换。

```bash
node scripts/init.js --target "<absolute-skill-target>"
node scripts/lifecycle.js --help
node scripts/lifecycle.js status --target "<absolute-skill-target>"
node scripts/lifecycle.js doctor --target "<absolute-skill-target>"
node scripts/lifecycle.js install --target "<absolute-skill-target>" --repo lcc0628/rental-price-agent --tag v1.0.0 --browser chrome
node scripts/lifecycle.js upgrade --target "<absolute-skill-target>" --repo lcc0628/rental-price-agent --tag v1.0.1 --browser chrome
node scripts/lifecycle.js rollback --target "<absolute-skill-target>" --dry-run
node scripts/lifecycle.js rollback --target "<absolute-skill-target>" --confirm v1.0.0@0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

`init` 当前支持省略 `--target`，但那只会检查当前 skill 目录本身。它不是安装目标推断，也不应用来代替显式发布目录。

操作规则：

- `init` 只跑 read-only doctor 汇总，不创建 config，不安装依赖，不复制示例文件
- `status` 只报 presence、versions、receipt、daemon identity、`restartRequired`
- `doctor` 给出 `readyForReads` / `readyForWrites` 和 blocker 列表。任何 fail check 都会让命令非零退出
- `install` 只允许空目录、缺失目录，或已识别 legacy 目录
- `upgrade` 只允许升到更高 release，不允许 downgrade，不会自动清理 unresolved batch/task/recovery state
- `rollback` 默认是 dry-run。只有把 dry-run 返回的精确 `version@digest` token 原样传回 `--confirm` 才会执行

## restartRequired 与 daemon 兼容性

- `install`、`upgrade`、`rollback` 成功后都会写入 `restart-required.json`
- 在旧 OpenCode session 中，safe-read 还能继续，mutation 和 lifecycle control 会被 `SESSION_RESTART_REQUIRED` 阻断
- 不会自动重启 OpenCode。必须由操作者手动重启，然后再跑 `doctor`
- daemon 复用前会校验 hello、instanceId、token fingerprint、releaseTreeSha256、版本范围。版本不兼容时，safe-read 和 write 会按协商结果分开阻断

## 升级、回滚、恢复

- `upgrade` 只保留一个 previous slot，也就是 `<target>.previous`
- `rollback` 只认上一次已提交 upgrade 留下的那个 previous slot
- `rollback` 是 release activation rollback，不是 SaaS 商品字段批量回滚。商品批量回滚仍使用 `batch-runner.js rollback`
- lifecycle journal 记录 install / upgrade / rollback 的 durable phase。中断后下一次生命周期命令会先恢复或明确报错
- live daemon 清理如果发现进程还活着但 identity 或 token 无法安全复用，会返回 `DAEMON_RECOVERY_REQUIRED`，要求先做人工恢复或 stop
- lifecycle install / upgrade / rollback 如果操作已完成但 owned lock 无法释放，会返回 `LIFECYCLE_LOCK_RELEASE_FAILED`
- declarative migration 如果数据迁移已完成但 migration lock 无法释放，会返回 `MIGRATION_LOCK_RELEASE_FAILED`
- validated daemon stop 如果终止结果已确定但 stop lock 无法释放，会返回 `DAEMON_STOP_LOCK_RELEASE_FAILED`
- 没有 automatic copy discovery，没有 hot upgrade，也不会扫描其他目录寻找候选 release

## 发布准备

先在仓库外的全新绝对临时目录生成并离线验证发布资产：

```bash
node scripts/build-release.js --verify --output "<absolute-temp-dir>"
```

命令使用 `package.json` 与 `release-manifest.json` 的规范版本/tag；如显式传入 `--version X.Y.Z --tag vX.Y.Z`，值也必须与规范文件完全一致。输出目录不得位于 Skill 源码树内，命令不会把归档留在仓库中。

验证成功后，操作者在 Gitee 为精确 tag `vX.Y.Z` 手工创建 Release，再手工上传同一输出目录中的三件套；本命令不会创建 tag、push 或 publish：

1. `rental-price-agent-vX.Y.Z.tgz`
2. `rental-price-agent-vX.Y.Z.manifest.json`
3. `rental-price-agent-vX.Y.Z.sha256`

资产名、tag、hash、bytes 必须一致。外部清单必须是 schema 2，逐文件记录规范路径、bytes、SHA-256、mode 与 type，并与归档的完整文件/目录集合精确一致。校验文件必须是唯一一行 `<64 lowercase hex><two spaces><archive name><LF>`。详细格式和故障处理见 `references/process.md`。

## SaaS 操作快速开始

```bash
# 1. 启动 daemon
node scripts/playwright-runner.js daemon start

# 2. 首选 daemon send。单商品读取，回归测试只能使用商品 ID 761
echo '{"action":"read","productId":"761"}' > cmd.json
node scripts/playwright-runner.js daemon send --file cmd.json

# 2B. 直接 HTTP 只用于 advanced diagnostics。先从 target 计算 sibling data root，再读取 daemon\daemon.token
$target = "<absolute-skill-target>"
$dataRoot = Join-Path (Split-Path -Parent $target) ("." + (Split-Path -Leaf $target) + "-data")
$token = Get-Content (Join-Path $dataRoot "daemon\daemon.token")
Invoke-RestMethod -Uri http://127.0.0.1:9223 -Method POST -Headers @{"X-Rental-Agent-Token"=$token} -Body '{"action":"read","productId":"761"}' -ContentType "application/json"

# 3. 批量改价
node scripts/mirror-search.js batch-spec ipod > batch.json
node scripts/batch-runner.js preview batch.json
node scripts/batch-runner.js execute batch.json

# 4. 停止 daemon
node scripts/playwright-runner.js daemon stop
```

## VAS 批处理示例

```json
{
  "items": [
    {
      "productId": 761,
      "vas": {
        "enabled": true,
        "platforms": ["wechat", "h5"],
        "services": {
          "upsert": [
            {
              "id": "1",
              "defaultSelected": true,
              "isForce": false,
              "isPopup": false,
              "expectedName": "安心保（200元内损坏直接免赔）",
              "expectedMoney": "30.00"
            }
          ],
          "remove": ["8"]
        }
      }
    }
  ],
  "options": { "stopOnError": true }
}
```

- `services.set` 是完整有序快照；`services.upsert + remove` 是幂等补丁，两种模式互斥。
- `platforms` 按集合比较，服务按数组顺序比较。关闭 VAS 默认保留平台和服务，只有 `services.set: []` 才清空服务。
- `isPopup=true` 最多一个；`isForce=true` 要求 `defaultSelected=true` 且 `isPopup=false`。
- no-op batch item 会被拒绝；如果 item 本身无字段变化，但命中了 shared setup，shared setup 仍算有效操作。
- `preview` 真实执行 `vas-read → vas-catalog-read → buildTarget/validate/diff`，不提供绕过预览的 `confirmVASWithoutPreview`；所有布尔选项必须使用 JSON boolean，`platforms` 与 `services.set/upsert/remove` 必须使用数组，类型错误会阻断执行。工作流要求先给 agent/operator 看预览并拿到显式确认，但 batch execute 没有统一的确认 token 或工件校验，只有 form setup 和 image 路径存在显式执行开关。
- `execute` 在图片之后应用完整 `expectedVAS`，与字段/图片只提交一次；提交后立即 `vas-verify`。
- `delayed-verify` 使用 state 中执行时确定的 `vasExpected`，不会从原始 patch 重新推导。
- `rollback` 直接使用 state 中保存的完整 `vasBefore` 快照恢复，不依赖当前服务库重建；候选覆盖已提交的 `completed` 与 `verifyFailed`，明确排除未提交的 `previewOnly`。字段回滚和其回读均只覆盖可恢复的字段，并支持任意 `rent{N}day` 动态租期。
- rollback preview 与 rollback --confirm 只执行同时具备字段或 VAS 恢复数据的候选；若过滤后为空则直接失败。rollback 验证要求非零字段校验或严格 VAS 证据，绝不会把 unsupported-only 候选报成 `0/0` 成功。图片 / spec / tenancy rollback 当前未实现，不支持的候选会被排除。
- 第一版只管理商品与现有服务的绑定，禁止服务库 CRUD，不调用 `incrementAdd`、`incrementDel`。
- daemon 模式下的 `submit` 现在要求 `expectedProductId`，并校验当前页是 canonical 商品编辑页：正整数商品 ID、预期 origin/path、`r=goods.edit`、`id=<expectedProductId>` 都必须匹配。
- 图片与 VAS 的当前页导航也会在到达目标商品后再次校验 canonical 当前页，再进行任何 DOM 修改。
- submit 响应观察器在点击前立即 arm，只采集点击后的匹配 AJAX 响应；会锁定首个与点击关联的匹配保存请求 identity，后续不同 identity 的匹配请求会被忽略；完成后 cleanup/disarm，点击前旧响应会被忽略。
- submit 点击序列先执行观察器关闭状态下的滚动/预检 `trial`，再 arm 观察器并立刻执行 `force` 派发；`trial` 失败仍属 pre-dispatch，最多允许单次重试，`force` timeout 仍属 ambiguous 且不重试。
- 只有显式匹配的 AJAX 业务成功响应才会直接返回 `ok`。redirect、URL 变化、toast-only、3xx、空响应、陌生响应都保留为 `unknown`，必须依赖 readback。
- short grace 只用于等待已捕获请求的最终 body 或完成 cleanup；后续不同请求不会重新并入判定。只有已捕获请求自己的 pending body 才会在 timeout 时 fail-closed 落为 `unknown`。
- malformed、非对象或缺少关键状态字段的 daemon submit 结果会统一归一化为 `unknown`，并只保留有界 raw preview。
- submit 结果采用有界递归、failure-first 的 JSON 检查；只要嵌套 `result` 或 `data` 中出现显式失败，就覆盖顶层 success。截断后的 JSON 预览不会单独采纳 success，除非更早已经命中显式失败，否则保守返回 `unknown`。
- 仓库已验证的 `status=1` / `code=1` 可接受为业务成功；裸 `code=0` / `code=200` 不接受；嵌套 failure text 优先判定失败。
- submit 证据预览在写入 state 或 report 前会先脱敏敏感 URL query value，并按 camelCase 与分隔符归一化后的敏感 key 继续脱敏，只保留有界 preview；请求 body、header、cookie 不会持久化。
- click timeout 视为 dispatch-ambiguous：不自动重试，返回 `unknown`，`submitted=null`、`sideEffectPossible=true`、`retrySafe=false`。只有 proven pre-dispatch failure 允许单次重试。
- submit transport exception 如果发生在 `submitting` checkpoint 之后，会落为 `recovery_required` / `verify_failed`，按 side-effect-possible 处理，并阻断自动二次 submit。
- batch 只能在至少一个适用 readback 校验成功且没有任何失败校验时，把原始 `unknown` 保守解析为成功；原始审计状态仍保留 `unknown`。
- batch 会在 submit command dispatch 前保存每商品 `submitting` checkpoint，在拿到 submit 响应后再保存 `submitted` checkpoint。state 会在同目录原子落盘，`resume` 会阻止对 `submitting` / `submitted` / `recovery_required` / 待人工核验商品的自动二次 submit，并要求先做人工核验或恢复；只要创建 recovery，原始 state 就会标记为 `recovery_required`，即使其他商品仍在继续；父 `resumed` 终态链路会阻止旧 state replay；report 会对 `completed`、`verifyFailed`、`failed` 同时展示 raw submit 与 resolution。
- immediate field verify 遇到 expected changes 但零校验时也会 fail-closed。
- immediate image/VAS verify 也要求严格的非零精确计数。
- delayed applicable image/VAS 只要出现 `0/0` 计数也按 fail-closed 处理。
- `delayed-verify` 现在 fail-closed：自动 readback 只覆盖已支持的字段、图片、VAS 范围。read error、没有 values、声明了 expected fields 但零校验、仅做 tenancy/spec setup 且结构型 readback 缺失导致的零校验、适用的图片或 VAS 校验缺失或结构异常都会直接失败；image/VAS `verifyResult` 计数必须是非负整数且满足 `total = matched + mismatched`，否则按失败处理。
- `delayed-verify` 不会自动提升 `verifyFailed` / `recovery_required` 条目，也不会在仍有 unresolved 条目时把批次置为 `delayed_verified`；summary/report 会暴露 unresolved count，并把 `submitting` / `submitted` inFlight 项计入且不重复。
- batch 终态优先级以 `recovery_required` 为最高；重复或非法 product ID 会在入口直接拒绝；audit 只保留有界 response evidence 预览。
- legacy `verify` 用法应为 `verify <productId> <changes.json>`。
- legacy `apply <productId> <changes.json> --submit` 只有在 apply 状态为 `ok` 时才会真正提交；`partial` / `error` 只记录 skipped submit，绝不会保存页面。若 submit 返回嵌套 `error` / `unknown`，顶层状态会原样透传，并保留 `sideEffectPossible` / `retrySafe`。
- legacy `verify <productId> <changes.json>` 支持 flat 与嵌套 spec-specific change 文件，并在 read failure、无 values、缺 spec 或缺字段时干净失败。
- audit report 对 `completed`、`verifyFailed` 会展示 field/image/VAS/recovery 细节；对 `failed` 会展示 raw submit/resolution；同时展示每商品 delayed 域计数和有界 response evidence。
- rollback preview 与 rollback --confirm 使用同一套过滤候选集，包含 `completed` 与 `verifyFailed`，排除 `previewOnly`。
- flat `rent{N}day` 镜像回写会做动态映射；任一字段无法映射时整条 item 会被拒绝，防止部分写回。嵌套 per-SKU writeback 仍显式不支持并跳过。
- 镜像回写的 guarded contract 只有：状态必须是 `delayed_verified`，且必须带有效的 `delayedVerify.at` 作为 `verified_at`；缺失或非法时间戳会直接拒绝写回，绝不使用当前时间兜底。写回时带 `source='saas_verify'`。不承诺镜像冲突时间戳检查，也不承诺把 writeback 历史写入 task-store。
- `task-store` 状态是宽松的操作记录，不做严格状态迁移承诺；batch-state 生命周期单独强制执行，状态包含 `running`、`stopped`、`partial`、`completed`、`completed_with_mismatch`、`recovery_required`、`resumed`、`delayed_verified`、`delayed_verify_partial` 等。

## 文档与本地验证命令

- `node scripts/run-unit-tests.js`
- `node scripts/run-lifecycle-tests.js --offline --forbid-saas --case documentation-contract`
- `node --check scripts/playwright-runner.js`
- `node --check scripts/batch-runner.js`
- `node --check scripts/mirror-search.js`

## 当前剩余限制

- 自动 readback 仅覆盖已支持的字段 / 图片 / VAS 范围。仅做 setup 的 tenancy/spec 修改时，提交后仍缺少专门的结构型 readback 校验，delayed-verify 在这类结构校验缺失时继续 fail-closed。
- `skipSubmit` + 图片上传仍可能在素材库留下副作用，且早退路径的清理并不保证对所有分支都完全覆盖。
- live 商品 653 仍需抓到 submit 对应 POST 的精确 URL、status、content-type 和 body，才能宣布问题彻底关闭。

## 双根架构摘要

- `<absolute-skill-target>` 是 release-owned tree，只放发布包清单里的文件
- `<sibling-data-root>` 是 mutable data root，只放 config、`.env`、browser profile/cache、tasks、daemon、receipt、journal、lock、restart marker
- 任何文档、命令或排错步骤都不能把 mutable data 误写成 release-owned 文件

## 环境要求

- Node.js `>=18.0.0 <25.0.0`
- Windows 是发布生命周期命令的受支持平台
- `.env` 只放凭据，占位符继续写在 `config.json` 中

## 安全

- 凭据存储在 `.env` 文件，不入库
- `config.json` 使用 `${VAR}` 占位符，运行时从环境变量解析
- 工作流要求先预览并拿到显式确认后再执行，但 batch execute 没有统一的确认 token 或工件校验，只有 form setup 和 image 路径存在显式执行开关
- 自动回读验证仅覆盖已支持的字段 / 图片 / VAS 范围，tenancy/spec-only 结构修改仍缺少专门 readback，并在 delayed-verify 中 fail-closed
- 发布生命周期只信任明确的 `--target`、`--repo`、`--tag`、`--browser` 输入，不会自动推断或替换

## License

MIT
