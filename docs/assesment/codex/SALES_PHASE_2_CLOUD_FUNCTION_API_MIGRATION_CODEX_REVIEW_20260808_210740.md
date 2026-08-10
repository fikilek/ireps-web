# 1. Executive Verdict

OVERALL VERDICT: FAIL

READY FOR DEV IMPLEMENTATION: NO

NEW BLOCKERS: 3

The locked architecture is directionally correct: `sales-all-meters` should be the sole Sales runtime collection, the two Web streams must move together, operational writers must use field-scoped writes, and an open additive root schema is preferable to a complete allowlist. The current local implementation and stated modification surface are not yet safe to implement unchanged. Three corrections must be incorporated into the implementation contract first:

1. Targeted Batch creation currently writes and deletes the root `batchFail` field, contrary to the locked ownership of `tbRefs` only.
2. geofence creation computes and writes a complete `geofenceRefs` array from a non-transactional snapshot, allowing concurrent geofence runs to lose each other's additions.
3. the Sales All validator treats `tbRefs` and `geofenceRefs` as protected only at the outer-array type level; malformed items pass, contrary to the proposed strict protected-contract design.

This is a review of the current local files, including existing uncommitted changes. No application source was modified. The named DEV sample was not present at the supplied path, so sample-based compatibility is **NOT PROVEN**; compatibility conclusions use the shape stated in the brief and code inspection.

# 2. Repository State Reviewed

- Repository: `C:\dev\ireps-web`
- Branch: `main`
- HEAD: `860f44add153151232a775705c4e2c85a5bea7db`
- Review timestamp: `2026-08-08 21:07:40 +02:00` (Africa/Johannesburg)
- Git status summary at review start: 10 modified tracked files plus existing untracked reports, tools, tests, generated report directories, and UI files. Material modified files included `firestore.indexes.json`, `functions/salesAllMeters/helpers.js`, two Targeted Batch callables, `functions/test/salesAllMeters.helpers.test.js`, and several Sales/Targeted Batch pages. All were preserved.
- Review basis: current working tree, not HEAD-only content.
- DEV sample: `C:\dev\ireps-pipeline-sales\output\inspection\sales_all_meters_dev\sales_all_meters__ireps2__ZA5241__sample_50.json` was absent. **NOT PROVEN** from the requested artifact.

# 3. Runtime demo_sales_meters Inventory

| file | function/module | read/write/trigger/API | current collection | proposed collection | migration required? | notes |
|---|---|---|---|---|---|---|
| `src/redux/demoSalesApi.js:6,470-493` | shared Sales RTK Query stream | active Web API read/listener | `demo_sales_meters` | `sales-all-meters` | Yes | Preserve names and `onSnapshot`; LM query is compatible with canonical `lmPcode`. |
| `src/redux/salesTargetedBatchApi.js:26,508-514,860-865` | report and stats Sales joins | active Web API reads/listeners | `demo_sales_meters` | `sales-all-meters` | Yes | Both listener families must change in the same Web release as `demoSalesApi`. |
| `functions/targetedBatches/helpers.js:4-10` | `TARGETED_BATCH_COLLECTIONS.sales` | active Cloud Function central binding | `demo_sales_meters` | `sales-all-meters` | Yes | Propagates to creation, deletion, row retrieval, premise lifecycle, Meter Discovery completion, and no-access. |
| `functions/targetedBatches/callables.js:510,840-843` | permanent creation | active CF read/write | mapped Demo Sales | mapped Sales All | Yes | `tbRefs` update is scoped, but `batchFail` is an unauthorized second root write. |
| `functions/targetedBatches/deleteCallable.js:197-237,356-437` | deletion/unlink | active CF read/write | mapped Demo Sales | mapped Sales All | Via binding | Exact `arrayRemove` is field-scoped; transaction rereads canonical row-linked docs. |
| `functions/targetedBatches/getTargetedBatchRowsCallable.js:237-243` | row enrichment | active CF read | mapped Demo Sales | mapped Sales All | Via binding | Read-only; current uncommitted code matches by TB ID and reports integrity state. |
| `functions/targetedBatches/premiseLink.js:618,838-842,1182,1495,1637-1639` | premise start/validation/MD completion | active CF read/write | mapped Demo Sales | mapped Sales All | Via binding | Writes only `tbRefs`, inside transactions. |
| `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js:325-376` | no-access/TRN | active CF read/write | mapped Demo Sales | mapped Sales All | Via binding | Reconstructs `tbRefs`, but transaction rereads the Sales document and retries on conflict. |
| `functions/geofences/triggers.js:23-253` | `onGeoFenceCreated` | active trigger/read/write | `demo_sales_meters`, `HasUsableGps` | `sales-all-meters`, `hasUsableGps` | Yes | Direct collection and field change required. Whole-array write has lost-update risk. |
| `src/pages/sales/PrepaidSales.jsx:510` | error copy | documentation/UI text only | Demo name in message | canonical name | Optional | Non-runtime dependency; update with Web patch for accurate diagnostics. |
| `functions/tools/targetedBatches/repairTargetedBatchErfRefs.js:237` | repair utility | migration/admin tool read | `demo_sales_meters` | case-specific | No Phase 2 runtime change | Blocks physical retirement until explicitly audited/retired. Do not mechanically alter. |
| `functions/scripts/tools/geofences/reprocessGeoFenceMembership.js:506-507` | geofence reprocess | admin tool read/write | Demo + legacy casing | separate canonical-safe tool or retirement | No runtime patch | Not active trigger, but blocks retirement and would otherwise keep operating on Demo. |
| `functions/scripts/tools/targeted-batches/*` | reset/verification tools | admin/test tooling | Demo | retain historical intent or replace separately | No | Includes read/reset scripts and read-only verifier. Not active runtime. |
| `functions/test/*.test.js` Demo literals | tests | test | Demo | Sales All expectations | Yes where exercising binding | Update/add assertions without broad textual replacement. |
| `src/pages/sales/PrepaidSales.before-gps-filter.jsx` | backup source | dead/legacy source | Demo in text | none | No | Excluded from active runtime imports by repository search. |
| `functions/targetedBatches/helpers.js:649,840` | comments | comment only | Demo assumptions | canonical wording/logic | Logic review required | The missing-`lmPcode` exception should not remain the canonical contract. |

