# Product ID Map Local Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop tracking generated product ID mapping files while preserving local runtime behavior.

**Architecture:** Treat `config/product-id-map.json` and `config/product-id-map.backup.json` as generated local artifacts. Keep `config/product-id-map.example.json` as the shared template, and leave runtime code paths unchanged.

**Tech Stack:** Git, Node.js, TypeScript, Vitest.

---

## File Structure

- Modify `.gitignore` to ignore generated product ID mapping files.
- Remove `config/product-id-map.json` from the Git index with `git rm --cached` while keeping the local file.
- Remove `config/product-id-map.backup.json` from the Git index with `git rm --cached` while keeping the local file.
- Keep `config/product-id-map.example.json` tracked.

### Task 1: Ignore Runtime Mapping Files

**Files:**
- Modify: `.gitignore`
- Untrack: `config/product-id-map.json`
- Untrack: `config/product-id-map.backup.json`

- [ ] **Step 1: Add ignore rules**

Add these lines to `.gitignore`:

```gitignore
config/product-id-map.json
config/product-id-map.backup.json
```

- [ ] **Step 2: Stop tracking runtime files without deleting local copies**

Run:

```powershell
git rm --cached -- "config/product-id-map.json" "config/product-id-map.backup.json"
```

Expected: Git stages both files as deleted, while the files remain present on disk because `--cached` only removes them from the index.

- [ ] **Step 3: Verify local files still exist**

Run:

```powershell
Test-Path -LiteralPath "config/product-id-map.json"
Test-Path -LiteralPath "config/product-id-map.backup.json"
```

Expected output:

```text
True
True
```

- [ ] **Step 4: Verify Git status**

Run:

```powershell
git status --short
```

Expected: `.gitignore` is modified and both runtime mapping files are staged as deleted. The same mapping files should not also appear as untracked files because `.gitignore` ignores them.

### Task 2: Verify And Commit

**Files:**
- Modified: `.gitignore`
- Deleted from index: `config/product-id-map.json`
- Deleted from index: `config/product-id-map.backup.json`

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npx vitest run tests/productIdMapping.test.ts tests/refreshProductIdMapping.test.ts tests/publicTrafficCliSource.test.ts tests/publicTrafficReportCliBehavior.test.ts tests/extractProductId.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: TypeScript build exits successfully.

- [ ] **Step 3: Inspect staged files**

Run:

```powershell
git diff --cached --name-status
```

Expected staged paths:

```text
M	.gitignore
D	config/product-id-map.backup.json
D	config/product-id-map.json
```

- [ ] **Step 4: Commit**

Run:

```powershell
git add .gitignore
git commit -m "调整：商品ID映射改为本地产物"
```

Expected: one commit containing only `.gitignore` and the two index removals.

- [ ] **Step 5: Push master**

Run:

```powershell
git push origin master
```

Expected: remote `master` advances to the new commit.
