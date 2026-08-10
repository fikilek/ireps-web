# Targeted Batch Nuclear Reset with No Access — Final Safety Correction

## 1. Executive summary

The five final safety corrections are implemented locally: refreshable crash-safe latest pointer, nanosecond-exact Firestore update-time guards, proven cross-document correlations, exact-path/generation Storage race protection, and full-collection `demo_sales_meters` concurrency and zero-`tbRefs` proof. Final status is **PASSED WITH LIMITATIONS**.

## 2. Branch and HEAD

- Branch: `main`
- Starting HEAD: `418bf43c81bd6312764a761e91ea5b5a9e637935`

## 3. Git status before work

```text
 M functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js
 M functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js
?? docs/assesment/codex/TB_NUCLEAR_RESET_WITH_NA_IMPLEMENTATION_REPORT.md
?? functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js
?? functions/test/targetedBatchReset.helpers.test.js
?? skills.md
```

This exactly matched the authorized dirty paths.

## 4. Repository rules

The complete `C:\dev\ireps-web\skills.md` was read first and treated as binding. It was not modified, moved, deleted, staged, or committed.

## 5. Exact files modified

- `functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js`
- `functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js`
- `functions/test/targetedBatchReset.helpers.test.js`
- `docs/assesment/codex/TB_NUCLEAR_RESET_WITH_NA_IMPLEMENTATION_REPORT.md`

No other path was changed.

## 6. Latest pointer replacement design

`LATEST_INVENTORY.json` now uses a dedicated mutable-pointer helper. It serializes the complete new pointer, creates a uniquely named temporary file in the same directory with `wx`, and replaces the pointer only after that write completes. On Windows replacement errors, it uses a unique same-directory backup, restores the prior pointer if replacement fails, and removes only files created by that operation. The final pointer contains the new `runId`, absolute inventory path, expected project, and creation time.

## 7. Immutable versus mutable writes

Timestamped `inventory.json`, JSONL exports, manifests, hashes, and run reports remain immutable/create-only. Only `LATEST_INVENTORY.json` uses mutable replacement. Tests prove initial creation, repeat refresh, immutable overwrite rejection, preservation after failed temporary writes, operation-scoped cleanup, and newest-run resolution. Step 2 independently validates pointer identity, schema/version, approved real path, project, artifact paths, hashes, manifests, and inventory status.

## 8. Exact updateTime representation

Authoritative snapshot update times use:

```json
{"__firestoreUpdateTime__":{"seconds":"<exact non-negative seconds>","nanoseconds":123456789}}
```

No `Date` or ISO round trip is used. Seconds and nanoseconds survive deterministic JSON and hashing. Missing, legacy ISO-only, negative, malformed, non-integral, unsafe-range, and nanoseconds above `999999999` are rejected.

## 9. Schema and manifest versions

- Inventory schema: `3.0.0`
- Manifest version: `2.0.0`

Step 2 requires the exact new versions and does not migrate old destructive inventories.

## 10. Exact lastUpdateTime reconstruction

Step 2 parses both exact components and constructs `new admin.firestore.Timestamp(seconds, nanoseconds)` directly for every `lastUpdateTime` precondition. Preflight compares both components. Tests prove zero and non-zero nanoseconds, same-millisecond distinctions, malformed rejection, legacy rejection, and direct construction without `Timestamp.fromDate`.

## 11. Established correlation fields inspected

The implementation and repository callable/tests establish these fields:

- TRN: Firestore document ID, root `id`, `sourceModule`, `targetedBatchContext.tbId`, `.rowId`, `.salesDocId`, `.erfId`, `accessData.premise.id`, and `accessData.erfId`.
- Row: Firestore document ID/root `id`, root `tbId`, root `salesAllMeterId`, `refs.erfId`, `refs.premiseId`, `refs.meterId`, `refs.trnId`, and `execution.status`.
- Parent: Firestore document ID and root `id` when stored; row membership is the row’s root `tbId`.
- Sales: Firestore document ID and exact `tbRefs[]` selected by `id + rowId`; available linkage fields include `fieldWork.premiseId`, `fieldWork.erfId`/root `erfId`, and `fieldWork.meterId`.
- Premise: Firestore document ID, root `id` when stored, root `erfId`, and `noAccessTrnIds`.
- Registry ERF: Firestore document ID and root `id`/`erfId` when stored.

## 12. Correlation checks implemented

Every destructive TRN candidate must have consistent TRN identity/context, exact row identity/batch/Sales/ERF and available premise link, non-completed/non-meter-linked row state, matching parent, exactly one deterministic Sales `tbRefs` match, non-conflicting available tbRef values, exact premise/TRN/ERF linkage when a premise exists, and non-conflicting registry identity. Pre-premise NA remains valid and produces no premise read or manifest row. Existence alone cannot pass the proof.

## 13. Correlation blockers

Precise blockers include `TRN_ROOT_ID_MISMATCH`, context/source/access identity mismatches, `ROW_ROOT_ID_MISMATCH`, `ROW_TB_ID_MISMATCH`, `ROW_SALES_DOC_ID_MISMATCH`, `ROW_ERF_ID_MISMATCH`, `ROW_PREMISE_ID_MISMATCH`, `ROW_COMPLETION_STATE_CONFLICT`, `PARENT_BATCH_ID_MISMATCH`, `SALES_TBREF_NOT_FOUND`, `DUPLICATE_SALES_TBREF_MATCH`, `SALES_TBREF_ERF_ID_MISMATCH`, `SALES_TBREF_PREMISE_ID_MISMATCH`, `MISSING_REFERENCED_PREMISE`, `PREMISE_ERF_ID_MISMATCH`, `PREMISE_TRN_LINK_MISMATCH`, `REGISTRY_ERF_ID_MISMATCH`, and missing-document correlation states. All blockers prevent `PASSED` inventory status.

