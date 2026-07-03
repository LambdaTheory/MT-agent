# Rental Skill Native Action to MT-agent Capability Map

This is an implementation audit table for rental-price-agent capability alignment. It is not an operator README.

| Native action / runner command | MT tool / wrapper | Status | Notes |
|---|---|---|---|
| `ping` | `rental.daemonStatus` | 等价 | Read-only daemon health check. |
| `login` | Not exposed | 缺失 | Native session operation; not added to MT-agent capability surface in this round. |
| `navigate` | Not exposed | 缺失 | Low-level browser navigation remains outside MT-agent tools. |
| `read` | `rental.readRaw`, `rental.priceSnapshot`, `rental.pricePreview` read phase | 安全包装 | Read-only or preview-scoped usage; write execution still goes through confirmation and verification. |
| `apply` | `rental.priceApply`, `rental.perSpecPriceApply` | 安全包装 | Confirmed write path with ledger attribution and readback verification where applicable. |
| `apply-current` | `rental.applyCurrent` | 安全包装 | Advanced form-state capability; requires explicit `expectedProductId` and writes a changes file before native `apply-current`. |
| `submit` | `rental.submitCurrent`, internal submit after apply wrappers | 安全包装 | Advanced form-state submit is exposed only with explicit `expectedProductId`; normal write wrappers keep submit inside confirmed flows. |
| `spec-discover` | `rental.specDiscover`, `rental.specDiscoverFull` | 等价 | Read-only spec discovery; no write side effect. |
| `spec-add-item` | `rental.specAddItem` | 等价 | Confirmed advanced form-state atomic capability. |
| `spec-remove-item` | `rental.specRemovePlan` -> `rental.operationConfirmRequest` | 安全包装 | Dedicated preview/confirmation path; executes remove, refresh, submit, verify, and audit file write. |
| `spec-add-dim` | `rental.specDimPlan` -> `rental.specDimApply` | 安全包装 | Planner uses preview card; hidden apply tool executes confirmed atomic dimension add. |
| `spec-remove-dim` | `rental.specDimPlan` -> `rental.specDimApply` | 安全包装 | Planner uses preview card; hidden apply tool executes confirmed atomic dimension remove. |
| `spec-add-and-refresh` | `rental.specAddAndRefresh` | 等价 | Aligned to native `productId + specDimId + itemTitle`; no longer wrapper-compressed. |
| `spec-refresh` | `rental.specRefresh` | 等价 | Confirmed advanced form-state atomic capability. |
| `tenancy-set` | `rental.tenancySet` | 安全包装 | Confirmed write path with ledger attribution. |
| `delist` | `rental.delist`, `rental.delistBatch` | 安全包装 | Single and batch delist require confirmation; batch wrapper continues per product. |
| `copy` | `rental.copy`, `rental.newLinkBatchPlan` | 安全包装 | Confirmed copy/new-link flows preserve safety checks. |
| `platform-search` | `rental.platformSearch` | 等价 | Read-only native search. |
| `platform-search-all` | `rental.platformSearchAll` | 等价 | Read-only native search with MT-side output limiting. |
| `batch-read` | `rental.batchRead` | 等价 | Read-only multi-product read. |
| batch `preview` | `rental.batchPreview` | 安全包装 | Batch control-plane command; file path constrained to `tasks/batches`. |
| batch `execute` | `rental.batchExecute` | 安全包装 | Batch control-plane command; supports explicit `confirmFormSetupWithoutPreview`. |
| batch `resume` | `rental.batchResume` | 安全包装 | Batch control-plane command; state path is accepted only under `tasks/batches`. |
| batch `status` | `rental.batchStatus` | 安全包装 | Batch control-plane command; state path is accepted only under `tasks/batches`. |
| batch `delayed-verify` | Not exposed | 缺失 | Native command exists but was not included in first MT batch scope from the plan. |
| batch `report` | `rental.batchReport` | 安全包装 | Batch control-plane command; state path is accepted only under `tasks/batches`. |
| batch `rollback` | `rental.batchRollback` | 安全包装 | Batch rollback control-plane command; `confirm=true` maps to native `rollback --confirm`. |
| mirror `search` | `rental.mirrorSearch` | 等价 | Read-side only. |
| mirror `batch-spec` | `rental.mirrorBatchSpec` | 等价 | Read-side/spec scaffolding only. |
| mirror `writeback-state` | Not exposed | 缺失 | Explicitly deferred; no MT-agent writeback tool registered. |
| “上架” | Not exposed | 未定义业务语义 | Explicitly out of scope for this round. |
| task-store evidence/history/result | Not connected as MT task system | 安全包装 | Only patterns are borrowed through existing audit/ledger artifacts; task-store is not connected as a parallel MT-agent task system. |

Batch file arguments are intentionally strict: MT-agent accepts batch spec/state files only after they resolve inside the rental skill `tasks/batches` directory. Operators should pass files from that directory; paths outside it are rejected rather than normalized or copied.

## Card and Approval Boundary

| Capability | Status | Notes |
|---|---|---|
| Confirm card `requestRef` confirm payload | 等价 | Existing referenced confirm payload retained. |
| Confirm card `requestRef` cancel payload | 安全包装 | Cancel now uses `{ action, requestRef, confirmationKey }` when a request reference exists. |
| Explore confirmation-card coverage | 安全包装 | Uses registry risk/confirmation/schema checks for ledger-covered rental write tools. |
| Daily Mission card semantics | 安全包装 | Cards visibly carry source, phase, scope, `runId`, and `decisionId` while preserving callback reason parsing. |
