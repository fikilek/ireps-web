# Sales Targeted Batch My Workorders Phase 3 Implementation Report

## 1. Executive Summary

Phase 3 is **PASSED WITH LIMITATIONS**. The backend now exposes an authenticated `recordTargetedBatchNoAccessCallable` that creates one immutable canonical No Access TRN, appends one summary to the exact Sales `tbRefs` item, starts a not-started row and parent exactly once, rejects meter-linked or terminal rows, and uses the client TRN ID as the transaction idempotency key. It writes no AST and supports rows both with and without premises.

The limitation is test-environment fidelity: the isolated Admin fake proves the transaction's reads, writes, preservation, validation and retry result, but does not emulate Firestore's concurrent transaction retry scheduler or execute a deployed Firestore create trigger. No live Firestore testing was permitted.

## 2. Repository State Before Implementation

- Web: `C:\dev\ireps-web`, branch `main`, HEAD `3656f47`, clean.
- Mobile: `C:\dev\ireps-mobile`, branch `main`, HEAD `d01a464`, clean.
- The mobile repository was inspected only and remains unchanged.

## 3. Existing No Access Backend Architecture

The existing Meter Discovery callable validates a `TRN_MDIS_` ID, `METER_DISCOVERY`, `hasAccess`, `meterType: NA`, a reason, and tagged `noAccessPhoto` media in `functions/index.js:1132-1185`. Its normal path requires a premise and writes `trns/{id}` (`functions/index.js:3028-3202`). The create trigger recognizes `accessData.access.hasAccess === "no"`, reads `accessData.premise.id` and `accessData.erfId`, and performs the premise/ERF follow-up (`functions/index.js:1852-1914`).

## 4. Corrected Premise Rule

The new TRN uses the existing trigger-recognized `accessData.premise.id` when the row has an authoritative premise (`recordTargetedBatchNoAccessCallable.js:245-279`). When no premise exists, it writes `accessData.premise: null`. The existing trigger already returns without a document lookup when that ID is absent (`functions/index.js:1870-1873`), so no Sales-specific bypass or trigger change was made.

## 5. Implemented Callable Contract

Input normalization and validation are at `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js:118-141`. Required fields are `trnId`, `sourceModule`, `tbId`, `rowId`, `salesDocId`, `erfId`, `capturedAt`, `reason`, `media`, and `location`; `premiseId` is optional. IDs are trimmed, `sourceModule` is locked to `SALES_TARGETED_BATCH`, the TRN retains the canonical `TRN_MDIS_` convention, media requires a usable `noAccessPhoto` reference, and GPS coordinates are range checked.

The callable export is imported at `functions/index.js:91` and exported at `functions/index.js:180`.

## 6. Authentication and Work Authority

Authentication, actor profile lookup, authenticated display name, supported FWR/SPV role resolution and transaction entry are at `recordTargetedBatchNoAccessCallable.js:282-303`. TEAM membership and SP ownership follow the existing Targeted Batch model and are checked against the authoritative allocation at lines 174-188 and 306-320. Only TEAM and SP targets are accepted; direct-user allocation fails closed.

## 7. Exact TB/Row/Sales/ERF Correlation

The transaction reads exact parent, row, Sales and TRN references at lines 304-311. Row document/parent identity, authoritative `salesAllMeterId` (with the established source record fallback), ERF reference and optional premise correlation are enforced at lines 334-348. Sales reference matching requires both `tbId` and `rowId` and exactly one match at lines 201-216.

## 8. Immutable TRN Shape

The canonical TRN builder is at lines 245-279. It records the immutable ID, Sales origin and correlation context, canonical Meter Discovery No Access structure, authoritative premise or null, reason, uploaded media references, validated location, captured timestamp, and server-controlled actor/metadata. It uses `transaction.create`, not merge or update, at line 351.

## 9. Sales tbRefs Append

The exact-reference append is implemented at lines 201-243. It preserves the containing Sales document, all other references, the original `tbRef.date`, prior No Access entries and order, and all unrelated `fieldWork` values. It appends only `{date, time, user}`, sets `status: IN_PROGRESS`, sets authoritative `premiseId`, and refreshes `updatedAt`.

## 10. First-Activity Row and Parent Updates

Lines 353-377 start a `NOT_STARTED` row and parent, preserve existing allocation/references, and increment `counts.executionStartedRows` only on the row transition. An already `IN_PROGRESS` row remains in progress and does not increment again. No completed-row counter is written.

## 11. Idempotency

