# Targeted Batch DEV Nuclear Reset — Implementation Codex Review 1

## 1. Executive Verdict

**FAIL**

**READY TO DEPLOY MAINTENANCE GUARDS: NO**

**READY TO RUN STAGE 1 READ-ONLY INVENTORY: NO**

**READY FOR STAGE 2 DESTRUCTIVE RESET: NO**

The implementation described in the review request is not present in the reviewed checkout. The claimed Stage 2 nuclear-reset entry point, five supporting reset modules, maintenance module, runtime guard, static test, and emulator test are absent. The files that are present are the earlier No-Access/Demo-Sales/Storage reset, not the reviewed design's implementation. Present Stage 1 performs Firebase Storage metadata reads; present Stage 2 targets `demo_sales_meters` and deletes Storage objects. No maintenance guard is integrated into runtime writers.

This is a source-state failure, not an approval that could be recovered through operator procedure. Neither present reset script may be executed for the proposed nuclear reset.

## 2. Git / Source State Reviewed

- Repository: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `1d1437cbc1c8249b3fbb2dafd090441657022d10`
- Review date: 2026-08-09
- The working tree was dirty before review. Reset-related tracked modifications were present in `01_read_targeted_batch_reset_scope_dev.js` and the retired legacy filename `02_delete_batches_and_clean_demo_sales_dev.js`; `targetedBatchReset.helpers.js` and its helper test were untracked.
- Other unrelated tracked and untracked changes were present and were not modified.
- Git was used read-only with a per-command `safe.directory` override because the sandbox account differs from the repository owner. No Git configuration or repository state was changed.
- The only repository write made by this review is this report.

## 3. Files Inspected

The prior design review was read first. The review then inspected or searched all requested reset paths, all named runtime-writer paths, the existing reset helper/test, relevant production registry/report/geofence/ward/dependency code, package lint configuration, and Git source state.

Present primary files inspected:

- `functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js`
- `functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js`
- `functions/test/targetedBatchReset.helpers.test.js`
- all named Targeted Batch, TC, BGO, meter-lifecycle, commissioning, data-cleansing, and geofence callable integration files
- `functions/index.js`

Required implementation files confirmed absent:

- `functions/scripts/tools/targeted-batches/02_apply_targeted_batch_nuclear_reset_dev.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.firestore.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.dependencies.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.reconciliation.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.manifest.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.maintenance.js`
- `functions/maintenance/targetedBatchResetGuard.js`
- `functions/test/targetedBatchNuclearReset.static.test.js`
- `functions/test/targetedBatchNuclearReset.emulator.test.js`

No file matching a nuclear-reset implementation or maintenance guard was found recursively under `functions`.

## 4. Review-1 Required Changes Closure

