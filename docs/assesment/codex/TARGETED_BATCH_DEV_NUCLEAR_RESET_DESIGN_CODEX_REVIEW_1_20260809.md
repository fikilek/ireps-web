# Targeted Batch DEV Nuclear Reset — Codex Design Review 1

## 1. Executive Verdict

**PASS WITH REQUIRED CHANGES**

**READY TO IMPLEMENT: NO**

The two-stage, manifest-driven model is the correct foundation, and `tb_uploads` plus `tb_rows` is the correct primary population. The proposal is not safe enough to implement unchanged. Four issues are decisive:

1. Historical premise ownership cannot be proved by the current schema. `premiseCreated` exists only as a transaction result; it is not persisted. A newly created premise and a pre-existing linked premise both receive the same `targetedBatchContext`. Automatic premise deletion must therefore be removed for the current reset population.
2. A read-all/revalidate-all preflight followed by independent writes has a time-of-check/time-of-use gap. There is no database-wide Firestore transaction capable of atomically freezing an unbounded reset graph. A maintenance/freeze control enforced by every relevant writer, or an equivalent operational shutdown, is required, plus per-write snapshot/update-time preconditions.
3. Deleting an AST or premise has no delete trigger in current source. Explicit synchronous cleanup/rebuild is required; waiting for unrelated create/update triggers is insufficient.
4. Target Cleansing is only one dependent workflow. TC rows and already-created BGO/MLCT work can refer directly to the AST and premise. Active or historical operational dependencies must be inventoried and blocked unless a separately approved policy proves deletion harmless.

Successful Targeted Batch Meter Discovery TRNs should be deleted, and for this workflow the implementation assigns `astId = trnId`. That equality is necessary but not sufficient evidence of ownership.

The reset can be performed with zero Firebase Storage operations. Storage is neither a safety dependency nor a verification gate.

## 2. Source Inspected

The review inspected the current source and followed the relevant imports. Exact files inspected were:

- `functions/index.js`
- `functions/targetedBatches/acceptanceCallable.js`
- `functions/targetedBatches/allocationCallable.js`
- `functions/targetedBatches/callables.js`
- `functions/targetedBatches/deleteCallable.js`
- `functions/targetedBatches/documentFactory.js`
- `functions/targetedBatches/getTargetedBatchRowsCallable.js`
- `functions/targetedBatches/helpers.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js`
- `functions/salesAllMeters/helpers.js`
- `functions/meterMaster/helpers.js`
- `functions/registry/meterRegistryRowRebuild.js`
- `functions/registry/premiseRegistryRowBuilder.js`
- `functions/registry/premiseRegistryRowRebuild.js`
- `functions/registry/premiseMeterCountsRebuild.js`
- `functions/registry/erfBaseRowRebuild.js`
- `functions/registry/erfPremiseCountRebuild.js`
- `functions/registry/erfMeterCountsRebuild.js`
- `functions/registry/erfTrnCountRebuild.js`
- `functions/registry/wardBuilder.js`
- `functions/registry/wardCounters.js`
- `functions/registry/wardHelpers.js`
- `functions/dataCleansing/helpers.js`
- `functions/dataCleansing/triggers.js`
- `functions/geofences/helpers.js`
- `functions/geofences/membership.js`
- `functions/geofences/salesMembership.js`
- `functions/geofences/triggers.js`
- `functions/reports/reportHelpers.js`
- `functions/reports/trnReports.js`
- `functions/tcUploads/callables.js`
- `functions/tcUploads/deleteCallable.js`
- `functions/tcUploads/helpers.js`
- `functions/tcUploads/readiness.js`
- `functions/tcUploads/refreshCallable.js`
- `functions/bgo/callables.js`
- `functions/bgo/executionSummary.js`
- `functions/bgo/executionSummaryTrigger.js`
- `functions/bgo/helpers.js`
- `functions/bgo/trnFactory.js`
- `functions/scripts/tools/targeted-batches/01_read_targeted_batch_reset_scope_dev.js`
- `functions/scripts/tools/targeted-batches/02_delete_batches_and_clean_demo_sales_dev.js`
- `functions/scripts/tools/targeted-batches/targetedBatchReset.helpers.js`
- `functions/scripts/tools/targeted-batches/verifySalesTargetedBatchNoAccessReadonly.js`
- `functions/test/targetedBatchReset.helpers.test.js`
- `functions/test/targetedBatchPremiseLink.test.js`
- `functions/test/targetedBatchNoAccessRule.test.js`
- `functions/test/targetedBatchSalesAllBinding.test.js`
- `functions/test/recordTargetedBatchNoAccessCallable.test.js`
- `functions/test/getTargetedBatchRowsCallable.test.js`
- `functions/test/salesAllMeters.helpers.test.js`
- `functions/test/meterMaster.helpers.test.js`
- `functions/test/geofenceSalesMembership.test.js`
- `functions/test/salesPhase2Cutover.static.test.js`

## 3. Current Reset Behaviour

The current reset is not the proposed nuclear reset.

`01_read_targeted_batch_reset_scope_dev.js` inventories `tb_uploads`, `tb_rows`, selected `SALES_TARGETED_BATCH` No Access TRNs, affected premise `noAccessTrnIds`, ERF TRN counts, legacy `demo_sales_meters.tbRefs`, and Storage objects. It classifies only the No Access path and explicitly names Demo Sales in its proof model.

`02_delete_batches_and_clean_demo_sales_dev.js` deletes those No Access TRNs, removes their IDs from premise arrays, rebuilds/checks limited ERF TRN counts, deletes Storage objects, removes root `tbRefs` from `demo_sales_meters`, and deletes the core batch rows/uploads. It does not handle successful Meter Discovery ASTs, Meter Master rollback, `sales-all-meters`, service snapshots, occupancy, registries, geofences, wards, TC/BGO dependencies, or upload history. Its Sales writes are not guarded by update-time preconditions. It is unsuitable for reuse except for small pure utilities that are revalidated independently.

The ordinary user-facing Targeted Batch delete callable is also not a nuclear reset. `targetedBatches/deleteCallable.js` refuses deletion once execution has started, removes exact Sales `tbRefs`, deletes rows, and then deletes the parent. It intentionally does not reverse execution artifacts.

No current reset implementation should be executed for this task. The legacy Demo Sales and Storage behavior must be removed from the active design and statically prohibited.

## 4. Targeted Batch Write Graph

The current write graph is:

1. Creation writes `tb_uploads/{tbId}` and `tb_rows/{rowId}`. Each row records `tbId`, `salesAllMeterId` (with `source.recordId` as compatibility identity), scope, and `refs.erfId`; creation also `arrayUnion`s a batch reference into `sales-all-meters/{salesAllMeterId}.tbRefs`.
2. Acceptance writes `tb_uploads/{tbId}/history/{autoId}`. This is the only Targeted Batch-owned subcollection found in current source.
3. Premise start uses one transaction across the upload, row, Sales document, authoritative ERF, and premise. It creates or updates `premises/{premiseId}.targetedBatchContext`, writes `tb_rows.refs.premiseId`, advances row/parent execution state, and enriches the exact Sales `tbRef.fieldWork`. `premiseCreated` is returned but not stored.
4. A newly created premise asynchronously causes `onPremiseCreated` to rebuild `registry_premises/{premiseId}`, add the premise ID to `ireps_erfs/{erfId}.premises[]`, rebuild `registry_erfs.counts.premises`, resolve premise geofence membership, and rebuild the ward row. A pre-existing linked premise does not fire this create trigger.
5. No Access writes `trns/{trnId}` with `sourceModule = SALES_TARGETED_BATCH`, canonical `targetedBatchContext`, Meter Discovery access data, and optional premise identity; it appends Sales `tbRefs[].fieldWork.noAccess` and advances row/parent execution state. `onTrnWritten` then maintains TRN reports and the ward registry. Other source paths also maintain `premises.noAccessTrnIds`, so the reset must inspect actual data rather than assume every No Access TRN necessarily appears there.
6. Successful Meter Discovery first writes a canonical TRN. `onMeterDiscoveryCreated` assigns `astId = trnId`, creates `asts/{trnId}`, sets/updates `meter_master/{normalizedMeterNo}.refs.asts.id`, derives visibility from the Master bridge, updates `sales-all-meters/{normalizedMeterNo}.master.visibility` if a Sales bridge exists, sets premise occupancy to `Accessed`, and adds `trn.derived` including Targeted Batch completion evidence. In the same transaction, Targeted Batch completion writes row `refs.premiseId`, `refs.meterId`, and `refs.trnId`, updates its Sales `tbRef`, and advances parent counts/status.
7. AST creation asynchronously resolves AST geofence membership, writes a premise service snapshot under `services.electricityMeters[]` or `services.waterMeters[]` with `trnId = astId`, writes `registry_meters/{astId}`, conditionally rebuilds `registry_accounts/{premiseId}`, and rebuilds the ward row.
8. Successful discovery synchronously rebuilds ERF meter/TRN counts and premise registry/meter counts after the transaction. TRN reporting is separately asynchronous.
9. TC rows persist AST identity in several compatibility paths (`ast.id`, `ast.astId`, `backend.astId`, `astId`, `sourceAstId`) and meter identity/snapshots. BGO creation consumes TC rows, validates the live AST and premise, and can create operational TRNs/batches that refer to both.

No AST-delete or premise-delete handler was found. Deleting either source document alone leaves derived state behind.

## 5. Collections and Side Effects

| Collection / path | How Targeted Batch affects it | Proposed reset action | Codex verdict | Notes |
|---|---|---|---|---|
| `tb_uploads/{tbId}` | Core parent, status/counts/allocation | Delete last | Approved | All documents are in scope. |
| `tb_uploads/{tbId}/history/{id}` | Acceptance audit entries | Inventory and delete before parent | Required | Parent deletion does not delete subcollections. |
| `tb_rows/{rowId}` | Core row and all authoritative links | Delete near end | Approved | All documents are in scope, including orphans. |
| `sales-all-meters/{id}` | Root `tbRefs`; visibility may change through Master | Delete all root `tbRefs`; narrowly set visibility | Approved with guards | Never delete Sales documents. Scan entire collection, not only row-linked docs. |
| `trns/{trnId}` | No Access and successful Meter Discovery source | Delete exact proven TB TRNs | Approved | Both successful and No Access TRNs are reset artifacts. |
| `asts/{trnId}` | Successful discovery output | Delete exact proven AST | Approved with strict proof | No broad query deletion. |
| `meter_master/{meterNo}` | `refs.asts.id` bridge | Clear only exact target ID | Approved with qualification | Never delete. Field-only Masters created by TB may remain as unprovable residual state and must be reported. |
| `premises/{id}` | Context, No Access IDs, occupancy, service snapshots; sometimes created | Preserve and clean | Required change | Automatic deletion is unsafe for historical data. |
| `registry_meters/{astId}` | AST registry projection | Delete exact target row | Required | Rebuilder does nothing when AST is absent and there is no delete trigger. |
| `registry_premises/{premiseId}` | Premise projection and meter counts | Rebuild preserved premise | Required | Builder uses merge; verification must compare governed projection and ensure stale fields are not hidden by merge semantics. |
| `registry_accounts/{premiseId}` | Premise/account/meter projection | Rebuild if row exists or account truth requires it | Required | Rebuilder deletes row if premise missing. Premises are preserved under corrected design. |
| `account_master` | Independent account truth linked to premise | Preserve; dependency blocks premise deletion | Protected | Also inventory `field_account_data`/account references if deletion were ever reconsidered. |
| `ireps_erfs/{erfId}.premises[]` | New-premise create trigger adds ID | No change for preserved premises | Corrected | `arrayRemove` is needed only for a premise whose deletion is independently proven and approved. Never delete ERF. |
| `registry_erfs/{erfId}` | Premise, meter, TRN counts | Authoritative rebuild | Required | Six proposed counters are covered. Base-row rebuild must not overwrite unrelated state unexpectedly. |
| `geo_fences/{id}` | Derived counts from ERF/premise/AST/Sales membership | Recompute affected IDs | Required | Keep Sales memberships untouched. Counts include `salesMeters`, not only ERFs/premises/meters. |
| `registry_wards/{scope}` | ERF/premise/active-meter/TRN counts | Authoritative rebuild | Required | Current meter count counts only active states. Preserve that semantic. |
| `report_trn_no_access/{trnId}` | Exact No Access projection | Delete/rebuild synchronously | Required | Do not treat trigger completion as immediate. |
| `report_trn_normalisation/*` | Aggregate bucket | Rebuild affected bucket | Required | Bucket identity comes from before TRN. |
| `report_trn_anomaly/*` | Aggregate bucket | Rebuild affected bucket | Required | Same. |
| `report_trn_user_activity/*` | Aggregate per LM/user | Rebuild affected bucket | Required | Same. |
| `tc_rows`, `tc_uploads` | AST snapshots, readiness and allocation state | Preserve; detect conflict | Approved but incomplete | Exact AST identity plus meter identity and BGO use must be checked. |
| BGO collections and BGO/MLCT TRNs | May consume a TC row/AST/premise | Preserve; block conflicting AST deletion | Newly required | Existing downstream work is a stronger dependency than mere TC readiness. |
| `teams`, `users`, `serviceProviders` | Allocation/identity only | No reset action | Protected | References do not justify mutation. |
| Firebase Storage | URLs may occur in Firestore | No operation | Approved | Orphaned objects are accepted. |

Additional protected collections are `account_master`, `field_account_data`, TC collections, BGO collections, `users`, `teams`, `serviceProviders`, and all non-target report rows. They should not be mutated by this reset.

