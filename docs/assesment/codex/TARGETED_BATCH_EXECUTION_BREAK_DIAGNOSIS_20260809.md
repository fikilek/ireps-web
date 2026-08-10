# Targeted Batch execution break diagnosis — 2026-08-09

## Scope and evidence

Assessment only. This report follows the current working-tree source from allocation forward. No Firebase reads/writes, reset scripts, deployment, Git mutation, or runtime data changes were performed. `sales-all-meters` is treated as the active Sales collection. Line references below refer to the current files inspected on 2026-08-09.

## Executive finding

Allocation is healthy: `onAllocateTargetedBatchCallable` writes the same canonical TEAM/SP identity to the parent and every row, verifies every row, and then marks the parent `ALLOCATED`/`WAITING`. An allocated and accepted row can reach My Workorders.

The first broken downstream handoff is the premise-address contract. `tb_rows` does not contain canonical `strNo`, `strName`, `strType`, `name`, or `unitNo`. It contains only `location.addressLine1` and `location.town`. My Workorders preserves only those two values in `targetedBatchContext.sourceAddress`; the Premise form then invents a number/name split with a regex and hard-codes `strType` to `Select...`. Consequently the requested structured values never travel through the workflow as structured source truth.

The next operational break is after successful premise creation: mobile ignores the callable's Targeted Batch linkage result, clears selected premise state, and routes to `/premises`, not back to My Workorders. The row itself does stream live and will contain `refs.premiseId`, so manual return can continue, but the intended automatic loop is broken.

The later backend completion path is internally coherent if mobile reaches Meter Discovery with the nested context. It uses AST ID = TRN ID and atomically completes `tb_rows`, updates the parent, and updates the exact `sales-all-meters.tbRefs[]` member. Two mobile contract defects remain: Sales enrichment still listens to `demo_sales_meters`, and the submitted TRN has `sourceModule` only inside `targetedBatchContext`, not as the canonical top-level `sourceModule` requested by the workflow.

## Concrete handoff table

| STAGE | EXPECTED INPUT | ACTUAL INPUT | EXPECTED OUTPUT | ACTUAL OUTPUT | RESULT |
|---|---|---|---|---|---|
| Allocation | Ready TB, `tbId`, `targetType` TEAM/SP, `targetId` | Same | Parent and every row allocated to one target | Parent and rows receive `allocation.status/targetType/targetId/targetName`; parent becomes `ALLOCATED`, acceptance `WAITING`; verified row count | PASS |
| Mobile fetch | Actor identity plus allocated TBs visible only to actor's TEAM/SP | API listener receives actor args but queries all `tb_uploads`; My Workorders locally filters by SP ID or TEAM membership | Live actor-visible allocated batches | Live Firestore stream; local TEAM/SP filter; only `ALLOCATED` retained | PASS functionally; over-broad data boundary |
| My Workorders mapping | Accepted batch and canonical rows | Parent must be `ACCEPTED`; rows streamed by `tbId` | Row retains IDs, refs, scope, meter/customer/address | Most fields retained; structured address absent; Sales enrichment reads wrong collection | PARTIAL |
| Premise navigation | TB IDs, Sales ID, ERF, scope, structured address/customer | Selected ERF carries serialized nested context; route to `/premises`, then `/premises/formPremise` | Canonical Premise fields available | Only `sourceAddress.addressLine1/town`; serializer drops account/customer | FAIL — first break |
| Premise callable | Premise payload plus complete nested TB context | Mobile sends `targetedBatchContext` with `tbId,rowId,salesDocId,erfId` and generated premise `id` | Transactionally create/link premise, row, parent, Sales ref | Backend does so when correlation/scope/authority conditions pass | PASS conditional |
| TB row after premise | Valid premise ID and correlated context | Backend transaction result | `refs.premiseId`, row `IN_PROGRESS` | Exactly those fields written | PASS |
| My Workorders refresh/stream | Changed `tb_rows` document | Live `onSnapshot` on `tb_rows where tbId==...` | Updated row rendered without manual refetch | Stream is live, but Premise form navigates to `/premises`; response is ignored | FAIL operational continuation |
| Meter Discovery navigation | Linked premise and complete TB context | On manual return, current streamed row rebuilds context and routes to `/premises/form` (Meter Discovery) | Form receives row/Sales/ERF/premise/meter/scope context | Nested context has core IDs and meter number; scope comes from selected Geo/premise, not the serialized context | PASS conditional on returning |
| Meter Discovery submit | Canonical source and nested TB correlation | Nested TB context appended; no top-level `sourceModule` | Canonical Targeted Batch TRN | Context is sufficient for current backend, but top-level source marker absent | FAIL contract |
| TRN | `sourceModule=SALES_TARGETED_BATCH` and complete `targetedBatchContext` | `targetedBatchContext.sourceModule=SALES_TARGETED_BATCH`; top-level missing | Stored canonical TRN | Callable canonicalizes nested context and creates TRN | PARTIAL |
| onMeterDiscoveryCreated | Created accessed Meter Discovery TRN with AST payload | Same if submit succeeds | AST/master/premise/TB/Sales transaction | Trigger gates on TRN type, access yes, AST, meter number and premise, then runs completion | PASS conditional |
| AST | Meter Discovery TRN | `trnId` | AST ID equals TRN ID | `const astId = trnId`; AST created at that ID | PASS |
| TB row completion | Valid correlated nested context, premise and discovered meter | Same | Complete row and refs | `COMPLETED`, outcome `METER_DISCOVERED`, refs premise/meter/TRN | PASS conditional |
| TB parent completion | Completed-row count reaches completion target | Parent counters | Increment count; complete parent at target | Implemented using first positive allocatable/accepted/allocated/total count | PASS conditional |
| Sales All completion | Exact Sales doc and exact `{tbId,rowId}` ref | `salesDocId` from row survives nested context | Update exact `tbRefs[].fieldWork` | Backend writes status/outcome/meter match/IDs/timestamps to `sales-all-meters` | PASS conditional; mobile enrichment reads wrong collection |

