# Sales Targeted Batch No Access Audit Timestamp and Trigger Verification Report

## 1. Executive Summary

**Overall status: PASSED WITH LIMITATIONS.** The row and parent audit-timestamp gap is corrected locally and is not deployed. Every new unique Sales Targeted Batch No Access (NA) transaction now refreshes both documents' `metadata.updatedAt`, `metadata.updatedByUid`, and `metadata.updatedByUser` using the callable's single server-controlled `Timestamp` and authenticated actor. Idempotent retries still return before all writes. Automated verification passed (44 passed, 0 failed, 0 skipped).

The requested `ireps2` read-only verification could not establish a trusted TLS connection from this workstation. Three attempts performed zero Firestore writes but returned gRPC `14 UNAVAILABLE` (`unable to verify the first certificate`; one attempt also encountered an unreachable IPv6 route). Therefore the supplied physical-test facts are recorded below but are not represented as independently verified DEV evidence. Exact live TRN IDs could not be obtained and are deliberately not invented.

## 2. Repository State Before Work

| Repository | Branch | HEAD | Initial status |
|---|---|---|---|
| `C:\dev\ireps-web` | `main` | `f6630c096bd36afa90bc1bc39a5771f9b33137d8` | Clean; expected |
| `C:\dev\ireps-mobile` | `main` | `ea2e598f76558bb3577186509cf1210f487d2f30` | Clean; expected (`ea2e598` short form) |

Mobile was inspection-only and no mobile file was modified.

## 3. Current Callable Timestamp Behaviour

The callable is imported/exported unchanged at `functions/index.js:91` and `functions/index.js:180`. `recordTargetedBatchNoAccess` receives `now = Timestamp.now()` and reuses that value throughout the transaction. The actor UID comes exclusively from `request.auth.uid`; the actor display name is resolved by `getActorNameFromRequest(request, profile)` after the authoritative user profile lookup. Client-supplied Sales summary user names are not trusted.

Before this correction, Sales `fieldWork.updatedAt` refreshed for every unique append (`functions/targetedBatches/recordTargetedBatchNoAccessCallable.js:218-242`), but the row update occurred only for `NOT_STARTED`, and the parent update only for a start transition.

## 4. Confirmed Audit-Timestamp Gap

The supplied physical-test export reports both `tb_rows/TBR_20260803_232835_Q1PZ_000001` and `tb_uploads/TGB_20260803_232835_Q1PZ` at `metadata.updatedAt = 2026-08-03T21:33:49.554Z`, despite three successful unique NA submissions. Source inspection confirms why: later `IN_PROGRESS` attempts skipped both audit patches. This is confirmed as a code defect; the live timestamp is supplied evidence, not independently re-read during this run.

## 5. Implemented Timestamp Correction

At `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js:353-382`, unconditional dot-path audit patches are constructed for the row and parent and written once per new unique transaction. First-activity execution changes are conditionally added to those patches. This preserves unrelated nested metadata and all locked business fields.

## 6. First Unique NA Behaviour

**PASS (automated).** A first unique NA creates the immutable TRN and Sales append, changes the row and parent to `IN_PROGRESS`, sets each `execution.startedAt` once, increments `counts.executionStartedRows` from 0 to 1, preserves `completedRows = 0`, and writes authenticated audit identity plus the transaction timestamp to row and parent. Assertions are at `functions/test/recordTargetedBatchNoAccessCallable.test.js:149-175`.

## 7. Later Unique NA Behaviour

**PASS (automated).** A second unique TRN appends one ordered Sales summary, refreshes both audit timestamps to the later server timestamp, keeps the authenticated audit actor, leaves both `execution.startedAt` values unchanged, leaves `executionStartedRows = 1`, and leaves `completedRows = 0`. Assertions are at `functions/test/recordTargetedBatchNoAccessCallable.test.js:233-257`.

## 8. Idempotent Retry Behaviour

**PASS (automated).** The existing TRN path begins at callable line 322 and returns `alreadyRecorded` before any create/update call. The test at lines 259-275 proves the write count and both audit timestamps remain unchanged on a same-identity retry; conflicting canonical identity fails with zero additional writes.