## 6. Sales All Reset

`sales-all-meters` is the only Sales collection in the new design. The repository constants and current Targeted Batch writers use it. The proposal's legacy Demo Sales references occur only in the existing reset files/tests and must not appear in the replacement scripts, manifests, CLI text, or verification.

The reset must perform a complete paged scan and remove the root `tbRefs` field from every Sales document that has it. This is intentionally broader than row correlation because orphan `tbRefs` are themselves Targeted Batch state. A malformed `tbRefs` value is a hard blocker for apply unless the approved policy explicitly deletes the whole root field after preserving the exact before value; a field delete is safer than reconstructing an array when the global postcondition is no `tbRefs` anywhere.

Sales documents must never be deleted. The allowed mutations are:

- root `tbRefs` deletion; and
- `master.visibility`, only where exact Meter Master rollback proves the current bridge should be invisible.

`master.id` should not be an allowed reset mutation. Although the general Sales sync helper can repair it, doing so expands reset scope.

All other fields are protected. Current validation shows the contract includes meter identities, provider, customer/account fields, LM, commercial totals, monthly totals/sales/units, sales periods, source lineage, risk fields, GPS/geofence state, ERF candidates, and every unknown additive root field. A canonical hash of the complete serialized document excluding only `tbRefs` and, for specifically approved affected documents, `master.visibility`, is a good gate. The hash must preserve Firestore types deterministically (Timestamp, GeoPoint, DocumentReference, bytes, arrays, maps, NaN/infinity if present); JSON stringification alone is inadequate. Also compare document existence, document ID, createTime, and a field-level diff so a hash mismatch is diagnosable.

## 7. TRN Reset

Deleting both No Access and successful Targeted Batch Meter Discovery TRNs is correct because both are execution state caused by the batches and the stated objective is a full operational reset. The previous preservation policy is obsolete.

Canonical positive identification requires all available current truth, not a single marker:

- TRN document ID equals its `id` and has the expected `TRN_MDIS_` family;
- `sourceModule === SALES_TARGETED_BATCH`;
- `accessData.trnType === METER_DISCOVERY`;
- complete `targetedBatchContext` with `tbId`, `rowId`, `salesDocId`, and `erfId` (and `premiseId` where written);
- exact upload and row existence or an explicitly classified orphan case;
- row `tbId`, authoritative Sales identity (`salesAllMeterId`, with compatible `source.recordId`), `refs.erfId`, and `refs.premiseId` agree;
- exact Sales `tbRef` identity agrees where present;
- TRN `accessData.erfId`, premise, scope, and context agree;
- for success, row `refs.trnId`, row `refs.meterId`, TRN `derived.astId`, and `derived.targetedBatch` agree when present.

Contradictory identity is a hard blocker. Missing redundant evidence can be an orphan classification, but deletion is allowed only if the remaining canonical chain uniquely proves ownership. A TRN with only `sourceModule` or only context is not enough.

## 8. AST and Meter Registry Reset

For successful Meter Discovery in `onMeterDiscoveryCreated`, `astId` is universally assigned from `trnId`; the AST document path is `asts/{trnId}`, its `trnId` field is the same value, and the Targeted Batch completion writes that ID to row `refs.meterId`. This statement is scoped to this current workflow, not all AST creation workflows.

The safest AST proof is the conjunction of:

1. the fully proven Targeted Batch successful TRN described above;
2. `ast.id/path == trn.id == row.refs.trnId == row.refs.meterId`;
3. `trn.derived.astId` equals the same ID when present;
4. AST `trnId` equals the same ID;
5. AST premise/ERF/scope agree with the TRN, row, and premise;
6. AST normalized meter identity agrees with TRN discovery payload and the Meter Master document ID;
7. the Meter Master current AST link equals the exact AST ID;
8. no non-target workflow owns or actively depends on that AST.

Create time, geography, meter number, premise, or ERF alone are never sufficient.

Explicit deletion of `registry_meters/{astId}` is required. `rebuildMeterRegistryRow` returns without deleting when its AST is absent, and no AST delete trigger exists. Inventory must prove the registry row identity matches the AST before deletion; a conflicting row at the same ID is a blocker.

Other AST-derived reversal includes premise service snapshots, `registry_accounts` meter projection, `registry_premises` meter counts, ERF meter counts, geofence counts, ward active-meter counts, and any TC/BGO dependency. AST `geofenceRefs` vanish with the AST; no membership index collection was found, but affected geofence IDs must be captured before deletion.

## 9. Meter Master / Sales Bridge Rollback

The source rule is exact: `VISIBLE` iff both `meter_master.refs.asts.id` and `meter_master.refs.sales.id` are truthy; otherwise `INVISIBLE`. The Sales document addressed by the bridge code is the normalized meter number, while `refs.sales.id` is used as the bridge-presence signal. Inventory must flag a non-empty `refs.sales.id` that disagrees with the canonical Sales document identity rather than silently updating another document.

Clearing `refs.asts.id` to `""` matches the canonical Master shape. It is allowed only when the current value equals the exact proven target AST ID. A different value is a hard blocker; already-empty is safe only after proving the target AST is already absent and no stale target reference remains elsewhere.

The transaction must read and update Meter Master and Sales together, with exact live checks. It should:

- verify the Master document, AST link, Sales link/provider, meter identity, and updateTime;
- set only `refs.asts.id` plus explicit reset audit metadata;
- derive visibility from the transaction's post-patch Master data;
- set only Sales `master.visibility` if necessary;
- preserve `refs.sales.id`, `refs.sales.provider`, identities, LM, account/customer data, and all unrelated fields.

Do not rely on `onMeterMasterUpdated` as the primary writer. The trigger will fire after the transaction and should converge to the same value, making its second write normally a no-op. The apply transaction prevents an intermediate committed state in which Master and Sales disagree. Precondition and idempotency logic must accept the trigger's metadata/update-time change only after the phase that intentionally invokes it; otherwise later whole-document update-time checks will falsely fail. Use phase-specific expected states rather than retaining the original updateTime forever.

A further gap is field-only Meter Masters created by successful TB discovery when no Master existed. Source persists no Targeted Batch provenance on the Master. The prohibition on deleting Master documents is therefore safety-correct, but such a cleared field-only Master may remain as residual state caused by TB. Inventory must identify and report these as `PRESERVED_UNPROVEN_TB_CREATED_MASTER`, not claim a perfect nuclear purge. Deleting them is not safe from current provenance.

## 10. Premise Reset

### TB-created premise proof

The current schema cannot reliably prove premise creation ownership for historical records. `createOrLinkTargetedBatchPremise` returns `premiseCreated: !premiseSnapshot.exists`, but does not persist it. Both branches write the same canonical `targetedBatchContext`. A pre-existing premise retains its old create metadata, while a new one normally has coincident Firestore createTime and `metadata.createdAt`; that distinction is useful evidence but not an immutable ownership marker. Client-supplied premise IDs, retries, imports, clock/string timestamps, and prior context can make timestamp inference unsafe.