No other active `functions/` or `src/` path directly names `demo_sales_meters`. The two Redux readers, central Targeted Batch binding, and geofence trigger are the complete discovered active runtime surface. Repository code cannot prove whether an external/mobile client still reads Demo; that remains **NOT PROVEN** and blocks deletion, not Phase 2 cutover.

# 4. Sales All Field Ownership Review

| owner | contract | verdict |
|---|---|---|
| Sales Pipeline | commercial/source-derived fields only; create default for `master.visibility` only on a new document | PASS with deployment gate. Adjacent current pipeline refresh uses field-path updates and states it preserves `master.visibility`, `tbRefs`, `geofenceRefs`, and non-pipeline roots (`sales_pipeline_sales_all_refresh.py:1-6,456-461,538-559`). |
| Targeted Batch | `tbRefs[]` only | FAIL currently. Most paths comply, but `callables.js:118-124,840-843` writes/deletes `batchFail`. |
| Geofence | `geofenceRefs[]` only | PASS on field scope, FAIL on concurrency. `salesMembership.js:125-130` returns only `geofenceRefs`, but it replaces a snapshot-derived full array. |
| Meter Master bridge | `master.id`, `master.visibility` only | PASS. `classifySalesAllMetersSync` produces only dot-path patches; `syncSalesAllMetersFromMaster` uses `tx.update`. |

The adjacent pipeline refresh implementation materially reduces refresh risk because it updates only pipeline-owned paths in a Firestore transaction. The legacy Stage 08 create/resume uploader is create-only and does not refresh existing documents. A preflight/execute verification of the exact deployed pipeline revision remains a deployment gate.

# 5. Open Additive Schema Review

Removing the complete root allowlist is the correct design. Unknown additive roots do not by themselves create a trigger loop: repository search found no `sales-all-meters/{id}` write trigger. The current allowlist at `functions/salesAllMeters/helpers.js:41-45,145-150` must be removed, and the test at `functions/test/salesAllMeters.helpers.test.js:214` must invert from rejection to acceptance.

Mandatory validation that must remain:

- canonical document ID, `meterNoNormalized`, `master.id`, and their equality;
- nonblank `meterNo`, supported normalized `provider`, and nonblank canonical `lmPcode` for canonical runtime documents;
- exact `master` namespace: object with only `id` and `visibility`; valid visibility enum;
- type and invariant validation for known commercial fields currently governed: amount/unit maps, totals, month keys/continuity, recency rules by provider/source, known booleans, ERF arrays, risk fields, account aliases, and source ranges;
- `tbRefs` absent or an array of strictly validated objects. At minimum each item needs nonblank canonical `id`, a valid Firestore timestamp/date contract, optional `rowId` with the expected type, and, when present, a map-shaped `fieldWork` whose known members (`status`, IDs, timestamps, `noAccess[]`) are validated. Duplicate TB IDs or ambiguous links must be rejected where the lifecycle requires uniqueness;
- `geofenceRefs` absent or an array of objects with nonblank `id` and a valid optional/name string; duplicate IDs should be rejected or normalized by the owner;
- known protected namespaces must never be accepted with an unexpected type merely because the root is open.

No general denylist of unknown roots is justified. Precisely reserve the existing owner namespaces (`master`, `tbRefs`, `geofenceRefs`) and known commercial names for strict validation. Fields such as `metadata`, `batchFail`, `trnBatchIds`, `astId`, or future names should not be globally forbidden solely because they are unknown; instead, active writers must obey ownership and known legacy fields should be removed from those writers. A denylist is warranted only if a concrete security rule, deployed trigger, or pipeline collision is identified. None was found for unknown roots.

The open schema does not worsen write concurrency: validation controls admissibility, while lost updates are determined by write primitives and transaction scope.

# 6. Targeted Batch Review

Changing `TARGETED_BATCH_COLLECTIONS.sales` at `helpers.js:7` propagates to every genuine backend Sales reference found. No direct Demo literal remains in active Targeted Batch runtime outside that mapping.

- Creation: reads canonical Sales via the mapping, validates correlation, then `arrayUnion`s a `{id,date}` `tbRefs` entry inside a transaction (`callables.js:806-845`). This preserves other fields and concurrent updates. However, the same patch deletes `batchFail`, and failure handling writes `batchFail` outside the Targeted Batch ownership contract. Move diagnostics to `tb_uploads`, a creation-attempt/audit collection, or structured logs; do not write it to Sales All.
- Deletion: transactionally rereads the parent, rows, and Sales documents, validates the exact TB/date reference, then uses exact `arrayRemove` (`deleteCallable.js:395-437`). It preserves all other roots. The post-pass cleanup also uses field-scoped `arrayRemove` but is not transactional with its prior query; it is safe for exact element removal, though it should remain an idempotent cleanup rather than the primary correctness mechanism.
- Row retrieval: reads mapped Sales documents in chunks and writes nothing.
- Premise start and Meter Discovery completion: each reads Sales in the same Firestore transaction and writes only reconstructed `tbRefs`. Firestore transaction retry prevents a stale Sales read from replacing a newer `tbRefs` value, including concurrent no-access or geofence/master changes. Since only `tbRefs` is updated, unrelated fields survive.
- No access/TRN: reads parent, row, Sales, and TRN inside one transaction; creates TRN and replaces only `tbRefs`. Transaction retries protect concurrent `tbRefs` edits. `geofenceRefs`, `master`, commercial and future fields are preserved.
- TRN relationship: TRN creation is atomic with the `tbRefs` and row/parent state transition in `recordTargetedBatchNoAccess`.
- Source validation: `helpers.js:839-844` explicitly permits missing `lmPcode` for the Demo source. After canonical cutover, require a present matching `lmPcode`; otherwise a corrupt/cross-scope canonical document can pass the old compatibility exception.
- Meter type: `helpers.js:649-651` defaults absent type to `PREPAID`. This is not a Phase 2 blocker for the stated Contour prepaid scope, but it is a provider-neutrality debt and should be covered by a canonical-source test.

# 7. Geofence Review

The exact trigger change is `functions/geofences/triggers.js:187-189` from:

```js
db.collection("demo_sales_meters").where("HasUsableGps", "==", true)
```

to:

```js
db.collection("sales-all-meters").where("hasUsableGps", "==", true)
```

`salesMembership.js` is shape-compatible with both generations:

- `ErfCandidates` / `erfCandidates`: lines 28-30;
- `HasUsableGps` / `hasUsableGps`: lines 61-62;
- candidate latitude/longitude aliases and LM/ward aliases are normalized in the candidate helpers;
- candidate scope and point-in-polygon selection are applied before membership;
- only matching documents receive a `geofenceRefs` patch.

The helper should not require a compatibility change merely for canonical casing. Renaming `collectGeoFenceDemoSalesUpdates` is optional and out of the deadline-critical scope.

