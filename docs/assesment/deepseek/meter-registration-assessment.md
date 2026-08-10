# iREPS Meter Registration and Meter Lifecycle Assessment

## Agent: Deepseek
## Date: 2025-07-23

---

## 1. REPOSITORY STATE

| Repository | Branch | HEAD Commit | Status |
|---|---|---|---|
| `ireps-web` | `main` | `860f44add153151232a775705c4e2c85a5bea7db` | Unable to determine `git status --short` (sandbox restriction) |
| `ireps-mobile` | `main` | `0e39d5a3d24af927d64cc39d212e6c0a8b455ac1` | Unable to determine `git status --short` |
| `ireps-pipeline-sales` | Read-only inspection | Not inspected directly | Exists as Python ETL pipeline |
| `ireps-schemas` | Read-only inspection | Not inspected directly | Exists |

**NOTE:** Shell access (bash) is blocked in the current sandbox mode. Git branch and HEAD were read from `.git/HEAD` and `.git/refs/heads/main`. `git status --short` could not be executed.

---

## 2. EXECUTIVE CONCLUSION

The iREPS codebase currently supports **two complete meter registration origination paths**: Path 1 (Field/FWR origin — no supplied meter list) and Path 2 (Prepaid/Vending Sales origin — supplied meter list via `demo_sales_meters`). Path 3 (Conventional/Billing supplied meter origin) **does not exist** as an end-to-end path, though the field registration forms and lifecycle TRNs can handle conventional meters once they are created.

**Meter Discovery (MDIS) and Meter Installation (MINST) ultimately create the same canonical AST shape** — the only material differences are the TRN type string, TRN ID prefix (`TRN_MDIS_` vs `TRN_MINST_`), and a few form-specific fields (commissioning answers in INST, meter-reading prefill in MDIS). Both write to the same `asts`, `trns`, `meter_master`, `premises`, and `ireps_erfs` collections through the same transaction patterns.

**The Meter Master collection already provides a generic bridge** between supplied meters, canonical meter numbers, ASTs, and sales records via `refs.asts.id` and `refs.sales.id`. However, Targeted Batch is currently hard-coupled to `demo_sales_meters` as the sole source collection and `PREPAID_SALES` as the sole source type.

**Post-registration meter lifecycle TRNs are AST-centric** — they operate against `asts/{astId}` and require an AST ID. They do not inspect or depend on the meter's original source (field, sales, or billing). Each lifecycle TRN is generic.

**Overall assessment:** Path 1 and Path 2 converge cleanly. Path 3 is partially supported at the form and lifecycle level but completely missing as an origination path. The AST-centric lifecycle model is validated (PASS). The primary gap is the absence of a conventional-source equivalent to `demo_sales_meters` and its TB integration.

---

## 3. CURRENT REGISTRATION ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ORIGINATION PATHS                                 │
│                                                                          │
│  PATH 1 (Field)          PATH 2 (Prepaid)         PATH 3 (Conventional) │
│  ┌──────────────┐       ┌──────────────┐         ┌──────────────┐       │
│  │ FWR/Field    │       │ Pipeline ETL │         │ Billing Sys? │       │
│  │ Premise →    │       │ → demo_sales │         │ → ???        │       │
│  │ Meter Disc.  │       │   _meters    │         │              │       │
│  └──────┬───────┘       └──────┬───────┘         └──────┬───────┘       │
│         │                      │                        │               │
│         │                      ▼                        │               │
│         │              ┌──────────────┐                 │               │
│         │              │ Targeted     │                 │               │
│         │              │ Batch (TB)   │                 │               │
│         │              │ allocation/  │                 │               │
│         │              │ acceptance   │                 │               │
│         │              └──────┬───────┘                 │               │
│         │                     │                         │               │
│         ▼                     ▼                         ▼               │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │               ERF → Premise → Meter                       │           │
│  │         (Meter Discovery OR Meter Installation)           │           │
│  │                                                           │           │
│  │  Mobile: FormMeterDiscovery.js / FormMeterIstallation.js  │           │
│  │  → httpsCallable("onMeterDiscoveryCallable") /            │           │
│  │    httpsCallable("onMeterInstallationCallable")           │           │
│  │  → Firestore Transaction                                  │           │
│  │    → trns/{trnId}     (TRN)                               │           │
│  │    → asts/{trnId}     (AST, same ID)                      │           │
│  │    → meter_master/{normalizedMeterNo}                     │           │
│  │    → sales-all-meters/{normalizedMeterNo} (visibility)    │           │
│  │    → premises/{premiseId} (services, occupancy)           │           │
│  │    → ireps_erfs/{erfId} (metadata)                        │           │
│  │    → demo_sales_meters/{salesDocId} (TB only, tbRefs)     │           │
│  │    → tb_uploads/{tbId} + tb_rows/{rowId} (TB only)       │           │
│  └──────────────────────┬───────────────────────────────────┘           │
│                         │                                                │
│                         ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │                 POST-REGISTRATION LIFECYCLE               │           │
│  │                                                           │           │
│  │  TRNs operating on asts/{astId}:                           │           │
│  │  • METER_DISCONNECTION  (MDCN)  CONNECTED → DISCONNECTED  │           │
│  │  • METER_RECONNECTION   (MRCN)  DISCONNECTED → CONNECTED  │           │
│  │  • METER_REMOVAL        (MREM)  → REMOVED                 │           │
│  │  • METER_READING        (MREAD) status unchanged          │           │
│  │  • METER_INSPECTION     (MINSP) status unchanged          │           │
│  │  • METER_COMMISSIONING  (COMM)  FIELD → CONNECTED         │           │
│  │                                                           │           │
│  │  Each validated against AST doc, premise, status state    │           │
│  │  All independent of meter's origination path              │           │
│  └──────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. PATH 1 ASSESSMENT — FIELD / FWR ORIGIN

**STATUS: FULLY IMPLEMENTED**

Path 1 supports field-originated meter registration with no supplied meter list. The field worker creates (or uses an existing) premise, then performs Meter Discovery or Meter Installation.

### 4.1 Entry Points (Mobile)

Three ways to enter Meter Discovery:
| Entry | File | Mechanism |
|---|---|---|
| Premise screen | `src/context/DiscoveryContext.js:23` | `openMissionDiscovery({ premiseId, premise, hasAccess, meterType })` |
| Targeted Batch work order | `app/(tabs)/admin/operations/my-workorders.js:1492` | Router push with `targetedBatchContext` |
| Offline premise storage | `app/(tabs)/admin/storage/premise-offline-storage.js:354` | Draft recovery |

