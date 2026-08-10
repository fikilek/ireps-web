# TARGETED_BATCH_MOBILE_DIAGNOSIS_REPORT

## Summary
- Current mobile failure is almost certainly in the bucket/list loading path, not the row callable path.
- Mobile list loading uses a Firestore stream from `tb_uploads` in `src/redux/targetedBatchApi.js`, not the `getTargetedBatchRowsCallable`.
- The row load uses `getTargetedBatchRowsCallable` via `httpsCallable` in `src/redux/targetedBatchApi.js`.
- `No Targeted Batches available` is rendered only when the bucket list is empty and no stream error occurred.
- The existing `tb_rows` index in `firestore.indexes.json` matches the exact row query in `getTargetedBatchRowsCallable.js`.

## Evidence

### Mobile bucket/list path
- `app/(tabs)/admin/operations/my-workorders.js` imports the bucket and row hooks at lines 45-47.
- `useGetTargetedBatchBucketsQuery(...)` is called at lines 1057-1062.
- `useGetTargetedBatchRowsQuery(...)` is called at lines 1071-1076.
- `targetedBatchBuckets` is computed by filtering `targetedBatchData.buckets` with `canActorSeeBgoBucket(...)` at lines 1358-1396.
- `No Targeted Batches available` is rendered at line 2559 only when `!isLoadingTargetedBatches && !targetedBatchError && targetedBatchBuckets.length === 0`.
- A stream error would instead render the error card at line 2542.

### Mobile query implementation
- `src/redux/targetedBatchApi.js` defines `getTargetedBatchBuckets` using an `onSnapshot` listener on `collection(db, "tb_uploads")` ordered by `metadata.createdAt` and limited to 200.
- `canActorSeeBgoBucket(...)` is the exact visibility filter for both BGO and Targeted Batch buckets in `src/redux/targetedBatchApi.js` around line 368.
- Team membership resolution on the mobile side relies on `useGetTeamsQuery(...)` from `src/redux/teamsApi.js` and `getActorTeamIds(...)` in `my-workorders.js` line 1107.
- This means a team-targeted batch can be hidden client-side if the team membership data is missing, incomplete, or does not match the current batch target.

### Row callable path
- `src/redux/targetedBatchApi.js` uses `httpsCallable(functions, "getTargetedBatchRowsCallable")` for row loading.
- `functions/targetedBatches/getTargetedBatchRowsCallable.js` enforces access in `assertCanView(...)` starting at line 113 and loads the parent batch from `tb_uploads` at line 136.
- Row query shape is built at lines 262-264 with:
  - `where("tbId", "==", tbId)`
  - `orderBy("rowNo")`
  - `orderBy(FieldPath.documentId())`
- `getTargetedBatchRowsCallable` is exported from `functions/index.js` and wired at import/export around lines 88-91 and 177-180.

### Index and query sufficiency
- `firestore.indexes.json` contains a `tb_rows` index with:
  - `tbId ASCENDING`
  - `rowNo ASCENDING`
  - `__name__ ASCENDING`
- This index exactly matches the row callable query ordering requirements.
- Therefore the previously reported missing composite index diagnosis is stale or incorrect for the currently defined row callable query.

### Deployment drift
- `git status` in `C:\dev\ireps-web` shows local modifications in `functions/targetedBatches/getTargetedBatchRowsCallable.js` and other files.
- The local version of `functions/targetedBatches/getTargetedBatchRowsCallable.js` contains diagnostic logging that has not been deployed yet.
- The exact deployed Cloud Function version cannot be determined from the repo alone, but local code clearly differs from the checked-out HEAD and thus may differ from deployed code if no deployment has happened.

## Confirmed root cause / hypotheses
### Primary hypothesis
- The current failure is a client-side bucket visibility filter issue in the mobile app.
- The target batch is likely being loaded from `tb_uploads` but then filtered out by `canActorSeeBgoBucket(...)` because the user is not recognized as the correct `SP` or `TEAM` target.
- This is consistent with seeing the batch earlier and now seeing `No Targeted Batches available` without a stream error.

### Supporting hypothesis
- The line `useGetTeamsQuery(...)` at line 1107 in `my-workorders.js` suggests team membership is resolved in the client.
- If `teams` data is unavailable due Firestore rules, read failures, or missing fields, the batch list can become empty silently.
- The list empty state is not an error card, so a team membership stream failure could be hidden.

