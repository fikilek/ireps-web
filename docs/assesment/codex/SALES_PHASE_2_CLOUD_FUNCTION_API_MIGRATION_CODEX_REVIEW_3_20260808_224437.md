# iREPS Sales Phase 2 — Cloud Functions + Web API Cutover
## Codex Review 3 — Actual Implementation Review

**Repository:** `C:\dev\ireps-web`  
**Branch at implementation input:** `main`  
**HEAD at implementation input:** `860f44add153151232a775705c4e2c85a5bea7db`  
**Review stage:** Post-implementation / pre-deployment  
**Deployment status:** **NOT DEPLOYED**

---

## 1. Review objective

Review the **actual Phase 2 implementation** against the already-approved Sales migration architecture.

This is **not another architecture-design review**. Review 2 already returned:

- `OVERALL VERDICT: PASS`
- `READY FOR DEV IMPLEMENTATION: YES`
- `NEW BLOCKERS: 0`

The implementation target remains:

```text
IMPLEMENT EVERYTHING
→ RUN LOCALLY
→ CODEX REVIEW 3
→ only after PASS may DEV deployment be considered
```

Do not propose unrelated refactors or reopen settled design choices unless the implementation demonstrably violates the approved contract or is unsafe.

---

## 2. Locked Phase 2 target

Move all **active runtime Sales usage** from:

```text
demo_sales_meters
```

to:

```text
sales-all-meters
```

`sales-all-meters` is the authoritative Sales runtime collection.

`demo_sales_meters` is **not deleted** in this patch.

### Locked ownership

- Sales Pipeline owns commercial/source-derived Sales fields.
- Targeted Batch owns **`tbRefs[]` only**.
- Geofence owns **`geofenceRefs[]` only**.
- Meter Master bridge owns **`master.id` and `master.visibility` only**.

No subsystem may replace the complete Sales All document merely to update an owned operational field.

---

## 3. Files changed by this Phase 2 implementation

### Production

1. `functions/salesAllMeters/helpers.js`
2. `functions/targetedBatches/helpers.js`
3. `functions/targetedBatches/callables.js`
4. `functions/geofences/salesMembership.js`
5. `functions/geofences/triggers.js`
6. `src/redux/demoSalesApi.js`
7. `src/redux/salesTargetedBatchApi.js`
8. `src/pages/sales/PrepaidSales.jsx`

### Tests

9. `functions/test/salesAllMeters.helpers.test.js`
10. `functions/test/getTargetedBatchRowsCallable.test.js`
11. `functions/test/recordTargetedBatchNoAccessCallable.test.js`
12. `functions/test/targetedBatchPremiseLink.test.js`
13. `functions/test/salesPhase2Cutover.static.test.js` — new
14. `functions/test/targetedBatchSalesAllBinding.test.js` — new
15. `functions/test/geofenceSalesMembership.test.js` — new

### Review evidence

16. `docs/assesment/codex/SALES_PHASE_2_CLOUD_FUNCTION_API_MIGRATION_CODEX_REVIEW_3_20260808_224437.md`

### Explicitly unchanged

- `functions/geofences/membership.js`
- `functions/index.js`
- `firestore.indexes.json`
- `functions/targetedBatches/deleteCallable.js`
- `functions/targetedBatches/getTargetedBatchRowsCallable.js` production logic
- `functions/targetedBatches/premiseLink.js` production logic
- `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` production logic
- `functions/targetedBatches/documentFactory.js`

The inherited Targeted Batch lifecycle files consume the changed central Sales collection binding and were deliberately not rewritten.

---

## 4. Sales All validator implementation

`functions/salesAllMeters/helpers.js` now implements the approved model:

```text
OPEN ADDITIVE ROOT SCHEMA
+
STRICT PROTECTED CONTRACTS
```

### Root behavior

- The old complete root allowlist has been removed.
- Unknown legitimate additive root fields are accepted.
- Known protected structures remain strictly validated.
- `lmPcode` is now a mandatory protected root field and must be a nonblank string.