The route is always `app/(tabs)/premises/form.js` → `FormMeterDiscovery.js`.

Meter Installation is entered via `MissionInstallationModal.js` → `app/(tabs)/premises/form-meter-installation.js` → `FormMeterIstallation.js` (note: filename has a typo).

### 4.2 TRN ID Format

- Meter Discovery: `TRN_MDIS_{timestamp}_{WTR|ELC|NA}_{wardPcode}_{erfNo}`
- Meter Installation: `TRN_MINST_{timestamp}_{WTR|ELC|NA}_{wardPcode}_{erfNo}`

### 4.3 AST ID

The AST document ID is **identical to the TRN ID** (`astId = trnId`). This is set at `functions/index.js:1619`.

### 4.4 Key Callables

| Callable | File | Line |
|---|---|---|
| `onMeterDiscoveryCallable` | `functions/index.js` | 3057 |
| `onMeterInstallationCallable` | `functions/index.js` | 4812 |

---

## 5. PATH 2 ASSESSMENT — PREPAID / VENDING SALES ORIGIN

**STATUS: FULLY IMPLEMENTED**

### 5.1 Pipeline → Targeted Batch Flow

```
ireps-pipeline-sales (Python ETL)
  → Consumes PSD CSV/JSONL from input/
  → Enriches with ERF GPS
  → Outputs: output/monthly_only/{lmPcode}/02_enriched_psd/
  → Loaded into demo_sales_meters/{meterNo}
  → Web UI: Create Targeted Batch from demo_sales_meters selection
  → tb_uploads/{tbId} + tb_rows/{rowId} created
  → Team allocation → acceptance
  → Field worker: my-workorders → bucket → row → premise
  → Meter Discovery form (targetedMeterNo pre-filled from row)
  → onMeterDiscoveryCallable → onMeterDiscoveryCreated trigger
  → completeTargetedBatchMeterDiscoveryInTransaction
```

### 5.2 Key Collections

| Collection | Doc ID | Role |
|---|---|---|
| `demo_sales_meters` | `{meterNo}` (normalized) | Temporary prepaid source |
| `sales-all-meters` | `{normalizedMeterNo}` | Operational projection with `master.visibility` |
| `meter_master` | `{normalizedMeterNo}` | Canonical meter identity bridge |
| `tb_uploads` | `TGB_{date}_{time}_{hash}` | Parent batch |
| `tb_rows` | Auto-generated | Individual work row |

### 5.3 Source Type

`TARGETED_BATCH_SOURCE_TYPES.prepaidSales = "PREPAID_SALES"` is the **only** defined source type (`functions/targetedBatches/helpers.js:12-14`).

### 5.4 Backlinking (Traceability After AST Creation)

| Link | Data | Location |
|---|---|---|
| TB Row → Sales | `row.salesAllMeterId` = `demo_sales_meters` doc ID | `tb_rows` |
| TB Row → AST | `row.refs.meterId` = AST ID | `tb_rows` |
| Sales → TB | `sales.tbRefs[]` with `fieldWork` details | `demo_sales_meters` |
| TRN → TB | `trn.derived.targetedBatch` + `trn.targetedBatchContext` | `trns` |
| TRN → Source | `trn.sourceModule = "SALES_TARGETED_BATCH"` | `trns` |
| Premise → TB | `premise.targetedBatchContext` | `premises` |
| Meter Master → AST | `master.refs.asts.id` | `meter_master` |
| Meter Master → Sales | `master.refs.sales.id` (populated at TB completion) | `meter_master` |

**CONFIRMED CURRENT BEHAVIOUR:** The `meter_master.refs.sales.id` is populated during TB completion (`completeTargetedBatchMeterDiscoveryInTransaction`). The original supplied meter identity is fully traceable through multiple redundant paths.

### 5.5 Path 2 Uses Normal Meter Discovery

**CONFIRMED:** Path 2 uses the **same** `onMeterDiscoveryCallable` and `FormMeterDiscovery.js` as Path 1. The TB context is attached as `targetedBatchContext` in the payload, but the core registration logic is identical. No special "Targeted Batch registration TRN" exists.

---

## 6. PATH 3 ASSESSMENT — CONVENTIONAL / BILLING SUPPLIED METERS

**CLASSIFICATION: NOT SUPPORTED**

### 6.1 What DOES Exist (Conventional Meter Capability in Forms)

| Capability | File | Evidence |
|---|---|---|
| Conventional meter type in registration | `ireps-mobile/components/forms/ElectricitySections.js:127` | `type` picker: `["prepaid", "conventional"]` |
| Conventional in water forms | `ireps-mobile/components/forms/WaterSections.js:51` | Same picker |
| AST validation accepts conventional | `functions/index.js:1277-1280` | `meter.type` as `"prepaid"` or `"conventional"` |
| Conventional reading evidence | `functions/index.js:1362-1368` | Requires `meterReadingPhoto` for conventional + reading |
| MREAD is conventional-only | `functions/meterLifecycle/helpers.js:1097-1103` | Explicitly `PREPAID_MREAD_NOT_SUPPORTED` |
| Inspection handles conventional | `functions/meterLifecycle/helpers.js:1835-1895` | Numeric reading + photo + timestamp required |
| TB allows conventional meter type | `functions/targetedBatches/helpers.js:23-26` | `TARGETED_BATCH_ALLOWED_METER_TYPES` includes `CONVENTIONAL` |

### 6.2 What is MISSING (No Conventional Origination Path)

| Gap | File | Detail |
|---|---|---|
| **No conventional source collection** | — | Only `demo_sales_meters` exists as source |
| **Source type hard-coded to PREPAID** | `functions/targetedBatches/helpers.js:12-14` | `TARGETED_BATCH_SOURCE_TYPES = { prepaidSales: "PREPAID_SALES" }` only |
| **getDemoSalesMeterType defaults to PREPAID** | `functions/targetedBatches/helpers.js:649` | Returns `"PREPAID"` when no explicit type found |
| **TB validation requires Sales doc** | `functions/targetedBatches/callables.js:459` | `"Missing Sales source"` if `salesAllMeterId` can't resolve to `demo_sales_meters` |
| **TB requires Sales tbRefs** | `functions/targetedBatches/callables.js:467` | `"Missing Sales tbRefs link"` |
| **Premise linkage Sales-coupled** | `functions/targetedBatches/premiseLink.js:619-645` | `SALES_DOCUMENT_NOT_FOUND` is a hard failure |
| **Completion writes to demo_sales_meters** | `functions/targetedBatches/premiseLink.js:1437` | `demo_sales_meters/{id}.tbRefs[]` |
| **No billing importer** | — | No alternative source adapter |
| **No conventional source type** | `functions/targetedBatches/helpers.js:12` | No `BILLING_SALES` or `CONVENTIONAL_SALES` constant |

