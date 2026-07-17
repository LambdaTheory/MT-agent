# Link Registry LLM 二层建议实施计划

**Goal:** 在链接档案审计的一层确定性降噪之后，为剩余高价值待审项接入可选 LLM 建议层，帮助人工审批判断，但不自动写入 override、不绕过人工确认。

**Architecture:** 保持 `maintenance` 只做确定性过滤；新增审计 review enrichment 层读取 `LlmProvider`，对每条 `LinkRegistryAuditReviewRow` 生成结构化建议并写入 JSON/CSV/Markdown 审批产物。CLI 默认不调用 LLM，只有显式 `--llm-suggestions` 且环境中可创建 provider 时才启用。

**Tech Stack:** TypeScript ESM、vitest、现有 `src/llm/provider.ts` / `FakeLlmProvider` / `createLlmProviderFromEnv`。

## Global Constraints

- LLM 只产候选建议，不产最终审批值，不写 `decision` / `finalSameSkuGroupId` / `finalCategoryName` / `finalProductType` / `finalShortName`。
- 单元测试只用 `FakeLlmProvider` 或手写 provider，不调用真实外部 LLM。
- LLM 输出必须 schema 校验；非法、空、异常都降级为无建议或 unavailable 元数据，审计 CLI 不因此失败。
- Prompt 只传 bounded row context，不暴露文件系统、shell、凭证或 override 写入能力。
- 审批产物必须明确标注“LLM 建议仅供人工确认”。

## Scenarios

1. Happy path: `buildLinkRegistryAuditReviewReport` 接收 fake LLM 建议后，JSON row 带 `llmSuggestion` 字段，CSV 和审批 Markdown 渲染建议文本；真实 surface 为 `link-registry:audit --llm-suggestions --json` 产物。
2. Edge path: LLM 返回非法结构、低置信或注入式文本时，不写最终审批字段，row 只记录 unavailable/empty suggestion；测试证明不会执行任何写操作。
3. Adjacent regression: 不启用 `--llm-suggestions` 时，现有审计队列、CSV/Markdown 基础字段和 7 条高价值待审结果保持可用。

## Implementation Waves

### Wave 1: Row contract and LLM suggestion builder

- Add `LinkRegistryAuditReviewLlmSuggestion` fields to review rows.
- Add a small validator/parser for accepted LLM output: action, confidence, rationale, suggested fields, uncertainties.
- Add prompt builder that sends only row summaries.
- Tests first in `tests/linkRegistryAuditReviewLlm.test.ts`.

### Wave 2: Renderers and CLI opt-in

- Extend JSON/CSV/approval Markdown/guide renderers with LLM suggestion fields.
- Add `--llm-suggestions` to `src/cli/linkRegistryAudit.ts`; default remains disabled.
- Use `createLlmProviderFromEnv(process.env)` only when the flag is present.
- If provider is unavailable, write artifacts without suggestions and print disabled summary.

### Wave 3: Verification and surface QA

- RED: run new LLM tests before implementation and capture the failure.
- GREEN: run targeted link-registry audit tests.
- Surface: run `npm run link-registry:audit -- --llm-suggestions --json` with LLM disabled to prove safe opt-in behavior, and run a unit-level fake-provider path for suggestions.
- Build: run `npm run build`.
- Diagnostics: run LSP diagnostics on changed source/test files.

### Wave 4: Formal security audit

- Run a post-implementation security audit focused on prompt injection, unintended writes, secret leakage, SSRF/external provider configuration, malformed output handling, and artifact injection.
- Stop after reporting audit results.