### `tbRefs`

Implemented validation includes:

- absent or array;
- every item is a plain object;
- `id` is required and nonblank;
- logical duplicate IDs are rejected case-insensitively after trim/normalization;
- `date` is required and must be a Firestore Timestamp or valid hydrated Timestamp representation;
- optional `rowId` must be nonblank;
- optional `fieldWork` must be a plain object;
- status is restricted to exact canonical values:
  - `NOT_STARTED`
  - `IN_PROGRESS`
  - `COMPLETED`
- known fieldWork members remain strictly typed;
- unknown nested members remain forward-compatible;
- `noAccess` must be an array of canonical `{date,time,user}` records;
- `IN_PROGRESS` requires `rowId` and valid `updatedAt`;
- `COMPLETED` requires the current completion correlation fields and timestamps;
- explicit `NOT_STARTED` may omit in-progress/completion correlation IDs.

### `geofenceRefs`

Implemented validation includes:

- absent or array;
- item must be a plain object;
- required nonblank `id`;
- optional `name` must be a string;
- duplicate logical IDs rejected;
- unknown nested members remain allowed.

### Recency

Contour canonical null recency remains valid:

```text
lastPurchaseAtISO = null
daysSinceLastPurchase = null
```

No Atomic recency is fabricated.

---

## 5. Targeted Batch cutover implementation

### Central binding

`functions/targetedBatches/helpers.js`:

```js
TARGETED_BATCH_COLLECTIONS.sales = "sales-all-meters"
```

### Canonical LM rule

The old Demo compatibility exception is removed:

- missing Sales `lmPcode` → `SALES_LM_SCOPE_MISSING`;
- wrong `lmPcode` → `SALES_LM_SCOPE_MISMATCH`;
- matching `lmPcode` → authoritative validation continues normally.

### `batchFail` removal

`functions/targetedBatches/callables.js` no longer:

- writes `batchFail` on validation failure;
- deletes `batchFail` after successful Targeted Batch creation.

The successful Sales update is limited to:

```js
transaction.update(record.salesRef, {
  tbRefs: FieldValue.arrayUnion(salesTbRef),
});
```

Validation failure performs **zero diagnostic writes to Sales All**.

The callable still returns failure information and retains logging/Targeted Batch failure state.

### Inherited lifecycle paths

Existing creation/deletion/row retrieval/premise/no-access/completion code continues to use the shared `TARGETED_BATCH_COLLECTIONS.sales` binding.

Production lifecycle logic was intentionally not rewritten where the existing current-read/transaction semantics were already correct.

---

## 6. Geofence cutover implementation

`functions/geofences/triggers.js` now reads:

```js
db
  .collection("sales-all-meters")
  .where("hasUsableGps", "==", true)
```

No composite index change was made.

The existing canonical Sales candidate compatibility remains:

- `erfCandidates` / legacy case-compatible candidate fields;
- lower-case canonical coordinates;
- LM/ward scope matching.

### Sales-specific atomic membership writer

`functions/geofences/salesMembership.js` now isolates the Sales-specific write behavior.

For matching Sales documents it writes only:

```js
geofenceRefs: FieldValue.arrayUnion({ id, name })
```

This removes the stale-read/full-array-replacement lost-update risk for different geofence additions.

Integrity behavior:

- no existing logical ID → atomic add;
- same ID + same name → idempotent/no write;
- existing ID-only compatibility ref → treated as already linked;
- same logical ID + different explicit name → fail closed;
- duplicate logical IDs already present → fail closed;
- if any assessed Sales integrity conflict exists, the Sales commit helper opens no write batch and throws `SALES_GEOFENCE_MEMBERSHIP_INTEGRITY_CONFLICT`.

Generic ERF/premise/AST membership behavior in `functions/geofences/membership.js` was not changed.

Deferred items remain deferred:

- trigger catch/suppress behavior;
- rename lifecycle;
- delete/deactivate membership removal.

---

## 7. Web API cutover implementation