### 6.3 Business Comment in Code

From `functions/targetedBatches/helpers.js:649`:
> *"demo_sales_meters is the temporary Prepaid Sales source. Conventional demo records must carry an explicit meter type when they are introduced."*

This comment anticipates Path 3 but no implementation exists.

### 6.4 Meter Master Already Has Generic Shape for Path 3

The `meter_master` schema already supports a non-sales meter:
- `refs.sales.id = ""` (empty for field-only meters)
- `refs.sales.provider = ""`
- `customerNo = ""` and `accountNo = ""`
- The `hasExactKeys` validator enforces exactly `{ id: "", provider: "" }` for the sales ref

**INFERENCE:** Meter Master is architecturally ready for Path 3 — it does not couple field meters to sales data.

### 6.5 Sales All Meters Already Distinguishes Visibility

`deriveMasterVisibility` returns `"VISIBLE"` only when BOTH `refs.asts.id` AND `refs.sales.id` are non-empty. A field-only meter (or conventional-supplied without sales reference) would be `"INVISIBLE"` in `sales-all-meters`.

---

## 7. METER DISCOVERY — FULL CODE TRACE

### 7.1 Mobile Side

| Step | File | Function/Component | Lines |
|---|---|---|---|
| Entry modal | `components/MissionDiscoveryModal.js` | Component | 1-42 |
| Route | `app/(tabs)/premises/form.js` | Screen | 1-10 |
| Form | `src/features/meters/FormMeterDiscovery.js` | `FormMeterDiscovery` | 1-800+ |
| TRN ID build | Same file | `buildMeterDiscoveryTrnId()` | 55-67 |
| Access schema (No Access) | Same file | `accessSchema` (Yup) | 419-445 |
| Water schema | Same file | `WaterDiscoverySchema` (Yup) | 448-520 |
| Electricity schema | Same file | `ElecDiscoverySchema` (Yup) | 522-730 |
| Submit handler | Same file | `handleSubmitDiscovery()` | ~853 |
| Media upload | Same file | Upload to `meters/{type}/{erfId}_{tag}_{ts}.jpg` | In submit handler |
| Callable invocation | Same file | `httpsCallable(functions, "onMeterDiscoveryCallable")` | In submit handler |
| Meter number input | `components/forms/FormInputMeterNo.js` | Component | — |
| TB context parsing | `src/features/premises/targetedBatchPremiseContext.js` | `parseTargetedBatchContextRouteParam()` | — |
| Offline queue mapping | `src/utils/submissionQueue.js` | `getCallableNameForSubmissionQueueItem` | 663 |

### 7.2 Backend Callable: `onMeterDiscoveryCallable`

**File:** `functions/index.js:3057`

**Flow:**
1. Authenticate caller (`request.auth.uid`)
2. Normalize meter number via `normalizeMeterNo(meterNoRaw)` (`meterMaster/helpers.js:56`)
3. Validate payload via `validateMeterCreationPayload` (line 1136)
   - Expected `trnType`: `"METER_DISCOVERY"`
   - Expected `trnPrefix`: `"TRN_MDIS_"`
4. Premise gate: `premises/{premiseId}` must exist
5. If TRN already exists → idempotent success
6. If `hasAccess === "yes"`:
   - Run `validateTargetedBatchMeterDiscoverySubmission` (if TB context)
   - Check `meter_master/{normalizedMeterNo}` via `classifyOperationalAstChange`
   - On conflict → return `DUPLICATE_METER`
7. If `hasAccess === "no"` → save TRN directly (No Access)
8. Save to `trns/{trnId}` with `{ merge: true }`
9. Return success

### 7.3 Firestore Trigger: `onMeterDiscoveryCreated`

**File:** `functions/index.js:1593`

**Trigger:** `onDocumentCreated("trns/{trnId}")` filtered by `trnType === "METER_DISCOVERY"`

**Transaction:**
1. **Read** `asts/{trnId}`, `premises/{premiseId}`, `meter_master/{normalizedMeterNo}`, `sales-all-meters/{normalizedMeterNo}`, `ireps_erfs/{erfId}`
2. **If TB context present:** `completeTargetedBatchMeterDiscoveryInTransaction(tx, ...)`
   - Updates `tb_rows/{rowId}.execution.status → COMPLETED`
   - Updates `tb_uploads/{tbId}.counts.completedRows++`
   - Updates `demo_sales_meters/{salesDocId}.tbRefs[].fieldWork`
3. **AST creation:** `tx.create(astRef, astDoc)` — `astId = trnId`
4. **Meter Master:** `classifyOperationalAstChange` → `CREATE_FIELD_ONLY` or `UPDATE_AST_LINK` or `CONFLICT`
   - Creates/updates `meter_master/{normalizedMeterNo}`
5. **Sales All Meters:** `syncSalesAllMetersFromMaster` → updates `sales-all-meters/{normalizedMeterNo}.master.visibility`
6. **Premise update:** `premises/{premiseId}.services.{waterMeters|electricityMeters}[]` + `occupancy.status → "Accessed"`
7. **TRN update:** writes `derived: { astId, master, targetedBatch }` back to `trns/{trnId}`
8. **ERF update:** `ireps_erfs/{erfId}.metadata`

### 7.4 Registry Side Effects

| Trigger | Collection | Action |
|---|---|---|
| `onMeterCreated` (`asts`) | `registry_meters/{astId}` | Creates registry meter row |
| `onMeterCreated` (`asts`) | `premises/{premiseId}.services` | Service snapshot update |
| `onMeterCreated` (`asts`) | `asts/{astId}.geofenceRefs` | Geofence membership |
| `onMeterCreated` (`asts`) | `registry_erfs/{erfId}` | Meter/TRN counts |
| `onMeterCreated` (`asts`) | `registry_premises/{premiseId}` | Meter counts |

### 7.5 Link Summary