Matching row/context, ERF, LM/ward, createTime, `metadata.createdAt`, and the absence of unrelated dependencies are necessary evidence for a future provenance-aware policy, but they do not prove that the premise did not pre-exist. They are too weak for destructive ownership. For the current reset, `DELETE_TB_CREATED` must be disabled. All candidate premises are `PRESERVE_AND_CLEAN` or `BLOCK_UNCERTAIN/CONFLICT`.

A future workflow can make deletion provable by atomically persisting immutable origin data on creation, for example `origin.createdByWorkflow`, `origin.tbId`, `origin.rowId`, `origin.eventId`, and a non-client-controlled creation marker, while never adding that origin block to linked premises. That does not retroactively prove current data.

### Pre-existing and uncertain premise handling

Preserve the premise. Exact contradictory identities are blockers. Missing optional cleanup evidence should warn and preserve, not delete. A premise with unrelated ASTs, TRNs, accounts, field account data, clients/occupants, services, or workflow references is not itself a blocker to preserving it; those facts only prohibit deletion. Under the corrected no-delete policy, `PREMISE_HAS_UNRELATED_AST/TRN/ACCOUNT_MASTER` should be warnings or validation inputs unless the reset cannot isolate the target-owned nested fields.

### Exact cleanup fields

For a preserved premise, allowed cleanup is limited to:

- delete `targetedBatchContext` only when it exactly matches an in-scope row/context; conflicting or foreign context blocks that premise cleanup;
- remove exact proven target No Access TRN IDs from `noAccessTrnIds`, preserving order and duplicates of all other values;
- remove exact service entries from `services.electricityMeters[]` and/or `services.waterMeters[]` whose normalized `trnId`/legacy `id` equals a proven deleted AST ID;
- update reset audit metadata only if explicitly excluded from protected-field comparison.

Do not delete the whole `services` map or normalize unrelated legacy entries as a side effect. Do not remove premise `geofenceRefs`; membership remains valid because the premise remains. Do not change address, property, GPS, occupancy, ERF/scope, media URLs, account/client state, or unrelated service snapshots.

Sales `tbRefs[].fieldWork` contains premise/meter/TRN state, but the entire root `tbRefs` field is removed later, so no separate nested Sales cleanup is needed.

### Occupancy rollback

Successful discovery unconditionally writes `occupancy.status = "Accessed"`. No previous value is persisted on the TRN, AST, row, or premise. `registry_premises` merely copies current premise occupancy and is not an authoritative history. Therefore occupancy cannot be correctly rolled back for a pre-existing premise. Preserve current occupancy rather than guess. Record `OCCUPANCY_NOT_REVERSIBLE` as a warning/residual and rebuild `registry_premises` from the preserved value.

### Account and unrelated dependency checks

`account_master` records link by `premise.premiseId`; `registry_accounts` derives from premise, account Masters, live ASTs, and meter registry rows. Inventory must query account Masters and any field account data/reference paths before any future premise deletion. With deletion disabled, preserve account truth and rebuild the registry after target AST/registry removal.

## 11. Registry and ERF Reconciliation

`rebuildPremiseRegistryRow` deletes the registry row when its premise is missing, otherwise merges a rebuilt projection and then rebuilds meter counts. Under the corrected premise-preservation policy it should run after premise cleanup and AST deletion. Verification must independently compare the projection and meter counts because merge writes can retain obsolete fields not emitted by the builder.

`rebuildRegistryAccountsForPremise` deletes the row if the premise is absent; otherwise it derives from surviving `account_master`, ASTs, and `registry_meters`. Run it for every affected premise for which a registry row already exists or account Master truth exists. The current `onMeterCreated` helper deliberately skips creation if `registry_accounts` did not already exist, so the reset should not manufacture an empty registry row for a premise with no account workflow.

If premise deletion were ever safely enabled, an `account_master` or field-account dependency must hard-block it. The existing builders make the derived registry deletion technically possible but do not authorize deletion of the authoritative premise.

`ireps_erfs.premises[]` cleanup is necessary only when an approved premise is actually deleted, because the create trigger adds the ID and no delete trigger removes it. `arrayRemove(exact premiseId)` is sufficient for that array but does not replace rebuilding `registry_erfs.counts.premises`. With all premises preserved, no array change is permitted.

The three ERF rebuilders cover all six proposed counts:

- premise: `counts.premises`;
- AST: `counts.electricityMeters`, `counts.waterMeters`, `counts.totalMeters`;
- TRN: `counts.trnsNa`, `counts.trnsAccess`, `counts.trnsTotal`.

They query surviving authoritative collections and are preferable to decrements. Run them after all source deletions for each affected ERF. Their internal `rebuildErfBaseRow` call also rewrites base projection metadata, so inventory and verification must protect unrelated `registry_erfs` fields and confirm the base builder's expected output.

## 12. Geofence Reconciliation

Current geofence counts are recomputed from `ireps_erfs`, `premises`, and `asts` carrying the geofence ID, with Sales meter membership/count handled as an additional `salesMeters` component. The reset must capture the union of geofence IDs from target ASTs and any premise that would be deleted before mutation. Under premise preservation, only target AST geofence IDs need source-removal reconciliation.

After AST deletion, recompute each affected `geo_fences` document from current truth and preserve its geometry, scope, permissions, status, metadata creation fields, and unrelated fields. The expected count object must include `erfs`, `premises`, `meters`, and `salesMeters` according to the current geofence architecture. Do not alter `sales-all-meters.geofenceRefs`; Sales membership is independent.

No separate generic membership index collection was found. TC rows do carry geofence snapshots, which are workflow state and must not be rewritten by this reset; an AST on which TC/BGO depends should instead block deletion.

## 13. Ward Reconciliation

`rebuildWardRegistryRow` derives the row from current truth. Its count model includes formal/informal/total ERFs, premises, electricity/water/total active meters, and all TRNs. “Active meter” is specifically limited to `FIELD`, `CONNECTED`, and `DISCONNECTED`, with compatibility queries for `status.state` and scalar `status`.

Capture every valid `{lmPcode, wardPcode}` from the before TRN, AST, premise, and ERF evidence. Rebuild after all source deletions and premise cleanup. Invalid or contradictory scope is a hard blocker to applying that target because otherwise the affected ward cannot be deterministically reconciled. Verification should run `loadWardCounts` semantics independently and compare the complete governed count set and operational status.

## 14. TRN Reporting Reconciliation

Relying on `onTrnWritten` alone is unsafe for a destructive verifier. Firestore triggers are asynchronous, at-least-once, may be delayed, and the handler catches/logs failures rather than rethrowing. A reset can therefore finish while reports are stale and no failed reset write is visible.