## Step 1 — allocation

`functions/targetedBatches/allocationCallable.js`, `onAllocateTargetedBatchCallable`:

- Request identity: `targetType` is normalized to `TEAM` or `SP`; `targetId` is the team document ID or service-provider document ID.
- TEAM target must be `ACTIVE`, owned by the actor's MNC, and uses `teams/{targetId}.scope.memberUserIds` for member count.
- SP target must be `ACTIVE`, have an MNC `SUBC` relationship, and actor visibility later matches `profile.employment.serviceProvider.id`.
- Parent writes at lines 571–588 and 674–698 include `allocation.status`, `targetType`, `targetId`, `targetName`, `memberCount`, allocation audit identity/times, `status=ALLOCATED`, `acceptance.status=WAITING`, and counts.
- Every row independently receives allocation fields at lines 616–627. Rows do not merely inherit allocation from `tb_uploads`.
- Lines 648–669 re-read all rows and require every row to match.

Does allocation produce everything My Workorders requires? **YES.**

## Step 2 — Mobile My Workorders

Exact APIs:

- `useGetTargetedBatchBucketsQuery` from `src/redux/targetedBatchApi.js`.
- `useGetTargetedBatchRowsQuery` from the same file.
- Acceptance uses `onAcceptRejectTargetedBatchCallable` through `useAcceptRejectTargetedBatchMutation`.

Both reads are streams, not one-time callables. Bucket stream: `onSnapshot(query(collection(db, "tb_uploads"), orderBy("metadata.createdAt", "desc")))`. Row stream: `onSnapshot(query(collection(db, "tb_rows"), where("tbId", "==", tbId)))`.

Visibility is applied in `my-workorders.js:1671–1689` by `canActorSeeBgoBucket`:

```js
if (target.type === "SP") return target.id === cleanId(actorSpId);
if (target.type === "TEAM") return actorTeamIds.includes(target.id);
```

The endpoint retains only allocated parents; My Workorders exposes rows only when `selectedBucket.permissions.canViewRows === true`, which requires parent acceptance `ACCEPTED`. Row query itself returns all rows of that selected parent and does not additionally filter row allocation/status.

Actual normalized row shape (`normalizeTargetedBatchRow`, followed by Sales enrichment) is:

```js
{
  id, tbId, rowNo,
  erfId, erfNo, premiseId, meterId, trnId,
  salesDocId,
  noAccessCount, noAccessSourceStatus, fieldWorkMeterId,
  meterNo, accountNumber, customerName,
  address, town, sgCode, wardNumberLabel,
  allocationStatus, executionStatus, executionOutcome,
  scope, refs,
  raw // complete tb_rows document
}
```

