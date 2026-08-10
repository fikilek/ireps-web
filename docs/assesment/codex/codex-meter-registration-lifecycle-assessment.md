# iREPS Meter Registration and Meter Lifecycle Assessment

**Agent:** Codex  
**Assessment date:** 2026-08-07  
**Scope:** Local working trees; read-only code/architecture assessment.  
**Evidence labels:** **CONFIRMED CURRENT BEHAVIOUR**, **INFERENCE**, **NOT IMPLEMENTED**, **UNKNOWN / REQUIRES MORE EVIDENCE**.

## 1. Repository state

Recorded before assessment. No repository content was altered except this report.

| Repository | Branch | HEAD | Pre-existing working-tree state |
|---|---|---|---|
| `C:\dev\ireps-web` | `main` | `860f44add153151232a775705c4e2c85a5bea7db` | Modified: `firestore.indexes.json`, Targeted Batch reset scripts/callables/pages, Sales reporting/map files. Untracked: multiple existing assessment/report directories, Targeted Batch helper/tests, Sales map/chart components. |
| `C:\dev\ireps-mobile` | `main` | `0e39d5a3d24af927d64cc39d212e6c0a8b455ac1` | Modified: Targeted Batch No Access screen/actions/API/tests, `IrepsNoAccessSection.js`, `FormMeterDiscovery.js`. Untracked: `skills.md`, `noAccessReasons.js`, streaming test. |

The assessment describes these local trees, including their uncommitted changes. Other agents' reports were not read.

## 2. Executive conclusion

**Overall finding: PARTIAL.**

The code already has a strong generic core: a successfully registered meter is an `asts/{trnId}` document, linked to `premises` through `accessData.premise.id`, to the ERF through `accessData.erfId`, and to `meter_master/{normalizedMeterNo}` through `master.id` / `refs.asts.id`. Implemented lifecycle execution validates and updates an AST by `ast.astData.astId`; it does not branch on whether registration originated in the field or in a Sales Targeted Batch.

However, the three proposed origins do not cleanly converge today:

- **Path 1 — field/FWR:** supported for Discovery and Installation, including No Access TRNs.
- **Path 2 — prepaid/vending supplied:** supported through the temporary `demo_sales_meters` → `tb_uploads` / `tb_rows` implementation and normal Meter Discovery. Source linkage is preserved in the TRN, TB row, and Sales `tbRefs`. Meter Master provides a useful bridge, but Sales All synchronization only occurs where an existing master carries `refs.sales.id` and a matching `sales-all-meters/{normalizedMeterNo}` document exists.
- **Path 3 — conventional/billing supplied:** **NOT SUPPORTED as an end-to-end origin path**. Registration forms and lifecycle logic understand a conventional meter classification, but no governed billing/conventional source collection, import, allocation, acceptance, or source-backlink path was found. The current Targeted Batch implementation is explicitly Sales-coupled and defaults temporary source rows to `PREPAID`.

Discovery and Installation use the same identity rule (`AST ID = registration TRN ID`) and broadly similar AST envelopes, but they are not equivalent writers. Discovery derives AST/master/sales/premise/ERF changes in a trigger transaction; Installation writes TRN/AST/master/premise/ERF directly. Discovery explicitly synchronizes Sales All and sets premise occupancy to `Accessed`; Installation updates the premise service bucket and hard-codes initial AST status `FIELD` and master visibility `VISIBLE`. This duplicated registration logic is the principal obstacle to claiming one canonical registration mechanism.

## 3. Current registration architecture diagram

```text
WORK ORIGIN                         WORK DELIVERY
Field/FWR -----------------------> individual mobile action
demo_sales_meters -> TB ----------> allocated/accepted TB row
BMD/BGO --------------------------> bulk geofence work
Billing/conventional list --------> NOT IMPLEMENTED
                                         |
                                         v
METER REGISTRATION
Premise -> normal Meter Discovery form -> onMeterDiscoveryCallable
                                         -> trns/TRN_MDIS_...
                                         -> onMeterDiscoveryCreated trigger
                                         -> transaction: AST + meter_master + optional
                                            sales-all-meters sync + premise/ERF + TB completion

Premise -> Meter Installation form ----> onMeterInstallationCallable
                                         -> transaction: TRN + AST + meter_master
                                            + premise service bucket + ERF metadata

No Access ------------------------------> TRN only; no AST
TB No Access ---------------------------> METER_DISCOVERY TRN + TB/Sales progress; no AST

SUCCESSFUL REGISTRATION
trns/{trnId} <== identity ==> asts/{trnId}
asts.master.id -> meter_master/{normalizedMeterNo}
meter_master.refs.sales.id -> supplied Sales identity
meter_master.refs.asts.id -> AST
                                         |
                                         v
POST-REGISTRATION
INSP / DCN / RCN / REM / MREAD (+ separate commissioning)
operate on AST ID and premise; BGO can pre-create lifecycle instruction TRNs.
VEND is named but no executable lifecycle implementation was found.
```