The safest policy is synchronous reconciliation using shared exported report builders (or new reset-specific wrappers around the same pure bucket logic), followed by independent reads. For every target TRN, capture before deletion:

- exact No Access report ID;
- normalization bucket identity;
- anomaly bucket identity;
- user-activity `{lmPcode, userUid}` bucket;
- ward scope.

After deleting all target TRNs, rebuild each unique affected aggregate bucket from surviving `trns`, delete zero-count buckets, delete exact target `report_trn_no_access` rows, rebuild user activity and ward rows, and verify. The asynchronous trigger may also run, but must be idempotent and must not be the completion signal. If direct reuse is impractical, poll only as a secondary safeguard with a bounded timeout and independently recompute expected values; polling for “some update” is insufficient.

## 15. Target Cleansing and Other Workflow Protection

The TC blocker concept is correct but must be expanded. A real dependency exists when any `tc_row` resolves to the target AST through any supported identity path (`ast.id`, `ast.astId`, `backend.astId`, `backend.matchedAstId`, root `astId`, or `sourceAstId`), or when its canonical meter number and embedded AST/premise snapshot resolve uniquely to the target despite a missing ID. Querying only one AST field is insufficient; Firestore cannot OR all compatibility paths in one reliable historical query, so Stage 1 needs indexed queries where possible plus a complete paged TC scan/fallback.

Safe no-block cases are limited to demonstrably unrelated rows whose normalized meter number happens to match but whose exact AST ID differs and whose embedded premise/ERF identity also differs, or fully rejected/unmatched rows that never captured the AST. Meter identity alone must produce `AMBIGUOUS_TC_DEPENDENCY`, not a deletion decision.

Any matched TC row should be a hard blocker under the stated “do not rewrite TC” rule because deleting the AST makes its snapshot/readiness false. This is especially strict when `bgo.used`, `bgo.batchId`, allocation, or execution state exists.

Other protected workflows include BGO/MLCT. BGO creation reads TC rows, requires live AST/premise documents, creates TRNs and batch artifacts, and writes references back to TC/AST lifecycle state. Inventory must inspect BGO batches/TRNs and AST active-lifecycle references. Any live or historical downstream work referencing a target AST/premise is a hard blocker. Meter lifecycle TRNs or other operational TRNs referencing the AST are likewise dependencies, not “unrelated TRNs” to ignore.

## 16. Concurrency and Idempotency Review

The proposed preflight is necessary but not sufficient. Firestore read snapshots from separate calls are not a single consistent database snapshot, and an unbounded graph cannot be revalidated and mutated in one transaction. A new batch, No Access TRN, premise link, successful discovery, TC refresh, or BGO allocation can occur after its check and before the first or later write.

Required controls are:

1. Establish a DEV maintenance window and a reset lock/generation document before destructive preflight. Every Targeted Batch creation/execution writer and relevant TC/BGO writer must enforce that lock, or the functions must be operationally disabled/traffic blocked for the window. Merely writing a lock that current functions do not read provides no safety.
2. Re-run the full inventory under the freeze and bind approval to its cryptographic root hash, policy/schema version, project ID, database ID, and reset run ID.
3. Use Firestore write preconditions (`lastUpdateTime` or transaction reads) on every update/delete. Exact already-absent handling must be phase-aware.
4. Recheck global invariants at phase boundaries, including that no new upload, row, canonical TB TRN, or root Sales `tbRefs` appeared.
5. Make each operation idempotent against explicit desired state. Record a durable reset journal/checkpoint outside the target collections with phase and per-document outcomes. A local-only file is insufficient after process/host failure.
6. Release the freeze only after post-reset verification passes; a partial failure keeps it in place for human review.

The confirmation token is useful but should also require `--project ireps2`, emulator rejection, authenticated principal allow-list, approved inventory hash/run ID, an expiry, and a second exact acknowledgement of target counts. Credentials' `project_id`, Firebase app project, Firestore database `(default)`, and resolved project number should agree. Wrong/missing controls must cause zero writes.

Trigger-generated updates make original updateTimes stale. The orchestrator needs per-phase expected-state snapshots and must distinguish its own/expected trigger convergence from foreign concurrent changes.

## 17. Destructive Ordering Review

Recommended exact order:

1. Acquire/enforce the DEV operational freeze; create the reset journal; validate project, principal, database, token, approval expiry, policy version, manifest root hash, and zero blockers.
2. Under the freeze, perform a fresh complete inventory and compare its normalized Merkle/root hash and all target sets to the approved manifest. Abort before target writes on any difference.
3. Capture final before evidence for reports, geofences, wards, registries, Master/Sales bridges, premises, TC/BGO, and protected-field hashes.
4. In guarded transactions, remove exact target IDs/service entries/context from preserved premises. Preserve occupancy. Doing this before AST deletion retains source evidence and prevents stale service references after deletion.
5. For each successful target, atomically clear the exact Meter Master AST link and set Sales visibility from post-rollback bridge truth. This must precede AST deletion so the live AST remains available as transaction evidence.
6. Delete exact `registry_meters/{astId}` rows with preconditions. It is acceptable before AST deletion and avoids a window in which a deleted AST still has a registry row after the source delete; the freeze makes the brief inverse window non-observable to users.
7. Delete exact proven target ASTs with preconditions.
8. Delete exact proven target TRNs (No Access and success) with preconditions.
9. No premise deletions for the current historical population. If future provenance makes deletion possible, delete only after all dependencies are absent, then remove its exact ERF array ID immediately in the same transaction where feasible.
10. Synchronously rebuild affected `registry_premises` and eligible `registry_accounts` from surviving truth.
11. Synchronously rebuild all affected `registry_erfs` count groups.
12. Recompute all affected geofence counts, including Sales count preservation.
13. Rebuild affected ward rows.
14. Synchronously reconcile exact and aggregate TRN reporting buckets.
15. Remove root `tbRefs` from the complete guarded Sales target set. This is deliberately late: the links remain available as correlation evidence during destructive operational rollback. A global rescan immediately follows.
16. Delete all inventoried upload history documents with preconditions and verify each parent has no remaining subcollections named by the policy.
17. Delete all `tb_rows`, then all `tb_uploads`, with preconditions. Core deletion is the commit marker that dependency cleanup completed.
18. Run complete verification while the freeze remains active. Mark the journal `VERIFIED` only on full pass, then release the freeze.

The proposal's main ordering weakness was allowing trigger convergence to overlap verification and not defining a writer freeze. Its registry rebuilds also occurred before Sales `tbRefs` removal, which is acceptable because those builders do not use `tbRefs`, but keeping core documents until the end is essential. Report/ward rebuilds must occur after all TRN deletions, not race per-document triggers.

Transactions should group only naturally coupled documents: Master+Sales, premise exact cleanup, and (if ever allowed) premise+ERF array. Do not attempt giant transactions. Use conservative batches (for example 200–400 writes) and account for transforms as writes; exact limit should be a named policy constant below Firestore's current hard limit.