### `src/redux/demoSalesApi.js`

Only the backing collection binding changed:

```js
const DEMO_SALES_COLLECTION = "sales-all-meters";
```

The API name/file/reducer/hook contract was deliberately retained.

Existing behavior retained:

- `onSnapshot` streaming;
- shared stream lifecycle;
- `lmPcode` query;
- normalization;
- sorting;
- loading/error behavior;
- monthly calculations;
- map compatibility;
- missing operational arrays normalized safely.

### `src/redux/salesTargetedBatchApi.js`

All Sales listeners now use:

```js
const SALES_COLLECTION = "sales-all-meters";
```

Its existing Targeted Batch/reporting listeners remain `onSnapshot` streams.

The two Redux readers therefore cut over together; no Web split-brain Demo/Sales-All runtime source remains.

### `PrepaidSales.jsx`

Only stale user-facing source wording was corrected from Demo Sales to Sales All.

No direct Firestore access was introduced into the page.

---

## 8. Local verification performed in the implementation sandbox

The uploaded implementation input intentionally did not include repository `node_modules`.

An attempted real Functions dependency install using the provided lockfile could not complete because the sandbox package registry returned a 404 for the `wrappy-1.0.2.tgz` dependency. Therefore no claim is made that a full real-dependency Firebase test suite ran in this sandbox.

### A. Validator + static Phase 2 suite

Command-equivalent test set:

```text
functions/test/salesAllMeters.helpers.test.js
functions/test/salesPhase2Cutover.static.test.js
```

Result:

```text
59 tests
59 PASS
0 FAIL
```

This covers the validator contract, central binding, `batchFail` removal, canonical geofence query/atomic transform source, and Web streaming source cutover.

### B. Focused Targeted Batch LM + geofence behavior tests

Because real Firebase packages could not be installed in the sandbox, lightweight temporary test-only API stubs were used solely to load the modules and exercise their pure/fake-Firestore logic. The stubs were removed immediately after execution and are **not in the patch**.

Test set:

```text
functions/test/targetedBatchSalesAllBinding.test.js
functions/test/geofenceSalesMembership.test.js
```

Result:

```text
12 tests
12 PASS
0 FAIL
```

Coverage includes:

- Sales All central TB source;
- missing/wrong/matching `lmPcode`;
- geofence inside/outside polygon;
- exact retry idempotency;
- ID-only compatibility;
- same-ID/different-name conflict;
- duplicate logical-ID conflict;
- conflict causes zero membership writes;
- membership commit changes only `geofenceRefs` via atomic transform.

### C. Inherited Targeted Batch lifecycle regression comparison

The same temporary Firebase API stubs were used against:

1. the exact uploaded current-source baseline **before this patch**; and
2. the Phase 2 implementation **after this patch**.

Same inherited test set on both:

```text
getTargetedBatchRowsCallable.test.js
recordTargetedBatchNoAccessCallable.test.js
targetedBatchNoAccessRule.test.js
targetedBatchPremiseLink.test.js
```

Baseline result:

```text
35 tests
31 PASS
4 FAIL
```

Post-Phase-2 result:

```text
35 tests
31 PASS
4 FAIL
```

The **same four tests fail in both baseline and patched source**, so this implementation introduced no new failure in that comparison:

1. `enriches from exact Sales tbRef and deduplicates reads without writes`
2. `reports all integrity states and never maps them to zero`
3. `exact correlation and Sales shape failures produce zero writes`
4. `meter-linked and terminal rows reject with zero writes`

These existing failures must not be misreported as Phase 2 regressions. They should be judged separately if Codex believes they are deployment blockers.

### D. Syntax checks

`node --check` passed for all 14 changed/added `.js` modules and tests.

`PrepaidSales.jsx` only contains two copy changes; no JSX structure was changed.

---

## 9. Runtime legacy-source audit

A post-patch search of the active production source represented in the implementation package finds:

```text
active Functions/Web runtime demo_sales_meters references: 0
Targeted Batch batchFail references: 0
```