Can an allocated/accepted row correctly reach My Workorders? **YES**, provided the current user matches the parent TEAM/SP. The API boundary nevertheless streams all parents before local filtering, and its per-Sales listeners incorrectly use `demo_sales_meters`.

## Step 3 — row selection and exact mapping

Before My Workorders normalization the streamed object is effectively `{id: doc.id, ...doc.data()}`. The important source members are:

```js
{
  id, tbId, rowNo, salesAllMeterId,
  refs: { erfId, premiseId, meterId, trnId },
  meter: { numberRaw, numberNormalized, masterVisibility },
  customer: { accountNumber, customerName },
  property: { erfNo },
  location: { addressLine1, town, sgCode, wardNumberLabel },
  scope: { lmPcode, lmName, wardPcode, wardName, wardNumber },
  allocation, execution
}
```

The exact transformation is `normalizeTargetedBatchRow` in `src/redux/targetedBatchApi.js`: refs become both top-level IDs and `refs`; `salesDocId` is initially read from nonexistent `row.salesDocId`, then `enrichTargetedBatchRowFromSales` sets it from `row.salesAllMeterId`; meter/customer/display address are derived; the complete source remains under `raw`.

`my-workorders.js:1320–1338` only adds/resolves `erfId` and `erfNo`. On selection, `buildTargetedBatchSelectedErf` produces:

```js
{
  ...warehouseErf,
  id: erfId,
  erfId,
  erfNo,
  erfType,
  admin: { localMunicipality: {pcode,name}, ward: {pcode,name} },
  targetedBatchContext
}
```

`buildTargetedBatchContextFromRow` maps:

```js
{
  sourceModule: "SALES_TARGETED_BATCH",
  operationType: "METER_DISCOVERY",
  tbId: bucket.id || row.tbId || raw.tbId,
  rowId: row.id || raw.id,
  rowNo,
  salesDocId: row.salesDocId || raw.salesAllMeterId,
  erfId: row.erfId || raw.refs.erfId,
  premiseId: row.refs.premiseId || raw.refs.premiseId,
  targetedMeterNo: row.meterNo || raw.meter.numberRaw || raw.meter.numberNormalized,
  accountNumber: row.accountNumber || raw.customer.accountNumber,
  customerName: row.customerName || raw.customer.customerName,
  sourceAddress: { addressLine1: raw.location.addressLine1, town: raw.location.town },
  returnTo: "/(tabs)/admin/operations/my-workorders"
}
```

For a missing premise, the route is first `/premises` after placing this object in `GeoContext.selectedErf`. The Premises add action then routes to `/premises/formPremise` with `id` and serialized `targetedBatchContext`. The serializer preserves core IDs, meter number, source address, and return route, but drops `accountNumber` and `customerName`. For discovery, the exact route is:

```js
{
  pathname: "/(tabs)/premises/form",
  params: {
    premiseId,
    action: JSON.stringify({ access: "yes", meterType: "electricity" }),
    targetedBatchContext: serializedTargetedBatchContext
  }
}
```

`/premises/form` renders `FormMeterDiscovery`; it is not the premise-create form.

## Step 4 — Premise address handoff

| Field | TB row has it? | My Workorders preserves it? | Navigation sends it? | Premise form reads it? | Result |
|---|---:|---:|---:|---:|---|
| `strNo` | No | No | No | Derived by regex from `addressLine1` | Not canonical |
| `strName` | No | No | No | Derived by regex/fallback from `addressLine1` | Not canonical |
| `strType` | No | No | No | Hard-coded `Select...` | Lost/unavailable |
| `name` | No | No | No | New premise uses empty `propertyType.name` | Lost/unavailable |
| `unitNo` | No | No | No | New premise uses empty `propertyType.unitNo` | Lost/unavailable |
| `addressLine1` | Yes | Yes under `sourceAddress` | Yes | Parsed by `parseTargetedBatchAddress` | Preserved only as unstructured source |
| `town` | Yes | Yes under `sourceAddress` | Yes | Used as `suburbName` | Preserved |

Where are `strNo / strName / strType` lost? They are never written to the current `tb_rows` contract. `documentFactory.js:236–249` writes only `location.addressLine1` and `town`. My Workorders therefore cannot preserve structured fields. `parseTargetedBatchAddress` attempts to manufacture `strNo/strName`; `strType` is always `Select...`. This is the first broken handoff after allocation.