## 9. Exact Files Modified

- `C:\dev\ireps-web\functions\targetedBatches\recordTargetedBatchNoAccessCallable.js`
- `C:\dev\ireps-web\functions\test\recordTargetedBatchNoAccessCallable.test.js`

## 10. Exact Files Created

- `C:\dev\ireps-web\functions\scripts\tools\targeted-batches\verifySalesTargetedBatchNoAccessReadonly.js`
- `C:\dev\ireps-web\docs\assesment\codex\TB_MY_WORKORDERS_NA_AUDIT_TIMESTAMP_AND_TRIGGER_VERIFICATION_REPORT.md`

## 11. Automated Tests Added

The focused suite now explicitly proves first-attempt row/parent timestamps and authenticated actor fields; one-time row/parent start timestamps and counter behavior; later-attempt timestamp refresh without resetting start timestamps or counters; retry timestamp immutability and zero writes; Sales history preservation/order; premise-linked TRN preservation; zero direct premise/AST writes; and existing rejection/correlation zero-write behavior. Existing tests already cover meter-linked rejection, terminal rows, wrong TB/row/Sales/ERF correlations, evidence validation, and immutable TRN shape.

## 12. Automated Test Commands

```powershell
cd C:\dev\ireps-web\functions
node --check targetedBatches/recordTargetedBatchNoAccessCallable.js
node --check test/recordTargetedBatchNoAccessCallable.test.js
node --check scripts/tools/targeted-batches/verifySalesTargetedBatchNoAccessReadonly.js
npx.cmd eslint index.js targetedBatches/recordTargetedBatchNoAccessCallable.js test/recordTargetedBatchNoAccessCallable.test.js
npx.cmd eslint scripts/tools/targeted-batches/verifySalesTargetedBatchNoAccessReadonly.js
node --test test/recordTargetedBatchNoAccessCallable.test.js test/getTargetedBatchRowsCallable.test.js test/targetedBatchPremiseLink.test.js test/meterMaster.helpers.test.js
```

## 13. Automated Test Results

**PASS.** Syntax checks passed. ESLint passed with zero findings. The final regression run reported **44 passed, 0 failed, 0 skipped**. An earlier focused run had two assertion failures because `structuredClone` strips the Firebase `Timestamp` prototype in the fake; assertions were corrected to compare seconds/nanoseconds, after which the focused suite passed 10/10. This was a test representation issue, not a production-code failure.

## 14. DEV Verification Method

The created verifier requires explicit project, service account, TB, row, Sales, premise, and ERF IDs. It performs six direct document reads plus a single-field query constrained to the exact `targetedBatchContext.rowId` (`verifySalesTargetedBatchNoAccessReadonly.js:71`), then filters exact canonical correlations locally. Its source contains no Firestore create, set, update, delete, transaction write, or batch write.

Invocation used all locked IDs against project `ireps2`. Three attempts failed before any snapshot completed: TLS certificate verification failed twice; the intervening attempt also showed an unreachable IPv6 route and reported that the previously configured `.tmp\avast-web-shield-root.pem` no longer exists. **DEV method: PASS; DEV execution: FAILED due to environment connectivity.**

## 15. Verified TRN Evidence

**FAILED / not obtained.** Expected count: 3. Independently verified count: 0 because no Firestore read completed. Exact TRN IDs: **unavailable**. The supplied statement that three separate submissions succeeded is retained as physical-test context only. Canonical ID prefix, outcome, correlations, actor, timestamps, reason, media, GPS, premise, and null AST checks are implemented in the verifier but were not executed against live snapshots.

## 16. Verified Sales Evidence

**PASSED WITH LIMITATIONS.** Supplied physical evidence states Sales `demo_sales_meters/07027981971` displays `NA 3`, with the row still in progress. Independent verification of the exact single `tbRef`, ordered three entries, `premiseId`, null `meterId`/`trnId`/`discoveredMeterNo`/`submittedAt`, other `tbRefs`, and `geofenceRefs` was blocked by TLS. No live values are asserted beyond supplied evidence.