`trns/{trnId}` is read inside the transaction. Lines 322-331 validate the existing immutable record against the submitted TB/row/Sales/ERF identity and return `alreadyRecorded: true` with no writes. Conflicting identity throws `IDEMPOTENCY_CONFLICT` (lines 189-199).

## 12. Existing Premise Trigger Preservation

`onNoAccessRecorded` was not modified. For a premise-linked TRN, its established `premises/{premiseId}.noAccessTrnIds` array union and premise metadata update remain at `functions/index.js:1889-1894`; ERF metadata and count rebuild remain at lines 1900-1907. Normal non-Sales Meter Discovery code was not changed.

## 13. No-Premise Behaviour

The authoritative row premise is resolved at line 344. A missing premise is valid and results in a null TRN premise and null Sales `fieldWork.premiseId`. The transaction never creates or reads a premise reference. The existing trigger's missing-ID return prevents an invalid premise update.

## 14. Meter-Completion Guard

The current row is re-read inside the transaction. `refs.meterId` rejects with `TARGETED_BATCH_METER_ALREADY_LINKED`; completed, cancelled, rejected and other unsupported execution states fail at lines 158-171. These checks occur before all writes.

## 15. Transaction Boundary

One transaction covers the new TRN, exact Sales document, row and parent (`recordTargetedBatchNoAccessCallable.js:304-378`). Authority and correlations use current transaction snapshots. The existing premise/ERF trigger remains asynchronous and is not claimed as part of this transaction. Media upload remains outside the callable. No AST reference or write exists in the implementation.

## 16. Exact Files Modified

- `C:\dev\ireps-web\functions\index.js` — callable import/export at lines 91 and 180.

## 17. Exact Files Created

- `C:\dev\ireps-web\functions\targetedBatches\recordTargetedBatchNoAccessCallable.js`
- `C:\dev\ireps-web\functions\test\recordTargetedBatchNoAccessCallable.test.js`
- `C:\dev\ireps-web\docs\assesment\codex\TB_MY_WORKORDERS_PHASE3_NA_BACKEND_IMPLEMENTATION_REPORT.md`

## 18. Tests Added

The focused suite at `functions/test/recordTargetedBatchNoAccessCallable.test.js:113-275` covers authentication, roles, TEAM/SP authority, unrelated/direct allocation, no-premise and premise paths, exact correlation, malformed Sales state, preservation, multiple attempts, counters, idempotency conflicts, meter guard, terminal rows, evidence and timestamp/location validation, and explicit zero AST/premise transaction writes.

## 19. Test Commands

```text
node --check functions/targetedBatches/recordTargetedBatchNoAccessCallable.js
node --check functions/test/recordTargetedBatchNoAccessCallable.test.js
node --check index.js
npx.cmd eslint index.js targetedBatches/recordTargetedBatchNoAccessCallable.js test/recordTargetedBatchNoAccessCallable.test.js
node --test test/recordTargetedBatchNoAccessCallable.test.js test/getTargetedBatchRowsCallable.test.js test/targetedBatchPremiseLink.test.js test/meterMaster.helpers.test.js
git diff --check
```

## 20. Test Results

- Combined Node test run: **44 passed, 0 failed, 0 skipped**.
- Targeted syntax checks: passed.
- Targeted ESLint: passed with no output.
- `git diff --check`: passed (Git emitted only its Windows line-ending advisory).

## 21. Regression Results

- Phase 1 rows API: passed.
- Targeted Batch premise-link: passed.
- Meter Master / normal Meter Discovery source regression: passed.
- Existing No Access trigger source and behavior were preserved unchanged.
- No live Firebase operation, deployment, physical test, stage, commit or push occurred.

## 22. Risks and Limitations

- The isolated fake applies transaction operations atomically but does not simulate server-side transaction contention/retry scheduling. Firestore's transaction contract is relied on for genuinely simultaneous unique submissions.
- Event-trigger effects were inspected and preserved, but not executed against an emulator or live Firestore in this phase.
- Date/time summaries are UTC components of the canonical captured ISO timestamp, matching deterministic backend derivation; a future product decision could explicitly require a local display timezone.

## 23. Deferred Phase 4 Work

Mobile No Access capture, navigation activation, offline queue integration, physical-device validation, deployed trigger validation, and any Meter Discovery completion flow remain deferred. No mobile source was changed.

## 24. Final Recommendation

**PASSED WITH LIMITATIONS.** Proceed to Phase 4 integration and emulator/approved environment concurrency testing. Retain the stable client-generated `TRN_MDIS_` ID and send uploaded `noAccessPhoto` references plus captured GPS/timestamp to this callable.
