# Targeted Batch My Workorders Phase 1 Rows API Implementation Report

## 1. Executive Summary

Phase 1 is **PASSED**. A read-only authenticated callable named `getTargetedBatchRowsCallable` now returns one stable page of `tb_rows`, enriched only with the authoritative Sales-derived `noAccessCount` and an explicit integrity status. No mobile or frontend source was changed.

## 2. Repository State Before Implementation

- Branch: `main`
- HEAD: `b7f261672825eebe9a9a91bfe2aee8666fc6c952`
- The worktree was already substantially dirty: deleted root archives/inspection artifacts; modified Targeted Batch backend, tests, and web UI files; and numerous untracked reports/tools/UI files.
- Relevant pre-existing modifications included `functions/index.js`, `functions/targetedBatches/callables.js`, `documentFactory.js`, `helpers.js`, `premiseLink.js`, and `functions/test/targetedBatchPremiseLink.test.js`.
- No pre-existing file was cleaned, reset, staged, or overwritten. The two-line `functions/index.js` integration was added around existing changes.

## 3. Existing Rows Architecture

Collections are declared in `functions/targetedBatches/helpers.js`: parent `tb_uploads`, rows `tb_rows`, and Sales `demo_sales_meters`. `buildTargetedBatchRowDoc` in `documentFactory.js` creates rows with `id`, `tbId`, positive numeric `rowNo`, `salesAllMeterId`, mirrored `source.recordId`, canonical `refs`, allocation, and the existing mobile-required row fields. The literal field `salesDocId` is not currently written. Inspection confirmed `salesAllMeterId` is the canonical Sales document ID used by existing permanent creation and premise-link logic; this endpoint does not fall back to meter/account/address/ERF matching.

Before this change, mobile directly streamed `tb_rows`; no backend rows callable or bucket-list backend endpoint supplied Sales NA counts. Existing create, allocate, accept/reject, delete, and premise-link modules remain unchanged.

## 4. Implemented Callable Contract

`functions/targetedBatches/getTargetedBatchRowsCallable.js:158-195` implements and exports the handler/callable. `functions/index.js:90,178` exports it from the deployed Functions entry point.

Input is `{ tbId, limit?, cursor? }`. Output is `{ success, rows, summary, pagination, diagnostics }`. Each row preserves its complete canonical row payload and adds only `salesDocId`, `noAccessCount`, and `noAccessSourceStatus`; no Sales document or NA history is returned.

## 5. Authentication and Authority

At `getTargetedBatchRowsCallable.js:95-119`, auth is mandatory. Actor data is resolved through the existing `findActorProfile` helper. Only existing field roles (`FWR`, `SPV`) proceed, and access is then fail-closed against the parent allocation:

- `TEAM`: actor UID must be in the allocated team using the repository's accepted membership shapes.
- `SP`: actor employment Service Provider ID must equal the allocation target.
- Direct-user allocation is unsupported.

Absent allocation, an unrelated actor, an unsupported target, or a missing team denies access.

## 6. Row Query and Pagination

Validation is at lines 73-93. Default limit is 100 and strict maximum is 200 (line 11). The query at lines 161-166 filters exact `tbId`, orders by numeric `rowNo`, then Firestore document ID, applies a matching two-value cursor, and reads at most `limit + 1` documents. This provides deterministic ordering, a tiebreaker, and `hasMore` without unbounded reads.

## 7. Sales Document Batch Enrichment

Lines 146-156 chunk Admin `getAll` reads into groups of 100. Lines 167-174 collect, normalize, and deduplicate canonical `salesAllMeterId` values. Each row consults only its mapped Sales snapshot. Exact reference matching at lines 129-133 requires both `tbRef.id === row.tbId` and `tbRef.rowId === row.id`.

Diagnostics report rows read, unique Sales IDs, Sales documents requested/found, successful rows, integrity-status counts, and zero writes (lines 184-189).

## 8. noAccessCount Rules

At lines 121-143, an exact valid reference with absent `fieldWork`, absent `noAccess`, or an empty array returns `0 / OK`. A valid array returns its exact length. No premise, AST, ERF, user, or TRN history is inspected.

