# Codex Targeted Batch Streaming Follow-up Report

## Final verdict

**TARGETED BATCH STREAMING FOLLOW-UP PASSED**

The unapproved mobile Targeted Batch bucket cap was removed without replacing Firestore streaming, actor visibility, ordering, or RTK Query listener cleanup. The four backend failures were reproduced and investigated. They are stale expectations against already-approved working-tree behavior, not production defects in the active Targeted Batch field workflow. No backend production or test patch was made.

## 1. Repository baselines

| Repository | Branch | HEAD |
|---|---|---|
| `C:\dev\ireps-web` | `main` (ahead of `origin/main` by 19) | `418bf43c81bd6312764a761e91ea5b5a9e637935` |
| `C:\dev\ireps-mobile` | `main` (ahead of `origin/main` by 13) | `ea2e598f76558bb3577186509cf1210f487d2f30` |

Initial web status:

```text
## main...origin/main [ahead 19]
 M firestore.indexes.json
 M functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js
 M functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js
 M functions/targetedBatches/getTargetedBatchRowsCallable.js
 M functions/targetedBatches/recordTargetedBatchNoAccessCallable.js
 M src/pages/operations/TargetedBatchAllocationPage.jsx
 M src/pages/operations/TargetedBatchDetailsPage.jsx
 M src/pages/operations/TargetedBatchesPage.jsx
?? docs/assesment/codex/CODEX_TARGETED_BATCH_STREAMING_ASSESSMENT_AND_PATCH_REPORT.md
?? docs/assesment/codex/GET_TARGETED_BATCH_ROWS_CALLABLE_INTERNAL_ERROR_REPORT.md
?? docs/assesment/codex/TB_NUCLEAR_RESET_WITH_NA_IMPLEMENTATION_REPORT.md
?? docs/assesment/copilot/
?? docs/reports/targeted-batch-reset/generated/
?? functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js
?? functions/test/targetedBatchNoAccessRule.test.js
?? functions/test/targetedBatchReset.helpers.test.js
?? skills.md
```

Initial mobile status:

```text
## main...origin/main [ahead 13]
 M app/(tabs)/admin/operations/my-workorders.js
 M src/features/targetedBatches/targetedBatchActions.js
 M src/features/targetedBatches/targetedBatchActions.test.mjs
 M src/redux/targetedBatchApi.js
?? skills.md
?? src/redux/targetedBatchApi.streaming.test.mjs
```

All initial modified and untracked work was preserved. No reset, restore, clean, stage, commit, push, deployment, or Firebase write was performed.

## 2. Bucket cap found and correction

The exact cap was `200` documents. In mobile `src/redux/targetedBatchApi.js`, `TARGETED_BATCH_STREAM_LIMIT` was `200`; the bucket endpoint converted `args.limit || 200` to `streamLimit` and applied `firestoreLimit(streamLimit)` to the ordered `tb_uploads` listener.

Changed file: `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js`.

The bucket-only changes were:

- removed the Firestore `limit` import alias;
- removed `TARGETED_BATCH_STREAM_LIMIT = 200`;
- removed bucket `streamLimit` metadata and argument handling;
- removed `firestoreLimit(streamLimit)` from the bucket query;
- retained `query(collection(db, "tb_uploads"), orderBy("metadata.createdAt", "desc"))`;
- retained `onSnapshot`, snapshot normalization, sorting, `updateCachedData`, `cacheEntryRemoved`, and `unsubscribeTargetedBatches()`.

No replacement bucket cap, pagination, cursor dependency, polling, Load More, or refresh path remains. The remaining `streamLimit`/pagination identifiers in this module belong only to the separate row-data compatibility shape; they are not in `getTargetedBatchBuckets` and do not constrain the bucket query.

The bucket API still streams through Firestore `onSnapshot`. Its collection, ordering, snapshot processing, RTK Query lifecycle, error handlers, and unsubscribe cleanup remain intact. No actor visibility, TEAM allocation, Service Provider allocation, or unrelated Targeted Batch behavior was changed.

## 3. Mobile verification

Commands and results:

- `node --check src/redux/targetedBatchApi.js`: passed.
- `node --test src/redux/targetedBatchApi.streaming.test.mjs src/features/targetedBatches/*.test.mjs src/features/premises/targetedBatchPremiseContext.test.mjs`: 22/22 passed. This covers the focused streaming, action, No Access, and premise-context tests. Node emitted only existing module-type warnings.
- `npx.cmd eslint src/redux/targetedBatchApi.js`: passed with no output.

## 4. Focused backend result

The same documented focused command was run:

```text
node --test test/recordTargetedBatchNoAccessCallable.test.js test/getTargetedBatchRowsCallable.test.js test/targetedBatchPremiseLink.test.js test/meterMaster.helpers.test.js
```

Current result: **40 passed / 44 total; 4 failed**. The earlier assessment recorded 31/35 for this set; nine premise-link tests have since been added, while the same four failures remain.

The dedicated approved-rule corroboration command, `node --test test/targetedBatchNoAccessRule.test.js`, passed 5/5, including “NA is rejected only when fieldWork meterId has a value.”

### Failure 1