| Relationship | Mechanism |
|---|---|
| TRN ↔ AST | `astId = trnId` (same document ID) |
| AST ↔ Premise | `premises/{premiseId}.services.waterMeters[]` or `electricityMeters[]` |
| AST ↔ ERF | `asts/{astId}.accessData.erfId` + `ireps_erfs/{erfId}` metadata |
| AST ↔ Meter Master | `meter_master/{normalizedMeterNo}.refs.asts.id = astId` |
| Meter Master ↔ Sales All | `sales-all-meters/{normalizedMeterNo}.master.id` via `syncSalesAllMetersFromMaster` |

---

## 8. METER INSTALLATION — FULL CODE TRACE

### 8.1 Mobile Side

| Step | File | Function/Component | Lines |
|---|---|---|---|
| Entry modal | `components/MissionInstallationModal.js` | Component | 1-50+ |
| Route | `app/(tabs)/premises/form-meter-installation.js` | Screen | 1-10 |
| Form | `src/features/meters/FormMeterIstallation.js` | `FormMeterInstallation` | 1-2056 |
| TRN ID build | Same file | `buildMeterInstallationTrnId()` | — |
| Submit handler | Same file | `handleSubmitInstallation()` | ~853 |
| Callable invocation | Same file | `httpsCallable(functions, "onMeterInstallationCallable")` | In submit handler |

### 8.2 Backend Callable: `onMeterInstallationCallable`

**File:** `functions/index.js:4812`

**Flow:** Mirrors `onMeterDiscoveryCallable` with these differences:
- Uses `TRN_MINST_` prefix and `METER_INSTALLATION` TRN type
- Calls the same `validateMeterCreationPayload`, `normalizeMeterNo`, `classifyOperationalAstChange`
- Creates the same `asts` document shape
- No `onMeterInstallationCreated` trigger — writes happen directly in the callable transaction, not deferred to a trigger

### 8.3 Write Transaction (Access Branch)

```
db.runTransaction(async (tx) => {
  1. Read premises/{premiseId} — verify exists
  2. Read asts/{trnId} — check duplicate
  3. Read meter_master/{normalizedMeterNo}
  4. classifyOperationalAstChange → CREATE_FIELD_ONLY / UPDATE_AST_LINK / CONFLICT
  5. tx.create(trnRef, trnDoc)   → trns/{trnId}
  6. tx.create(astRef, astDoc)   → asts/{trnId}
  7. tx.update(premiseRef, ...)  → premises/{premiseId}
  8. tx.create/update(masterRef) → meter_master/{normalizedMeterNo}
  9. tx.update(erfRef)           → ireps_erfs/{erfId} (if applicable)
})
```

**No Access Branch:** Saves TRN only (no AST, no master, no premise update).

### 8.4 Comparison: Discovery vs Installation

| Aspect | Meter Discovery | Meter Installation |
|---|---|---|
| TRN Prefix | `TRN_MDIS_` | `TRN_MINST_` |
| TRN Type | `METER_DISCOVERY` | `METER_INSTALLATION` |
| Callable | `onMeterDiscoveryCallable` | `onMeterInstallationCallable` |
| AST Creation | Via trigger (`onMeterDiscoveryCreated`) | In callable transaction directly |
| AST shape | Same canonical shape | Same canonical shape |
| Meter Master | CREATE_FIELD_ONLY / UPDATE_AST_LINK | Same |
| Premise update | Services + occupancy | Same |
| ERF update | metadata | Same |
| TB completion | Via trigger | Not supported (no TB for INST) |
| Commissioning questions | Not collected | Collected (vending, switch-on, keypad) |
| Meter reading | Pre-filled if available | — |

**CONFIRMED CURRENT BEHAVIOUR:** Meter Discovery and Meter Installation ultimately create the **same canonical AST shape**. The `asts/{trnId}` document has identical structure: `accessData`, `ast`, `master`, `media`, `meterType`, `status`, `serviceProvider`, `trnId`. The only differences are in form-specific fields (commissioning vs reading prefill) and the TRN metadata.

---

## 9. NO ACCESS ASSESSMENT

### 9.1 No Access Creates a TRN

**YES — always.** Both standalone and TB paths create a TRN document in `trns/` collection.

| Path | TRN ID Pattern | TRN Type | meterType | ast |
|---|---|---|---|---|
| Standalone Discovery | `TRN_MDIS_{ts}_NA_{ward}_{erf}` | `METER_DISCOVERY` | `"NA"` | `null` |
| Standalone Installation | `TRN_MINST_{ts}_NA_{ward}_{erf}` | `METER_INSTALLATION` | `"NA"` | `null` |
| TB Sales | `TRN_MDIS_{ts}_NA_{random}` | `METER_DISCOVERY` | `"NA"` | `null` |

### 9.2 No AST is Created

**CONFIRMED CURRENT BEHAVIOUR:** No Access never creates an AST. The `ast` field is `null`, `meterType` is `"NA"`.

### 9.3 Evidence Stored

- `noAccessPhoto` (mandatory, via `IrepsNoAccessSection`)
- `reason` from `NO_ACCESS_REASONS` list (Locked Gate, Vicious Dogs, etc.)
- `location.gps` (lat/lng)
- `capturedAt` timestamp

### 9.4 Batch/Row/Workorder Status Changes (TB Only)

| Entity | Before | After |
|---|---|---|
| `tb_rows/{rowId}.execution.status` | `NOT_STARTED` | `IN_PROGRESS` (does NOT complete) |
| `tb_uploads/{tbId}.execution.status` | `NOT_STARTED` | `IN_PROGRESS` (if first row started) |
| `demo_sales_meters/{id}.tbRefs[].fieldWork.noAccess[]` | (array) | Appended with No Access entry |

**Retry/revisit is supported for TB:** The row stays `IN_PROGRESS`. Multiple No Access attempts accumulate in `fieldWork.noAccess[]`. The worker can return later. Blocked only if `fieldWork.meterId` is already set (meter was discovered in a prior attempt).

### 9.5 No Access in Lifecycle TRNs

Five lifecycle TRNs support No Access as an `executionOutcome`:
- Meter Reading, Inspection, Disconnection, Reconnection, Removal

Commissioning does NOT support No Access.

When No Access occurs in lifecycle: `executionOutcome.outcome = "NO_ACCESS"`, `astStatusChanged = false`, AST state unchanged.

### 9.6 No Access Firestore Side Effects

| Trigger | Collection | Action |
|---|---|---|
| `onNoAccessRecorded` | `premises/{premiseId}` | Appends `trnId` to `noAccessTrnIds[]` |
| `onTrnWritten` | `report_trn_no_access/{trnId}` | Denormalized report row |

