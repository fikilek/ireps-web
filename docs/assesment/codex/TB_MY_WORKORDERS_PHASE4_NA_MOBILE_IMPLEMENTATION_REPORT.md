# TB My Workorders Phase 4 NA Mobile Implementation Report

## 1. Executive Summary

Phase 4 is **PASSED WITH LIMITATIONS**. The mobile app now enables Sales Targeted Batch No Access for executable, Sales-valid rows without a linked meter; captures the established reason/photo evidence plus foreground GPS; submits the Phase 3 callable online; and saves the same stable attempt to the existing MMKV queue offline or after a transient upload/call failure. No backend or web source was changed.

## 2. Repository State Before Implementation

- Mobile: `C:\dev\ireps-mobile`, branch `main`, HEAD `d01a464`, clean.
- Web/backend: `C:\dev\ireps-web`, branch `main`, HEAD `3864a0a`, clean.

## 3. Existing Mobile No Access Architecture

The implementation reuses `components/forms/IrepsNoAccessSection.js`, `components/media/IrepsMedia.js`, the `METER_NO_ACCESS_REASON` lookup, Expo foreground Location, Firebase Storage, and `src/utils/submissionQueue.js`. The read-only `app/(tabs)/premises/NaScreen.js` is unchanged.

## 4. Phase 3 Callable Contract

`functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` requires `trnId`, `sourceModule`, `tbId`, `rowId`, `salesDocId`, `erfId`, optional `premiseId`, `capturedAt`, non-empty `reason`, `media[]` containing `noAccessPhoto`, and GPS at `location.gps.lat/lng`. It returns `success`, `alreadyRecorded`, IDs, premise, row status, and authoritative count. Mobile follows this contract at `src/features/targetedBatches/targetedBatchNoAccess.js:54`.

## 5. NA Tile Activation

`src/features/targetedBatches/targetedBatchActions.js:9` enables NA only for `OK` Sales integrity, allocated/executable rows, complete IDs, and no linked meter. Invalid Sales data shows a dash/`DATA ISSUE`; linked meters retain count and show `DISCOVERY COMPLETE`. The selected tile alone receives `opening` at `app/(tabs)/admin/operations/my-workorders.js:3357`.

## 6. RECORD_NO_ACCESS Navigation

The existing ward/workbase/Warehouse/ERF preparation remains authoritative. After re-resolving the row, meter and Sales status are rechecked at `my-workorders.js:1234`; the minimal serialized context is built and routed at `my-workorders.js:1270`.

## 7. Capture Route and Form

The focused route is `app/(tabs)/admin/operations/targeted-batch-no-access.js`. It displays meter, ERF, batch, NA count and premise status. Registration is in `app/(tabs)/admin/operations/_layout.js:41`.

## 8. Reason Validation

The form reuses `IrepsNoAccessSection` and converts the established select-with-other shape to canonical text. Empty reason is rejected before GPS or submission (`targeted-batch-no-access.js:65`).

## 9. Photograph Capture and Upload

The established `IrepsMedia` camera captures tag `noAccessPhoto`. Online upload uses `meters/no_access/{stableTrnId}_noAccessPhoto.jpg` (`targeted-batch-no-access.js:79`). Offline retains local URI; queue sync uploads it with the same deterministic name (`src/services/processSubmissionQueue.js:74`). Upload and callable are explicitly separate operations.

## 10. GPS Capture

Foreground permission and high-accuracy current position are requested at `targeted-batch-no-access.js:43`. Payload preserves `lat`, `lng`, accuracy and capture time. Null/invalid coordinates fail local validation.

## 11. Stable TRN ID

`buildTargetedBatchNoAccessTrnId` uses `TRN_MDIS_` (`targetedBatchNoAccess.js:28`). A `useRef` owns one ID and a second ref owns the original captured timestamp (`targeted-batch-no-access.js:33`). Upload, immediate call, queue and retries reuse it.

## 12. Online Submission

The screen validates evidence, uploads media, invokes `recordTargetedBatchNoAccessCallable`, and treats both new and `alreadyRecorded` success as completion (`targeted-batch-no-access.js:85`). The submit ref/button prevent duplicate taps.

## 13. Offline Queue Integration

Queue form type `SALES_TARGETED_BATCH_NO_ACCESS` is declared at `targetedBatchNoAccess.js:1` and routed to the Phase 3 callable at `src/utils/submissionQueue.js:655`. Payload and display context preserve all required fields.

## 14. Retry and Idempotency

