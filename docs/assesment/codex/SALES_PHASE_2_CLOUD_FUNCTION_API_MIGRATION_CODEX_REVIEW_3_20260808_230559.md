# Sales Phase 2 Cloud Function / API Migration — Codex Review 3

## 1. Executive Verdict

OVERALL VERDICT: **PASS**

READY FOR DEV DATA-READINESS GATES: **YES**

READY FOR DEV DEPLOYMENT AFTER DATA-READINESS GATES: **YES**

NEW BLOCKERS: **0**

The installed implementation follows the approved Phase 2 architecture. Active Targeted Batch, geofence CREATE, Sales table, and Sales reporting/stats paths use `sales-all-meters`; operational writers remain within their locked field ownership; Web reads remain live `onSnapshot` streams; and the three prior blockers are closed in code. The two separate DEV data-readiness gates remain required but are not implementation blockers.

## 2. Repository State Reviewed

- Repository: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `860f44add153151232a775705c4e2c85a5bea7db` (the stated implementation baseline; Phase 2 is installed as uncommitted working-tree changes)
- Branch relationship observed: `main...origin/main [ahead 40]`
- Working tree was already dirty and contains unrelated modified/untracked work. This review did not modify source, deploy, commit, or push.
- Review date/time zone: 2026-08-08, Africa/Johannesburg.

## 3. Files Reviewed

Carefully reviewed the requested validator, Targeted Batch, geofence, Redux API, UI compatibility, and test files, plus `functions/index.js`, `firestore.indexes.json`, `functions/tools/targetedBatches/repairTargetedBatchErfRefs.js`, `functions/scripts/tools/targeted-batches/*`, `functions/scripts/tools/geofences/reprocessGeoFenceMembership.js`, and the relevant working-tree diffs/runtime exports needed to classify legacy references and trace active behavior.

## 4. Review 1 Blocker Closure Verification

### B-01 batchFail

**CLOSED.** `functions/targetedBatches/callables.js:771-773` updates only `tbRefs` on successful creation. Searches find no `batchFail` in active Targeted Batch production code; the remaining occurrences are negative assertions in `functions/test/salesPhase2Cutover.static.test.js:18`.

### B-02 geofence lost-update risk

**CLOSED.** Conflict inspection is at `functions/geofences/salesMembership.js:67-99`; the writer uses only `geofenceRefs: FieldValue.arrayUnion(...)` at lines 208-210. Conflicts abort before any batch is opened at lines 185-194. Different concurrent additions therefore compose without stale-array replacement.

### B-03 operational array structural validation

**CLOSED.** `validateTbRefs` (`functions/salesAllMeters/helpers.js:175-269`) and `validateGeofenceRefs` (lines 272-301) strictly type known contracts, reject normalized duplicate IDs, and do not reject unknown nested additions. They are invoked at lines 460-462.

## 5. Sales All Validator Review

The validator now implements an open additive root schema: required/protected roots are enumerated at `functions/salesAllMeters/helpers.js:21-40`, but there is no whole-document “extra root” rejection. Identity, provider, nonblank `lmPcode`, Master, commercial totals/month maps, and operational arrays remain governed at lines 315-486.

`tbRefs` accepts absence/arrays and the initial `{id,date}` shape; requires a nonblank normalized-unique ID and timestamp-like date; validates optional `rowId`, `fieldWork`, canonical statuses, known nullable/string/boolean/timestamp members and canonical no-access entries; requires row/timestamp correlation for `IN_PROGRESS`; and requires completion correlation for `COMPLETED`. Explicit `NOT_STARTED` remains minimal. Unknown nested members are not allowlisted and remain forward-compatible.

`geofenceRefs` accepts absence/arrays, requires a nonblank normalized-unique ID, permits optional string `name`, and allows unknown nested additions.

## 6. Targeted Batch Cutover Review

The central binding is `sales: "sales-all-meters"` at `functions/targetedBatches/helpers.js:7`. Creation (`callables.js:440-443,771-773`), deletion (`deleteCallable.js:204-233,356-431`), row retrieval (`getTargetedBatchRowsCallable.js:236-245`), premise/field-work lifecycle and Meter Discovery completion (`premiseLink.js:617-840,1181-1287,1494-1638`), and no-access/TRN correlation (`recordTargetedBatchNoAccessCallable.js:323-376`) all consume that binding.

Authoritative validation rejects missing `lmPcode` with `SALES_LM_SCOPE_MISSING` at `helpers.js:839-846`, rejects mismatch with `SALES_LM_SCOPE_MISMATCH` at lines 848-855, and continues on a match. Targeted Batch Sales writes are `tbRefs` only. Creation validation failure no longer writes diagnostics to Sales.

## 7. Geofence Cutover Review