| Requirement | Status | Evidence | Remaining action |
|---|---|---|---|
| 1. Remove premise deletion; preserve and narrowly clean premises | PARTIALLY CLOSED | Present legacy Stage 2 preserves premise documents and filters exact No Access IDs, but there is no nuclear cleanup of exact `targetedBatchContext` and deleted-AST service snapshots. | Implement the complete preserve-and-clean policy in the nuclear reset. |
| 2. Preserve occupancy and report non-reversible residual state | PARTIALLY CLOSED | Present legacy reset does not write occupancy, but no nuclear manifest/residual report exists. | Preserve and protected-hash occupancy and disclose it explicitly. |
| 3. Enforced operational freeze with preconditions/rescans | OPEN | `targetedBatchResetGuard.js` and maintenance module are absent; repository-wide guard search found no runtime integration. | Implement, deploy, and verify a DEV-only guard in every relevant writer and trigger before inventory. |
| 4. Expand dependency protection to TC/BGO/MLCT/lifecycle/accounts/historical paths | OPEN | `targetedBatchReset.dependencies.js` is absent; present inventory covers only the earlier No Access scope. | Implement complete paged dependency discovery with all compatibility identities and fail-closed ambiguity handling. |
| 5. Guarded Master + Sales rollback transaction | OPEN | Nuclear Stage 2 and Firestore module are absent; present legacy Stage 2 never reads or updates `meter_master`. | Implement exact Master/AST proof and atomic Master+Sales rollback. |
| 6. Explicit synchronous registry/report/geofence/ward reconciliation | OPEN | Reconciliation module is absent. Present legacy code only computes limited `registry_erfs` TRN counters and relies on none of the required complete rebuild set. | Implement and verify all required projections synchronously. |
| 7. Exact successful-TRN/AST ownership proof | OPEN | Helper test explicitly says successful Sales TB Meter Discovery is preserved; present inventory only selects canonical No Access TRNs. | Implement the complete identity chain and contradiction blockers. |
| 8. Exact `registry_meters` deletion and residual-reference verification | OPEN | No active code inventories or deletes exact registry meter rows or target ASTs. | Implement exact guarded registry-row deletion before AST deletion and full residual scans. |
| 9. Preserve/report field-only Masters; never delete Masters | OPEN | No nuclear Master inventory, rollback, residual reporting, or verification exists. | Implement field-only classification and protected preservation. |
| 10. Expanded immutable manifests, hashes, masks, dependencies, journal | PARTIALLY CLOSED | Existing helper has deterministic Firestore serialization, exact timestamp components, immutable JSON/latest-pointer helpers, and tests; the required nuclear manifests, source fingerprint, approval binding, expected states, masks, dependencies, and journal do not exist. | Implement the full manifest and durable apply-journal contract. |
| 11. Phase-specific expected states and concurrency handling | OPEN | No nuclear phase engine or journal exists. Present legacy apply uses a single preflight model. | Implement per-phase expected state/preconditions and distinguish own/idempotent changes from foreign changes. |
| 12. Complete paged scans and completeness evidence | OPEN | Present Stage 1 uses whole-query `.get()` calls, does not inventory successful canonical TB TRNs, upload history, unexpected subcollections, or all required dependency paths, and has no final consistency rescan. | Add explicit pagination, cardinality/root hashes, collection-group/subcollection checks, and final rescan. |
| 13. Required destructive ordering | OPEN | Nuclear orchestrator is absent. Present legacy order is unrelated to the required AST/Master/reconciliation order. | Implement the approved phase order with fail-closed checkpoints. |
| 14. Remove Demo Sales and Storage from active reset | OPEN | Stage 1 uses `demo_sales_meters`, initializes Storage, and reads metadata; legacy Stage 2 uses `demo_sales_meters`, initializes Storage, reads metadata, and deletes objects. | Remove all active Demo Sales and Storage dependencies and retire legacy code before it initializes Firebase. |
| 15. Expanded post-reset verification | OPEN | Present verification covers the earlier No Access/Demo-Sales/Storage scope only. | Implement complete protected hashes, residual scans, dependency gates, and all authoritative aggregate checks. |
| 16. Split modules and add emulator failure/race/resume tests | OPEN | All five requested supporting modules, static test, and emulator test are absent. | Add the modules and the required static/unit/emulator coverage. |

Fully closed: **0/16**.

## 5. Maintenance Freeze Review

The maintenance freeze is not implemented. `functions/maintenance/targetedBatchResetGuard.js` is absent, the reset maintenance module is absent, and searches across JavaScript under `functions` found no guard reference in any runtime writer.

Therefore the freeze is not DEV-only, behavior-neutral, pre-mutation, or capable of excluding competing mutations: it simply does not exist. The named Targeted Batch, TC, BGO, meter lifecycle, commissioning, data-cleansing, and geofence callables remain unguarded. Trigger paths exposed through `functions/index.js` are also not shown to consult a freeze before dependency-graph writes.

A settling period plus fresh preflight is insufficient without enforced admission control. Already-running functions can outlive an arbitrary delay, retry, or be redelivered. Before reset execution, every synchronous writer and asynchronous trigger capable of mutating uploads, rows, Sales `tbRefs`, TRNs, ASTs, premises, Masters, registries, ERFs, geofences, wards, or reports must reject/defer while the DEV freeze is active. The reset must then wait for a defined quiescence interval, perform a fresh complete inventory/preflight including AST snapshots, and retain exact update-time preconditions. Trigger handlers must also re-check the guard immediately before their transaction/write, not only at invocation.

## 6. Stage 1 Zero-Write Review

Stage 1 contains no Firestore `.set`, `.create`, `.update`, `.delete`, write batch, BulkWriter, or write transaction call. Its local filesystem writes are permitted. In that narrow sense, Firestore inventory code is read-only.

It nevertheless fails the stated Stage 1 contract because it initializes `admin.storage(app).bucket()` and calls `bucket.file(...).getMetadata()`. The required contract is zero Storage reads, writes, deletes, inventory, verification, and PASS gates. It also inventories `demo_sales_meters`, not exclusively `sales-all-meters`.

Result: **Stage 1 is not approved to run.** No Stage 1 execution occurred during this review.

## 7. Manifest / Hash / Approval Review

The existing helper demonstrates useful primitives: deterministic tagged serialization of Timestamp/GeoPoint/reference/bytes, exact `{seconds,nanoseconds}` update-time representation, immutable JSON behavior, and a latest-pointer helper. Its tests pass.

The nuclear manifest system is absent. There is no canonical nuclear root binding all manifests, no source execution fingerprint for the missing Stage 2, no complete protected-state manifests, no dependency and expected-after manifests, no approval hash/expiry/principal/target-count acknowledgement contract for the proposed reset, and no durable phase journal. Existing confirmation is for the legacy schema/token model and cannot approve a different implementation.

