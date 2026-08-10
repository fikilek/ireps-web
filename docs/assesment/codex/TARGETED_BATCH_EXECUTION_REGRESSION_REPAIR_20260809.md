# Targeted Batch execution regression repair — 2026-08-09

## Outcome

The smallest mobile handoff repair is implemented. Targeted Batch premise success now returns to My Workorders only after validating the backend linkage response; ordinary premise creation still returns to Premises. Targeted Batch Sales enrichment continues to stream but now reads `sales-all-meters`. Targeted Batch Meter Discovery now adds the canonical top-level `sourceModule` while preserving the complete nested context.

No Targeted Batch backend completion code, allocation code, row schema, reset tooling, Firebase data, deployment, or Git state was changed.

## Git evidence and classification

Repository state captured before editing:

- Web branch `main`, HEAD `1d1437cbc1c8249b3fbb2dafd090441657022d10`.
- Mobile branch `main`, HEAD `0e39d5a3d24af927d64cc39d212e6c0a8b455ac1`.
- Both worktrees were already dirty. Existing changes were preserved.

| FILE | CURRENT/PRE-PATCH BEHAVIOR | GIT EVIDENCE | CLASSIFICATION | PATCH |
|---|---|---|---|---|
| `functions/targetedBatches/documentFactory.js` | Writes `location.addressLine1` and `town`, not structured premise fields | Targeted row implementation history (`68b5586`, `da629bc`, `85a7569`) never carried canonical `strNo/strName/strType/name/unitNo` | PRE-EXISTING LIMITATION; NOT REQUIRED TO CLOSE LOOP | No |
| `src/features/premises/targetedBatchPremiseContext.js` | Core IDs, target meter, source address and `returnTo` round-trip; account/customer are normalized but not serialized | Introduced in `f8b4063`; `d01a464` added premise ID, targeted meter and `returnTo`. No later removal. Existing tests prove required core round-trip | PRE-EXISTING NON-BLOCKING OMISSION | No |
| `src/features/premises/formPremise.js` | Successful create always routed to `/premises` and ignored TB linkage result | TB premise mode added in `f8b4063`; the unconditional route is older (`77809a1`). Git contains no earlier TB-specific return behavior | PRE-EXISTING INTEGRATION GAP, REQUIRED TO CLOSE LOOP | Yes |
| `src/redux/targetedBatchApi.js` | Current uncommitted live Sales join used `demo_sales_meters` | File introduced by `f8b4063`; HEAD later used callable-backed rows. Current dirty streaming migration introduced Demo Sales. Approved Phase 2 target is Sales All | NEW PHASE 2 CONTRACT FIX | Yes |
| `src/features/meters/FormMeterDiscovery.js` | Nested TB context was submitted; top-level source module absent | TB Meter Discovery support added by `62a4ec2`; it added nested context and return route but never top-level source | NEW BACKWARDS-COMPATIBLE CONTRACT FIX | Yes |

Git does not contain evidence that structured TB addresses or TB-specific premise return behavior previously existed and were removed. The operational failure is confirmed as an omitted cross-screen continuation in the initial TB premise integration, followed by an incomplete Sales-All streaming migration—not a single revertable regression commit.

## Files modified

Production:

1. `C:\dev\ireps-mobile\src\features\premises\formPremise.js`
2. `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js`
3. `C:\dev\ireps-mobile\src\features\meters\FormMeterDiscovery.js`

Focused test:

4. `C:\dev\ireps-mobile\src\redux\targetedBatchApi.streaming.test.mjs`

Delivery report:

5. `C:\dev\ireps-web\docs\assesment\codex\TARGETED_BATCH_EXECUTION_REGRESSION_REPAIR_20260809.md`

## Exact repairs

### Premise success continuation

After a successful create, mobile now validates:

- non-edit Targeted Batch mode;
- `targetedBatchLink.linked === true`;
- returned `premiseId` equals the submitted premise ID;
- returned `tbId` and `rowId` equal the submitted nested context.

Only when all correlations match does it route to `targetedBatchContext.returnTo`, falling back to `/(tabs)/admin/operations/my-workorders`. Non-TB and uncorrelated responses retain the existing `/(tabs)/premises` route. The live `tb_rows` subscription then supplies the updated `refs.premiseId` to My Workorders.

### Sales-All live stream

Only the collection name changed:

```text
demo_sales_meters -> sales-all-meters
```

The existing `onSnapshot` lifecycle, dynamic listener map, exact `tbId` matching, normalization, publishing, and cleanup remain unchanged. The focused test now requires Sales All and explicitly rejects an active `demo_sales_meters` reference.

### Meter Discovery source contract

For valid Targeted Batch context only:

```js
cleanPayload.sourceModule = targetedBatchContext.sourceModule;
```

Normal Meter Discovery payloads remain unchanged. The nested `targetedBatchContext` and premise-ID resolution are unchanged.

## Intentionally not changed

- `documentFactory.js`: structured address fields never existed in Git's working TB row contract. The existing address line reaches the editable Premise form; expanding the backend schema was unnecessary tonight.
- `targetedBatchPremiseContext.js`: required core IDs and `returnTo` already round-trip. Account/customer serialization is not required by Premise or completion because backend canonicalizes context from the authoritative row.
- My Workorders navigation, allocation, acceptance, callable validation, trigger completion, AST/master creation, TB row/parent completion, and Sales-All final write.
- Reset scripts, Firebase data, deployments, Sales UI/reporting/stats, registry, and geofence code.

## Validation

Passed:

- Mobile targeted tests: 17/17.
  - context construction/serialization and normal non-TB absence;
  - Targeted Batch action states;
  - live `tb_rows` stream and Sales listener lifecycle;
  - `sales-all-meters` required and Demo Sales rejected.
- Static source assertions:
  - correlated TB premise success selects My Workorders route;
  - ordinary premise fallback remains `/premises`;
  - Meter Discovery assigns top-level source before nested TB context.
- ESLint on three changed production files: zero errors; 23 pre-existing warnings in `FormMeterDiscovery.js`.
- Backend premise/Sales-All correlation tests: 20/20.
- `git diff --check`: passed in both repositories; only existing line-ending warnings.

Not fully passing:

- A broader 34-test backend run passed 30 and failed 4 in already-dirty, untouched files:
  - two `getTargetedBatchRowsCallable` enrichment expectations;
  - two `recordTargetedBatchNoAccessCallable` expectations.
- These failures are outside this three-file production repair, but they prevent claiming a completely green offline Targeted Batch suite. No backend changes were made because the task explicitly scoped completion as healthy and prohibited expansion without proof.

## Remaining blocker to one-row DEV test

The repaired premise-to-discovery execution path is ready for a controlled one-row DEV exercise, but the repository-wide Targeted Batch offline gate is not fully green because of the four pre-existing failures above. Reconcile those dirty callable/No-Access changes or explicitly waive those unrelated failures before treating the full suite as a release gate. No live test or deployment was performed.

REGRESSION ROOT CAUSE CONFIRMED:
YES

FILES MODIFIED:
5

REGRESSIONS RESTORED:
1

NEW CONTRACT FIXES:
2

PRE-EXISTING LIMITATIONS LEFT ALONE:
2

ALLOCATION PATH:
PASS

PREMISE HANDOFF:
PASS

RETURN TO MY WORKORDERS:
PASS

SALES-ALL STREAM:
PASS

METER DISCOVERY TB CONTEXT:
PASS

BACKEND COMPLETION CHANGED:
NO

OFFLINE TESTS:
FAIL

READY FOR ONE-ROW DEV TEST:
NO