The CREATE trigger queries `sales-all-meters` by canonical `hasUsableGps == true` at `functions/geofences/triggers.js:187-190`, then invokes the Sales-specific collector/committer at lines 196-216. Candidate processing retains lower-case canonical `erfCandidates`, latitude/longitude and LM/ward scope handling in `salesMembership.js:26-65,102-174`.

Exact existing `{id,name}` is idempotent; an ID-only legacy ref is accepted; same logical ID with a different explicit name and duplicate logical IDs fail closed (`salesMembership.js:67-99`). The atomic update touches only `geofenceRefs` (`:208-210`), preserving `tbRefs`, `master`, commercial fields, and unknown roots. Generic ERF/premise/AST membership in `geofences/membership.js` was not unnecessarily changed by this cutover.

## 8. Web Streaming API Review

`src/redux/demoSalesApi.js:6` retains the existing API identity while binding it to `sales-all-meters`. It preserves row normalization/defaults for `geofenceRefs`/`tbRefs` (`:422-425`), the LM query (`:488-490`), and shared `onSnapshot` lifecycle (`:492+`).

`src/redux/salesTargetedBatchApi.js:26` centrally binds every active Sales listener to `sales-all-meters`; the Sales listeners at `:509-511` and `:861-863` remain `onSnapshot`, as do Targeted Batch/reporting streams. `PrepaidSales.jsx:8,226` continues to consume the Redux hook and introduces no direct listener. Its `sgCode`/`erfNo` fallback remains `NAv` at lines 303-304, as permitted.

## 9. Runtime Legacy-Source Audit

No active deployed Web/backend runtime dependency on `demo_sales_meters` was found. Remaining strings were classified as:

- admin/repair tooling: `functions/tools/targetedBatches/repairTargetedBatchErfRefs.js:237`;
- reset/verification/migration tooling: `functions/scripts/tools/targeted-batches/*`;
- historical geofence reprocess tooling: `functions/scripts/tools/geofences/reprocessGeoFenceMembership.js:506`;
- negative migration tests: `functions/test/salesPhase2Cutover.static.test.js`;
- archived UI snapshot: `src/pages/sales/PrepaidSales.before-gps-filter.jsx:439`.

These files are not imported/exported by `functions/index.js` or active pages. Physical legacy-data retirement remains out of scope. No active Targeted Batch Sales `batchFail` dependency was found.

## 10. Field Ownership / Preservation Review

- Targeted Batch writes only `tbRefs` (creation `callables.js:771-773`; deletion `deleteCallable.js:233,431`; no-access `recordTargetedBatchNoAccessCallable.js:376`; premise/completion `premiseLink.js:839-840,1637-1638`).
- Geofence writes only `geofenceRefs` (`salesMembership.js:208-210`).
- Meter Master bridge patches only dot paths `master.id` and `master.visibility` (`functions/salesAllMeters/helpers.js:497-523`), preserving all other roots.
- Because all operational writes are field-level updates/transforms rather than full document replacement, the other owners’ fields, commercial data, and unknown additive roots are preserved.

## 11. Test Evidence Review

Executed the requested focused suite with Node’s test runner:

```text
tests: 106
pass: 102
fail: 4
```

All Phase 2-specific validator, binding, geofence atomicity, Web cutover, LM-scope, and ownership tests passed. The four inherited reds do not evidence a Phase 2 regression:

1. `getTargetedBatchRowsCallable.test.js:63-66` supplies two references with the same logical TB ID while expecting row-specific selection, whereas production intentionally resolves by normalized TB ID (`getTargetedBatchRowsCallable.js:205-208`) and the validator rejects duplicate logical IDs.
2. Its integrity-state assertion expects `null`, while inherited production initializes the count to `0` (`getTargetedBatchRowsCallable.js:195-230`).
3. `recordTargetedBatchNoAccessCallable.test.js:203-207` expects `SALES_TB_REF_NOT_FOUND`; current fail-closed behavior correctly returns the more specific `SALES_TB_REF_ROW_CONFLICT` (`recordTargetedBatchNoAccessCallable.js:215-224`).
4. The meter-linked fixture changes row `refs.meterId` (`test:278-281`), while the canonical no-access guard is Sales `fieldWork.meterId` (`recordTargetedBatchNoAccessCallable.js:241-245`), covered successfully by `targetedBatchNoAccessRule.test.js:103-127`.

The reported baseline comparison reproduced the same four failures before Phase 2. Source tracing and passing dedicated current-contract tests corroborate that classification.

## 12. Lint and Build Evidence Review

Accepted local evidence: Functions lint `0 errors / 27 warnings`; repository-wide Web lint `37 errors / 349 warnings`; DEV build successful. The Phase 2 Web changes are collection constants and compatible UI wording/fallbacks, and no new Phase 2 file-specific lint error was identified. Existing repository-wide lint debt is non-blocking for this implementation review.