## Steps 5–6 — premise callable, writes, and response

Expected Targeted Batch payload is a normal valid Premise payload plus:

```js
targetedBatchContext: {
  sourceModule: "SALES_TARGETED_BATCH",
  operationType: "METER_DISCOVERY",
  tbId, rowId, rowNo, salesDocId, erfId,
  premiseId, meterNo, accountNumber, customerName,
  sourceAddress
}
```

The required core members enforced by `assertCompleteTargetedBatchPremiseContext` are source module, `tbId`, `rowId`, `salesDocId`, and `erfId`; the submitted premise's own `id` is the authoritative new `premiseId`. Actual mobile payload includes all required core members. Its serialized route context has lost account/customer fields, but backend rebuilds canonical account/customer/address from the row.

`createOrLinkTargetedBatchPremise` transaction writes:

- `premises/{premiseId}` with canonical Targeted Batch context;
- `tb_rows/{rowId}`: `execution.status=IN_PROGRESS`, start time, `refs.premiseId`;
- `tb_uploads/{tbId}`: `execution.status=IN_PROGRESS`, start time, increment `counts.executionStartedRows` when appropriate;
- exact `sales-all-meters/{salesDocId}.tbRefs[]` reference: `fieldWork.status=IN_PROGRESS`, `premiseId`, targeted meter and timestamps while preserving existing fields.

Does premise create/link write `tb_rows.refs.premiseId` and Sales fieldWork premise information? **YES**, if all ID, scope, allocation/acceptance, actor, ERF, premise, and exact Sales tbRef correlations pass.

Backend response:

```js
{
  success: true, code: "SUCCESS", message, premiseId,
  targetedBatchLink: {
    linked, alreadyLinked, premiseCreated,
    tbId, rowId, salesDocId, erfId, executionStatus
  }
}
```

Mobile's `premisesApi` returns it, but `FormPremise` only checks `result.success`. It does not use `premiseId` or `targetedBatchLink`, clears selected premise, and routes to `/premises`. Response status: **ignored except for success/message**.

## Step 7 — return and live continuation

The TB row is not stale: `getTargetedBatchRows.onCacheEntryAdded` maintains a live Firestore listener and republishes whenever `refs.premiseId` changes. My Workorders will see the updated row when mounted/subscribed.

Why does the row not correctly continue automatically? `FormPremise.js:945–950` unconditionally clears `selectedPremise` and calls `router.replace("/(tabs)/premises")`. It does not honor `targetedBatchContext.returnTo`, does not use returned `premiseId`, and does not return to My Workorders. Manual navigation back allows the streamed row's Premise tile to become `1` and AST action to become `DISCOVER`.

Separately, `targetedBatchApi.js` listens to `demo_sales_meters/{salesAllMeterId}` for `noAccessCount` and `fieldWorkMeterId`. This violates the active collection contract and can leave those Sales-derived action values missing/stale even though TB refs stream correctly.

## Steps 8–9 — Meter Discovery handoff and submit

Expected versus actual nested navigation context:

| Field | Expected | Actual |
|---|---|---|
| `tbId` | Required | Present |
| `rowId` | Required | Present |
| `salesDocId` | Required | Present from `salesAllMeterId` |
| `erfId` | Required | Present |
| `premiseId` | Required at submit | Present from streamed row and overwritten with resolved premise at submit |
| `meterNo` | Target meter | Present as `targetedMeterNo`; form pre-fills AST number |
| `meterType` | Execution type | Route action supplies `electricity`; not part of nested TB context |
| `lmPcode/wardPcode` | Required TRN scope | Not serialized in TB context; `buildTrnSystemFields` obtains them from selected premise/Geo state |
| account/customer | Optional trace | Built before serialization but serializer drops them; backend later rebuilds canonical nested context from row |
| GPS/location | Required form evidence | Captured by Meter Discovery form, not sourced from TB row |

The electricity submit payload is:

```js
{
  id,
  accessData: { ...buildTrnSystemFields(resolvedPremiseId), access },
  ast: values.ast,
  meterType: "electricity",
  media,
  status: { state, id: lmPcode, detail: lmName },
  metadata,
  serviceProvider,
  targetedBatchContext: { ...targetedBatchContext, premiseId: resolvedPremiseId }
}
```