## 8. Targeted Batch TRN Correlation Review

Present correlation is limited to canonical `SALES_TARGETED_BATCH` No Access TRNs. Successful Meter Discovery is explicitly classified for preservation by the helper test. Accordingly, the proposed reset does not prove or delete the complete canonical Targeted Batch TRN population, and it has no final rescan of canonical and ambiguous successful/No Access sets.

## 9. AST Ownership and Delete Review

No AST deletion implementation exists. There is no conjunction proving upload, row, Sales reference, context, TRN, derived block, AST identity, premise/ERF/scope, normalized meter, Master link, and absence of downstream ownership. `AST ID = TRN ID` is not used as sole proof because it is not used at all for deletion; this is not closure.

Immediate post-freeze AST snapshot revalidation is also absent.

## 10. Premise Preserve-and-Clean Review

The legacy apply preserves premise documents and filters exact target No Access TRN IDs. It does not implement complete nuclear cleanup of exact matching `targetedBatchContext` and exact service snapshots for proven deleted ASTs. It does not provide protected before/after hashes for occupancy or unrelated premise state. Premise deletion is not permitted and no new implementation may reintroduce it.

## 11. Meter Master / Sales Rollback Review

No Master rollback exists. The present reset neither deletes a Master nor changes `refs.sales`, but it also cannot reverse successful Targeted Batch Meter Discovery. There is no transaction deriving Sales visibility from post-rollback Master truth, no exact `refs.asts.id` comparison, and no field-only Master residual classification.

## 12. Sales All tbRefs Purge Review

The active code scans and mutates `demo_sales_meters`, not `sales-all-meters`. It therefore provides no complete root `tbRefs` purge or protected-field proof for the required collection. Orphan root fields in `sales-all-meters` are not inventoried or removed.

## 13. Operational Dependency Review

No dependency module exists. Present inventory does not cover all TC identity paths, legacy `bgo_rows`, BGO/MLCT use, active lifecycle references, other TRNs, `account_master`, or `field_account_data`. Historical identity-path ambiguity therefore cannot block an AST deletion because AST deletion itself is absent. This entire safety gate remains open.

## 14. Registry / ERF Reconciliation Review

There is no synchronous complete reconciliation. The legacy helper derives only affected `registry_erfs` No Access/access/total TRN counts. It does not authoritatively reconcile `registry_meters`, `registry_premises`, `registry_accounts`, complete `registry_erfs`, or all related source truth after AST/TRN removal.

## 15. Geofence / Ward Reconciliation Review

No AST geofence capture or nuclear geofence reconciliation exists. There is no proof that current geofence count semantics, including `salesMeters`, are preserved. There is no ward reconciliation using current load/build semantics. The required preservation of `sales-all-meters.geofenceRefs` and premise `geofenceRefs` is not protected by a nuclear manifest or verifier.

## 16. TRN Reporting Review

No synchronous TRN report reconciliation exists. Exact No Access rows and affected normalisation, anomaly, and user-activity buckets are not rebuilt from surviving truth by the reset. Consequently, bucket IDs/report-key assumptions cannot be approved.

## 17. Concurrency / TOCTOU Review

The design-review blocker remains. There is no enforced freeze, no phase engine, no phase-specific expected-state model, and no AST revalidation immediately after freeze acquisition. Existing preflight comparisons cannot close the interval between reads and independent writes across the complete graph. Foreign writes and expected trigger writes are not safely distinguished.

## 18. Partial Failure / Resume Review

The required durable resumability/journaling implementation is absent. The legacy apply writes a final local report in `finally`, but that is not a durable Firestore-backed progress journal, does not keep an enforced freeze active, and cannot prove each operation completed before skipping it on resume. There is no supported safe resume after partial destruction.

## 19. Destructive Ordering Review

The required order—freeze, fresh approved-state validation, exact premise cleanup, Master+Sales rollback, registry meter deletion, AST deletion, TRN deletion, authoritative reconciliations, Sales root purge, history/rows/uploads deletion, full verification, freeze release—is not implemented. The present legacy Stage 2 has no freeze, AST, Master, or complete reconciliation phases and must not be repurposed.

## 20. Post-Reset Verification Review

The present verifier covers only the legacy No Access/Demo-Sales/Storage model. It cannot fail closed on safely identifiable successful TB TRNs/ASTs, Master bridges, service snapshots, registry rows, operational dependencies, all reports, geofence/ward semantics, `sales-all-meters` root `tbRefs`, protected fields, unexpected subcollections, or journal completeness.

## 21. Demo Sales Exclusion

Failed. Active Stage 1 declares `demo_sales_meters` in export/count collections and uses it for correlation and manifests. Legacy Stage 2 queries, validates, mutates, and verifies `demo_sales_meters`. The retired legacy file is still executable and initializes Firebase; it has not been converted into a fail-fast retirement stub incapable of reaching Firebase.