## 13. Required Review Questions

1. **YES** — Central binding and all traced active lifecycle consumers use Sales All (`helpers.js:7`; callables/read/delete/premise/no-access citations above).
2. **YES** — No active Targeted Batch Sales `batchFail` write/delete remains (`callables.js:771-773`).
3. **YES** — Targeted Batch Sales mutations are limited to `tbRefs`.
4. **YES** — Missing canonical `lmPcode` rejects (`helpers.js:839-846`).
5. **YES** — Wrong `lmPcode` rejects (`helpers.js:848-855`).
6. **YES** — Matching `lmPcode` proceeds; verified by `targetedBatchSalesAllBinding.test.js:103-106` test output.
7. **YES** — Unknown additive roots are accepted (`salesAllMeters/helpers.js:21-40,315-486`).
8. **YES** — Known identity/provider/LM/Master/commercial/operational contracts remain strict (`helpers.js:315-486`).
9. **YES** — `tbRefs` is structurally validated (`helpers.js:175-269`).
10. **YES** — Initial, NOT_STARTED, IN_PROGRESS/no-access, and COMPLETED lifecycle shapes are supported (`helpers.js:175-269`; tests 58-71).
11. **YES** — Duplicate logical TB IDs reject after trim/case normalization (`helpers.js:191-199`).
12. **YES** — Unknown nested TB/fieldWork members remain allowed; known members are typed (`helpers.js:175-269`).
13. **YES** — `geofenceRefs` structure is validated (`helpers.js:272-301`).
14. **YES** — Duplicate logical geofence IDs reject (`helpers.js:287-294`).
15. **YES** — Geofence CREATE reads Sales All (`triggers.js:187-190`).
16. **YES** — It queries `hasUsableGps` (`triggers.js:189`).
17. **YES** — Sales membership uses atomic `arrayUnion` (`salesMembership.js:208-210`).
18. **YES** — Same ID/name retry produces no update (`salesMembership.js:96,162`).
19. **YES** — Same ID/different explicit name conflicts and aborts writes (`salesMembership.js:85-94,185-194`).
20. **YES** — Different concurrent additions compose as transforms, without full-array lost updates (`salesMembership.js:208-210`).
21. **YES** — The Sales geofence update contains only `geofenceRefs` (`salesMembership.js:208-210`).
22. **YES** — `demoSalesApi.js` streams Sales All (`:6,488-492`).
23. **YES** — Both active Sales listeners in `salesTargetedBatchApi.js` use its Sales All constant (`:26,509-511,861-863`).
24. **YES** — `onSnapshot` is retained in both Redux APIs (`demoSalesApi.js:492`; `salesTargetedBatchApi.js:509,861` and other streams).
25. **NO** — No active Web/backend runtime dependency remains; legacy strings are tooling/tests/archive only.
26. **NO** — No active Targeted Batch Sales `batchFail` dependency remains.
27. **YES** — Master bridge behavior is preserved and owns only its two dot paths (`salesAllMeters/helpers.js:497-523`).
28. **YES** — Geofence writes only `geofenceRefs`, preserving `tbRefs` (`salesMembership.js:208-210`).
29. **YES** — Targeted Batch writes only `tbRefs`, preserving `geofenceRefs`.
30. **YES** — Field-level updates/transforms preserve commercial and unknown additive roots.
31. **NO** — The four inherited failures are unchanged/pre-existing contract-test mismatches; Phase 2-specific tests pass.
32. **NO** — No new blocker makes DEV deployment unsafe after the separate data-readiness gates.

## 14. Findings

### BLOCKERS

None.

### NON-BLOCKING FINDINGS

- Four inherited tests remain red because their assertions/fixtures do not reflect the current canonical lifecycle rules. They should be reconciled separately, without changing safe production transaction logic merely to satisfy stale expectations.
- The repository is dirty and the implementation is uncommitted; deployment packaging should deliberately select the reviewed state.

### DEFERRED / OUT-OF-SCOPE ITEMS

- Fresh read-only DEV sample validation for `sales-all-meters`, `lmPcode = ZA5241`.
- Audit of active DEV Targeted Batches whose refs may exist only in Demo Sales.
- Physical retirement of `demo_sales_meters`, mobile/external-consumer verification, geofence rename/delete/retry redesign, and scalar `sgCode`/`erfNo` derivation.
- Historical/admin tools intentionally retaining Demo Sales bindings.

## 15. Final Recommendation

Approve the installed Phase 2 implementation and proceed to the two separate DEV data-readiness gates. If both gates pass, the reviewed code is suitable for controlled DEV deployment and verification. Preserve the current field-ownership boundaries and do not fold deferred legacy-data retirement or unrelated lifecycle/lint work into this cutover.
