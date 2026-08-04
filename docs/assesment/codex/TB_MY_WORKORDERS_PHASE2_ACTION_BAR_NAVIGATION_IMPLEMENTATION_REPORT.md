# Targeted Batch My Workorders Phase 2 Action Bar and Navigation Implementation Report

## 1. Executive Summary

**PHASE 2 STATUS: PASSED WITH LIMITATIONS.** My Workorders now reads Sales-enriched Targeted Batch rows from the Phase 1 callable, pages them explicitly, renders row-authoritative PREMise/AST/NA/ERF tiles, and uses one intent-based geography preparation flow for exact ERF, premise, AST, and Meter Discovery actions. NA remains read-only. No backend/web source, Firestore data, deployment, or physical device was touched. The limitation is that this repository has no React Native component/navigation test harness; focused pure Node tests cover the state and stale-reference logic, while navigation was verified statically and with lint rather than rendered integration tests.

## 2. Repository State Before Implementation

- Mobile: `C:\dev\ireps-mobile`, branch `main`, HEAD `f8b4063`, clean.
- Web: `C:\dev\ireps-web`, branch `main`, HEAD `85a7569`, clean.
- Both states matched the requested baselines; implementation proceeded only after this check.

## 3. Existing Mobile Rows Architecture

My Workorders was the only consumer of `useGetTargetedBatchRowsQuery`. The endpoint directly listened to `tb_rows`; `my-workorders.js` then counted all warehouse premises/meters on each ERF. The card exposed two passive ERF-wide counts and one button. The pending action stored row/bucket snapshots and always opened Premises. Existing individual, BGO, and MD-BGO branches were left unchanged.

## 4. Phase 1 Callable Integration

`src/redux/targetedBatchApi.js:280-292,445-463` preserves `refs`, `salesDocId`, nullable `noAccessCount`, and `noAccessSourceStatus`, and calls `getTargetedBatchRowsCallable` with exact `{ tbId, limit, cursor }`. Errors are converted to the existing RTK error shape without exposing stacks. No Sales document or NA history is stored.

## 5. Pagination and Refresh Behaviour

`targetedBatchApi.js:535-545` keys cache by TB, appends pages in stable normalized order, and deduplicates row IDs. `my-workorders.js:1067-1082,2316-2327,3260-3263` uses a controlled 100-row first page, explicit LOAD MORE, duplicate-request blocking, pull-to-refresh, and page-one reset when the selected TB changes. A later-page failure retains the existing cache.

## 6. Four-Tile Component

`src/features/targetedBatches/TargetedBatchActionTile.js:1-27` is the reusable tile. `my-workorders.js:3320-3329` renders PREMISE, AST, NA, and ERF. Only the pending intent's tile receives `opening=true`; card geometry remains stable.

## 7. Row State Matrix

`src/features/targetedBatches/targetedBatchActions.js:11-33` derives Premise/AST solely from `row.refs`, represents non-OK NA as null/`DATA ISSUE`, shows `DISCOVERY COMPLETE` after meter linkage, keeps NA non-interactive for Phase 2, disables AST without a premise, and flags meter-without-premise linkage.

## 8. Shared Intent Preparation

`my-workorders.js:2110-2198` implements `prepareTargetedBatchAction` with OPEN_ERF, OPEN_PREMISE, START_METER_DISCOVERY, OPEN_AST, and architecture-only RECORD_NO_ACCESS. It reuses the prior LM/workbase/ward activation and Warehouse readiness pipeline instead of duplicating geography work.

## 9. ERF Navigation

`my-workorders.js:1196-1254` resolves `row.refs.erfId` from the active ward package, updates exact ward/ERF with premise/meter cleared as applicable, and routes OPEN_ERF to `/(tabs)/erfs`. No arbitrary ERF fallback exists.

## 10. Premise Navigation

`my-workorders.js:1218-1229,1244-1259` resolves only `refs.premiseId`, validates its ERF, and fails closed with Premise Linkage Error. Empty premise refs select the exact ERF and open its Premises list; populated refs select the exact premise.

## 11. AST and Meter Discovery Navigation