### Secondary hypothesis
- There may also be a role or actor eligibility change causing `fieldWorkorderActor` to skip the stream, but this would likely also affect BGO buckets and is less consistent with the symptom described.

## Separation of list/bucket loading and row loading
- Bucket loading: direct Firestore stream in `src/redux/targetedBatchApi.js` -> `tb_uploads`.
- Row loading: callable `getTargetedBatchRowsCallable` in `functions/targetedBatches/getTargetedBatchRowsCallable.js`.
- The mobile list empty state is independent of the row callable.
- The row callable failure is separate and would only occur after selecting a batch and requesting rows.

## Error swallowing analysis
- In the bucket UI, `targetedBatchError` is shown explicitly at line 2542 in `my-workorders.js`.
- `No Targeted Batches available` is only shown when there is no error and the filtered bucket list is empty.
- Therefore the list view is not silently swallowing a bucket stream error into the empty state.
- The row callable error path logs `getTargetedBatchRowsCallable ERROR` in `src/redux/targetedBatchApi.js` and would return an error object, not an empty bucket list.

## Exact deployed callable names involved
- Bucket load: `useGetTargetedBatchBucketsQuery` / Firestore `tb_uploads` stream in `src/redux/targetedBatchApi.js`.
- Row load: `getTargetedBatchRowsCallable` via `httpsCallable(functions, "getTargetedBatchRowsCallable")` in `src/redux/targetedBatchApi.js`.
- Allocation and authorization: `onAllocateTargetedBatchCallable` is present in `functions/index.js` but not directly used by these load paths.

## Smallest safe next action to prove the diagnosis
- Instrument the mobile bucket/list path rather than deploying the row callable diagnostics.
- Specifically, add temporary logs in `src/redux/targetedBatchApi.js` and/or `app/(tabs)/admin/operations/my-workorders.js` for:
  - `actorUid`, `actorSpId`, and `actorTeamIds`
  - the raw `targetedBatchData.buckets` returned by the `tb_uploads` stream
  - each `bucket.allocation.targetType` and `bucket.allocation.targetId`
  - whether `canActorSeeBgoBucket(...)` returns true for the known batch `TGB_20260804_221932_OP6H`
  - `teamsData` shape and whether the relevant team document is present
- This will prove whether the batch is failing at bucket visibility filtering.

## Should we deploy the diagnostic row callable now?
- No. The current symptom is earlier than the row callable, so the first instrumentation should be on the bucket/list path.
- Deploying the row callable diagnostic now would not prove the current `No Targeted Batches available` issue.
- If the batch becomes visible after bucket/list changes, then deploy the row callable diagnostics as the next step to diagnose row fetch failures.

## Exact files that would need modification
- `c:\dev\ireps-mobile\src\redux\targetedBatchApi.js`
- `c:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js`
- Optionally, `c:\dev\ireps-web\functions\targetedBatches\getTargetedBatchRowsCallable.js` if row-call diagnostics are later required.

## Recommended logging points
- In `src/redux/targetedBatchApi.js` inside `getTargetedBatchBuckets` after snapshot receives data.
- In `src/redux/targetedBatchApi.js` inside `canActorSeeBgoBucket(...)` to log target type/id and membership decision.
- In `app/(tabs)/admin/operations/my-workorders.js` after `actorTeamIds` is computed and before bucket filtering.
- In `app/(tabs)/admin/operations/my-workorders.js` when `targetedBatchBuckets.length === 0` to log the source batch list and filter decisions.
- If row loading is investigated later, keep the existing local diagnostics in `functions/targetedBatches/getTargetedBatchRowsCallable.js` and deploy them only after the list issue is resolved.

## Regression tests
- Existing web unit tests already validate `getTargetedBatchRows` row access and pagination in `functions/test/getTargetedBatchRowsCallable.test.js`.
- Add or extend mobile unit tests for `canActorSeeBgoBucket(...)` to include:
  - a `TEAM`-targeted batch where `actorTeamIds` contains the target ID
  - a `TEAM`-targeted batch where `teamsData` is empty
  - an `SP`-targeted batch with matching and non-matching `actorSpId`
- Add an integration test covering `targetedBatchBuckets` filtering in `app/(tabs)/admin/operations/my-workorders.js` or the corresponding state selector.

## Confirmation of no modification
- I did not modify application code or deploy anything.
- I only inspected source files, git state, and created this report.