Concurrency blocker: `collectGeoFenceDemoSalesUpdates` reads `geofenceRefs`, appends in memory, and returns a full array (`salesMembership.js:112-130`). `commitGeoFenceMembershipUpdates` later uses non-transactional `batch.update` (`membership.js:487-494`). Two concurrently created geofences can both read `[]`, then write `[A]` and `[B]`; last writer wins. Correct with a transaction that rereads each Sales doc before reconstructing, or use `FieldValue.arrayUnion({id,name})` for creation. If names can be changed, use an ID-keyed map or a transactional normalize/replace operation. Tests must simulate concurrent additions.

The active trigger only handles creation, so active add behavior exists; removal after geofence deletion/deactivation is **NOT PROVEN** from active runtime. The reprocess tool is not a lifecycle trigger. This is important but not introduced by the collection cutover.

Index: a single equality predicate on `hasUsableGps` uses Firestore's automatic single-field index unless that field is exempted. `firestore.indexes.json` contains no exemption for `sales-all-meters.hasUsableGps`; no composite index is required for the proposed one-field query. If production has console-only exemptions not represented locally, that state is **NOT PROVEN** and should be checked in DEV preflight.

The trigger catches all errors and does not rethrow (`triggers.js:250-252`), so Firestore will consider a partially completed invocation successful and will not retry. This is important non-blocking existing reliability debt; at minimum Phase 2 verification must detect partial membership and rerun safely.

# 8. Web Streaming API Review

## `src/redux/demoSalesApi.js`

The stream lifecycle is correct and must remain: one shared `onSnapshot` query, incremental `docChanges`, cached stream state, subscriber release delay, and LM filtering. Change only the collection constant (and inaccurate error copy).

The normalizer accepts the documented canonical lower-case shape:

- `meterNo`, `meterNoNormalized`, `lmPcode`, address, account/customer fields;
- `monthlySalesC`, `monthlyUnits`, totals and period fields;
- `erfCandidates`, `erfNumbers`, `gpsMatchStatus`, `hasUsableGps`;
- `leakageCategory`, `riskTier`, `riskScore`;
- absent `tbRefs` and `geofenceRefs` normalize to `[]` (`lines 422-425`);
- absent `sgCode` and `erfNo` normalize to blank and render as `NAv`;
- no Atomic recency is fabricated from Contour `lastPurchaseAtISO = null`.

One cosmetic/semantic issue is `demoData: data.demoData !== false` (`line 367`), which labels canonical rows as demo data by default. No discovered cutover logic depends on it; classify as deferred unless analytics or UI behavior proves otherwise.

Actual sample compatibility is **NOT PROVEN** because the requested JSON file was absent.

## `src/redux/salesTargetedBatchApi.js`

Both Sales joins use the one `SALES_COLLECTION` constant at lines 511 and 863. Changing that constant moves report and statistics listeners together. They retain `onSnapshot`, document-ID chunking, cleanup, and normalized read-model publication. This Web file must ship atomically with `demoSalesApi.js`; otherwise the UI is split-brain.

# 9. Meter Master / Meter Discovery Interaction Review

`onMeterMasterUpdated` targets `sales-all-meters` (`functions/index.js:2592-2628`). It exits when relevant Meter Master refs/derived visibility did not change, so its own Sales write cannot recursively retrigger it. There is no Sales All document trigger in the reviewed runtime.

Inside a Firestore transaction it rereads Meter Master and Sales, validates the current master and complete known Sales contract, and calls `syncSalesAllMetersFromMaster`. The resulting patch contains only `master.id` and/or `master.visibility` dot paths (`salesAllMeters/helpers.js:344-354`; `index.js:1508-1510`). This preserves `tbRefs`, `geofenceRefs`, commercial data, and unknown additive fields. Concurrent changes to the same Sales document cause Firestore transaction retry rather than overwrite.

If Sales All is missing, the bridge logs and returns `TARGET_MISSING`; it does not create an incomplete commercial document (`index.js:1512-1524`). This is safe fail-closed behavior, but creation ordering must ensure Stage 08 created Sales All before a bridge transition is expected.

Contour is supported by the current uncommitted validator, including null monthly-source recency. The open-root change is needed so operational/future fields do not block a visibility update.