Concept separation:

| Concept | Current representation |
|---|---|
| Work origin | `sourceModule`, `origin`, `targetedBatchContext`, BGO fields |
| Work delivery | individual UI; office instruction; TB allocation/acceptance; BGO batch/child TRNs |
| Registration | `METER_DISCOVERY`, `METER_INSTALLATION` |
| Execution outcome | access block and/or `executionOutcome`; No Access does not register an AST |
| Post-registration lifecycle | lifecycle TRN references `ast.astData.astId`; AST state is authoritative for eligibility/transitions |

## 4. Path 1 assessment — field/FWR origin

**CONFIRMED CURRENT BEHAVIOUR — SUPPORTED.** From a saved premise, mobile routes to Discovery or Installation. Both forms build client IDs (`TRN_MDIS_...`, `TRN_MINST_...`), capture access, meter, GPS/media and reading/token-reading data, and call their respective Firebase callable. Both enforce a real premise on the server. Successful access creates a TRN and AST; No Access creates a TRN and no AST.

Field registration has no dependency on Sales data. When no Meter Master exists, both paths can create a field-only master with blank `refs.sales`; thus field work remains independently operable.

Material caveat: Discovery and Installation do not produce identical side effects (sections 7–8).

## 5. Path 2 assessment — prepaid/vending supplied origin

**CONFIRMED CURRENT BEHAVIOUR — SUPPORTED, WITH TEMPORARY SALES COUPLING.**

- Authoritative Targeted Batch source is currently `demo_sales_meters` (`TARGETED_BATCH_COLLECTIONS.sales`). `tb_uploads` owns the parent batch and `tb_rows` owns work rows.
- The source row identity is carried as `salesAllMeterId` / `source.recordId` and must correlate to `targetedBatchContext.salesDocId`.
- TB allocation/acceptance exposes allocated rows to mobile. The context passed through ERF/premise navigation contains `tbId`, `rowId`, `salesDocId`, `erfId`, targeted meter number, and return route.
- The normal `FormMeterDiscovery` is used; it pre-fills `ast.astData.astNo` from `targetedMeterNo`. There is no special Targeted Batch registration TRN type.
- Submission is validated against parent, row, Sales source, ERF, premise, actor allocation and meter correlations before the TRN is accepted.
- On successful AST derivation, the same transaction completes `tb_rows.execution`, writes `refs.premiseId`, `refs.meterId` (AST ID), `refs.trnId`, and updates the supplied Sales record's `tbRefs[].fieldWork` with targeted/discovered meter numbers and match flag.
- A mismatch is recorded as `meterMatch: false`; it is not silently rewritten into equality.

### Meter Master / Sales bridge

The intended bridge is substantially present:

```text
supplied meter identity
 -> normalized meter number
 -> meter_master/{normalizedMeterNo}
      refs.sales.id      (supplied Sales identity)
      refs.asts.id       (registered AST)
 -> sales-all-meters/{normalizedMeterNo}
```

But it is conditional, not universal. A field-only master is created with an empty Sales reference. `syncSalesAllMetersFromMaster` updates an existing `sales-all-meters` document only from validated master truth; a missing Sales All target is logged, not created. Consequently, Targeted Batch source traceability is strongest in `targetedBatchContext`, `tb_rows`, and `demo_sales_meters.tbRefs`, while Meter Master/Sales All linkage depends on prior Sales pipeline population.

## 6. Path 3 assessment — conventional/billing supplied origin

**Classification: NOT SUPPORTED.**

**CONFIRMED CURRENT BEHAVIOUR:**

- Discovery/Installation can register `ast.astData.meter.type = conventional`.
- Inspection, removal, disconnection and reconnection distinguish conventional readings from prepaid token readings. MREAD is explicitly conventional-only in its current backend validator.
- Meter Master itself is not inherently prepaid-only: it stores normalized meter number, physical service `meterType` (`water`/`electricity`), AST and Sales references.

