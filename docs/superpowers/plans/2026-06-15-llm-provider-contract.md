# LLM Provider 契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立 LLM provider 契约、JSON 解析、fake provider 和 OpenAI-compatible provider，为后续飞书自然问句工具路由提供稳定基础。

**Architecture:** 所有新代码放在 `src/llm/`，不接入 `feishuBot`。Provider 只生成并解析 JSON，不执行工具、不处理权限、不读取日报。

**Tech Stack:** TypeScript、Node.js fetch 类型、Vitest、现有 ESM/NodeNext 配置。

---

## Task 1: Provider 类型契约

**Files:**
- Create: `src/llm/provider.ts`
- Test: `tests/llmProviderTypesSource.test.ts`

- [ ] Write failing source test that checks `LlmProvider`, `LlmChatMessage`, `LlmGenerateJsonInput`, `LlmProviderResult` are exported.
- [ ] Run `npm test -- tests/llmProviderTypesSource.test.ts` and confirm it fails because file is missing.
- [ ] Create `src/llm/provider.ts` with role/message/input/result/provider interfaces.
- [ ] Run the focused test and confirm pass.
- [ ] Commit `功能：定义LLM Provider契约`.

## Task 2: JSON 解析工具

**Files:**
- Create: `src/llm/json.ts`
- Test: `tests/llmJson.test.ts`

- [ ] Write tests for valid object, empty output, markdown fenced JSON, array, null, and invalid JSON.
- [ ] Run `npm test -- tests/llmJson.test.ts` and confirm failure.
- [ ] Implement `parseLlmJsonObject(text)` with clear errors.
- [ ] Run focused test and confirm pass.
- [ ] Commit `功能：新增LLM JSON解析约束`.

## Task 3: Fake Provider

**Files:**
- Create: `src/llm/fakeProvider.ts`
- Test: `tests/llmFakeProvider.test.ts`

- [ ] Write tests that fake provider returns fixed parsed JSON and records last input.
- [ ] Run `npm test -- tests/llmFakeProvider.test.ts` and confirm failure.
- [ ] Implement `FakeLlmProvider` using `parseLlmJsonObject`.
- [ ] Run focused test and confirm pass.
- [ ] Commit `功能：新增测试用LLM Provider`.

## Task 4: OpenAI-compatible Provider

**Files:**
- Create: `src/llm/openAiCompatibleProvider.ts`
- Test: `tests/llmOpenAiCompatibleProvider.test.ts`

- [ ] Write tests with fake fetch for request body/header, successful JSON parse, HTTP error, missing content, env factory complete/missing config.
- [ ] Run `npm test -- tests/llmOpenAiCompatibleProvider.test.ts` and confirm failure.
- [ ] Implement `OpenAiCompatibleLlmProvider` and `createOpenAiCompatibleProviderFromEnv`.
- [ ] Run focused test and confirm pass.
- [ ] Commit `功能：新增OpenAI兼容LLM Provider`.

## Task 5: Verification

**Files:**
- All touched files

- [ ] Run focused tests:

```bash
npm test -- tests/llmProviderTypesSource.test.ts tests/llmJson.test.ts tests/llmFakeProvider.test.ts tests/llmOpenAiCompatibleProvider.test.ts
```

- [ ] Run full tests:

```bash
npm test -- --exclude ".worktrees/**"
```

- [ ] Run build:

```bash
npm run build
```

- [ ] Check `git status --short --branch` is clean after final commits.