### 9.7 No Access vs Meter Registration

| Aspect | Meter Registration (Access) | No Access |
|---|---|---|
| `meterType` | `"water"` / `"electricity"` | `"NA"` |
| `hasAccess` | `"yes"` | `"no"` |
| AST created | Yes | No |
| Meter Master check | Yes (conflict gate) | No |
| `ast` payload | Full AST data required | `null` |
| Reason | NAv | Required from fixed list |
| Photo | Not mandatory | Mandatory `noAccessPhoto` |
| Premise occupancy update | Yes (`"Accessed"`) | No |
| Report | Normal TRN report | `report_trn_no_access` |

---

## 10. POST-REGISTRATION TRN INVENTORY

### 10.1 Implemented Lifecycle TRNs

**Source:** `functions/meterLifecycle/helpers.js:16-25`

| # | TRN Type | Short Code | TRN Prefix | Implemented |
|---|---|---|---|---|
| 1 | `METER_DISCONNECTION` | MDCN | (generic, no fixed prefix for lifecycle) | ✅ Yes |
| 2 | `METER_RECONNECTION` | MRCN | (generic) | ✅ Yes |
| 3 | `METER_REMOVAL` | MREM | (generic) | ✅ Yes |
| 4 | `METER_READING` | MREAD | (generic) | ✅ Yes |
| 5 | `METER_INSPECTION` | MINSP | (generic) | ✅ Yes |
| 6 | `METER_COMMISSIONING` | — | `TRN_MCOM_` | ⚠️ Partial (own callable, not in BGO) |
| 7 | `METER_VENDING` | — | — | ❌ Not implemented |

### 10.2 Detailed TRN Profiles

#### METER_DISCONNECTION (DCN)

| Attribute | Value |
|---|---|
| Code name | `METER_DISCONNECTION` |
| Individual initiation | ✅ Yes — Office LCT (`onCreateMeterLifecycleInstructionCallable`) |
| Individual execution | ✅ Yes — `onMeterLifecycleTrnCallable` |
| Mobile form | ❌ No dedicated form; routed through `trn-origin` |
| BGO/Bulk | ✅ Yes — `trnFactory.js`, short code `MDCN` |
| TC Upload | ✅ Yes |
| Targeted Batch | ❌ No |
| Required AST? | ✅ YES |
| AST ID field | `data.ast.astData.astId` or instruction `astId` |
| Status BEFORE | `CONNECTED` only |
| Status AFTER | `DISCONNECTED` |
| Backend callable | `onMeterLifecycleTrnCallable` (`callables.js`) |
| Meter Master impact | `CONNECTED → DISCONNECTED` |
| Origin-independent? | ✅ Yes — generic |

#### METER_RECONNECTION (RECN)

| Attribute | Value |
|---|---|
| Code name | `METER_RECONNECTION` |
| Individual initiation/execution | ✅ Yes |
| Mobile form | ❌ No dedicated form |
| BGO/Bulk | ✅ Yes, short code `MRCN` |
| TC Upload | ✅ Yes |
| Required AST? | ✅ YES |
| Status BEFORE | `DISCONNECTED` only |
| Status AFTER | `CONNECTED` |
| Origin-independent? | ✅ Yes |

#### METER_REMOVAL (REM)

| Attribute | Value |
|---|---|
| Code name | `METER_REMOVAL` |
| Individual initiation/execution | ✅ Yes |
| Mobile form | ❌ No dedicated form |
| BGO/Bulk | ✅ Yes, short code `MREM` |
| TC Upload | ✅ Yes |
| Required AST? | ✅ YES |
| Status BEFORE | `FIELD`, `CONNECTED`, or `DISCONNECTED` |
| Status AFTER | `REMOVED` |
| Origin-independent? | ✅ Yes |

#### METER_READING (MREAD)

| Attribute | Value |
|---|---|
| Code name | `METER_READING` |
| Individual initiation/execution | ✅ Yes |
| Mobile form | ✅ **Has dedicated form**: `/(tabs)/asts/meter-reading` |
| BGO/Bulk | ✅ Yes, short code `MREAD` |
| TC Upload | ✅ Yes (conventional only) |
| Required AST? | ✅ YES |
| Status BEFORE | Any except `DECOMMISSIONED` and `REMOVED` |
| Status AFTER | Unchanged |
| Registry impact | ✅ Direct `registry_mread/{trnId}` write |
| GPS requirement | ✅ `readingGps` within tolerance of known meter GPS |
| Prepaid restriction | ✅ MREAD rejects prepaid (`PREPAID_MREAD_NOT_SUPPORTED`) |
| Origin-independent? | ✅ Yes |

#### METER_INSPECTION (INPS)

| Attribute | Value |
|---|---|
| Code name | `METER_INSPECTION` |
| Individual initiation | ✅ Yes — Office WMS only |
| Individual execution | ✅ Yes — must complete accepted instruction |
| Mobile form | ❌ No dedicated form |
| BGO/Bulk | ✅ Yes, short code `MINSP` |
| TC Upload | ✅ Yes |
| Required AST? | ✅ YES |
| Status BEFORE | `FIELD`, `CONNECTED`, `DISCONNECTED`, `REMOVED` |
| Status AFTER | Unchanged |
| Origin-independent? | ✅ Yes |

#### METER_COMMISSIONING (COMM)

| Attribute | Value |
|---|---|
| Code name | `METER_COMMISSIONING` |
| TRN prefix | `TRN_MCOM_` |
| Individual initiation | ✅ Yes — `onCreateMeterCommissioningCallable` |
| Mobile form | ✅ Yes — `/(tabs)/asts/commissioning` |
| BGO/Bulk | ❌ No |
| TC Upload | ❌ No |
| Required AST? | ✅ YES |
| Status BEFORE | `FIELD` only |
| Status AFTER | `CONNECTED` (via `onMeterCommissioningTrnCreated` trigger) |
| Evidence | `vendingEvidence`, `finalSwitchOnEvidence` |
| Origin-independent? | ✅ Yes — but coupled to FIELD→CONNECTED transition |

#### METER_VENDING (VEND)

**Status: NOT IMPLEMENTED.** Listed in `LIFECYCLE_TRN_TYPES` but not in `IMPLEMENTED_LIFECYCLE_TRN_TYPES`. No callable, no BGO support, no mobile form, no TC eligibility.

---

## 11. REGISTRATION MATRIX