Does mobile submit canonical Targeted Batch context? **NO, strictly**: it submits sufficient nested core context and nested `targetedBatchContext.sourceModule`, but never assigns top-level `cleanPayload.sourceModule = "SALES_TARGETED_BATCH"`. Current backend recognizes Targeted Batch by presence/validity of `targetedBatchContext`, so this omission does not by itself prevent current completion.

## Step 10 — callable, trigger, AST, and final writes

`onMeterDiscoveryCallable` recognizes a Targeted Batch attempt when `data.targetedBatchContext` exists. It requires:

- valid normalized nested source module and complete core IDs;
- authenticated actor authorized for the allocated TEAM/SP;
- `accessData.access.hasAccess === "yes"`;
- real linked premise ID;
- parent ready/allocated/accepted, row ready, exact row/parent/Sales/ERF/premise correlation;
- matching LM/ward scopes and exact Sales tbRef.

It canonicalizes the nested context from authoritative documents and creates the TRN. `onMeterDiscoveryCreated` then requires `accessData.trnType === METER_DISCOVERY`, access `yes`, an AST payload, valid meter number, and real premise. It sets `astId = trnId`.

Inside one Firestore transaction, `completeTargetedBatchMeterDiscoveryInTransaction` requires the nested context, loads exact parent/row/Sales/premise, revalidates correlations, and writes:

- `asts/{trnId}` (created by the surrounding transaction);
- `meter_master/{normalizedMeterNo}` create/update;
- premise occupancy `Accessed`;
- TRN derived AST/master/TB result;
- `tb_rows.refs.premiseId/meterId/trnId`, `execution.status=COMPLETED`, `execution.outcome=METER_DISCOVERED`, timestamps;
- `tb_uploads.counts.completedRows + 1`, status `IN_PROGRESS` or `COMPLETED`, completion time when target reached;
- exact `sales-all-meters/{salesDocId}.tbRefs[]` member's `fieldWork`:
  `status=COMPLETED`, `outcomeCode=METER_DISCOVERED`, `outcomeLabel=Meter Discovered`, `targetedMeterNo`, `discoveredMeterNo`, `meterMatch`, `premiseId`, `meterId`, `trnId`, `submittedAt`, `updatedAt`.

The direct Targeted Batch Sales update uses the row-carried `salesDocId`, not the discovered meter number. The separate master-to-Sales sync uses `sales-all-meters/{normalizedMeterNo}` and is independent of the exact TB-ref completion update.

## Confirmed breaks, in execution order

### BREAK 1

File: `functions/targetedBatches/documentFactory.js`

Function: `buildTargetedBatchRowDoc`

Expected: Canonical premise address fields survive into execution (`strNo`, `strName`, `strType`, `name`, `unitNo`) or are explicitly absent without fabrication.

Actual: Row location writes only `addressLine1`, `town`, `sgCode`, and ward label. Mobile later regex-parses `addressLine1` and hard-codes `strType`.

Missing / incorrect fields: `strNo`, `strName`, `strType`, property `name`, `unitNo`.

Effect: Premise initial values cannot be faithful structured source data; `strType` is always missing and number/name can be incorrectly split.

Minimum correction: Extend the controlled row/source-address contract to carry available structured Sales address fields without parsing. Where source fields truly do not exist, leave them explicitly empty and require user completion.

### BREAK 2

File: `C:\dev\ireps-mobile\src\features\premises\targetedBatchPremiseContext.js`

Function: `serializeTargetedBatchContext` / `parseTargetedBatchAddress`

Expected: Navigation preserves all intentionally built premise context and reads structured fields directly.

Actual: Serializer omits `accountNumber` and `customerName`; address contains only line/town; parser guesses street number/name and forces `strType=Select...`.

Missing / incorrect fields: account/customer after serialization; all structured premise-address members.

Effect: Premise handoff is lossy and non-canonical.

Minimum correction: Serialize the canonical structured address object and existing customer/account members; remove heuristic parsing from the authoritative path.

### BREAK 3

File: `C:\dev\ireps-mobile\src\features\premises\formPremise.js`

Function: `handleSubmit`

Expected: On successful Targeted Batch premise link, consume returned `premiseId/targetedBatchLink` and return to `targetedBatchContext.returnTo` so the live row continues.