## 9. Integrity Status Rules

- `OK`: Sales exists, exact reference exists, and fieldWork/noAccess types are valid.
- `SALES_DOCUMENT_MISSING`: canonical ID exists but the document does not.
- `TB_REFERENCE_MISSING`: Sales exists but no exact TB+row reference exists.
- `FIELDWORK_INVALID`: fieldWork is not a non-array object, or noAccess is not an array.
- `SALES_DOCUMENT_ID_MISSING`: added because a missing canonical row ID is distinct from a missing Sales document.

Every non-OK row returns `noAccessCount: null`, never zero.

## 10. Read-Only Guarantee

The implementation contains no `set`, `create`, `update`, `delete`, transaction, batch, FieldValue, counter, or metadata mutation. It only performs document/query reads. The isolated fake records no write API and the safety test compares the entire database fixture before and after listing. Firestore writes performed: **zero**.

## 11. Exact Files Modified

- `C:\dev\ireps-web\functions\index.js` — callable import/export only (lines 90 and 178). This file had pre-existing unrelated changes.

## 12. Exact Files Created

- `C:\dev\ireps-web\functions\targetedBatches\getTargetedBatchRowsCallable.js`
- `C:\dev\ireps-web\functions\test\getTargetedBatchRowsCallable.test.js`
- `C:\dev\ireps-web\docs\assesment\codex\TB_MY_WORKORDERS_PHASE1_ROWS_API_IMPLEMENTATION_REPORT.md`

## 13. Tests Added

Four focused Node test cases at `functions/test/getTargetedBatchRowsCallable.test.js:73-123` cover unauthenticated/invalid/unauthorized access, TEAM and SP authority, exact TB filtering, ordering, limit, cursor continuity, invalid cursor, all count rules, exact two-key reference matching, all integrity states, null invalid counts, deduplication, response minimization, zero writes, and unchanged row/Sales/parent fixtures.

## 14. Test Commands

```text
node --check functions/targetedBatches/getTargetedBatchRowsCallable.js
node --check functions/index.js
node --check functions/test/getTargetedBatchRowsCallable.test.js
node --test functions/test/getTargetedBatchRowsCallable.test.js functions/test/targetedBatchPremiseLink.test.js
npx.cmd eslint targetedBatches/getTargetedBatchRowsCallable.js test/getTargetedBatchRowsCallable.test.js ../functions/index.js
git diff --check -- functions/index.js functions/targetedBatches/getTargetedBatchRowsCallable.js functions/test/getTargetedBatchRowsCallable.test.js
```

## 15. Test Results

- Node tests: **20 passed, 0 failed, 0 skipped**.
- New rows API: 4/4 test cases passed.
- Syntax checks: passed.
- ESLint: passed with zero warnings/errors.
- Diff whitespace check: passed (Git emitted only its existing LF/CRLF advisory for `functions/index.js`).

## 16. Regression Results

The existing `targetedBatchPremiseLink.test.js` suite passed 16/16. Existing Targeted Batch bucket behavior was not changed; the repository has no backend rows bucket callable to modify. Premise-link behavior remains unchanged and passing. No live Firebase operation was run.

## 17. Risks and Limitations

- The query requires the composite Firestore ordering/index implied by exact `tbId`, `rowNo`, and document ID. If the deployed project reports a missing index, its generated index definition must be reviewed separately; no live deployment/index operation was authorized.
- Reads are page-consistent, not a cross-document transaction snapshot. Later write phases must revalidate correlation transactionally.
- Current canonical storage uses `salesAllMeterId`, while the public contract names it `salesDocId`. A future schema migration should avoid running both authorities ambiguously.

## 18. Deferred Phase 2 Work

Mobile action tiles/navigation, No Access capture and writes, trigger changes, premise/AST behavior, Meter Discovery completion, Sales reporting, and all mobile integration are intentionally deferred.

## 19. Final Recommendation

**PHASE 1 STATUS: PASSED.** Integrate the mobile worklist with this callable in the later authorized phase, retaining explicit integrity-state rendering and cursor paging. Before production deployment, confirm the required Firestore index in the target project and run emulator/integration coverage under the normal release process.