## 17. Verified Premise Evidence

**FAILED / not obtained.** Target: `premises/PRM_1785792820793_190_W007_1138`. Source confirms the trigger applies `FieldValue.arrayUnion(trnId)` to `noAccessTrnIds` and dot-path premise audit metadata (`functions/index.js:1884-1894`). The exact three IDs, uniqueness, latest trigger metadata, and absence of AST changes could not be independently read.

## 18. Verified ERF Trigger Evidence

**PASSED WITH LIMITATIONS (source), FAILED (live read).** `onNoAccessRecorded` is unchanged at `functions/index.js:1852-1915`. For an NA TRN with a premise it updates premise references/audit fields, then updates `ireps_erfs/{erfId}.metadata.updatedAt/updatedByUid/updatedByUser` at lines 1900-1905 and invokes `rebuildErfTrnCount` at line 1907. That rebuild updates `registry_erfs/{erfId}.counts.trnsNa`, `.trnsAccess`, `.trnsTotal` and system rebuild audit metadata (`functions/registry/erfTrnCountRebuild.js`). It intentionally does not add one direct NA reference per event to the ERF. Live `K241N0GT011700001138000000` evidence could not be read.

## 19. Verified Targeted Batch Parent and Row State

**PASSED WITH LIMITATIONS.** Supplied physical evidence states:

- Parent `TGB_20260803_232835_Q1PZ`: `execution.status = IN_PROGRESS`, `counts.executionStartedRows = 1`, `counts.completedRows = 0`.
- Row `TBR_20260803_232835_Q1PZ_000001`: `execution.status = IN_PROGRESS`, `refs.premiseId = PRM_1785792820793_190_W007_1138`, `refs.meterId = null`, `refs.trnId = null`.
- Both exported audit timestamps remained `2026-08-03T21:33:49.554Z`.

These values explain the local correction and indicate that three NAs did not start/complete the row three times or link a meter/AST. They were not independently re-read. The correction is not deployed and no claim is made that current DEV demonstrates the new timestamp behavior.

## 20. Zero-AST Verification

**PASS (local callable/tests); live verification unavailable.** `buildTrn` sets `ast: null` (callable line 267), and the callable has no AST reference or write. Focused tests assert no `asts/` write and no direct premise write. Live row/TRN evidence could not be retrieved.

## 21. Read-Only Guarantee

**PASS.** The verifier exposes only document/query reads. All three attempts printed `Firestore writes performed: 0`; no snapshot completed and no write API exists in the script. No Firestore, Storage, deploy, stage, commit, push, reset, revert, or clean action was performed.

## 22. Timezone Follow-Up

Approved deferred work: future Sales NA reporting should retain canonical `capturedAt` ISO time plus `date`, South African presentation `time`, `timezone: "Africa/Johannesburg"`, and authenticated `user`. This task did not change the Sales schema, backfill existing entries, change mobile display logic, or implement timezone conversion.

## 23. Risks and Limitations

- Live TRN IDs and all requested live field-by-field assertions remain unknown due solely to local TLS/network trust failure.
- The supplied physical state is credible context but is not substituted for an independent read.
- The local timestamp correction is not deployed, so DEV documents remain expected to show old behavior.
- The verifier expects the normal automatic single-field index on `targetedBatchContext.rowId`; it requests no composite index and scans no unrelated users.

## 24. Deployment Recommendation

Do not deploy from this task. First restore a trusted Node/gRPC CA chain, rerun the exact read-only verifier until all checks pass, and record the three exact TRN IDs. Then review and deploy the callable through the normal controlled release process. After deployment, use a new unique controlled attempt to confirm row and parent audit timestamps advance while `execution.startedAt` and counters remain stable; do not use an idempotent retry for that confirmation.

## 25. Final Status

**PASSED WITH LIMITATIONS**

The code correction and automated regression verification passed. The required live DEV verification remains incomplete because the environment could not establish a trusted Firestore TLS connection. No live claims were fabricated, and all prohibited writes/actions were avoided.
