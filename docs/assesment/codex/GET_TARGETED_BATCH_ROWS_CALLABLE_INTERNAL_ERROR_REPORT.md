# getTargetedBatchRowsCallable DEV Internal Error Diagnosis

## Conclusion

**The root cause of the current reported failure is not yet confirmed.** The initial version of this report incorrectly treated a historical missing-index exception as proof of the current cause.

DEV logs prove that calls at approximately `2026-08-04T14:45Z` reached the query in `functions/targetedBatches/getTargetedBatchRowsCallable.js:161-164` and failed with Firestore gRPC code `9` / `FAILED_PRECONDITION` and `The query requires an index`. That raw SDK exception escaped the wrapper (`getTargetedBatchRowsCallable.js:194-195`) and was exposed as `functions/internal`.

However, a live read of `ireps2` indexes at `2026-08-04T21:14Z` confirms that the exact required index exists and is `READY`: `tb_rows`, collection scope, `tbId ASC`, `rowNo ASC`, `__name__ ASC`. Missing index is therefore a confirmed historical failure mode, not a confirmed explanation for a call made after the index became ready.

Current classification: **unresolved pending a timestamp-correlated failing invocation or temporary stage/error logging**. Allocation shape, TEAM membership, permissions, Sales data, code, and deployment drift remain candidates only for a genuinely current failing call.

## Evidence

### Exact source and execution path

- Local callable source: `C:\dev\ireps-web\functions\targetedBatches\getTargetedBatchRowsCallable.js`.
- Collection constants in `functions/targetedBatches/helpers.js:4-10` are:
  - uploads: `tb_uploads`
  - rows: `tb_rows`
  - sales: `demo_sales_meters`
  - erfs: `ireps_erfs`
  - users: `users`
- `findActorProfile()` is in `functions/targetedBatches/helpers.js:182-200`. It reads, in order, `users/{uid}`, `userProfiles/{uid}`, and `profiles/{uid}`, returning the first existing document.
- The callable is imported by `functions/index.js:90` and exported by `functions/index.js:179`. Its on-call wrapper is declared at `getTargetedBatchRowsCallable.js:194-195`.

### Confirmed failing operation

The exact query is at `getTargetedBatchRowsCallable.js:161-164`:

```js
db.collection("tb_rows")
  .where("tbId", "==", tbId)
  .orderBy("rowNo")
  .orderBy(FieldPath.documentId())
```

`FieldPath.documentId()` is valid here and is used consistently with the two-value cursor at line 163. It is not itself an API misuse; it makes document ID the deterministic second ordering field and therefore part of the required composite index.

DEV Cloud Functions logs for `getTargetedBatchRowsCallable` contain the unhandled exception and stack:

```text
Error: 9 FAILED_PRECONDITION: The query requires an index.
...
collectionGroups/tb_rows/indexes
tbId ASC, rowNo ASC, __name__ ASC
```

The Firestore-generated index link encodes precisely:

- collection group: `tb_rows`
- query scope: collection
- `tbId`: ascending
- `rowNo`: ascending
- `__name__`: ascending

The same log trace shows callable authentication verification passed before the exception. The exception originates in Firestore `Query._get()` and therefore occurs at local line 164, before Sales ID collection or `db.getAll()`.

### Index state and repository manifest

`C:\dev\ireps-web\firestore.indexes.json` has no `collectionGroup: "tb_rows"` entry. This is repository configuration drift, not proof that the live index is absent.

The live `ireps2` index list contains the exact `tb_rows` collection-scope index with `tbId ASC`, `rowNo ASC`, and `__name__ ASC`, in state `READY`. The earlier Firestore error means it was unavailable to those earlier calls. The index-list API does not expose its creation/ready timestamp, so this investigation cannot determine whether it was absent, building, or became ready between the historical failure and the live verification.

### Allocation and access data path

The allocation callable writes the parent allocation in `functions/targetedBatches/allocationCallable.js:571-588` and finalizes it at lines 674-684 as:

```text
allocation.status
allocation.targetType
allocation.targetId
allocation.targetName
allocation.memberCount
allocation.startedAt / completedAt
allocation.allocatedByUid / allocatedByUser
allocation.failureCode / failureMessage / failedAt
```

It writes each row allocation at lines 616-627 with `status`, `targetType`, `targetId`, `targetName`, `allocatedAt`, and allocator metadata. This matches the read callable's parent access fields at `getTargetedBatchRowsCallable.js:103-118`.

For a TEAM target, the reader loads `teams/{allocation.targetId}` at line 115 and accepts UID membership from `memberUids`, `scope.memberUserIds`, string/object entries in `members`, and string/object entries in `users` (`getTargetedBatchRowsCallable.js:51-70`). Peter's UID in the available repository export is `RSEHoLEpg0W3bwWkEH3rgUnjMVu1`; the exported user profile is FWR with SP ID `LgIrdHR7cnUPIHPzw5iZ` (`functions/scripts/ireps2-users-20260621-2233.json:250-305`).

The historical request that logged the index exception necessarily passed `assertCanView()`: a missing/invalid role, parent, allocation, or TEAM membership would throw an `HttpsError` at lines 97, 101, 104, 109-110, or 118 and would never execute the row query. This proves access for that invocation only. No Firestore data was changed or probed with a write.

### Sales lookup and malformed-data review

`readSales()` at `getTargetedBatchRowsCallable.js:146-155` batches up to 100 document references and calls `db.getAll(...refs)` against `demo_sales_meters`. It is not reached in the failing execution because the row query fails first.

The enrichment path defensively handles missing `salesAllMeterId`, missing Sales documents, missing matching `tbRefs`, malformed `fieldWork`, and malformed `fieldWork.noAccess` at lines 121-143. Those states become diagnostic statuses rather than thrown errors. A Firestore transport/permission failure from `db.getAll()`, an unexpected snapshot/data getter exception, or an invalid Firestore document ID could still escape as `functions/internal`, but none explains this incident because the logged failure is earlier and exact.

Other uncaught SDK exceptions can escape from profile reads, parent/TEAM reads, the row query, and Sales reads because the exported wrapper has no catch block. For the historical logged incident, the escaped exception is specifically line 164's missing-index error. The exception for a later/current reported call is not present in the available correlated logs.

### Deployment comparison

DEV is running `gettargetedbatchrowscallable` in `us-central1`, revision `gettargetedbatchrowscallable-00001-guz`, with Firebase functions hash `e2d20c7cd07c377bb02a8c70990e70b375821620`. Its live exception requests exactly the index implied by the current local query. The local export wiring also matches the deployed callable name.

A byte-for-byte download of the deployed source was not available from the read-only Firebase CLI metadata used in this investigation. The historical deployed stack behavior proves that its query shape matched current local lines 161-164 at that revision. Deployment drift is not demonstrated, but cannot be completely excluded for the current failure without deployed-source comparison or new stage logging.

## Smallest safe next step

Do not create a duplicate live index: the exact index already exists and is `READY` in `ireps2`.

First reproduce the mobile failure once and capture its exact UTC timestamp (and execution ID/trace if available). Then inspect only that invocation. If it still returns `functions/internal`, the smallest diagnostic code change is temporary structured stage logging plus a top-level catch that logs `name`, `message`, `code`, and `stack` while preserving existing `HttpsError` behavior.

Separately, synchronize the already-live index into `C:\dev\ireps-web\firestore.indexes.json`:

Add this single composite index to `C:\dev\ireps-web\firestore.indexes.json`:

```json
{
  "collectionGroup": "tb_rows",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tbId", "order": "ASCENDING" },
    { "fieldPath": "rowNo", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ],
  "density": "SPARSE_ALL"
}
```

That manifest synchronization does not fix the present live database because its index is already ready. It should not be deployed until the generated deployment diff is reviewed to ensure the large manifest would not remove unrelated live indexes.