`my-workorders.js:1230-1259` resolves AST identity only from `refs.meterId`, validates premise/ERF linkage, and routes to `/(tabs)/asts`; missing/mismatched ASTs fail closed. With a premise and no meter it calls the existing DiscoveryContext mission. `targetedBatchPremiseContext.js:32-97` builds the complete TB context, and `components/MissionDiscoveryModal.js:14-20,31-73` conditionally carries it to the established form route without changing normal discovery parameters.

## 12. NA Phase Boundary

The NA tile displays the callable count/status but is always disabled. RECORD_NO_ACCESS exists as an intent only. No form, route, queue item, callable, Firestore write, premise mutation, AST mutation, or misleading success message was added. Phase 4 must activate valid pre-meter capture.

## 13. Race and Stale-State Protection

`my-workorders.js:966-969,1089-1098,1202-1216,2175-2190` generates monotonic unique request keys, stores row ID and a refs snapshot, re-resolves the current row, verifies TB and refs, supersedes older presses, and clears request state on TB change/unmount/completion. The pending object no longer treats a captured row as authority.

## 14. Exact Mobile Files Modified

- `C:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js`
- `C:\dev\ireps-mobile\components\MissionDiscoveryModal.js`
- `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js`
- `C:\dev\ireps-mobile\src\features\premises\targetedBatchPremiseContext.js`
- `C:\dev\ireps-mobile\src\features\premises\targetedBatchPremiseContext.test.mjs`

## 15. Exact Mobile Files Created

- `C:\dev\ireps-mobile\src\features\targetedBatches\TargetedBatchActionTile.js`
- `C:\dev\ireps-mobile\src\features\targetedBatches\targetedBatchActions.js`
- `C:\dev\ireps-mobile\src\features\targetedBatches\targetedBatchActions.test.mjs`

## 16. Tests Added

Seven new focused Node subtests cover States A-D, exact zero/two/integrity semantics, Phase 2 NA disabled behavior, AST gating/intents, stable deduplicated paging, and stale refs. Five existing Targeted Batch premise-context tests were updated/regressed, including the safe serialized discovery context.

## 17. Test Commands

```text
node --test src/features/targetedBatches/targetedBatchActions.test.mjs src/features/premises/targetedBatchPremiseContext.test.mjs
npx.cmd eslint "app/(tabs)/admin/operations/my-workorders.js" components/MissionDiscoveryModal.js src/redux/targetedBatchApi.js src/features/targetedBatches/targetedBatchActions.js src/features/targetedBatches/TargetedBatchActionTile.js src/features/premises/targetedBatchPremiseContext.js
node --check src/redux/targetedBatchApi.js
git diff --check
```

## 18. Test Results

Node: **12 passed, 0 failed, 0 skipped**. Syntax: passed. Targeted ESLint: zero errors; two pre-existing warnings remain in `my-workorders.js` (`isManagerRole`, MD-BGO `liveStats`). Diff whitespace: passed, with only Git's existing LF/CRLF advisory.

## 19. Regression Results

All five existing Targeted Batch premise-context tests pass. Static inspection and the isolated conditional modal parameter confirm normal non-TB discovery remains unchanged. Individual, BGO, MD-BGO, normal Premises, ERF, and AST code paths were not rewritten. No live Firebase tests were run.

## 20. Risks and Limitations

- No RN render/router harness exists, so exact navigation and per-tile spinner behavior lack automated component integration coverage.
- No physical DEV test was authorized; visual density and platform interaction remain deferred.
- The callable's Firestore composite index still requires environment validation at deployment time.
- The retired direct listener lifecycle remains inert inside the endpoint for minimal structural churn; it performs no reads.

## 21. Deferred Phase 3 and Phase 4 Work

Meter Discovery backend completion, canonical TB outcome writes, NA form/queue/callable/persistence, Sales append, premise/AST trigger exclusions, and post-submission page-one refresh invocation remain deferred. The refresh entry point and RECORD_NO_ACCESS intent are present for Phase 4.

## 22. Final Recommendation

Accept Phase 2 as **PASSED WITH LIMITATIONS** for source integration and focused tests. Before sprint completion/deployment, implement Phases 3/4, add rendered navigation coverage, and perform the planned physical DEV workflow. Do not deploy this interim phase independently.