## 14. Storage ALREADY_MISSING behavior

Step 1 records exact bucket/path and state `ALREADY_MISSING`, with no generation invented. Step 2 queries the current live exact path before any mutation and requires it still be absent; recreation yields `STORAGE_OBJECT_RECREATED_AFTER_INVENTORY`. Final verification checks the live path again.

## 15. Storage generation safety

For `EXISTS`, Step 2 requires the current live exact path, generation, and metageneration to match inventory. Missing, replacement, or metadata change blocks. Deletion targets only the inventoried generation and supplies generation and metageneration preconditions. A delete 404 is not treated as success; the live path is rechecked and any replacement fails closed.

## 16. Exact-path post-delete verification

Post-delete verification queries the unrestricted current exact object path, not merely the old generation. Every `EXISTS` and `ALREADY_MISSING` target must have no live object. No wildcard, prefix, or folder fallback exists. Shared-reference, non-target-reference, bucket, URL, prefix, wildcard, and folder protections remain.

## 17. Complete Sales concurrency snapshot

Step 1 exports every `demo_sales_meters` document with ID, path, exact update-time components, deterministic data, and exact root `tbRefs` shape. Inventory records total count, sorted complete ID set, root-`tbRefs` count, and exact IDs having root `tbRefs`.

## 18. Global zero-tbRefs proof

Before mutation, Step 2 rescans the complete Sales collection and requires the exact count, ID set, every update time, and every `tbRefs` value to equal inventory. New, missing, changed, or newly linked documents block. Apply updates only inventoried documents with root `tbRefs`. Final verification rescans the whole collection and requires unchanged count/ID set and zero root `tbRefs` fields, including fields added during the reset window.

## 19. geofenceRefs and unrelated field preservation

Apply uses a root-field delete for `tbRefs` only; documents are never deleted. `geofenceRefs` is explicitly compared after modification, and unrelated fields are untouched by the field-level update. Pure-helper tests confirm only root `tbRefs` is removed.

## 20. Metadata timestamps

`metadata.createdAt` and `metadata.updatedAt` remain ISO strings from `new Date().toISOString()`. The exact Firestore Timestamp representation applies only to snapshot `updateTime` concurrency tokens.

## 21. ireps_erfs

`ireps_erfs` remains outside active scope: zero reads, writes, counts, and update-time checks. Source-inspection tests enforce the absence of an active collection operation.

## 22. registry_erfs

Only exact affected `registry_erfs/{erfId}` documents are read and guarded. Their identity must not contradict the target ERF. Only TRN counts are rebuilt with an exact update-time precondition; registry documents are preserved.

## 23. Syntax commands and results

All passed with exit code 0 and no diagnostics:

```powershell
node --check functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js
node --check functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js
node --check functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js
node --check functions/test/targetedBatchReset.helpers.test.js
```

## 24. ESLint

The following passed with exit code 0 and no warnings/errors:

```powershell
npx.cmd eslint functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js functions/test/targetedBatchReset.helpers.test.js
```

## 25. Tests

```powershell
node --test functions/test/targetedBatchReset.helpers.test.js
node --test functions/test/recordTargetedBatchNoAccessCallable.test.js
```

- Helper suite: 76 tests, 76 passed, 0 failed/skipped/cancelled.
- Callable regression: 10 tests, 10 passed, 0 failed/skipped/cancelled.
- Combined: 86 tests, 86 passed.

Tests use pure helpers, mocks, local fixtures, temporary local files, and source inspection only.

## 26. git diff --check

Passed with exit code 0. Git printed only informational LF-to-CRLF warnings for the two tracked reset scripts.

## 27. Remaining limitations

Limited to: no real DEV inventory, no human inventory approval, and no destructive execution.

## 28. Proposed Step 1 — not executed

```powershell
node .\functions\scripts\tools\targeted-batches\01_read_targeted_batch_reset_scope_dev.js --project-id ireps2 --service-account <DEV_SERVICE_ACCOUNT_PATH>
```

## 29. Proposed Step 2 — not executed

```powershell
node .\functions\scripts\tools\targeted-batches\02_delete_batches_and_clean_demo_sales_dev.js --project-id ireps2 --service-account <DEV_SERVICE_ACCOUNT_PATH> --confirm RESET_TARGETED_BATCH_AND_NA_SCOPE_DEV
```

## 30. Explicit human approval gate

Step 2 requires separate explicit human authorization after review of a fresh `3.0.0` inventory, all `2.0.0` manifests, exact hashes, blockers, correlations, Storage states/generations, complete Sales snapshot, and `inventory.status === "PASSED"`.

## 31. Final status

**PASSED WITH LIMITATIONS**

Step 1: not executed. Step 2: not executed. DEV Firestore reads/writes: 0/0. DEV Storage reads/deletes: 0/0. Deployments: 0. Git stage/commit/push/reset/revert/clean/stash actions: 0.