**NOT IMPLEMENTED:** No billing-system/conventional supplied-meter collection, importer, governed source adapter, Targeted Batch source type, allocation/acceptance path, or completion backlink was found. The current TB helper names `demo_sales_meters` as temporary Prepaid Sales truth and defaults absent explicit type to `PREPAID`. TB validation requires a Sales document and `salesDocId`, and completion writes Sales `tbRefs`.

Therefore, field registration of a conventional meter exists, but **supplied conventional work origination does not**. The generic portions are the registration form and Meter Master identity; the work-supply and traceability portions are absent.

## 7. Meter Discovery full code trace

### Mobile/UI → client call

1. `app/(tabs)/premises/form.js` renders `FormMeterDiscovery`.
2. `FormMeterDiscovery.js` creates `TRN_MDIS_{timestamp}_{WTR|ELC}_{ward}_{erf}` and builds `accessData`, `ast`, status, media, service provider and initial reading/token reading. A Targeted Batch context is parsed from the route/queue, targeted meter number pre-fills `ast.astData.astNo`, and the canonical context is attached to the payload.
3. `handleSubmitDiscovery` validates premise readiness, uploads media, calls `onMeterDiscoveryCallable`, and queues the same payload on timeout/offline. Queue replay selects `onMeterDiscoveryCallable` by form/TRN type.

### Callable → TRN creation

4. `onMeterDiscoveryCallable` requires authentication, normalizes the meter number by removing whitespace, uppercasing, and restricting to alphanumerics, validates TRN type/prefix/status and saved premise, treats an existing identical TRN ID idempotently, validates Targeted Batch context when present, and rejects governed Meter Master conflicts.
5. It writes `trns/{data.id}` with server-authored flat metadata. The single callable write is not a multi-document transaction.

### Trigger → canonical derived records

6. `onMeterDiscoveryCreated` listens to all `trns/{trnId}`, exits unless type is `METER_DISCOVERY`, access is `yes`, and an AST payload exists. Thus No Access remains a TRN only.
7. It revalidates, normalizes meter number again, and sets `astId = trnId`.
8. One Firestore transaction reads AST, Meter Master and Sales All; validates/completes TB work if context exists; classifies master create/update/conflict; creates `asts/{trnId}` if absent; creates or links `meter_master/{normalizedMeterNo}`; synchronizes an existing `sales-all-meters/{normalizedMeterNo}` from master truth; marks premise occupancy `Accessed`; writes `trns.derived.astId/master/targetedBatch`; and touches ERF metadata.
9. After commit it rebuilds ERF meter/TRN counts and premise meter counts/registry row. Independent `asts/{astId}` create/update triggers rebuild meter/ward registries, geofence membership, premise service snapshot and related registry/account views.

### Identity and relationship answers

| Question | Current answer |
|---|---|
| Meter normalization | `meterMaster/helpers.js::normalizeMeterNo`: remove whitespace, uppercase, alphanumeric only. TB has a looser helper (uppercase/remove whitespace), so validation domains are not identical. |
| AST ID generation | Client creates TRN ID; backend uses exactly that `trnId` as AST document ID and `ast.astData.astId`. |
| TRN ↔ AST | Same document ID; TRN `derived.astId`; AST `trnId`. |
| AST ↔ Premise | AST `accessData.premise.id`; premise derived counts/registry. Discovery does not explicitly append its service bucket in the registration transaction. |
| AST ↔ ERF | AST `accessData.erfId`; ERF metadata and rebuilt counts. |
| AST ↔ Meter Master | AST `master.id`; master `refs.asts.id`. |
| Meter Master ↔ Sales All | master `refs.sales.id/provider`; normalized document ID; Sales All visibility/status patch derived from master. |
| Source preserved | TB context on TRN; TRN `derived.targetedBatch`; TB row refs; Sales `tbRefs.fieldWork`. Field origin otherwise follows registration metadata/source fields. |
| Conflict handling | Existing master with incompatible normalized identity, LM, physical meter type or a different AST link is rejected; AST creation is idempotent by ID. |

## 8. Meter Installation full code trace