Actual: Result is used only as success; selected premise is cleared and route is always replaced with `/premises`.

Missing / incorrect fields: returned linkage is not consumed; return route ignored.

Effect: The operational loop stops after premise creation even though backend linkage succeeded.

Minimum correction: For successful Targeted Batch creates, use the returned premise/link identity, preserve valid selection as needed, and replace to the declared My Workorders return route.

### BREAK 4

File: `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js`

Function: `getTargetedBatchRows.onCacheEntryAdded`

Expected: Sales-derived row state streams from `sales-all-meters/{salesAllMeterId}`.

Actual: Listener is hard-coded to `demo_sales_meters`.

Missing / incorrect fields: authoritative Sales `tbRefs[].fieldWork` no-access count and meter linkage are not read.

Effect: My Workorders Sales-derived NA/completion action state can be missing or stale even when backend correctly updates Sales All.

Minimum correction: Point the existing per-document stream to `sales-all-meters` and retain exact `tbId`/row correlation checks.

### BREAK 5

File: `C:\dev\ireps-mobile\src\features\meters\FormMeterDiscovery.js`

Function: `handleSubmitDiscovery`

Expected: Canonical TRN contains top-level `sourceModule="SALES_TARGETED_BATCH"` plus nested complete `targetedBatchContext`.

Actual: Only nested `targetedBatchContext.sourceModule` exists.

Missing / incorrect fields: top-level `sourceModule`.

Effect: Current backend still completes by inspecting nested context, but the stored TRN violates the declared canonical source contract and other source-based readers can miss it.

Minimum correction: When valid Targeted Batch context is present, set the canonical top-level source module before serialization/submission and retain backend validation.

## Minimum repair plan

No redesign is required. The smallest controlled repair is five files:

| File | WHY | WHAT MUST CHANGE | TEST TO PROVE IT |
|---|---|---|---|
| `functions/targetedBatches/documentFactory.js` | Source row lacks structured address | Copy only verified structured Sales source fields into a documented nested row address contract; do not parse `addressLine1` | Factory unit test with complete and absent structured source; assert no invented values |
| `C:\dev\ireps-mobile\src\features\premises\targetedBatchPremiseContext.js` | Context serialization is lossy and address is guessed | Normalize/serialize structured address plus account/customer; initialize form from exact values | Round-trip unit test for every address/customer/core-ID field |
| `C:\dev\ireps-mobile\src\features\premises\formPremise.js` | Success does not continue workflow | Consume success linkage and honor Targeted Batch `returnTo` | Component/navigation test: callable success returns to My Workorders and streamed row displays premise link |
| `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js` | Wrong Sales collection | Replace `demo_sales_meters` listener with `sales-all-meters` | Streaming test mutates Sales All fieldWork and observes row enrichment; Demo mutation has no effect |
| `C:\dev\ireps-mobile\src\features\meters\FormMeterDiscovery.js` | TRN source marker incomplete | Set top-level `sourceModule` for valid Targeted Batch submit | Payload unit test asserts top-level source and all nested IDs survive queue/online paths |

End-to-end proof should allocate and accept one TEAM batch and one SP batch, create a premise from a row with known structured address data, verify automatic return and live `refs.premiseId`, submit discovery, then assert AST ID equals TRN ID and exact row/parent/Sales All completion fields. Use an isolated test fixture; no reset is required.

FIRST BREAK IDENTIFIED:
YES

FIRST BREAK:
functions/targetedBatches/documentFactory.js + buildTargetedBatchRowDoc + canonical structured premise address fields are not written; only location.addressLine1/town reach execution

NUMBER OF CONFIRMED BREAKS:
5

ALLOCATION HEALTHY:
YES

MY WORKORDERS HANDOFF HEALTHY:
YES

PREMISE HANDOFF HEALTHY:
NO

POST-PREMISE CONTINUATION HEALTHY:
NO

METER DISCOVERY HANDOFF HEALTHY:
NO

TARGETED BATCH TRN CONTEXT HEALTHY:
NO

TB ROW COMPLETION HEALTHY:
YES

TB PARENT COMPLETION HEALTHY:
YES

SALES-ALL-METERS COMPLETION HEALTHY:
YES

MINIMUM FILES TO MODIFY:
5

READY TO IMPLEMENT:
YES