| Capability | Path 1 Field | Path 2 Prepaid | Path 3 Conventional |
|---|---|---|---|
| Supplied meter list | N/A (no list) | ✅ `demo_sales_meters` | ❌ **NOT IMPLEMENTED** |
| Targeted Batch | ❌ (not used) | ✅ `PREPAID_SALES` source | ❌ **NOT IMPLEMENTED** |
| Meter Discovery | ✅ `TRN_MDIS_` | ✅ Same form + `targetedBatchContext` | ✅ Same form can register conventional (but no origin path) |
| Meter Installation | ✅ `TRN_MINST_` | ❌ (TB uses Discovery only) | ✅ Same form can register conventional (but no origin path) |
| No Access | ✅ Creates TRN | ✅ Separate callable (`recordTargetedBatchNoAccessCallable`) | ❌ (no origin path) |
| AST created | ✅ `asts/{trnId}` | ✅ Same, via `onMeterDiscoveryCreated` | ✅ Same AST shape (once registered) |
| Meter Master linked | ✅ `meter_master.refs.asts.id` | ✅ + `refs.sales.id` from TB completion | ✅ via field registration forms |
| Supplied source linked back | N/A | ✅ Multiple redundant paths | ❌ (no source to link) |

---

## 12. LIFECYCLE MATRIX

| TRN | Individual | Bulk/BGO | Requires AST | Changes AST Status | Meter Master Impact | Sales Impact | Origin-Independent |
|---|---|---|---|---|---|---|---|
| `METER_DISCONNECTION` | ✅ | ✅ | ✅ | ✅ CONNECTED→DISCONNECTED | Status change | None | ✅ |
| `METER_RECONNECTION` | ✅ | ✅ | ✅ | ✅ DISCONNECTED→CONNECTED | Status change | None | ✅ |
| `METER_REMOVAL` | ✅ | ✅ | ✅ | ✅ →REMOVED | Status change | None | ✅ |
| `METER_READING` | ✅ | ✅ | ✅ | ❌ Unchanged | mreadings cache updated | None | ✅ |
| `METER_INSPECTION` | ✅ (WMS only) | ✅ | ✅ | ❌ Unchanged | AST data may update | None | ✅ |
| `METER_COMMISSIONING` | ✅ (field only) | ❌ | ✅ | ✅ FIELD→CONNECTED | Status change | None | ✅ |
| `METER_VENDING` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| `METER_DISCOVERY` | ✅ | ✅ BGO/BMD | Registration (creates AST) | N/A | Creates/links master | Via TB completion | N/A (registration) |
| `METER_INSTALLATION` | ✅ | ✅ BGO | Registration (creates AST) | N/A | Creates/links master | N/A | N/A (registration) |

---

## 13. AST-CENTRIC LIFECYCLE — PASS / PARTIAL / FAIL

### CLASSIFICATION: **PASS**

**Evidence:**

The `onMeterLifecycleTrnCallable` (`functions/meterLifecycle/callables.js`) operates exclusively against `asts/{astId}`. It:
1. Reads `asts/{astId}` to get current AST state
2. Validates the TRN type against AST's current status
3. Updates `asts/{astId}` with new status/patches
4. Updates `premises/{premiseId}` services snapshot
5. Does NOT inspect meter origin, source module, or TB context

The `validateCommonLifecycleInput` function requires only: `trnId`, `trnType`, `astId`, `premiseId`. It does not require or inspect any origin-specific field.

Each validation function validates against AST state:
- Disconnection: `astDoc.status.state === "CONNECTED"`
- Reconnection: `astDoc.status.state === "DISCONNECTED"`
- Removal: `astDoc.status.state` in `[FIELD, CONNECTED, DISCONNECTED]`
- Commissioning: `astDoc.status.state === "FIELD"`
- Reading: `astDoc.status.state` not `DECOMMISSIONED` or `REMOVED`

These validations are purely state-based, not origin-based.

**No coupling to origin was found in any lifecycle TRN.**

---

## 14. ORIGIN-COUPLING FINDINGS

### 14.1 Targeted Batch Origin Coupling

**Finding:** `TARGETED_BATCH_SOURCE_TYPES` defines only `PREPAID_SALES` (`functions/targetedBatches/helpers.js:12-14`). The `TARGETED_BATCH_COLLECTIONS.sales` is hardcoded to `"demo_sales_meters"` (`helpers.js:7`).

**Impact:** A conventional/billing supplied meter cannot enter the iREPS workflow through Targeted Batch.

### 14.2 TB Validation Origin Coupling

**Finding:** `functions/targetedBatches/callables.js:459-467` validates that every TB row must reference a valid `demo_sales_meters` document and have `tbRefs`. This is a hard failure if the source document isn't in `demo_sales_meters`.

### 14.3 Premise Linkage Origin Coupling

**Finding:** `functions/targetedBatches/premiseLink.js:619-645` reads `demo_sales_meters` directly when linking premises. `SALES_DOCUMENT_NOT_FOUND` is a hard failure.

### 14.4 Source Type Default

**Finding:** `functions/targetedBatches/helpers.js:338` rejects any `sourceType` that is not `TARGETED_BATCH_SOURCE_TYPES.prepaidSales`. And `getDemoSalesMeterType` defaults to `"PREPAID"` when no explicit type exists.

### 14.5 No Lifecycle TRN Coupling Found

**Finding:** No lifecycle TRN (DCN, RECN, REM, MREAD, INPS, COMM) inspects the meter's source module, TB context, or sales origin. They operate purely on AST state.

---

## 15. METER MASTER / SALES ALL INTEGRATION FINDINGS

### 15.1 Meter Master Schema

**Collection:** `meter_master`
**Document ID:** `normalizeMeterNo(meterNo)` — uppercase, whitespace-stripped, alphanumeric

**Canonical Fields** (`functions/meterMaster/helpers.js:26-31`):
```
lmPcode          : string
meterNo          : { raw: string, normalized: string }
meterType        : string ("water" | "electricity")
customerNo       : string (default "")
accountNo        : string (default "")
refs             : {
  asts: { id: string },
  sales: { id: string, provider: string }
}
metadata         : { createdAt, createdByUid, createdByUser, updatedAt, updatedByUid, updatedByUser }
```

**Strict shape enforcement:** `hasExactKeys` prevents extra fields at root, within `meterNo`, `refs`, `refs.asts`, `refs.sales`, and `metadata`.

### 15.2 Sales All Meters Schema

**Collection:** `sales-all-meters`
**Document ID:** same normalized meter number