1. `app/(tabs)/premises/form-meter-installation.js` renders the misspelled implementation file `FormMeterIstallation.js`.
2. The form builds `TRN_MINST_...`, gathers the same broad meter/access/media/readings envelope, calls `onMeterInstallationCallable`, and queues on timeout/offline.
3. The callable authenticates, normalizes number, validates `METER_INSTALLATION` / `TRN_MINST_`, and requires a saved premise.
4. **No Access:** directly writes a TRN with `ast: null`, `meterType: NA`; returns `NO_ACCESS_RECORDED`; no AST is created.
5. **Success:** sets status to `FIELD`; sets `astId = trnId`; checks duplicate AST by `master.id`; builds TRN and AST; then one transaction reads TRN/AST/master/premise, applies Meter Master conflict rules, creates/links master, creates TRN and AST, appends/updates the premise electricity/water service snapshot (`trnId`, status), and touches ERF metadata.
6. AST create triggers provide downstream meter/ward registry and geofence rebuild side effects.

### Discovery versus Installation canonical shape

**PARTIAL EQUIVALENCE.** Both successful paths create ASTs containing `accessData`, nested `ast.astData.astId`, creation readings, media, `meterType`, `trnId`, `master`, metadata, status and service provider. Both use normalized Meter Master identity and `AST ID = TRN ID`.

Material differences:

| Concern | Discovery | Installation |
|---|---|---|
| Write topology | Callable writes TRN; create trigger derives records | Callable transaction writes all primary records |
| Initial status | accepts submitted `CONNECTED`/`DISCONNECTED` status | hard-coded `FIELD` |
| Premise | marks `occupancy.status = Accessed` | appends/updates service bucket; does not set occupancy in shown transaction |
| Sales All | explicit master-driven sync | no explicit Sales All read/sync |
| Targeted Batch | validates and completes normal Discovery TB | no Targeted Batch context/completion path |
| Master visibility | derived from both AST and Sales refs | AST document hard-coded `VISIBLE`, even a newly created field-only master has blank Sales ref |
| Post-commit explicit counts | ERF/premise count rebuilds in Discovery trigger | relies on AST triggers/other rebuild logic |

Accordingly, these are duplicated registration writers with a shared identity model, not one generic registration mechanism.

## 9. No Access assessment

No Access is an **execution outcome**, not registration.

| Context | TRN behavior | AST | Work-state/evidence/retry |
|---|---|---|---|
| Normal Discovery | `onMeterDiscoveryCallable` stores the submitted `METER_DISCOVERY` TRN; creation trigger exits because `hasAccess != yes` | None | Reason/media captured by form; premise statistics use No Access TRN IDs. A later attempt uses a new registration TRN; no server retry state machine was found. |
| Normal Installation | callable writes `METER_INSTALLATION` TRN with `ast:null`, `meterType:NA` | None | Reason + `noAccessPhoto`; returns success code. Revisit is a later transaction, not conversion of this TRN. |
| Sales Targeted Batch | dedicated `recordTargetedBatchNoAccessCallable` creates a `METER_DISCOVERY` No Access TRN and atomically appends Sales `tbRefs[].fieldWork.noAccess`, sets row/parent to `IN_PROGRESS`, increments count | None | Requires reason, photo/media and location/correlation. Multiple attempts are appended; discovery can later complete the same row. No Access is explicitly origin-coupled here because Sales and TB documents are mandatory. |
| Lifecycle instruction | completion updates the pre-existing instruction TRN to `COMPLETED`, stores `executionOutcome=NO_ACCESS` and evidence | Existing AST retained | AST state unchanged; instruction is consumed/completed. Reissue/revisit requires a new instruction. |
| BGO/BMD | **PARTIAL / UNKNOWN.** BGO child lifecycle TRNs use the generic lifecycle No Access completion. BMD creates/uses Meter Discovery work, but no separate BGO-specific No Access registration callable was identified. | None for registration No Access | BGO execution summary trigger counts child outcomes; exact BMD mobile retry UX requires runtime evidence. |

## 10. Post-registration TRN inventory