Queue insertion deduplicates by stable TRN ID (`submissionQueue.js:69`). Sync persists uploaded media before calling (`processSubmissionQueue.js:97`), so a post-upload failure retries the canonical URL. Controlled permanent conflicts become `CONFLICT` rather than retrying indefinitely (`processSubmissionQueue.js:146`).

## 15. Pre-Premise Behaviour

Context normalizes an absent premise to `null` (`targetedBatchNoAccess.js:14`). No premise creation is required and the payload sends `premiseId: null`.

## 16. Premise-Linked Behaviour

An existing row premise is preserved in route context and callable payload. The backend remains authoritative and its existing premise-linked trigger behavior is not bypassed.

## 17. Meter-Linked Guard

Linked-meter rows are disabled in the action helper. A meter added during geography preparation is caught before navigation; a later backend `TARGETED_BATCH_METER_ALREADY_LINKED` response returns to/refetches My Workorders.

## 18. Post-Submission Refresh

The capture route dismisses to My Workorders with a refresh token (`targeted-batch-no-access.js:40`). My Workorders clears the cursor and changes `reloadKey` at `my-workorders.js:1097`, causing page-one API reload while preserving the existing screen/bucket where routing permits. No count is incremented optimistically.

## 19. Error Handling

Evidence failures remain on the form. Location permission/capture failures are controlled alerts. Transient failures queue the attempt. Meter/terminal conflicts return and refresh. Queue correlation, authority, missing Sales/tbRef and idempotency conflicts are surfaced as non-retryable `CONFLICT` items. Raw stacks are not shown.

## 20. Exact Mobile Files Modified

- `app/(tabs)/admin/operations/_layout.js`
- `app/(tabs)/admin/operations/my-workorders.js`
- `src/features/targetedBatches/targetedBatchActions.js`
- `src/features/targetedBatches/targetedBatchActions.test.mjs`
- `src/services/processSubmissionQueue.js`
- `src/utils/submissionQueue.js`

## 21. Exact Mobile Files Created

- `app/(tabs)/admin/operations/targeted-batch-no-access.js`
- `src/features/targetedBatches/targetedBatchNoAccess.js`
- `src/features/targetedBatches/targetedBatchNoAccess.test.mjs`

## 22. Tests Added

Five pure helper tests cover minimal context, premise normalization, missing IDs, stable canonical IDs, evidence validation, exact payload keys, and both premise modes. Phase 2 tests were updated for Phase 4 activation. Existing premise-context regression tests remain unchanged.

## 23. Test Commands

```text
node --test src/features/targetedBatches/*.test.mjs src/features/premises/targetedBatchPremiseContext.test.mjs
npx.cmd eslint "app/(tabs)/admin/operations/my-workorders.js" "app/(tabs)/admin/operations/targeted-batch-no-access.js" "app/(tabs)/admin/operations/_layout.js" "src/features/targetedBatches/targetedBatchActions.js" "src/features/targetedBatches/targetedBatchNoAccess.js" "src/services/processSubmissionQueue.js" "src/utils/submissionQueue.js"
git diff --check
```

## 24. Test Results

Node: 17 passed, 0 failed, 0 skipped. ESLint: 0 errors and 2 pre-existing warnings in `my-workorders.js`. `git diff --check`: no whitespace errors (line-ending notices only).

## 25. Regression Results

Phase 2 action tests and Phase 1 premise-context tests pass. Normal discovery, lifecycle, BGO, MD-BGO, read-only NA history, premise schema and GeoContext implementations were not modified. Static search found no direct mobile Firestore write in the Phase 4 path.

## 26. Risks and Limitations

Physical Expo validation of camera permissions, GPS permissions, Storage upload, offline-to-online transitions and router stack behavior was prohibited/not available. The repository has no standalone Node-compatible MMKV queue test harness, so queue integration is linted and inspected but not executed in Node. These are the reasons for **PASSED WITH LIMITATIONS**.

## 27. Deferred Meter Discovery Completion

Targeted Batch Meter Discovery backend completion remains intentionally deferred. Existing normal Meter Discovery is unchanged.

## 28. Combined Phase 1–4 Test Readiness

Phase 1 row/count contract, Phase 2 action/geography behavior, Phase 3 callable contract and Phase 4 capture/queue payload align. Controlled physical testing should cover pre-premise, premise-linked, linked-meter race, offline capture, post-upload timeout and already-recorded retry.

## 29. Final Recommendation

Proceed to controlled physical testing without live production data. Do not deploy until camera/GPS permission denial, offline queue recovery, deterministic media upload retry, callable conflicts and page-one count refresh have been observed on a device.