- Test file: `functions/test/getTargetedBatchRowsCallable.test.js`.
- Exact test: `enriches from exact Sales tbRef and deduplicates reads without writes`.
- Expected: `result.rows.map(row => row.noAccessCount)` equals `[0, 2, 0]`.
- Actual: `[0, 0, 0]`.
- Implementation: `functions/targetedBatches/getTargetedBatchRowsCallable.js`, `enrichTargetedBatchRow`, especially the Sales `tbRefs.find` by Targeted Batch ID and `fieldWork.noAccess` count.
- Root cause: stale test fixture/expectation caused by the recently approved rule. The fixture contains two Sales `tbRefs` with the same Targeted Batch ID and different row IDs, while the approved compatibility behavior reads the Targeted Batch reference by batch ID without requiring `rowId`. The first match therefore supplies zero attempts for both rows sharing that Sales document. The dedicated approved-rule test confirms batch-ID lookup.
- Active TB field workflow affected: **NO**. Current generated Sales data is governed as one TB reference per batch; the active mobile row stream uses the approved batch-ID lookup and locked meter rule. This legacy callable is no longer the active mobile row read.
- Blocks streaming patch testing/deployment: **NO**. It does not exercise the bucket stream cap.

### Failure 2

- Test file: `functions/test/getTargetedBatchRowsCallable.test.js`.
- Exact test: `reports all integrity states and never maps them to zero`.
- Expected: `noAccessCount === null` for missing/invalid Sales integrity states.
- Actual: `noAccessCount === 0`.
- Implementation: `functions/targetedBatches/getTargetedBatchRowsCallable.js`, `enrichTargetedBatchRow`, where count safely defaults to zero and the separate `noAccessSourceStatus` retains the integrity diagnosis.
- Root cause: stale test expectation caused by the recently approved NA/action behavior. The current normalized action state uses a safe numeric count and does not use integrity status to disable NA; only non-empty `tbRef.fieldWork.meterId` disables NA.
- Active TB field workflow affected: **NO**. The active mobile stream and action tests pass the locked rule.
- Blocks streaming patch testing/deployment: **NO**.

### Failure 3

- Test file: `functions/test/recordTargetedBatchNoAccessCallable.test.js`.
- Exact test: `exact correlation and Sales shape failures produce zero writes`.
- Expected: a Sales TB reference whose existing `rowId` is another row rejects with code `SALES_TB_REF_NOT_FOUND`.
- Actual: it rejects with `SALES_TB_REF_ROW_CONFLICT`; zero writes are still preserved.
- Implementation: `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js`, `resolveSalesTbRef`.
- Root cause: stale test expectation against pre-existing unrelated working-tree behavior. The implementation first resolves the unique batch-ID reference, then deliberately reports the more exact conflict when its non-empty `rowId` belongs to another row. The dedicated rule test “a Sales tbRef already assigned to another row is rejected” passes.
- Active TB field workflow affected: **NO**. Both expected and actual behaviors fail closed and write nothing; only the diagnostic code differs.
- Blocks streaming patch testing/deployment: **NO**.

### Failure 4

- Test file: `functions/test/recordTargetedBatchNoAccessCallable.test.js`.
- Exact test: `meter-linked and terminal rows reject with zero writes`.
- Expected: setting `tb_rows/{row}.refs.meterId` rejects with `TARGETED_BATCH_METER_ALREADY_LINKED`.
- Actual: no rejection occurs for that row-reference field, so Node reports `Missing expected rejection.`
- Implementation: `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js`, `assertRowExecutable` and `buildSalesAppend`.
- Root cause: stale test expectation directly caused by the recently approved NA rule. The former row `refs.meterId` check was removed; the implementation now rejects only when the authoritative matching Sales `tbRef.fieldWork.meterId` is non-empty. Terminal execution statuses remain rejected, but the test stops at its first stale assertion.
- Active TB field workflow affected: **NO**. The actual behavior is the locked active workflow rule and is explicitly covered by passing mobile and backend rule tests.
- Blocks streaming patch testing/deployment: **NO**.

## 5. Backend patch decision

No backend implementation or backend test was patched. The evidence does not identify a current-workflow production defect, and none of the failures is required to validate the bucket streaming correction. Updating the stale legacy expectations may be done as a separately approved cleanup, but was not necessary or authorised here. The previous sales-status, integrity-status, execution-status, row-meter, or context-based NA disabling rules were not restored.

## 6. Files modified by this follow-up

- `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js`
- `C:\dev\ireps-web\docs\assesment\codex\CODEX_TARGETED_BATCH_STREAMING_FOLLOWUP_REPORT.md`

No other file was modified by this follow-up.

## 7. Diff checks

- `git diff --check` in `C:\dev\ireps-web`: passed (existing line-ending warnings may be printed by Git).
- `git diff --check` in `C:\dev\ireps-mobile`: passed (existing line-ending warnings may be printed by Git).

## 8. Remaining risks

- Removing the cap intentionally increases Firestore reads, client memory, and snapshot processing for actors authorised to see very large bucket sets. Correctness now takes priority over the former hidden cap.
- Live completeness still depends on the deployed Firestore security rules authorising the signed-in actor's existing query. Rules and runtime Firebase data were deliberately not touched or tested.
- The four stale assertions remain red in the broader focused backend command, although the dedicated current-rule suite passes and the failures do not exercise or block the streaming patch.
- The repository worktrees contain substantial pre-existing uncommitted work; all of it remains preserved and unstaged.

## 9. Final verdict

**TARGETED BATCH STREAMING FOLLOW-UP PASSED**

The complete authorised Targeted Batch bucket query remains real-time and no longer has a document cap. Focused mobile verification passes, the four backend failures are classified and non-blocking, no backend production patch was warranted, and no prohibited external or Git action was performed.