| Current TRN | Prefix/type | Individual | Bulk/BGO | Targeted Batch | AST / relationships | State transition | Backend / mobile / evidence | External impacts and coupling |
|---|---|---:|---:|---:|---|---|---|---|
| Commissioning | `METER_COMMISSIONING` (client-generated commissioning ID; separate callable) | YES | No confirmed BGO factory case | NO | Requires AST; route receives AST/premise/ERF | Commissioning-specific updates; separate implementation | `onCreateMeterCommissioningCallable`; `asts/commissioning.jsx`; commissioning answers/photos | AST-centric, separate from generic lifecycle callable; no Sales-origin dependency found. |
| Inspection (INSP) | `METER_INSPECTION`; BGO short `INSP` | Office instruction/execution YES; direct field execution rejected | YES | NO | `ast.astData.astId`; premise from AST access data; ERF copied into access block | Status unchanged; may refresh conventional reading cache | instruction + `onMeterLifecycleTrnCallable`; `asts/inspection.js`; No Access photo or meter/anomaly/normalisation/reading evidence | AST/registry consequences only; origin-independent. Inspection is office/WMS-instruction-only. |
| Disconnection (DCN) | `METER_DISCONNECTION`; `DCN` | YES (instruction) | YES | NO | AST required | `CONNECTED → DISCONNECTED`; No Access unchanged | generic lifecycle callable; `asts/disconnection.jsx`; disconnection/safety/reading or token/no-access evidence | Updates AST/premise service snapshot/registries; no source-origin test. |
| Reconnection (RCN; business request says RECN) | `METER_RECONNECTION`; code short `RCN` | YES | YES | NO | AST required | `DISCONNECTED → CONNECTED`; No Access unchanged | generic callable; `asts/reconnection.jsx`; reconnection/safety/reading/token/no-access evidence | AST-centric and origin-independent. |
| Removal (REM) | `METER_REMOVAL`; `REM` | YES | YES | NO | AST required | `FIELD|CONNECTED|DISCONNECTED → REMOVED`; No Access unchanged | generic callable; `asts/removal.jsx`; removal, safety, reading/token or No Access evidence | AST-centric; master/sales mutation not performed by lifecycle callable. Registry follows AST update. |
| Meter reading (MREAD) | `METER_READING`; `MREAD` | YES (office; field path also exposed) | YES | NO | AST required | Status unchanged; successful reading updates AST `mreadings` | generic callable; `asts/meter-reading.js`; reading photo/GPS or No Access/no-reading evidence | Current backend rejects prepaid (`PREPAID_MREAD_NOT_SUPPORTED`); generic by origin but coupled to conventional meter kind. Registry MREAD staging is updated after success. |
| Vending (VEND) | `METER_VENDING` is a known/display/filter type | NO executable path found | NO | NO | UNKNOWN | UNKNOWN | **NOT IMPLEMENTED** in `IMPLEMENTED_LIFECYCLE_TRN_TYPES`; no mobile execution route/callable found | Sales reports/history display vending, but that is not a field lifecycle TRN implementation. |

No Targeted Batch initiation was found for post-registration lifecycle TRNs; TB is currently a Meter Discovery work-origin mechanism. BGO factory/helper code supports the five generic lifecycle instruction types above and normal BMD Discovery.

## 11. Registration matrix

| Capability | Path 1 Field | Path 2 Prepaid | Path 3 Conventional |
|------------|--------------|----------------|---------------------|
| Supplied meter list | No / not required | YES: `demo_sales_meters` temporary source | **NOT IMPLEMENTED** |
| Targeted Batch | Not required | YES | **NOT IMPLEMENTED** end-to-end |
| Meter Discovery | YES | YES, normal Discovery | YES as field capture only; no supplied-list path |
| Meter Installation | YES | No TB execution linkage found | Field form can install conventional; no supplied-list linkage |
| No Access | YES, TRN only | YES, dedicated TB callable + retry history | Field No Access only; no supplied work row |
| AST created | YES on success | YES on successful Discovery | YES only if independently field-registered |
| Meter Master linked | YES | YES by normalized number | YES for field registration |
| Supplied source linked back | N/A | YES in TB/TRN/Sales `tbRefs`; conditional through master/Sales All | **NOT IMPLEMENTED** |

## 12. Lifecycle matrix

| TRN | Individual | Bulk/BGO | Requires AST | Changes AST status | Meter Master impact | Sales impact | Origin-independent |
|-----|------------|----------|--------------|--------------------|---------------------|--------------|-------------------|
| MCOM | YES | NO confirmed | YES | Commissioning-specific | No direct write found | None | YES |
| INSP | YES, instruction | YES | YES | NO | None direct | None | YES |
| DCN | YES, instruction | YES | YES | CONNECTED → DISCONNECTED | None direct | None | YES |
| RCN | YES, instruction | YES | YES | DISCONNECTED → CONNECTED | None direct | None | YES |
| REM | YES, instruction | YES | YES | → REMOVED | None direct | None | YES |
| MREAD | YES | YES | YES | NO | None direct | None | YES by origin; conventional-only by meter kind |
| VEND | NO | NO | UNKNOWN | NOT IMPLEMENTED | Display/report only | Sales is source of displayed history | NO executable TRN |