## 22. Firebase Storage Exclusion

Failed. Stage 1 initializes Storage and reads object metadata. Legacy Stage 2 initializes Storage, reads metadata, deletes generation-matched objects, and uses Storage absence as a PASS gate. The helper exports Storage parsing/state/deletion policy. This directly violates the zero-operation requirement.

## 23. Tests Run and Results

No command initialized Firebase, ran a reset entry point, accessed Storage, deployed anything, or connected to `ireps2`.

| Check | Result |
|---|---|
| `node --check` on the five present reset/changed JS files | PASS (5/5) |
| `node --test functions/test/targetedBatchReset.helpers.test.js` | PASS (76/76) |
| `node --test functions/test/targetedBatchNuclearReset.static.test.js` | NOT RUN — file absent |
| Relevant offline regression bundle | FAIL (106 pass, 2 fail) |
| `targetedBatchNuclearReset.emulator.test.js` | NOT RUN — file absent and `FIRESTORE_EMULATOR_HOST` unset |
| ESLint on five present reset/changed JS files | PASS |
| `git diff --check` | PASS; line-ending warnings only |

The two regression failures are in `recordTargetedBatchNoAccessCallable.test.js`: one expected `SALES_TB_REF_NOT_FOUND` but received `SALES_TB_REF_ROW_CONFLICT`; another expected `TARGETED_BATCH_METER_ALREADY_LINKED` rejection but no rejection occurred. These failures are not caused by this review and were not fixed.

The claimed set of 34 implementation files could not be syntax-checked as a set because core claimed files do not exist. All present JavaScript files directly changed/added for the visible reset work passed syntax checking.

## 24. New Findings

### BLOCKERS

1. The reviewed checkout does not contain the claimed nuclear-reset implementation.
2. No runtime maintenance guard exists or is integrated into any relevant writer/trigger.
3. Present Stage 1 performs Firebase Storage reads and uses Demo Sales, so even read-only inventory is not eligible to run under the requested contract.
4. The supposedly retired legacy destructive reset remains executable, initializes Firebase, targets Demo Sales, and deletes Storage objects.
5. Nuclear ownership, rollback, dependency protection, synchronous reconciliation, concurrency handling, journaling, ordering, and verification are absent.

### REQUIRED CHANGES

1. Place the complete intended implementation in the reviewed repository/commit, including every claimed module and test.
2. Implement and deploy the DEV-only maintenance guard across every relevant callable and asynchronous trigger; add an immediate pre-write/transaction recheck.
3. Replace Stage 1 with the complete `sales-all-meters`-only, Firestore-read-only, Storage-zero inventory and final consistency rescan.
4. Retire the legacy Stage 2 as a fail-fast local stub that cannot initialize Firebase or import active reset/Firebase modules.
5. Implement the full ownership, dependency, exact premise cleanup, Master+Sales rollback, reconciliation, concurrency, journal, ordering, and verification contract from Review 1.
6. Add and pass the static and emulator suites, including interruption/resume, races, trigger redelivery, pagination, malformed/orphan state, and zero-write inventory tests.
7. Resolve the two existing relevant regression failures or demonstrate with corrected tests that the changed behavior is intentional and safe.

### NON-BLOCKING RECOMMENDATIONS

- Review from a clean, dedicated commit/worktree so the exact implementation boundary and all 34 files are auditable.
- Add CI checks that fail if active reset code contains Demo Sales or Storage identifiers or if the legacy retirement stub imports Firebase Admin.

## 25. Exact Changes Required Before Stage 1

1. Supply the missing nuclear implementation and supporting modules/tests in the reviewed source state.
2. Remove every active Demo Sales and Firebase Storage dependency from Stage 1 and its imported active helper surface.
3. Make Stage 1 inventory only `sales-all-meters` and the complete Firestore dependency graph, with explicit pagination and completeness evidence.
4. Add the final consistency rescan covering uploads, rows, complete Sales IDs/root `tbRefs`, canonical and ambiguous TRNs, history, and unexpected subcollections.
5. Implement, test, and deploy the DEV-only runtime maintenance guards before inventory is considered safe; Stage 1 itself remains read-only.
6. Add the missing static zero-write/zero-Storage test and pass it.

## 26. Final Gate

IMPLEMENTATION APPROVED: NO

REVIEW-1 REQUIREMENTS CLOSED: 0/16

NEW BLOCKERS: 5

REQUIRED CODE CHANGES: 7

READY TO DEPLOY MAINTENANCE GUARDS: NO

READY TO RUN STAGE 1 READ-ONLY INVENTORY: NO

READY FOR STAGE 2 DESTRUCTIVE RESET: NO