## 18. Blocker Model

### Hard blockers

- `PROJECT_OR_DATABASE_MISMATCH`
- `RESET_FREEZE_NOT_ENFORCED`
- `APPROVAL_TOKEN_INVALID_OR_EXPIRED`
- `MANIFEST_HASH_OR_POLICY_MISMATCH`
- `INVENTORY_CHANGED_AFTER_APPROVAL`
- `NEW_TARGET_BATCH_STATE_DURING_APPLY`
- `ORPHAN_ROW_WITH_UNRESOLVED_DEPENDENCIES`
- `AMBIGUOUS_OR_CONTRADICTORY_TARGET_TRN`
- `TARGET_TRN_IDENTITY_MISMATCH`
- `AST_CORRELATION_MISMATCH`
- `AST_HAS_NON_TARGET_OWNERSHIP_EVIDENCE`
- `METER_MASTER_MISSING_FOR_LIVE_TARGET_AST`
- `METER_MASTER_AST_CONFLICT`
- `METER_MASTER_SALES_BRIDGE_CONFLICT`
- `SALES_DOCUMENT_MISSING_FOR_NONEMPTY_SALES_BRIDGE`
- `SALES_IDENTITY_OR_SHAPE_CONFLICT`
- `SALES_TBREFS_CHANGED`
- `PREMISE_CONTEXT_CONFLICT`
- `PREMISE_SERVICE_ENTRY_AMBIGUOUS`
- `PREMISE_OR_ERF_SCOPE_CONFLICT`
- `REGISTRY_IDENTITY_CONFLICT`
- `REGISTRY_REBUILD_SOURCE_CONFLICT`
- `INVALID_ERF_OR_WARD_SCOPE`
- `TC_DEPENDENCY_CONFLICT`
- `BGO_OR_METER_LIFECYCLE_DEPENDENCY_CONFLICT`
- `UNRESOLVED_ACTIVE_TRN_REFERENCING_TARGET_AST`
- `REPORT_BUCKET_IDENTITY_UNRESOLVED`
- `GEOFENCE_IDENTITY_OR_SCOPE_CONFLICT`
- `WRITE_PRECONDITION_FAILED`
- `UNEXPECTED_SUBCOLLECTION_UNDER_TARGET_UPLOAD`

`PREMISE_ORIGIN_UNCERTAIN` is a hard blocker only to premise deletion, not to the corrected preserve-and-clean reset. Likewise unrelated AST/TRN/account dependencies block deletion but need not block narrow cleanup if exact target-owned nested fields remain separable.

### Warnings / accepted residuals

- `OCCUPANCY_NOT_REVERSIBLE_PRESERVED`
- `PREMISE_ORIGIN_UNCERTAIN_PRESERVED`
- `PRESERVED_UNPROVEN_TB_CREATED_MASTER`
- `PREMISE_HAS_UNRELATED_AST/TRN/ACCOUNT_MASTER`
- `TARGET_TRN_MISSING_REDUNDANT_DERIVED_EVIDENCE` where the remaining chain is still unique
- `ORPHANED_FIREBASE_STORAGE_OBJECTS_EXPECTED`
- legacy/unknown additive fields that are protected and unchanged

### Safe already-missing

- target report row absent and recomputed bucket already correct;
- target registry meter absent while AST and all references are consistently already absent;
- exact target service/no-access entry already absent;
- `tbRefs` already absent on an otherwise unchanged Sales document;
- history/row/upload already absent only in a resumed, journaled run whose prior successful action and before identity are proven.

An unexpected missing AST/TRN/Master/premise during initial apply is not automatically safe; it requires a new inventory and dependency proof.

### Non-target

Documents with similar meter numbers, geography, dates, users, or prefixes but no canonical Targeted Batch identity chain are non-target and protected.

## 19. Read-Only Inventory Review

Stage 1 must remain provably zero-write. It should not import modules that initialize triggers, call rebuild helpers, write logs to Firestore, or access Storage. Static and runtime-mocked tests should fail on `set`, `create`, `update`, `delete`, batch/transaction writes, BulkWriter, and Storage API calls.

In addition to the proposed inventory, capture:

- Firestore database ID/project number, credential principal, inventory code Git commit/file hashes, Node/dependency versions, start/end read times, page cursors, and collection read counts;
- a complete collection-group enumeration of upload `history` and detection of unexpected subcollection names if the Admin API used supports it;
- every `sales-all-meters` document with `tbRefs`, including malformed/orphan references;
- both `salesAllMeterId` and compatibility identities, with exact Sales reference index/evidence;
- TRN `derived` blocks and all supported premise/context paths;
- AST status, active lifecycle, geofence refs, exact meter number normalization, and all operational TRNs referencing it;
- Master creation/update metadata and whether it appears field-only;
- full premise services, occupancy, no-access array, context, geofence refs, accounts/clients, and dependency query results;
- account Master and field-account dependencies;
- TC compatibility identity paths, readiness/use/allocation data, and complete BGO/MLCT dependencies;
- exact affected report bucket keys and before rows;
- complete expected rebuilt registry/geofence/ward values computed read-only;
- protected-field canonical hashes and allowed-field masks;
- query completeness evidence, duplicate identities, missing indexes/errors, and retry consistency.

All collection scans must be explicitly paged by document ID with stable ordering. Count aggregation alone is not an inventory. Stage 1 should repeat a lightweight target-set scan at the end and warn if the population changed during its own run.

## 20. Manifest Design Review

The proposed manifests are a good start but insufficient for resumability and concurrency by themselves. Add:

- `before/sales_all_documents.jsonl` for every mutated Sales document with protected hash and allowed mutation mask;
- `before/report_trn_*.jsonl` for exact and aggregate report rows/buckets;
- `before/operational_dependencies.jsonl` for TC, BGO/MLCT, meter lifecycle, and account/field-data references;
- `before/premise_service_entries.jsonl` with exact array index/value and normalized identity;
- `before/unexpected_subcollections.jsonl`;
- `expected/` manifests for every derived rebuilt document and every deletion/field patch;
- `after/` verification evidence and diffs;
- a durable apply journal containing run ID, approval hash, phase, operation key, attempt, precondition, result, write time, and error.

Each entry needs path, ID, Firestore create/update/read times, full type-preserving serialization, normalized identity/correlation proof, planned action, allowed changed paths, precondition, dependency query evidence, expected post-state/hash, and policy version. For arrays, store both raw values and normalized matching evidence.

`manifest_hashes.json` should contain per-file SHA-256 plus one canonical root hash over sorted relative path/hash/record-count tuples. `inventory.json` should record schema and policy versions, target counts, blocker/warning counts, project/database/principal, code hashes, and the root. `LATEST.json` is only a convenience pointer and must never be an approval authority.