## 13. AST-centric lifecycle finding

**Classification: PASS for implemented post-registration lifecycle execution; PARTIAL for the requested end-to-end architecture.**

The five generic lifecycle implementations resolve and validate `ast.astData.astId`, load `asts/{astId}` and `premises/{premiseId}` in a transaction, enforce eligibility from AST state/type, update the instruction TRN and AST, and never require `sourceModule`, `targetedBatchContext`, Sales record or BGO provenance for execution. BGO affects delivery and instruction identity, not business-state validation. This satisfies the quoted AST-centric principle for an AST that already exists.

The overall target remains PARTIAL because Path 3 cannot currently originate supplied work and registration has two materially different writers. MREAD's conventional-only rule is meter-kind coupling, not origin coupling.

## 14. Origin-coupling findings

1. **CONFIRMED:** Targeted Batch is explicitly `SALES_TARGETED_BATCH`; validation and No Access require `salesDocId` and `demo_sales_meters`. It cannot accept a non-Sales supplied record unchanged.
2. **CONFIRMED:** TB completion is embedded in the Discovery AST trigger transaction. This is appropriate correlation but is an origin-specific branch inside one registration writer.
3. **CONFIRMED:** Installation has no corresponding TB/source-context branch.
4. **CONFIRMED:** Lifecycle execution has no Sales/TB/BGO-origin branch; it is AST-centric.
5. **CONFIRMED:** Inspection must execute an accepted office-originated instruction. That is delivery coupling, not registration-origin coupling.
6. **CONFIRMED:** MREAD is conventional-only at backend despite mobile UI knowing token readings. That is a capability limitation, not a supplied-source dependency.

## 15. Meter Master / Sales All integration findings

**Ownership:** `meter_master/{normalizedMeterNo}` is the identity/link hub. Operational registration owns `refs.asts.id`; the Sales pipeline owns/populates `refs.sales`. `sales-all-meters/{normalizedMeterNo}` is a projection/visibility target, not registration truth.

Discovery's master-driven sync validates the master, derives visibility (`VISIBLE` only when AST and Sales refs both exist), and patches an existing Sales All row. A master update trigger repeats this synchronization. It deliberately does not fabricate a missing Sales All document. Conflict objects record exact document/path evidence.

**Risk:** Installation writes AST `master.visibility: VISIBLE` without deriving it from both master links, and does not call Sales All sync. That can disagree with the bridge invariant used by Discovery.

## 16. Confirmed gaps

- No conventional/billing supplied-meter ingestion or targeting implementation.
- No generic source abstraction for TB; current source is hard-wired to `demo_sales_meters` and `salesDocId`.
- Registration is duplicated between Discovery trigger and Installation callable.
- Discovery and Installation differ in status, premise services/occupancy, Sales sync, TB completion and visibility semantics.
- No executable `METER_VENDING` lifecycle TRN despite enum/filter/report presence.
- No Targeted Batch lifecycle initiation after registration.
- MREAD backend is conventional-only.
- Discovery callable completion is asynchronous: callable success confirms TRN write, not guaranteed AST derivation; governed trigger conflicts are logged after client success.

## 17. Risks

- **Split canonical state:** equal meter payloads can yield different premise and visibility projections depending on registration route.
- **Asynchronous failure:** Discovery may acknowledge success before its trigger encounters a master/Sales conflict.
- **Normalization mismatch:** Meter Master permits only alphanumerics; TB normalization merely removes whitespace, so punctuation can survive TB identity but fail registration.
- **Temporary source becoming de facto schema:** `demo_sales_meters` and Sales-specific fields are embedded in validation/completion logic.
- **No Access analytics ambiguity:** normal No Access, TB attempt history, and lifecycle instruction No Access use related but distinct structures and completion meanings.
- **Status vocabulary:** `FIELD`, `CONNECTED`, `DISCONNECTED`, `REMOVED`, and checks for `DECOMMISSIONED` coexist; removal transitions to `REMOVED`, not `DECOMMISSIONED`.