**Canonical Fields** (`functions/salesAllMeters/helpers.js:78-83`):
```
master            : { id: string, visibility: "VISIBLE" | "INVISIBLE" }
meterNo           : string
meterNoNormalized : string
provider          : string ("conlog")
customerNo        : string
accountNo         : string
totalAmountC      : integer (≥0)
monthlyTotalsC    : { "YYYY-MM": integer }
lastPurchaseAtISO : string | null
daysSinceLastPurchase : integer | null
```

### 15.3 Visibility Model

```js
function deriveMasterVisibility(masterData) {
  return astId && salesId ? "VISIBLE" : "INVISIBLE";
}
```
(`functions/index.js:1466-1469`)

| AST linked | Sales linked | Visibility |
|---|---|---|
| ✅ | ✅ | `VISIBLE` |
| ✅ | ❌ | `INVISIBLE` |
| ❌ | ✅ | `INVISIBLE` |
| ❌ | ❌ | `INVISIBLE` |

### 15.4 Generic Bridge Confirmed

The `meter_master` with its dual `refs.asts.id` and `refs.sales.id` already provides the correct generic bridge:

```
supplied meter → canonical meter number → meter_master →
  refs.asts → AST(s)
  refs.sales → sales-all-meters → demo_sales_meters
```

**CONFIRMED CURRENT BEHAVIOUR:** This bridge works for Path 1 (field-only: `refs.sales.id = ""`) and Path 2 (sales: `refs.sales.id = salesDocId`). It is structurally ready for Path 3 (conventional-supplied: `refs.sales.id = conventionalSourceId`).

### 15.5 syncSalesAllMetersFromMaster

**File:** `functions/index.js:1475-1532`

Does NOT auto-create `sales-all-meters` documents. If the sales doc doesn't exist but master has `refs.sales.id`, it logs a warning and returns `TARGET_MISSING`. The sales document must already exist from pipeline/source import.

---

## 16. CONFIRMED GAPS

| # | Gap | Classification | Impact |
|---|---|---|---|
| 1 | No conventional/billing source collection | NOT IMPLEMENTED | Path 3 cannot originate from billing data |
| 2 | `TARGETED_BATCH_SOURCE_TYPES` only has `PREPAID_SALES` | NOT IMPLEMENTED | No conventional TB creation |
| 3 | TB validation hard-couples to `demo_sales_meters` | NOT IMPLEMENTED | Cannot use alternative source |
| 4 | `getDemoSalesMeterType` defaults to `PREPAID` | CONFIRMED BEHAVIOUR | Unknown types become prepaid |
| 5 | No billing importer/adapter | NOT IMPLEMENTED | No data entry path for conventional lists |
| 6 | `METER_VENDING` TRN not implemented | NOT IMPLEMENTED | Listed but no code |
| 7 | Most lifecycle TRNs lack dedicated mobile forms | NOT IMPLEMENTED | Routed through generic `trn-origin` |
| 8 | `sales-all-meters` not auto-created for new sales refs | CONFIRMED BEHAVIOUR | Sales doc must pre-exist from pipeline |
| 9 | BGO doesn't support Commissioning or Installation lifecycle | NOT IMPLEMENTED | Limited bulk operations for those types |

---

## 17. RISKS

| Risk | Severity | Detail |
|---|---|---|
| TB source coupling | HIGH | Adding Path 3 requires substantial TB refactoring or duplication |
| `demo_sales_meters` as sole source | HIGH | The "temporary" nature of this collection is a long-term risk |
| `meter_master.refs.sales.id` empty for field meters | MEDIUM | Visibility is `INVISIBLE` until a sales link is established; no bulk backfill mechanism |
| No auto-create for `sales-all-meters` | MEDIUM | If a sales ref is written but the SAM doc doesn't exist, visibility stays broken |
| `sales-all-meters` visibility depends on both refs | MEDIUM | A meter with only AST (no sales) is permanently INVISIBLE in SAM |
| `TRN_MINST_` has no trigger path | LOW | Installation writes happen synchronously in the callable; discovery uses triggers. Inconsistent pattern could lead to different failure modes |
| Meter number is the join key across 3 collections | LOW | Normalization is consistent but changing the algorithm would require migration |
| Offline queue depends on callable name matching | LOW | `submissionQueue.js` must stay in sync with callable exports |

---

## 18. QUESTIONS REQUIRING BUSINESS DECISION

1. **Should `meter_master.refs.sales.id` be populated for conventional-supplied meters?** If Path 3 has a source collection (e.g., `billing_supplied_meters`), should the reference go into the existing `refs.sales.id` field or a new `refs.billing.id` field?

2. **Should a conventional-supplied meter with no sales data be VISIBLE or INVISIBLE in `sales-all-meters`?** The current visibility model requires BOTH AST and sales links.

3. **Should `TARGETED_BATCH_SOURCE_TYPES` be extended or should TB be made source-agnostic?** The current code anticipates `CONVENTIONAL` meter types but has no source type for them.

4. **Should Targeted Batch have a generic "meter source" abstraction?** Currently hardcoded to `demo_sales_meters`. A source-agnostic TB would accept any collection implementing a source adapter contract.

5. **Should `METER_VENDING` be implemented?** It's in the type list but has no code.

6. **Should lifecycle TRNs get dedicated mobile forms?** Currently only MREAD and COMM have dedicated forms. Others route through a generic `trn-origin` screen.

7. **Should the `sales-all-meters` document be auto-created when `meter_master.refs.sales.id` is populated?** Currently it's only updated, not created.

---

## 19. EVIDENCE INDEX

### Repository: ireps-web