Manifests must be written atomically to a new run directory, fsynced/closed before hashing, immutable after approval, and kept outside any directory the apply script can overwrite. Human approval must cite the root hash and target summary. Full before data may contain personal information and URLs, so file permissions, retention, and redaction for human summaries are required; the machine manifest still needs exact protected hashes.

## 21. Post-Reset Verification Gates

A PASS requires all of the following while the freeze remains active:

1. `tb_uploads` and `tb_rows` complete scans return zero documents; every inventoried history document is absent; no unexpected target upload subcollection remains.
2. A complete paged `sales-all-meters` scan finds zero root `tbRefs`. All before Sales document IDs still exist. Canonical protected hashes match after excluding only approved `tbRefs` and per-document visibility paths. No Sales document was created/deleted by the reset.
3. Every exact target TRN is absent; a complete canonical-context/prefix/source scan finds no additional in-scope TB TRN missed by the manifest.
4. Every exact proven target AST is absent; no surviving AST claims its target TRN ID or contradictory target context.
5. Every exact target `registry_meters` row is absent; no registry row refers to a deleted AST ID.
6. No Meter Master `refs.asts.id` equals a deleted AST ID. Every affected Master still exists, `refs.sales` and all protected fields match, and exact Sales visibility equals `VISIBLE` iff both current Master bridges are non-empty. Preserved field-only residual Masters are explicitly listed.
7. Every preserved premise exists. Protected hashes match excluding exact approved context/no-access/service/audit paths. No reset context, exact deleted No Access ID, or exact deleted AST service entry remains. Occupancy is unchanged from before.
8. `registry_premises` equals a fresh projection of each affected surviving premise, including correct meter counts, and has no stale target IDs.
9. `registry_accounts` existence follows pre-reset account-workflow eligibility, and each affected row equals current premise/account Master/surviving AST/registry meter truth with no deleted AST.
10. `ireps_erfs.premises[]` is unchanged under the corrected no-premise-delete policy. If a future approved deletion occurs, only exact deleted IDs are absent and all surviving IDs are preserved.
11. Fresh authoritative queries equal all six `registry_erfs` counts; unrelated fields/base identity are correct.
12. Every affected geofence count object equals fresh current truth, including `salesMeters`; geometry, membership rules, and Sales `geofenceRefs` are unchanged.
13. Every affected ward row equals fresh `loadWardCounts` semantics for all count fields and operational status.
14. Every target No Access report row is absent. Every affected normalization, anomaly, and user-activity bucket equals a fresh scan; zero buckets are absent.
15. No TC/BGO/other dependency blocker was bypassed; all protected workflow documents have unchanged protected hashes.
16. No target ID remains anywhere in explicitly indexed reference paths across premise, rows, Sales, ASTs, Master, registries, reports, TC/BGO, and active-lifecycle state.
17. The apply journal has no unacknowledged error, every planned action has a terminal idempotent result, phase counts reconcile to manifest counts, and the post-reset scan did not observe new Targeted Batch state.
18. Firebase Storage has no check, operation, enumeration, or PASS gate.

Verification must fail closed on query/index errors, pagination gaps, timeouts, trigger uncertainty, malformed documents, or protected-hash serialization failures.

## 22. Storage Exclusion

The reset can safely proceed with **zero Firebase Storage operations**. Firestore source evidence is sufficient to correlate the targeted execution graph. Media/URL fields may disappear when their owning Firestore TRN, AST, premise (if ever safely deletable), or history document is deleted, but the underlying objects remain. Orphaned objects are accepted.

No `admin.storage()`, bucket access, object enumeration, manifest, generation/metageneration test, delete, or verification is required. Storage exclusion does not make the Firestore reset impossible and must not be a blocker.

## 23. Proposed Code Footprint Review

The six proposed files are directionally sound but not sufficient as currently divided. One large Firestore helper containing reads, guarded writes, all rebuilds, reporting, and verification would be difficult to audit.

Keep:

- `01_read_targeted_batch_reset_scope_dev.js` as the zero-write entry point;
- `02_apply_targeted_batch_nuclear_reset_dev.js` as a thin orchestrator;
- `targetedBatchReset.helpers.js` for pure canonicalization, identity/correlation, disposition, serialization/hashing, diff masks, and policy;
- `targetedBatchReset.firestore.js` for generic paged reads, snapshots, preconditions, transaction/batch primitives;
- the pure helper test and static safety test.

Add technically focused modules/tests:

- `targetedBatchReset.dependencies.js` for premise/account, TC/BGO/lifecycle, report bucket, geofence, and ward dependency resolution;
- `targetedBatchReset.reconciliation.js` for synchronous registry/report/geofence/ward expected-state builders and guarded application;
- `targetedBatchReset.manifest.js` for type-preserving serialization, root hashing, atomic run directories, and journal schema;
- integration-style emulator tests for interrupted/resumed phases, precondition races, trigger double-delivery, malformed/orphan data, pagination, and zero-write inventory.

The exact filenames are less important than these separations. Do not duplicate production counter/report logic; extract reusable pure builders where safe, with dedicated tests. Static regex tests are valuable guardrails but cannot prove runtime safety. Add dependency-injected unit tests and emulator tests.

The static suite must prohibit all Demo Sales names, all Storage imports/APIs, Sales/Master/ERF/geofence/ward document deletes, unguarded writes, unscoped AST/TRN/registry/premise deletes, missing project/database/freeze/token/hash guards, and imports of legacy reset modules.

## 24. Required Design Changes Before Coding

1. Remove automatic premise deletion for the current DEV reset. Preserve and narrowly clean all premises because creation provenance is not persisted.
2. Preserve `occupancy.status` on existing premises and report it as non-reversible residual state.
3. Add an enforced operational freeze/maintenance protocol covering Targeted Batch, TC, BGO, and relevant meter writers; retain per-write preconditions and phase-boundary rescans.
4. Expand dependency protection from TC to BGO/MLCT, meter lifecycle/active TRNs, account/field-account state, and all supported historical AST identity paths.
5. Make Master AST rollback and Sales visibility one guarded transaction; do not rely on `onMeterMasterUpdated` for completion.
6. Define and implement explicit synchronous post-delete reconciliation for registry rows, ERF counts, geofences, wards, and all TRN report buckets. Triggers may assist but cannot be the PASS signal.
7. Add exact successful-TRN/AST ownership proof using row, context, TRN, derived block, AST, premise, Master, and Sales identities; contradictions hard-block.
8. Explicitly delete exact `registry_meters/{astId}` before/with AST source removal and verify no deleted AST references remain.
9. Treat field-only Meter Masters that may have been TB-created as preserved, reported residuals unless independent immutable provenance exists; never claim they were fully reversed.
10. Expand manifests with expected states, reports, operational dependencies, protected hashes, allowed path masks, a canonical root hash, and a durable resumable apply journal.
11. Change preflight/update-time logic to phase-specific expected states so expected trigger/audit updates do not defeat later validation, while foreign changes still abort.
12. Add complete paged scans and fail-closed query completeness evidence for Sales `tbRefs`, TRNs, TC compatibility paths, upload history, and unexpected subcollections.
13. Replace the proposed destructive order with the order in section 17, keeping core documents until all operational and derived state is reconciled and verified.
14. Remove every active legacy Demo Sales and Firebase Storage reference from the new reset code and tests; statically prohibit their return.
15. Expand verification to the exact gates in section 21, including aggregate reporting, BGO/lifecycle protection, complete protected hashes, and residual-state disclosure.
16. Split dependency/reconciliation/manifest concerns out of the monolithic Firestore helper and add emulator-level failure/race/resume tests.