## 18. Questions requiring business decision

These are questions, not design proposals:

1. Must successful Discovery and Installation have identical initial status, premise-service and Sales visibility semantics?
2. Is a supplied meter-number mismatch in Targeted Batch allowed to complete as `meterMatch:false`, or should it block registration?
3. Is `REMOVED` the final lifecycle state, or is a separate `DECOMMISSIONED` transition required?
4. Should No Access complete a work instruction or leave it revisit-open? Current TB and lifecycle behavior differ.
5. Is VEND intended to be an executable iREPS TRN or only imported Sales/vending history?
6. Should prepaid MREAD remain unsupported even though several lifecycle forms collect token readings?
7. Which future system is authoritative for supplied conventional records? No current collection answers this.

### Data ownership and bridge fields

| Entity / collection | Current owner and bridge fields |
|---|---|
| TRN / `trns` | Immutable/updated execution evidence. `id`, `accessData.trnType`, `accessData.premise.id`, `accessData.erfId`, `ast.astData.astId`, `derived.astId`, `targetedBatchContext`, `bgo`, `workflow`, `executionOutcome`. |
| AST / `asts` | Registered physical meter and lifecycle state. Document ID = registration TRN ID; `trnId`, `master.id`, `accessData.premise.id`, `accessData.erfId`, `status.state`, reading caches, active lifecycle. |
| Premise / `premises` | Site/service relationship. `erfId`, `services.{electricityMeters|waterMeters}[].trnId`, occupancy and registry counters. |
| ERF / `ireps_erfs` | Land/geographic parent. AST/TRN bridge is primarily through their `accessData.erfId`; derived counts/metadata are rebuilt. |
| Meter Master / `meter_master` | Normalized meter identity/link authority. Document ID and `meterNo.normalized`, `refs.asts.id`, `refs.sales.id/provider`, `lmPcode`, physical `meterType`. |
| Sales All / `sales-all-meters` | Sales/reporting projection keyed by normalized meter number. Updated from validated master truth; relationship via master Sales/AST refs. |
| Targeted Batch / `tb_uploads` | Parent allocation/execution owner. `id/tbId`, source/operation type, allocation target, counts/status. |
| Targeted Batch row / `tb_rows` | Per-supplied-meter work unit. `rowId`, `salesAllMeterId`/`source.recordId`, meter number, `refs.erfId/premiseId/meterId/trnId`, allocation/execution. |
| Sales source / `demo_sales_meters` | Temporary prepaid supplied-row authority. `tbRefs[]` retains batch/row/allocation and `fieldWork` attempts/completion. |
| BGO / `bgo_batches`, `bgo_rows`, child `trns` | Bulk delivery/instruction owner. Batch/row/TRN IDs, AST ID, operation type and workflow; AST remains lifecycle truth. |

## 19. Evidence index

Line numbers refer to the assessed local working trees and may move after edits.