If temporary logging is added, the only code file requiring modification is `functions/targetedBatches/getTargetedBatchRowsCallable.js`, followed by deployment of that single function. No deployment was performed in this investigation.

## Optional temporary structured logging

Logging is needed to establish the current root cause unless a newly reproduced invocation emits a complete exception naturally. Modify only `functions/targetedBatches/getTargetedBatchRowsCallable.js`, import `logger` from `firebase-functions`, and emit one structured event per stage. Do not log tokens, full profiles, rows, meter data, or Sales documents.

Recommended fields/events:

```js
logger.info("getTargetedBatchRowsCallable stage", { stage: "callable_start", uid });
logger.info("getTargetedBatchRowsCallable stage", { stage: "parsed_input", uid, tbId, limit, hasCursor: Boolean(cursor) });
logger.info("getTargetedBatchRowsCallable stage", { stage: "actor_profile_resolved", uid, role, spId });
logger.info("getTargetedBatchRowsCallable stage", { stage: "parent_batch_loaded", uid, tbId, exists: parentSnap.exists });
logger.info("getTargetedBatchRowsCallable stage", { stage: "allocation_shape", uid, tbId, allocationStatus, targetType, targetId });
logger.info("getTargetedBatchRowsCallable stage", { stage: "team_document_loaded", uid, tbId, targetId, exists: teamSnap.exists, memberCount });
logger.info("getTargetedBatchRowsCallable stage", { stage: "access_granted", uid, tbId, targetType, targetId });
logger.info("getTargetedBatchRowsCallable stage", { stage: "row_query_start", uid, tbId, limit, hasCursor: Boolean(cursor) });
logger.info("getTargetedBatchRowsCallable stage", { stage: "row_query_completed", uid, tbId, documentsRead: page.docs.length });
logger.info("getTargetedBatchRowsCallable stage", { stage: "sales_ids_collected", uid, tbId, uniqueSalesDocumentIds: uniqueIds.length });
logger.info("getTargetedBatchRowsCallable stage", { stage: "sales_documents_read", uid, tbId, requested: uniqueIds.length, found });
logger.info("getTargetedBatchRowsCallable stage", { stage: "enrichment_completed", uid, tbId, rows: rows.length, statusCounts });
logger.info("getTargetedBatchRowsCallable stage", { stage: "callable_success", uid, tbId, rows: rows.length, hasMore });
logger.error("getTargetedBatchRowsCallable failed", { stage, uid, tbId, name: error?.name, message: error?.message, code: error?.code, stack: error?.stack });
```

Adding logging would require a functions deployment and should be reverted after diagnosis. If a catch is added, preserve existing `HttpsError` instances and translate only unexpected errors; do not expose raw Firestore details to mobile.

## Risks and regression checks

- Confirm the existing composite index remains `READY`; do not create a duplicate.
- Re-run the exact Peter / `TGB_20260804_221932_OP6H` mobile call and confirm row `TBR_20260804_221932_OP6H_000001` is returned.
- Verify first page ordering by `rowNo`, stable document-ID tie breaking, `limit + 1` pagination, and `startAfter(rowNo, id)` with multiple pages.
- Verify TEAM access for Peter and denial for a non-member; verify SP-target access for matching and non-matching SP IDs.
- Verify missing/malformed Sales and `tbRefs` still return integrity statuses rather than zero counts or callable failures.
- Verify No Access can continue and writes only through `recordTargetedBatchNoAccessCallable`.
- Run `node --test test/getTargetedBatchRowsCallable.test.js`; all four current tests passed during this investigation. The fake DB does not enforce indexes, so this test cannot detect the missing deployed index by itself.
- Confirm no additional composite index is accidentally removed when editing the large manifest.

## Modification confirmation

No function code, Firestore data, index, deployment, or unrelated file was modified. The only file modified by this investigation is this diagnosis report, including this correction after live index state was verified. Existing unrelated worktree changes were left untouched.
