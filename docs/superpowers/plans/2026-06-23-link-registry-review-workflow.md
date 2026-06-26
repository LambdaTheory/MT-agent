# Link Registry Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable candidate same-SKU workflow that groups existing registry entries, exports a human review list, reads review decisions, and materializes formal link-registry overrides.

**Architecture:** Add a focused `src/linkRegistry/reviewWorkflow.ts` module that owns candidate grouping, review-list serialization, decision parsing, and override materialization. Keep the runtime contract simple: registry-in, review artifacts out; decision file in, formal overrides out; then reuse the existing override pipeline and audit flow for verification.

**Tech Stack:** TypeScript, existing link registry modules, tsx CLI entrypoints, Vitest.

---

### Task 1: Candidate Review Model

**Files:**
- Create: `src/linkRegistry/reviewWorkflow.ts`
- Create: `tests/linkRegistryReviewWorkflow.test.ts`

- [ ] **Step 1: Write the failing test for candidate group export**

```ts
it('builds review candidates from strong and medium same-sku signals', () => {
  const review = buildLinkRegistryReviewCandidates(entries);
  expect(review.generatedAt).toBe('2026-06-23');
  expect(review.candidates[0]).toMatchObject({
    proposedShortName: 'DJI Pocket 3',
    proposedSameSkuGroupId: 'dji-pocket-3',
    confidence: 'high',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts`
Expected: FAIL because `buildLinkRegistryReviewCandidates` does not exist yet.

- [ ] **Step 3: Write minimal candidate model and grouping implementation**

```ts
export interface LinkRegistryReviewCandidate { ... }
export interface LinkRegistryReviewArtifact { ... }
export function buildLinkRegistryReviewCandidates(entries: LinkRegistryEntry[], options?: ...): LinkRegistryReviewArtifact { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts`
Expected: PASS for candidate export tests.

- [ ] **Step 5: Commit**

```bash
git add src/linkRegistry/reviewWorkflow.ts tests/linkRegistryReviewWorkflow.test.ts
git commit -m "feat: add link registry review candidate model"
```

### Task 2: Review CLI Export

**Files:**
- Create: `src/cli/linkRegistryReviewCandidates.ts`
- Modify: `package.json`
- Test: `tests/linkRegistryReviewWorkflow.test.ts`

- [ ] **Step 1: Write the failing test for CLI-ready review artifact formatting**

```ts
it('serializes review candidates with grouped entries and reasons', () => {
  const review = buildLinkRegistryReviewCandidates(entries, { generatedAt: '2026-06-23' });
  const pocket = review.candidates.find((item) => item.proposedSameSkuGroupId === 'dji-pocket-3');
  expect(pocket?.reasons).toContain('normalized_name_match');
  expect(pocket?.entries.map((entry) => entry.internalProductId)).toEqual(['701', '702', '703']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts`
Expected: FAIL on missing fields or incorrect review artifact shape.

- [ ] **Step 3: Add CLI that loads the current registry and writes review artifact JSON**

```ts
export async function runLinkRegistryReviewCandidatesCli(argv = process.argv.slice(2)): Promise<void> {
  const context = await loadClosedOrderRegistryContext(...);
  const artifact = buildLinkRegistryReviewCandidates(context.registry, ...);
  await writeFile(outputPath, JSON.stringify(artifact, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts`
Expected: PASS for review artifact structure tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/linkRegistryReviewCandidates.ts package.json tests/linkRegistryReviewWorkflow.test.ts
git commit -m "feat: export link registry review candidate artifacts"
```

### Task 3: Review Decisions and Override Materialization

**Files:**
- Modify: `src/linkRegistry/reviewWorkflow.ts`
- Create: `src/cli/linkRegistryMaterializeOverrides.ts`
- Test: `tests/linkRegistryReviewWorkflow.test.ts`

- [ ] **Step 1: Write the failing test for materializing accepted review decisions**

```ts
it('materializes accepted review decisions into formal overrides', () => {
  const overrides = materializeLinkRegistryOverridesFromReview({
    artifact,
    decisions: {
      version: 1,
      decisions: [{ candidateGroupKey: 'group:dji-pocket-3', reviewDecision: 'accept_with_edit', sameSkuGroupId: 'dji-pocket-3', shortName: 'DJI Pocket 3' }],
    },
  });
  expect(overrides.entries?.find((item) => item.internalProductId === '701')).toMatchObject({
    sameSkuGroupId: 'dji-pocket-3',
    shortName: 'DJI Pocket 3',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts`
Expected: FAIL because decision parsing/materialization does not exist yet.

- [ ] **Step 3: Implement decision parser and override materializer**

```ts
export interface LinkRegistryReviewDecisionFile { ... }
export function parseLinkRegistryReviewDecisionFile(value: unknown): LinkRegistryReviewDecisionFile { ... }
export function materializeLinkRegistryOverridesFromReview(input: ...): LinkRegistryOverrides { ... }
```

- [ ] **Step 4: Run focused verification**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts tests/linkRegistryOverrides.test.ts tests/linkRegistryAudit.test.ts`
Expected: PASS with no regression in override or audit behavior.

- [ ] **Step 5: Commit**

```bash
git add src/linkRegistry/reviewWorkflow.ts src/cli/linkRegistryMaterializeOverrides.ts tests/linkRegistryReviewWorkflow.test.ts
git commit -m "feat: materialize link registry overrides from review decisions"
```

### Task 4: End-to-End Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-link-registry-review-workflow-design.md` (only if implementation reveals a contract mismatch)

- [ ] **Step 1: Run typecheck**

Run: `C:\works\MT-agent\node_modules\.bin\tsc.cmd -p tsconfig.json`
Expected: PASS

- [ ] **Step 2: Run focused registry workflow tests**

Run: `C:\works\MT-agent\node_modules\.bin\vitest.cmd run tests/linkRegistryReviewWorkflow.test.ts tests/linkRegistryAudit.test.ts tests/linkRegistryStore.test.ts tests/linkRegistryOverrides.test.ts --exclude .worktrees/**`
Expected: PASS

- [ ] **Step 3: Smoke-test both new CLIs**

Run: `C:\works\MT-agent\node_modules\.bin\tsx.cmd src/cli/linkRegistryReviewCandidates.ts --output output/link-registry-review/test-review.json`
Expected: JSON artifact written successfully

Run: `C:\works\MT-agent\node_modules\.bin\tsx.cmd src/cli/linkRegistryMaterializeOverrides.ts --review output/link-registry-review/test-review.json --decisions config/link-registry-review-decisions.example.json --output output/link-registry-review/test-overrides.json`
Expected: Either successful output or a clear validation error if the example decisions file is intentionally incomplete

- [ ] **Step 4: Commit any final doc or script adjustments**

```bash
git add .
git commit -m "chore: finalize link registry review workflow"
```