| Repository | File | Function/component | Relevant lines / evidence |
|---|---|---|---|
| mobile | `app/(tabs)/premises/form.js` | route | 1–4: Discovery form entry |
| mobile | `app/(tabs)/premises/form-meter-installation.js` | route | 1–4: Installation form entry |
| mobile | `src/features/meters/FormMeterDiscovery.js` | `buildMeterDiscoveryTrnId`, `FormMeterDiscovery`, `handleSubmitDiscovery` | 54–69 ID; 132–160 TB context; 836–852 target prefill; 890–1259 payload/call/queue; 1466–1469 form submit |
| mobile | `src/features/meters/FormMeterIstallation.js` | ID builder, `handleSubmitInstallation` | 48–63 ID; 853–1200 payload/call/queue; 1441–1444 submit |
| mobile | `src/utils/submissionQueue.js` | callable selector | 655–687: TB NA, Discovery, Installation, lifecycle and commissioning replay |
| web | `functions/meterMaster/helpers.js` | `normalizeMeterNo`, master builders/classifier | 56–61 normalization; 118–128 field-only master; 268–294 AST link/conflict |
| web | `functions/index.js` | `syncSalesAllMetersFromMaster` | 1467–1519: visibility and existing Sales All sync |
| web | `functions/index.js` | `onMeterDiscoveryCreated` | 1535–1859: trigger guards, identity, transaction, AST/master/sales/premise/ERF/TB, rebuilds |
| web | `functions/index.js` | `onMeterDiscoveryCallable` | 3057–3254: authentication, validation, premise/master/TB gates, TRN write |
| web | `functions/index.js` | AST triggers | 3924–4170: geofence, meter/ward registry and related derived rebuilds |
| web | `functions/index.js` | `onMeterInstallationCallable` | 4812–5190; especially 4925–4943 No Access, 4946–5007 AST, 5031–5148 transaction, 5161–5167 result |
| web | `functions/targetedBatches/helpers.js` | collections/source typing | 4–10 collections; 630–651 meter/type (`demo_sales_meters`, default PREPAID); 800+ source correlation |
| web | `functions/targetedBatches/premiseLink.js` | TB submission/completion | 1122–1300 validation; 1300–1421 Sales `tbRefs`; 1437–1670 transactional completion and row refs |
| web | `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` | `buildTrn`, `recordTargetedBatchNoAccess` | 270–304 TRN; 307–410 transaction, correlation, append/retry state |
| mobile | `src/redux/targetedBatchApi.js` | TB row/workorder API | 190+ presentation; 282–343 No Access count and linked AST; 402–602 live batch/acceptance API |
| mobile | `src/features/premises/targetedBatchPremiseContext.js` | context normalization | complete file: permitted Sales TB context and routing fields |
| web | `functions/meterLifecycle/helpers.js` | lifecycle constants | 3–28: known vs implemented types; VEND known but not implemented |
| web | `functions/meterLifecycle/helpers.js` | validators | ~1030–1285 MREAD; ~1550–1909 INSP; ~1909–2182 REM; ~2600–2905 DCN; ~2920–3185 RCN; 3259–3330 eligibility |
| web | `functions/meterLifecycle/callables.js` | `onMeterLifecycleTrnCallable` | 198–246 dispatch; 250–335 common AST/premise gates; 496–694 completion/state/evidence; 856+ MREAD registry write |
| web | `functions/meterLifecycle/instructionCallable.js` | `onCreateMeterLifecycleInstructionCallable` | 228–528: individual instruction, AST/premise transaction and duplicate-active guard |
| web | `functions/meterLifecycle/manageInstructionCallable.js` | managed types/workflow | 19–25 types; 457–845 reassignment/cancel, AST active lifecycle |
| web | `functions/meterLifecycle/acceptRejectCallable.js` | acceptance | 321–652: instruction acceptance/rejection and AST linkage |
| web | `functions/bgo/helpers.js` | `getTrnShortCode`, BMD validation | 245–320 lifecycle short codes/IDs; 633–781 BMD special mode |
| web | `functions/bgo/trnFactory.js` | child/batch builders | 17–110 instructions/drafts; 283–470 AST lifecycle child TRNs; 596–795 BMD batch |
| mobile | `src/features/asts/astItem.js` | AST action launcher | 407–431 names; 721–735 eligibility/progress; 791–925 AST/premise route payloads |
| mobile | `app/(tabs)/asts/inspection.js` | inspection execution | 2193–2411 AST/TRN payload/queue; 2635–2652 callable |
| mobile | `app/(tabs)/asts/disconnection.jsx` | disconnection execution | 1261–1335 AST/access payload; submission later in same file |
| mobile | `app/(tabs)/asts/reconnection.jsx` | reconnection execution | ~1150–1310 AST/action payload; submission later in same file |
| mobile | `app/(tabs)/asts/removal.jsx` | removal execution | ~1150–1310 AST/action payload; submission later in same file |
| mobile | `app/(tabs)/asts/meter-reading.js` | reading execution | ~1330–1540 classification/payload; ~1900+ validation/submission |
| mobile | `app/(tabs)/asts/commissioning.jsx` | commissioning | 589–793 AST/TRN/queue; later callable submission |

### Confidence boundaries

- **CONFIRMED CURRENT BEHAVIOUR:** all primary registration, Sales TB, master bridge, lifecycle state and No Access conclusions above are directly supported by the cited local code.
- **INFERENCE:** independent AST triggers will run after Installation's AST creation in deployed Firestore; this follows trigger definitions but was not executed in this read-only assessment.
- **NOT IMPLEMENTED:** Path 3 supplied origin and executable VEND were absent from exhaustive repository searches and implemented-type lists.
- **UNKNOWN / REQUIRES MORE EVIDENCE:** production data population quality, deployed-function version parity, security-rule permission at runtime, and exact BMD revisit UX cannot be established from code alone.