Meter Discovery uses the same helper in its transaction (`index.js:1622,1774-1781`). Targeted Batch Meter Discovery completion updates `tbRefs` in its own transaction. Concurrent operations touch distinct dot/root paths and both transactions reread the Sales document, so neither should overwrite the other. A prior repository assessment mentions a separate meter-installation visibility gap; it was not part of the Phase 2 named path and is **NOT PROVEN** as resolved by this review.

# 10. sgCode / erfNo Assessment

BLOCKER: NO

Sales pages render either scalar as `NAv`. The primary normalizer supplies blank strings when absent. Targeted Batch derives authoritative ERF linkage from `erfCandidates`/ERF documents and validates draft correlation; it does not require Sales All root `sgCode` or root `erfNo` for the stream cutover. No backend code path was found that makes these two Sales All scalars mandatory. Do not invent a derivation in Phase 2.

# 11. Trigger Loop / Concurrency Assessment

1. Targeted Batch and Geofence can safely update distinct fields only after geofence lost-update remediation. Current TB writes are field-scoped; current geofence write is field-scoped but stale-array-prone.
2. TB cannot overwrite `geofenceRefs`; geofence cannot overwrite `tbRefs` because neither writes the whole document.
3. Meter Master dot-path writes cannot overwrite either operational array.
4. Current adjacent pipeline refresh uses transactionally applied pipeline-owned field paths, preserving operational roots. Execute its preservation verification before promotion.
5. No Sales All trigger loop was found. `onMeterMasterUpdated` is triggered by Meter Master and ignores irrelevant changes.
6. TB reconstruction writes occur in transactions; creation/deletion use atomic array transforms. Geofence batching is insufficient for read-modify-write correctness.
7. A stale TB read is retried by Firestore. A stale geofence read can replace a newer `geofenceRefs` array today.
8. TB `arrayUnion`/`arrayRemove` operations are concurrency-safe for exact objects. Reconstructed TB arrays are safe because transaction-scoped. Geofence reconstructed arrays are unsafe outside a transaction.
9. Meter Discovery, TB completion, and visibility sync touch `tbRefs`, related row/premise/master documents, and master dot paths in transactions. No cross-field overwrite was found. Business ordering is protected by correlation assertions; add an integration concurrency test.
10. Open additive roots do not change concurrency semantics.

# 12. Tests Required

`functions/test/salesAllMeters.helpers.test.js`:

- invert the unknown-root test to acceptance;
- accept absent, empty and valid `tbRefs`/`geofenceRefs`;
- reject non-arrays and malformed items, blank IDs, invalid dates/types, duplicate/ambiguous refs;
- retain invalid master, identity, provider, LM, amount-map, alias and Contour-recency failures;
- prove bridge patches contain only master dot paths with unknown fields present.

Targeted Batch tests:

- add collection-binding assertion for `sales-all-meters`;
- creation test proving only `tbRefs` changes and no `batchFail` write occurs;
- failure diagnostic test proving diagnostics are stored/logged outside Sales All;
- deletion exact-ref removal and preservation of master/geofence/commercial/unknown fields;
- `getTargetedBatchRowsCallable.test.js` reads canonical collection and handles missing/invalid refs;
- `targetedBatchPremiseLink.test.js` and `recordTargetedBatchNoAccessCallable.test.js` preserve all unrelated roots and retry on simulated concurrent `tbRefs` change;
- require present matching canonical `lmPcode` after cutover.

Geofence tests (new `functions/test/geofenceSalesMembership.test.js` and trigger-level test):

- trigger uses `sales-all-meters` and canonical `hasUsableGps`;
- canonical `erfCandidates` and lower-case coordinates/scope work; legacy aliases remain compatible if desired;
- inside/outside polygon and LM/ward selection;
- idempotent add and removal helper semantics;
- two concurrent additions retain both references;
- only `geofenceRefs` changes; `tbRefs`, master, commercial and unknown fields survive;
- error propagation/retry policy is explicit.

Web tests (add Redux/API unit tests under the existing frontend test convention):

- collection is `sales-all-meters`, query still filters `lmPcode`, and listener unsubscribe/reuse works;
- canonical Contour fixture normalizes totals, ERFs, lower-case GPS and null recency;
- missing operational arrays become `[]`;
- both targeted-batch Sales listener sites use the canonical collection;
- repository guard test/search prevents active Web `demo_sales_meters` literals.

# 13. Expected Files To Modify

Smallest safe implementation set:

- `functions/salesAllMeters/helpers.js`
- `functions/targetedBatches/helpers.js`
- `functions/targetedBatches/callables.js` (newly required by B-01)
- `functions/geofences/triggers.js`
- `functions/geofences/salesMembership.js` and/or `functions/geofences/membership.js` (required by B-02; a trigger-local transaction alternative is acceptable)
- `src/redux/demoSalesApi.js`
- `src/redux/salesTargetedBatchApi.js`
- `src/pages/sales/PrepaidSales.jsx` only for accurate error text
- relevant existing tests plus new geofence/Web tests

Reviewed files that should not require production logic modification if the central binding remains authoritative:

- `functions/targetedBatches/deleteCallable.js`
- `functions/targetedBatches/getTargetedBatchRowsCallable.js`
- `functions/targetedBatches/premiseLink.js`
- `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js`
- `functions/index.js`
- `firestore.indexes.json` for this one-field geofence query

Admin/migration tools should not be mechanically changed in Phase 2. They must instead be inventoried before Demo retirement.

# 14. Deployment Order Review

Recommended DEV sequence:

1. Land tests and the validator/open-schema change together; deploy functions that exercise the validator only after fixture validation against a fresh DEV sample.
2. Deploy Targeted Batch backend with the central binding change and removal/relocation of `batchFail` writes. Avoid an interval where Web creates canonical drafts but backend writes Demo.
3. Deploy geofence backend with canonical query and concurrency-safe membership writes.
4. Deploy both Web stream constants in one release.
5. Run DEV end-to-end: Sales table/stats/reporting, TB create/delete/row/no-access/premise/MD completion, concurrent geofence creation, and Meter Master visibility.
6. Run Stage 08 refresh preservation preflight/verification and a fresh repository/deployed-function/mobile Demo audit.
7. Observe logs and document counts; do not delete Demo.
8. Promote the same revisions and indexes/rules to TEST, then load/verify the 10,216 Endumeni records for training.

Exact Cloud Functions requiring deployment from the safe patch:

- `onCreateTargetedBatchCallable`
- `onDeleteTargetedBatchCallable`
- `getTargetedBatchRowsCallable`
- `recordTargetedBatchNoAccessCallable`
- the premise-link/Meter Discovery callable exports wired to `premiseLink.js` (exact export names should be taken from `functions/index.js` during implementation)
- `onGeoFenceCreated`
- `onMeterMasterUpdated` and `onMeterDiscoveryCreated` only if shared validator code is bundled/deployed per-function and the validator change must reach those consumers; `functions/index.js` itself needs no logic edit.

Because Firebase deployment packages shared source per selected function, deploy every exported function that imports the changed Targeted Batch helpers or Sales All validator. Derive the final `--only functions:...` list from the post-change import graph; do not deploy unrelated functions.

# 15. Remaining Demo Sales Retirement Blockers

- active Web streams and active CF paths listed in Section 3 until Phase 2 ships;
- geofence reprocessing admin tool and Targeted Batch repair/reset/verification tools still name Demo;
- stale UI/legacy-source text;
- external/mobile consumers are **NOT PROVEN** absent from this repository;
- deployed function revisions and scheduled/admin jobs are **NOT PROVEN** solely from local source;
- an observation period and data parity audit are required.

These block physical retirement, not the controlled Phase 2 cutover. Do not delete `demo_sales_meters` in this patch.

# 16. Findings

## B-01

- Severity: BLOCKER
- File: `functions/targetedBatches/callables.js:118-124,840-843`
- Code path: permanent Targeted Batch validation failure and creation
- Issue: writes/deletes Sales root `batchFail`, violating Targeted Batch ownership of `tbRefs` only.
- Consequence: operational ownership is ambiguous; pipeline refresh/open schema may preserve an unauthorized legacy diagnostic indefinitely.
- Required correction: move failure diagnostics to batch/audit state or logs and make every Sales update in this module `tbRefs`-only.

## B-02

- Severity: BLOCKER
- File: `functions/geofences/salesMembership.js:112-130`; `functions/geofences/membership.js:487-494`
- Code path: `onGeoFenceCreated` Sales membership commit
- Issue: non-transactional stale read followed by whole-array replacement.
- Consequence: concurrent geofence creations can silently lose a valid `geofenceRefs` addition.
- Required correction: transactionally reread/rebuild or use atomic `arrayUnion`; prove concurrency in tests.

## B-03