| File | Function/Component | Line(s) | Purpose |
|---|---|---|---|
| `functions/index.js` | `onMeterDiscoveryCallable` | 3057 | MDIS callable gatekeeper |
| `functions/index.js` | `onMeterDiscoveryCreated` | 1593 | MDIS Firestore trigger, AST creation |
| `functions/index.js` | `onMeterInstallationCallable` | 4812 | MINST callable + transaction |
| `functions/index.js` | `validateMeterCreationPayload` | 1136 | Shared payload validation |
| `functions/index.js` | `deriveMasterVisibility` | 1466 | VISIBLE/INVISIBLE logic |
| `functions/index.js` | `syncSalesAllMetersFromMaster` | 1475 | SAM visibility sync |
| `functions/index.js` | `onNoAccessRecorded` | 1875 | No Access premise trigger |
| `functions/index.js` | `onMeterMasterUpdated` | 2592 | Master change trigger |
| `functions/meterMaster/helpers.js` | `normalizeMeterNo` | 56 | Meter number canonicalization |
| `functions/meterMaster/helpers.js` | `buildCanonicalFieldOnlyMeterMaster` | 115 | Field-only master creation |
| `functions/meterMaster/helpers.js` | `validateExistingMeterMaster` | 137 | Full master validation (12 checks) |
| `functions/meterMaster/helpers.js` | `classifyOperationalAstChange` | 242 | CREATE_FIELD_ONLY / UPDATE_AST_LINK / CONFLICT |
| `functions/meterMaster/helpers.js` | `buildOperationalAstUpdate` | 271 | AST link patch on master |
| `functions/salesAllMeters/helpers.js` | Schema + classify sync | 1-216 | SAM schema + validation |
| `functions/meterLifecycle/helpers.js` | `LIFECYCLE_TRN_TYPES` | 6-13 | All 7 TRN types |
| `functions/meterLifecycle/helpers.js` | `IMPLEMENTED_LIFECYCLE_TRN_TYPES` | 16-20 | 5 implemented |
| `functions/meterLifecycle/helpers.js` | `OFFICE_LCT_INSTRUCTION_TRN_TYPES` | 22-28 | 5 office types |
| `functions/meterLifecycle/helpers.js` | `validateCommonLifecycleInput` | 499 | AST ID + premise ID requirement |
| `functions/meterLifecycle/helpers.js` | `validateMeterDisconnection` | 2631 | CONNECTED→DISCONNECTED |
| `functions/meterLifecycle/helpers.js` | `validateMeterReconnection` | 2909 | DISCONNECTED→CONNECTED |
| `functions/meterLifecycle/helpers.js` | `validateMeterRemoval` | 1916 | →REMOVED |
| `functions/meterLifecycle/helpers.js` | `validateMeterReading` | 1059 | MREAD validation |
| `functions/meterLifecycle/helpers.js` | `validateMeterInspection` | 1551 | INSP validation |
| `functions/meterLifecycle/callables.js` | `onMeterLifecycleTrnCallable` | 1-894 | Full lifecycle callable |
| `functions/commissioning/callable.js` | `onCreateMeterCommissioningCallable` | — | COMM TRN creation |
| `functions/commissioning/trigger.js` | `onMeterCommissioningTrnCreated` | — | COMM Firestore trigger |
| `functions/targetedBatches/helpers.js` | `TARGETED_BATCH_COLLECTIONS` | 3-9 | TB collection constants |
| `functions/targetedBatches/helpers.js` | `TARGETED_BATCH_SOURCE_TYPES` | 12-14 | Only `PREPAID_SALES` |
| `functions/targetedBatches/helpers.js` | `TARGETED_BATCH_ALLOWED_METER_TYPES` | 23-26 | `PREPAID`, `CONVENTIONAL` |
| `functions/targetedBatches/premiseLink.js` | `completeTargetedBatchMeterDiscoveryInTransaction` | 1437 | TB completion in tx |
| `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` | `recordTargetedBatchNoAccess` | 307 | TB No Access |
| `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` | `SALES_TARGETED_BATCH_SOURCE_MODULE` | 13 | `"SALES_TARGETED_BATCH"` |
| `functions/bgo/trnFactory.js` | `buildInstructionText` | 18-33 | BGO TRN type mapping |
| `functions/bgo/helpers.js` | `getTrnShortCode` | 247-268 | Short code mapping |
| `functions/bgo/helpers.js` | `BGO_SOURCE` | 16 | `"BULK_GEOFENCE_ORIGIN"` |
| `functions/tcUploads/helpers.js` | `getEligibilityResult` | 386-455 | TC eligibility per type |

### Repository: ireps-mobile

| File | Function/Component | Line(s) | Purpose |
|---|---|---|---|
| `components/MissionDiscoveryModal.js` | Component | 1-42 | MDIS entry modal |
| `components/MissionInstallationModal.js` | Component | — | MINST entry modal |
| `src/features/meters/FormMeterDiscovery.js` | `FormMeterDiscovery` | 1-800+ | Full MDIS form |
| `src/features/meters/FormMeterIstallation.js` | `FormMeterInstallation` | 1-2056 | Full MINST form |
| `components/forms/ElectricitySections.js` | — | 127 | Meter type picker (`prepaid`/`conventional`) |
| `components/forms/WaterSections.js` | — | 51 | Same picker |
| `components/forms/FormInputMeterNo.js` | — | — | Meter number input + duplicate detection |
| `components/forms/IrepsNoAccessSection.js` | — | — | No Access reason + photo |
| `src/features/meters/noAccessReasons.js` | — | — | 9 fixed No Access reasons |
| `src/context/DiscoveryContext.js` | `openMissionDiscovery` | 23 | MDIS launch from premise |
| `src/context/InstallationContext.js` | — | — | MINST launch context |
| `src/features/targetedBatches/targetedBatchActions.js` | `TARGETED_BATCH_INTENTS` | — | `START_METER_DISCOVERY` |
| `src/features/premises/targetedBatchPremiseContext.js` | `TARGETED_BATCH_OPERATION_TYPE` | — | `"METER_DISCOVERY"` |
| `src/features/targetedBatches/targetedBatchNoAccess.js` | — | — | TB No Access form |
| `src/utils/submissionQueue.js` | `getCallableNameForSubmissionQueueItem` | 663 | Offline queue callable mapping |
| `src/features/asts/astItem.js` | Launch functions | 780-914 | Lifecycle TRN launch from AST |
| `src/redux/trnsApi.js` | `addTrn` | 51 | Optimistic TRN cache updates |
| `src/redux/lifecycleInstructionApi.js` | — | — | Lifecycle instruction Redux API |

### Repository: ireps-pipeline-sales (read-only)

| File | Purpose |
|---|---|
| Pipeline scripts | ETL from PSD → `demo_sales_meters` |
| `input/` | Raw PSD CSV/JSONL |
| `output/monthly_only/{lmPcode}/02_enriched_psd/` | Enriched output loaded to Firestore |

---

## LEGEND

| Label | Meaning |
|---|---|
| **CONFIRMED CURRENT BEHAVIOUR** | Verified by reading source code; behaviour is active in current codebase |
| **INFERENCE** | Reasonable conclusion from code structure, but not an explicit code path |
| **NOT IMPLEMENTED** | Code search confirms absence; no implementation exists |
| **UNKNOWN / REQUIRES MORE EVIDENCE** | Could not fully verify with available code |

---

*End of Assessment*