## 25. Non-Blocking Recommendations

- Add immutable workflow-origin fields to future premise and field-only Meter Master creation so later scoped rollback can be proven.
- Use a dry-run human summary grouped by risk and action, with sample evidence plus exact machine-manifest links.
- Use a Merkle-style manifest root so individual large JSONL files can be verified without loading all records into memory.
- Emit structured JSON progress alongside concise console progress: pages, scanned documents, correlations, blockers, phase writes, retries, and verification counts.
- Use conservative concurrency limits to avoid Firestore hot spots and trigger storms.
- Retain reset artifacts under access-controlled retention because they contain customer and operational data.
- Add a separate read-only “reset readiness” CI job that runs pure/static tests without credentials and can never initialize Admin writes.

## 26. Final Approval Gate

### Explicit answers to the 35 review questions

1. **Is the overall model safe enough?** The architecture is sound only after the required changes; the proposal as written is not safe enough to implement.
2. **Primary population?** Yes. All `tb_uploads` plus all `tb_rows`, without lifecycle/geography/date filters, is the correct primary population; orphan downstream artifacts must also be discovered independently.
3. **Missed TB-owned paths?** Yes: `tb_uploads/{tbId}/history/{historyId}` is real. No other TB-owned collection/subcollection was found in current writers, but unexpected subcollections must be detected.
4. **Missed downstream effects?** Yes: aggregate TRN reports, field-only Master residuals, account/field-account projections, TC compatibility references, BGO/MLCT and other active meter-lifecycle dependencies, plus lack of delete-trigger convergence.
5. **Delete successful TB Meter Discovery TRNs?** Yes, after exact proof and dependency checks.
6. **AST ID equals TRN ID?** Yes for the current successful Meter Discovery creation path; not a universal rule outside this workflow.
7. **Safest AST proof?** The complete row/context/TRN-derived/AST/premise/ERF/Master/Sales identity conjunction in section 8, plus absence of foreign workflow ownership.
8. **Explicit `registry_meters` deletion?** Yes.
9. **Master rollback correct?** Clearing only an exact matching `refs.asts.id` to `""` while preserving the document and all other refs/data is correct; field-only residual Masters must be disclosed.
10. **Visibility rule?** `VISIBLE` iff both current `refs.asts.id` and `refs.sales.id` are truthy; otherwise `INVISIBLE`.
11. **Transactional Master+Sales?** Yes.
12. **Can schema distinguish TB-created premise?** No, not reliably for historical data.
13. **Exact proof if yes?** None exists in current persisted schema; timestamps/context are supporting evidence, not ownership proof.
14. **Remove automatic premise deletion?** Yes, for this reset population.
15. **Preserved premise cleanup fields?** Exact matching `targetedBatchContext`, exact target IDs in `noAccessTrnIds`, and exact target service entries in `services.electricityMeters`/`services.waterMeters`, plus controlled audit metadata only.
16. **Can occupancy be rolled back?** No. Preserve it.
17. **Registry premises/accounts?** Rebuild from surviving truth after source cleanup; do not manufacture account registry rows where the account workflow did not require one.
18. **`ireps_erfs.premises[]` cleanup?** Necessary and sufficient for that array only when a premise is actually and safely deleted; with premise deletion removed, it must remain unchanged.
19. **ERF counts covered?** Yes, all six named counts are covered by the three current rebuilders, subject to protected-field verification.
20. **Geofence updates covered?** Only after adding `salesMeters` preservation/verification and treating TC geofence snapshots as protected workflow state.
21. **Ward updates covered?** Yes if every before scope is captured and full current `loadWardCounts` semantics are rebuilt after source deletion.
22. **Rely on `onTrnWritten`?** No.
23. **Safest aggregate reporting handling?** Synchronously rebuild every affected before bucket from surviving TRNs, then independently verify; allow triggers only as idempotent secondary convergence.
24. **TC blocker correct?** Directionally yes, but it must inspect all supported AST identity paths, ambiguous meter matches, readiness/use/allocation, and complete-scan fallback.
25. **Other workflows to protect?** Yes: BGO/MLCT, active meter lifecycle/operational TRNs, and account/field-account dependencies.
26. **Destructive order safe?** Not unchanged. Use the freeze and exact order in section 17.
27. **Concurrency weaknesses?** Yes: cross-query snapshot inconsistency, TOCTOU after preflight, trigger-written updateTimes, and lack of an enforced writer freeze/journal.
28. **Manifests sufficient?** No; add expected/after state, report/dependency manifests, type-preserving serialization, allowed-path masks, a root hash, and durable journal.
29. **Missing hard blockers?** Yes; the additional blocker classes are enumerated in section 18, especially freeze, BGO/lifecycle, bridge/report/geofence conflicts, and unexpected subcollections.
30. **Missing verification gates?** Yes; add full protected hashes, aggregate reports, workflow dependency preservation, complete target-reference scans, journal reconciliation, and residual disclosure.
31. **Six-file structure maintainable?** Not at the proposed responsibility density. Split dependency, reconciliation, and manifest/journal concerns and add emulator tests.
32. **Unnecessarily complicated?** Premise deletion inference is unsafe complexity and should be removed; manual counter decrement logic should not be introduced where authoritative rebuilders exist.
33. **Not strict enough?** Writer freezing, AST ownership, downstream workflow protection, report convergence, type-preserving hashes, and resumability are not strict enough.
34. **Legacy Demo Sales reference?** The proposed new requirements correctly exclude it, but the current reset files/tests reference it and must not be reused without removing those references.
35. **Anything requires Storage?** No. No Firestore safety reason makes Storage access necessary.

**DESIGN APPROVED FOR IMPLEMENTATION: NO**

**NEW BLOCKERS: 4**

The four newly identified blocker classes are: unprovable historical premise ownership; unenforced global writer freeze/time-of-check gap; BGO/MLCT and other operational dependencies beyond TC; and lack of deterministic synchronous reporting/derived-state convergence.

**REQUIRED CHANGES: 16**

Once the required changes in section 24 are incorporated into the design, the architecture is suitable to implement. No Firebase Storage access is needed, and the only Sales collection permitted is `sales-all-meters`.