The only `demo_sales_meters` strings in the patched focused tree are negative assertions inside `salesPhase2Cutover.static.test.js`.

The pre-patch full-repository inventory also identified legacy references in deliberately excluded categories such as:

- reset/migration/admin tools;
- historical geofence reprocessing tool;
- read-only/repair tools;
- a dead backup page `PrepaidSales.before-gps-filter.jsx`.

Those were intentionally **not mechanically migrated** in this runtime Phase 2 patch.

Codex should verify that none of those excluded paths is an active Web/backend runtime consumer requiring inclusion before deployment.

---

## 10. Existing dirty working tree preservation

The implementation was based on the user-provided **current-source ZIP**, not an old snapshot.

The repository was already dirty at input time. Existing modified/untracked work was preserved.

No reset, clean, revert, checkout/discard, `git add`, commit, push, deployment, or Firestore write was performed by ChatGPT.

The delivery ZIP contains only the files changed/created by this Phase 2 work, preserving repository-relative paths.

---

## 11. Deployment gates intentionally still pending

Even if Review 3 passes, do **not** deploy until the previously agreed DEV readiness gates are completed:

1. obtain a fresh read-only Firestore sample from:
   - project `ireps2`
   - collection `sales-all-meters`
   - `lmPcode = ZA5241`
   and verify the actual hydrated deployed document shape against the validator/Web normalizer;

2. audit active existing DEV Targeted Batches to determine whether operational `tbRefs` exist only on Demo Sales and require a controlled data-readiness step before Targeted Batch DEV verification.

These are deployment/data-readiness gates, not reasons to redesign this implementation.

---

## 12. Required Codex Review 3 verdict

Please inspect the actual implementation files and return a concise review using this exact decision structure:

```text
OVERALL VERDICT: PASS | FAIL
READY FOR DEV DATA-READINESS GATES: YES | NO
READY FOR DEV DEPLOYMENT: NO (deployment is still explicitly blocked pending data-readiness gates)
NEW IMPLEMENTATION BLOCKERS: <count>
```

Then answer:

### B-01 — Targeted Batch ownership / batchFail

- Is `batchFail` fully removed from active Targeted Batch Sales writes/deletes?
- Does Targeted Batch now mutate Sales All only through `tbRefs`?
- Are validation failures write-free on Sales All?

Return:

```text
B-01 IMPLEMENTATION CLOSED: YES | NO
```

### B-02 — Geofence concurrent lost-update risk

- Does Sales geofence CREATE use `FieldValue.arrayUnion({id,name})` rather than full-array replacement?
- Can two different geofence additions to the same Sales document survive without one overwriting the other?
- Is same logical ID + conflicting name guarded fail-closed?
- Does the helper change only `geofenceRefs`?

Return:

```text
B-02 IMPLEMENTATION CLOSED: YES | NO
```

### B-03 — Operational ref validation

- Is root validation open/additive while protected fields remain strict?
- Are `tbRefs` items/lifecycle shapes structurally validated as approved?
- Are `geofenceRefs` items structurally validated as approved?
- Are unknown nested members still forward-compatible?

Return:

```text
B-03 IMPLEMENTATION CLOSED: YES | NO
```

### Runtime cutover

Confirm whether active runtime code represented by the patch now uses `sales-all-meters` consistently across:

- Targeted Batch;
- Geofence CREATE;
- Sales Table API;
- Targeted Batch Sales reporting/stats API.

Return:

```text
ACTIVE RUNTIME SPLIT-BRAIN FOUND: YES | NO
```

### Scope discipline

Confirm that the patch did **not** unnecessarily redesign:

- generic geofence membership;
- geofence rename/delete lifecycle;
- trigger retry/error suppression;
- Redux API naming;
- Meter Discovery UI;
- Firestore indexes;
- unrelated source.

Finally list any genuine implementation blocker with exact file + line/function + reason. Do not mark deferred/historical cleanup as a Phase 2 blocker unless it is actually an active runtime dependency.