- Severity: BLOCKER
- File: `functions/salesAllMeters/helpers.js:291-293`
- Code path: `validateExistingSalesAllMetersTarget`
- Issue: protected operational fields are checked only with `Array.isArray`; malformed objects/items pass.
- Consequence: bridge updates can bless structurally unsafe operational contracts, and downstream TB/geofence code may fail or mis-correlate.
- Required correction: strict item/duplicate/known-substructure validation while allowing absence and unknown additive roots.

## N-01

- Severity: IMPORTANT BUT NON-BLOCKING
- File: `functions/targetedBatches/helpers.js:839-844`
- Code path: Sales draft/source scope validation
- Issue: legacy Demo exception accepts missing `lmPcode`.
- Consequence: canonical corruption or wrong-scope data can pass validation.
- Required correction: require present matching `lmPcode` after cutover.

## N-02

- Severity: IMPORTANT BUT NON-BLOCKING
- File: `functions/geofences/triggers.js:250-252`
- Code path: `onGeoFenceCreated`
- Issue: catches and suppresses all failures after potentially partial multi-phase writes.
- Consequence: no automatic retry and potentially inconsistent counts/membership.
- Required correction: rethrow retryable failures or implement explicit durable/idempotent retry state.

## N-03

- Severity: IMPORTANT BUT NON-BLOCKING
- File: requested DEV sample path
- Code path: Web compatibility evidence
- Issue: sample file absent.
- Consequence: actual 50-document shape compatibility is **NOT PROVEN** in this review.
- Required correction: restore/provide sample and run fixture normalizer/validator tests before deployment.

## N-04

- Severity: IMPORTANT BUT NON-BLOCKING
- File: `functions/geofences/triggers.js`
- Code path: geofence lifecycle
- Issue: active runtime handles creation only; update/deactivation/deletion removal is not present.
- Consequence: physical geofence lifecycle may leave stale refs.
- Required correction: audit separately; do not expand Phase 2 unless existing operational requirements demand removal now.

## D-01

- Severity: DEFERRED / POLISH
- File: `src/redux/demoSalesApi.js`, API export names
- Code path: naming
- Issue: legacy Demo naming remains.
- Consequence: terminology only.
- Required correction: none in Phase 2.

## D-02

- Severity: DEFERRED / POLISH
- File: `src/redux/demoSalesApi.js:367`
- Code path: normalizer
- Issue: canonical rows default to `demoData: true`.
- Consequence: misleading metadata if later consumed.
- Required correction: change only when a real consumer/contract is identified.

## D-03

- Severity: DEFERRED / POLISH
- File: Sales UI and normalizer
- Code path: `sgCode`, `erfNo`
- Issue: scalars absent.
- Consequence: UI displays `NAv`; ERF candidates/numbers remain available.
- Required correction: none until canonical source is approved.

# 17. Final Implementation Contract

Implementation must preserve this architecture:

```text
Sales Pipeline --commercial field-path refresh--> sales-all-meters
Targeted Batch --tbRefs only--------------------> sales-all-meters
Geofence ------geofenceRefs only----------------> sales-all-meters
Meter Master --master.id/master.visibility-----> sales-all-meters

sales-all-meters --onSnapshot/lmPcode--> demoSalesApi read model
sales-all-meters --onSnapshot/id joins--> Sales TB reports/stats
```

No owner may replace the whole document. Read-modify-write arrays must use atomic transforms or a transaction that rereads the same Sales document. Unknown additive roots must survive every writer and validator pass. Known identity, master, operational and commercial contracts remain strict. Both Web Sales readers cut over atomically. Contour monthly data retains null Atomic recency. Demo remains intact until all local, deployed, mobile, scheduled and administrative consumers are verified off it.

# 18. Final Recommendation

The Phase 2 direction should proceed only after the implementation contract is amended to include `functions/targetedBatches/callables.js`, concurrency-safe geofence writes, and structural operational-array validation. Before implementation begins, agree where `batchFail` diagnostics will live and which geofence atomicity strategy will be used. Before deployment, restore a representative DEV sample and pass the tests and gates in Sections 12 and 14.

Corrections required before implementation:

1. remove/relocate Targeted Batch `batchFail` writes from Sales All;
2. specify and implement transaction/atomic-transform semantics for `geofenceRefs`;
3. specify strict `tbRefs` and `geofenceRefs` item contracts in the validator and tests.

OVERALL VERDICT: FAIL
READY FOR DEV IMPLEMENTATION: NO
NEW BLOCKERS: 3
