# iREPS Demo Sales to Sales All Migration Design Review — Codex

Assessment date: 2026-08-08  
Assessment basis: exact current local working trees; read-only inspection; no external reports consulted.  
Finding labels: **CONFIRMED CURRENT BEHAVIOUR**, **INFERENCE**, **NOT IMPLEMENTED**, **UNKNOWN / NEEDS EVIDENCE**.

## 1. Repository state

| Repository | Branch | HEAD | Local state at review start |
|---|---|---|---|
| `C:\dev\ireps-pipeline-sales` | `main` | `8bc4847574ab14388b566f75ad7830d36f40cb7d` | Untracked inspection packages, assessment directories, monthly-only scripts, and Sales tooling; Git also warned that `.pytest_cache` could not be read. |
| `C:\dev\ireps-web` | `main` | `860f44add153151232a775705c4e2c85a5bea7db` | Modified indexes, Targeted Batch functions/tools/UI, Sales Reporting; untracked reports, tests, and Sales/Targeted Batch UI files. |
| `C:\dev\ireps-mobile` | `main` | `0e39d5a3d24af927d64cc39d212e6c0a8b455ac1` | Modified Targeted Batch/No Access code; untracked tests/helpers and `mobile_search_results.txt`. |

The pipeline and mobile repositories required `git -c safe.directory=<repo>` because their owner differs from the sandbox user. This is a command-local override and did not alter Git configuration. Existing changes were treated as authoritative and were not modified. **CONFIRMED CURRENT BEHAVIOUR**.

## 2. Executive verdict — IMPLEMENTABLE WITH CORRECTIONS

The locked architecture is implementable. Atomic and legitimate monthly-origin data can converge at the meter-month contract represented by `conlog_sales_monthly`; neither Meter Master nor Sales All needs a provider-specific duplicate. The cutover can remain invisible to the existing Sales Table, Stats, and Reporting components by changing only the Firestore collection constant after Sales All supplies the aliases consumed by the current normalizer.

It is not safe to implement without these minimum corrections:

1. Add a governed monthly-source adapter that emits the Stage 03/04 meter-month contract and provenance without inventing Atomic records.
2. Remove the Conlog-only gates from the shared downstream stages (05–08), while retaining the existing `conlog_*` collection names.
3. Expand Stage 06 and its manifest contract with the exact compatibility fields in section 9.
4. Add a true Stage 08 refresh mode using field-level transactional updates/preconditions; preserve `master.visibility`, `tbRefs`, and `geofenceRefs`.
5. Expand the Sales All validator’s allow-list/type checks while leaving its generated patch restricted to `master.id` and `master.visibility`.
6. Switch every Targeted Batch dynamic source constant and direct demo source listener/tool noted below, then update tests.
7. Prove normalized-row parity before changing the one Sales streaming collection constant.

No locked-design element is technically impossible. **CONFIRMED CURRENT BEHAVIOUR / INFERENCE**.

## 3. Current architecture verified

The Atomic path is `01` preparation → `02` `conlog_sales_atomic` upload → `03` meter/month aggregation → `04` monthly collections → `05` Meter Master → `06` Sales All staging → `07` Meter Master upload → `08` Sales All upload. Stage 06 explicitly consumes Meter Master plus monthly meter CSVs (`scripts/06_build_sales_all_meters.py:4-13`) and Stage 08 targets `sales-all-meters` (`scripts/08_upload_sales_all_meters.py:72`). **CONFIRMED CURRENT BEHAVIOUR**.

The web Sales stream is a shared Firestore listener/cache keyed by LM, currently querying `demo_sales_meters` (`src/redux/demoSalesApi.js:6,470-525`). It normalizes legacy and canonical aliases before publishing rows. This module, not the pages, is the backend boundary. **CONFIRMED CURRENT BEHAVIOUR**.

## 4. Proposed architecture verification

The design respects existing seams. Stage 05/06 consume monthly outputs, not Atomic documents directly. Therefore a validated monthly adapter can enter immediately before the monthly persistence/downstream build contract. The smallest compatible correction is to generalize the monthly manifest/source identity and provider validation, not add another Meter Master or Sales All builder. **INFERENCE**, supported by `03_aggregate_monthly_from_atomic_outputs.py:513-564`, `05_build_meter_master_v3.py:1046-1089`, and `06_build_sales_all_meters.py:4-13,786-850`.

## 5. Sales Pipeline two-path assessment

1. **Yes**, the two-path design can be implemented as stated.
2. **Yes**, both origins can converge at `conlog_sales_monthly` if the adapter produces the same canonical meter/month identity, cent-valued totals, units/count semantics, timestamps where legitimately available, LM/provider identity, manifests, uniqueness, and reconciliation evidence.
3. **No**, there is no technical reason for Contour/Endumeni-specific Meter Master or Sales All builders. Such duplication would create schema and ownership drift.

Atomic-specific validation remains appropriate in stages 01–03 for the Atomic path. The downstream provider and filename assumptions must be generalized: Stage 06 only discovers `monthly__FULL__YYYY-MM__from_atomic.csv` (`06_build_sales_all_meters.py:50-53,627-652`). **CONFIRMED CURRENT BEHAVIOUR**.

## 6. Monthly-only source path assessment

The existing `scripts/monthly_only` folder is not the required convergence adapter. It builds ERF/GPS lookup/enrichment and deploys corrected PSD documents directly to `demo_sales_meters` (`monthly_only/01_build_erf_gps_lookup.py`, `02_build_enriched_psd.py`, `03_prepare_firestore_psd_no_geometry.py`, `05_assess_sales_sg_one_to_one.py`, `06_build_exact_gps_pilot.py`, `07_upload_exact_gps_pilot_dev.py:30`, `08_deploy_corrected_psd_{dev,test}.py:35`). It is reusable for supplied address/ERF/GPS enrichment logic, but not as the monthly sales ingestion contract. **CONFIRMED CURRENT BEHAVIOUR**.

The adapter must reject duplicate `(lmPcode,meterNo,ym,provider)` rows, normalize meter IDs, currency/cents and units, retain supplier lineage, and emit Stage 04-compatible documents/manifests. `purchasesCount`, first/last purchase timestamps, and Atomic IDs must not be fabricated. Where the canonical monthly schema currently requires Atomic-derived values, it needs an explicit optional/source-aware rule. **INFERENCE**.

## 7. Atomic-absence impact on iREPS Mobile

| Path | Classification | Evidence and behaviour |
|---|---|---|
| Prepaid Revenue monthly list/dashboard | **SAFE** | Reads `conlog_sales_monthly`, not Atomic (`src/redux/salesApi.js:129-190,589-615`). Monthly-only meters remain visible. |
| Revenue report “Atomic Purchases” modal | **SAFE** | Empty query returns `[]`; FlatList displays “No atomic purchases…” (`components/AtomicPurchasesModal.js:35-41,154-167`). |
| AST timeline | **SILENTLY INCOMPLETE** | Atomic query returns `[]`; timeline still contains field transactions but no vending events (`app/(tabs)/asts/[id]/timeline.js:170-201`). No crash or invalid-meter conclusion. |
| AST calendar | **SILENTLY INCOMPLETE** | Empty Atomic array contributes no sale events, while transaction events remain (`app/(tabs)/asts/[id]/calendar.js:397-419`). |
| AST overview metrics/tiles | **LOGICALLY WRONG** | Overview metrics are built from Atomic `sales`; a legitimate monthly-only sales meter is represented as having no sales activity in those Atomic-derived metrics (`app/(tabs)/asts/[id]/index.js:183-207`). It does not crash, but absence is conflated with zero activity. |
| Atomic limited/admin list | **SAFE** | Firestore empty snapshot maps to `[]` (`src/redux/salesApi.js:56-82`). |

No mobile modification is required merely to prevent runtime failure. A product correction is required if AST overview/timeline/calendar must portray monthly-only commercial history accurately; otherwise document the intentional incompleteness. **CONFIRMED CURRENT BEHAVIOUR / INFERENCE**.

## 8. `vending_providers` assessment

The model cleanly supports Contour: opaque `vpr_*` document identity plus independent `providerCode`, `providerName`, active/inactive status and metadata (`scripts/tools/vending-provider/seed_vending_providers.py:30-40,120-197`). Add a second governed seed entry with a stable new ID/code/name; do not create a new collection. The tool is create-only (`:230-249`). **CONFIRMED CURRENT BEHAVIOUR**.

Conlog-only assumptions requiring change for the shared downstream path are:

- Stage 05 `GOVERNED_PROVIDER`, CLI choice, and final gate (`05_build_meter_master_v3.py:53,212-215,1586-1589`).
- Stage 06 constant, manifest provider, and row validation (`06_build_sales_all_meters.py:46,535-575,701-735`).
- Stage 07 constant and validation (`07_upload_meter_master_v3.py:72,448-451,519`).
- Stage 08 constant, CSV/manifest validation (`08_upload_sales_all_meters.py:74,513-523,957-970`).
- Cloud validator’s literal `existing.provider !== "conlog"` (`functions/salesAllMeters/helpers.js:134-138`).

Stages 01–04 also contain Conlog ID gates (`01:42,485-488`; `02:49,527-530,1229-1232`; `03:53,390-391`; `04:50,935,1560-1562`), but those remain correct for the existing Atomic path. A monthly adapter/shared Stage 04 entry must use governed provider identity rather than weakening Atomic controls. **CONFIRMED CURRENT BEHAVIOUR**.

## 9. Exact Sales All additive field matrix

The table distinguishes persisted compatibility inputs from values derived by the protected normalizer. Types are the accepted/current types, not a proposed redesign.

| Field / normalized output | Demo name(s) read | Current Sales All equivalent | Consumer | Owner | Add? | Preserve canonical? | Type | Source / refresh | Notes |
|---|---|---|---|---|---|---|---|---|---|
| meter identity | `MeterNumber`, `meterNo`, `meterNoNormalized` | `meterNo`, `meterNoNormalized`, document ID | all | pipeline | existing | yes | string | Meter Master; refresh | no rename |
| LM | `lmPcode` | none | stream filter, table/TB | pipeline | **yes `lmPcode`** | yes | string | monthly/source; refresh | required for Firestore query |
| provider | optional | `provider` | governance | pipeline | existing | yes | string/code | adapter/Master; refresh | allow governed non-Conlog |
| account | `AccountNumber`, `accountNumber` | `accountNo` | table/report/TB | pipeline | **yes `accountNumber`** | yes (`accountNo`) | string | customer source; refresh | compatibility duplication |
| customer | `customerName`, `Customer`, `Surname` | `customerNo` only | table/report/TB | pipeline | **yes `customerName`** | yes (`customerNo`) | string | supplied customer; refresh | preserve customer number and display name |
| address 1 | `addressLine1`, `AddressLine1`, `PostalAddress1` | none | table/report/TB | pipeline | **yes** | n/a | string | supplied/enrichment; refresh |
| address 2 | `addressLine2`, `AddressLine2`, `PostalAddress2` | none | table/report | pipeline | **yes** | n/a | string | supplied/enrichment; refresh |
| town | `town`, `Town`, `PostalAddressTown` | none | table/report/TB | pipeline | **yes** | n/a | string | supplied/enrichment; refresh |
| stand | `standNumber`, `StandNumber`, fallback ERF | none | table/report | pipeline | **yes** | n/a | string | supplied/enrichment; refresh |
| SG/ERF scalar | `sgCode`, `erfNo` | none | UI/TB/geofence | pipeline | **yes both** | n/a | string | ERF enrichment; refresh |
| ERF numbers | `ErfNumbers`/`erfNumbers` | none | normalizer/UI | pipeline | **yes `erfNumbers`** | n/a | string[] | ERF enrichment; refresh |
| ERF candidates | `ErfCandidates`/`erfCandidates` | none | wards/GPS/TB/geofence | pipeline | **yes `erfCandidates`** | n/a | object[] | ERF enrichment; refresh | candidate fields: erfId, erfNumber, wardNumber, wardPcode, lmPcode, lat/long |
| wards | derived from candidates | none | table/report/TB | pipeline-derived | candidates sufficient | n/a | string[] | Stage 06 or API | normalized output must match |
| GPS status/flag | `GpsMatchStatus`, `HasUsableGps` aliases | none | filters/map/geofence | pipeline | **yes `gpsMatchStatus`, `hasUsableGps`** | n/a | string, boolean | enrichment; refresh |
| geofences | `geofenceRefs` | none | UI/geofence trigger | **operational** | **yes** | n/a | `{id,name}[]` | operational writer; **preserve** | third proven operational field |
| monthly money | `Sales` rand map or `monthlySalesC` | `monthlyTotalsC` | all sales views/TB | pipeline | **yes `monthlySalesC`** | yes (`monthlyTotalsC`) | `{YYYY-MM:int cents}` | monthly; refresh | safest parity duplication; normalizer already accepts either |
| total money | `totalSalesC` or derived | `totalAmountC` | table/stats/report/TB | pipeline | **yes `totalSalesC`** | yes (`totalAmountC`) | integer cents | Stage 06; refresh |
| monthly units | `Units`/`monthlyUnits` | none | reports/TB | pipeline | **yes `monthlyUnits`** | n/a | `{YYYY-MM:number}` | monthly adapter; refresh |
| total units | `totalUnits` or derived | none | reports | pipeline | optional derived; add for parity | n/a | number | Stage 06; refresh |
| recency metrics | `lastPositiveSalesMonth`, `monthsWithoutSales`, `latestMonthSalesC`, `sales3MonthsC`, `sales6MonthsC`, `sales12MonthsC`, `latest12MonthsSalesC` | `lastPurchaseAtISO`, `daysSinceLastPurchase` partially | table/stats/report/TB | pipeline/normalizer | add for exact snapshot parity or derive identically | preserve existing | month/string + integer cents/count | Stage 06; refresh | parity test decides persisted vs derived |
| calendar-year metrics | `sales2024C`, `sales2025C`, `sales2026C` | none | stats/report | normalizer | no if protected normalizer retained | n/a | integer cents | API derived | hard-coded years are existing contract debt, not migration redesign |
| sales period | `salesPeriodFrom`, `salesPeriodTo` | month keys | reports/TB | pipeline/normalizer | add or derive | yes | `YYYY-MM` | Stage 06; refresh |
| CAT/risk | `Leakage_Category`, `leakageCategory`; `Risk_Tier`, `riskTier`; `Risk_Score`, `riskScore` | none | table/stats/report/TB selection | pipeline | **yes three canonical aliases** | n/a | string,string,number|null | category source; refresh |
| tariff | `TariffInstance` (present in source) | none | **no direct current normalizer read found** | pipeline | add only if approved future requirement | n/a | string | supplier; refresh | current-consumer requirement not proven |
| blocked | supplied/known requirement | none | **no current read found** | pipeline | add only if source contract mandates | n/a | boolean/unknown | supplier; refresh | **UNKNOWN / NEEDS EVIDENCE** for exact type/name |
| installation/previous meter | `InstallationDate`, `PreviousMeterNumber`, `PreviousInstallationDate` | none | **no current protected normalizer read found** | pipeline | not required for current web contract | n/a | source strings | supplier; refresh | retain only if separately governed |
| source lineage | `sourceFileName`, `sourceRow`/`SourceEndRow`, `trnBatchIds` | manifest only | reports/TB/audit | pipeline | **yes sourceFileName/sourceRow/trnBatchIds** | manifest retained | string, number, string[] | source stages; refresh |
| AST/proposal compatibility | `astId`, `astMatchStatus`, `proposedTrnType`, `demoData` | Meter Master `refs.asts.id` exists separately | UI/TB | mixed | only if parity proves consumed | keep bridge ownership separate | nullable/string/bool | operational/normalizer | do not copy AST discovery payload broadly |
| Targeted Batch | `tbRefs` | none | TB/UI/mobile | **operational** | **yes** | n/a | object[] | TB transactions; **preserve** | authoritative history moves here |
| bridge | none | `master.id`, `master.visibility` | discovery/master bridge/TB | operational | existing | yes | map/string | bridge; **preserve** | bridge patch remains narrow |

Normalizer evidence: `src/redux/demoSalesApi.js:297-434`. Targeted Batch snapshot evidence: `functions/targetedBatches/documentFactory.js:147-304`. Fields such as tariff, blocked and installation appear in current Demo source data/tooling but are not read by the protected normalizer in the inspected local code; they must not be claimed as current UI requirements without additional product/schema evidence. **CONFIRMED CURRENT BEHAVIOUR / UNKNOWN where marked**.

## 10. Stage-by-stage pipeline impact

| Stage | Atomic path | Monthly-only path | Reason |
|---|---|---|---|
| `00_prepare_conlog_raw_sales.py` | **UNCHANGED** | **NOT USED** | Conlog raw preparation remains Atomic-specific. |
| `01_prepare_conlog_sales.py` | **UNCHANGED** | **NOT USED** | Canonicalizes Atomic rows and stamps Conlog provider. |
| `02_upload_conlog_atomic_v2.py` | **UNCHANGED** | **NOT USED** | Atomic is optional and must not be fabricated. |
| `03_aggregate_monthly_from_atomic_outputs.py` | **UNCHANGED** | **NEW COMPANION/ADAPTER REQUIRED** | Existing script validates Atomic input and Conlog ID; adapter must emit the same monthly boundary. |
| `04_upload_conlog_monthly_v3.py` | **MODIFY or shared companion** | **MODIFY / USED** | Must accept governed monthly-origin manifests/provider and optional Atomic lineage without weakening Atomic validation. |
| `05_build_meter_master_v3.py` | **MODIFY** | **MODIFY** | Remove one-provider choice/gate and accept canonical monthly source; keep one builder. |
| `06_build_sales_all_meters.py` | **MODIFY** | **MODIFY** | Generalize provider/filenames, join enrichment/source fields, add compatibility schema and units. |
| `07_upload_meter_master_v3.py` | **MODIFY** | **MODIFY** | Allow governed providers while preserving Meter Master shape/refs. |
| `08_upload_sales_all_meters.py` | **MODIFY** | **MODIFY** | Expanded schema, providers, recurring refresh and operational preservation. |

## 11. Stage 08 refresh design compatibility

Current modes are only `create-only` and exact-failure `resume`; create-only blocks a non-empty collection and resume only creates missing rows after exact comparison (`08_upload_sales_all_meters.py:1089-1103,1216-1242`). **NOT IMPLEMENTED**.

A safe refresh mode is feasible. It must:

- Build an explicit pipeline-owned field mask and update only those dotted/top-level fields.
- Read each target in a Firestore transaction (or use update-time preconditions), validate canonical identity/provider, and never use whole-document `set`.
- Preserve `master.visibility`, `tbRefs`, and `geofenceRefs`; preserve unknown non-pipeline fields by default and fail on ownership ambiguity.
- Re-read/verify pipeline fields and operational-field hashes after commit.
- Define removal semantics for stale pipeline fields and meters explicitly; omission must not silently delete operational data.

The existing resume comparator rejects extra top-level fields (`08_upload_sales_all_meters.py:626-665`), so it cannot be repurposed unchanged.

## 12. Sales All writer inventory

| Repository/file | Classification | Current action |
|---|---|---|
| pipeline `scripts/08_upload_sales_all_meters.py:72,741-757` | production writer | create-only/resume creates canonical documents. |
| web `functions/index.js:1472-1510,2621-2642` | operational bridge | transactional patch of `master.id`/`master.visibility`. |
| web `functions/index.js:1621-1648` | operational bridge + TB transaction participant | Meter Discovery reads Sales All and invokes the same narrow sync; TB completion may update the demo-backed source separately. |
| pipeline `scripts/tools/sales-all/update_sales_all_visibility_dev_v1.js` | migration/maintenance writer | visibility remediation. |
| pipeline `scripts/tools/sales-all/remove_sales_all_metadata_dev_v1.js` | migration/maintenance writer | guarded metadata removal. |

No production Targeted Batch writer currently points to Sales All; it points through the Demo collection constant. **CONFIRMED CURRENT BEHAVIOUR**.

## 13. Sales All reader inventory

- Stage 08 reads existing documents for resume and verification (`08_upload_sales_all_meters.py:763-871`). Production/audit reader.
- Meter Discovery and `onMeterMasterUpdated` transactionally read before bridge patches (`functions/index.js:1635-1638,2622-2628`). Operational bridge.
- `scripts/tools/sales-all/read_sales_all_meters_dev_v2.js` and `scripts/tools/audit/audit_export_sales_rules_sample.cjs` are audit/read-only tools.
- `scripts/tools/schemas/query_firestore_collection_schemas.js` is schema/audit tooling.
- Current web Sales API, pages, Stats, Reports, Targeted Batch, and mobile Sales do **not** read Sales All as their commercial source. **CONFIRMED CURRENT BEHAVIOUR**.

## 14. Demo Sales writer inventory

Production/operational writers:

- `functions/targetedBatches/callables.js:504-541,840-841` — creation reads source and array-unions `tbRefs`.
- `functions/targetedBatches/deleteCallable.js:197-233,356-431` — reads/removes exact `tbRefs`.
- `functions/targetedBatches/premiseLink.js:598-840,1437-1638` — premise start and Meter Discovery completion read/update `tbRefs` transactionally.
- `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js:307-376` — No Access reads and replaces the matching `tbRefs` history transactionally.
- `functions/geofences/triggers.js:182-218` plus `geofences/salesMembership.js:65-130` — adds `geofenceRefs` to Demo Sales.

Maintenance/migration writers:

- pipeline `monthly_only/07_upload_exact_gps_pilot_dev.py`, `08_deploy_corrected_psd_dev.py`, `08_deploy_corrected_psd_test.py`.
- pipeline `scripts/tools/sales-all/03_update_endumeni_sales_categories_test.py`, `04_enrich_endumeni_sales_lmpcode_test.py`, `05_apply_historical_categories_test.py`, and their run wrappers.
- web `scripts/tools/demo-sales/05_update_demo_sales_sg_erfno_dev.py`.
- web Targeted Batch reset/delete/repair tools under `functions/scripts/tools/targeted-batches` and `functions/tools/targetedBatches/repairTargetedBatchErfRefs.js`.

Package/inspection copies under pipeline `endumeni_demo_sales_package`, `SALES_CATEGORY_UPDATE_INSPECTION`, zips/text inventories, and web `docs/backups`, `docs/temp`, `docs/archive`, `docs/reports` are obsolete/reference artifacts, not production writers. **CONFIRMED CURRENT BEHAVIOUR**.

## 15. Demo Sales reader inventory

- `src/redux/demoSalesApi.js:6,487-493` — protected UI/API streaming reader for Sales Table, Stats and Reporting.
- `src/redux/salesTargetedBatchApi.js:26` — Targeted Batch stats/report/map reader.
- `functions/targetedBatches/helpers.js:7` and all dynamic consumers listed in section 14 — authoritative Targeted Batch reader.
- `functions/targetedBatches/getTargetedBatchRowsCallable.js` — joins row IDs to Sales source and returns sanitized sales records.
- `src/pages/operations/targeted-batches/allocation/TargetedBatchAllocationRowsPanel.jsx` — UI text/reference only; backend row data is authoritative.
- mobile `src/redux/targetedBatchApi.js:493` — direct per-document Demo Sales listener for TB field-work state.
- geofence trigger/tooling and read/inspection scripts noted above.

The mobile direct listener is the most important hidden cutover consumer. The geofence writer is the important hidden operational owner. **CONFIRMED CURRENT BEHAVIOUR**.

## 16. Cloud Functions validator impact

`ROOT_FIELDS` is an exact 11-field allow-list (`functions/salesAllMeters/helpers.js:21-25`); any additive root field produces `PROHIBITED_FIELD_PRESENT` (`:72-82`). It also requires `master` to contain exactly `id,visibility` (`:84-102`) and provider to equal `conlog` (`:134-138`). It must be expanded with explicit allowed fields and type/identity validation.

This does not require widening bridge ownership. `classifySalesAllMetersSync` constructs only `master.id` and `master.visibility` patches (`:188-214`). Keep this patch builder unchanged/narrow and separate validation acceptance from write authority. **CONFIRMED CURRENT BEHAVIOUR**.

## 17. Meter Discovery / Meter Master bridge impact

Meter Discovery reads AST/Master/Sales in one transaction and delegates Sales synchronization (`functions/index.js:1619-1648`). The bridge derives visibility only from `refs.asts.id` plus `refs.sales.id` (`:1466-1469`) and applies the validator decision patch (`:1472-1510`). `onMeterMasterUpdated` reacts only when AST/sales refs or derived visibility changes, then invokes the same helper (`:2601-2642`).

Thus Meter Discovery and `onMeterMasterUpdated` do not write CAT, ward, SG, tariff, blocked, address, sales, units, or customer fields. They can remain narrow after validator expansion. Targeted Batch completion inside the Meter Discovery transaction does separately write `tbRefs`; that is Targeted Batch ownership, not bridge/commercial ownership. **CONFIRMED CURRENT BEHAVIOUR**.

## 18. Targeted Batch cutover impact

The central switch is `TARGETED_BATCH_COLLECTIONS.sales` from `demo_sales_meters` to `sales-all-meters` (`functions/targetedBatches/helpers.js:7`). This flows into creation, deletion, premise linking, Meter Discovery completion, No Access, and row retrieval. Also switch the independent web constant `src/redux/salesTargetedBatchApi.js:26`, the mobile direct listener `src/redux/targetedBatchApi.js:493`, repair/reset/audit tools, and fixtures/tests.

Workflow semantics can remain unchanged because IDs are already named `salesAllMeterId`, source rows snapshot normalized commercial fields, and all TB writes are scoped to `tbRefs`. Sales All must contain the authoritative document IDs plus the aliases/ERF fields validated by `validateAuthoritativeSalesDocument` (`functions/targetedBatches/helpers.js:620-864`). **INFERENCE backed by confirmed interfaces**.

## 19. Sales streaming API compatibility

The final source cutover is one constant (`src/redux/demoSalesApi.js:6`) if Sales All includes `lmPcode` and the compatible source fields. Listener sharing, delayed release, RTK cache lifecycle, endpoint/hook names, sorting, error/loading semantics and row normalization can remain untouched (`:470-625` and exports at file end). Do not rename `demoSalesApi` during this migration.

Required gate: feed paired Demo and Sales All snapshots through `normalizeDemoSalesRow`, compare every normalized field (including serialized timestamps, derived money/units, ERFs, geofences and `tbRefs`), then compare sorted arrays and LM membership. **INFERENCE**.

## 20. Sales Table impact

No substantive Sales Table modification is required. `PrepaidSales.jsx` consumes normalized rows from the existing hook; only its current error copy explicitly names `demo_sales_meters` and should be made collection-neutral if that branch remains (`src/pages/sales/PrepaidSales.jsx`, search hit near line 421). Behaviour must not change. **CONFIRMED CURRENT BEHAVIOUR / INFERENCE**.

## 21. Sales Stats impact

No Stats logic modification is required if normalized parity is proven. Stats consume derived normalized fields, not Firestore documents directly. Any failure to supply monthly cents/units, risk/CAT, LM or recency fields would make results wrong; correct the Sales All builder/API boundary, not Stats. **INFERENCE based on the API contract**.

## 22. Sales Reporting / Batch Reports impact

No report-page logic modification is required if normalized parity is proven. Reporting and batch/map components consume the shared normalized rows and Targeted Batch snapshots. Existing local modifications to `SalesReportingPage.jsx` and `SalesBatchMapModal.jsx` are unrelated and must be preserved. **INFERENCE based on inspected imports/contracts**.

## 23. Writer ownership / race-condition analysis

There are three concurrent writer classes after cutover: pipeline refresh (commercial fields), bridge (`master.*`), and Targeted Batch/geofence (`tbRefs`, `geofenceRefs`). Whole-document Stage 08 writes would lose operational updates. Array transforms alone do not protect against a refresh overwriting the entire array.

Required strategy:

1. Stage 08 transactionally reads each target and validates identity/schema.
2. It updates only an explicit pipeline-owned field mask, never `master`, `tbRefs`, or `geofenceRefs`.
3. Firestore transaction retry/update-time preconditions detect intervening writes. On conflict, re-read and recompute rather than overwriting.
4. TB and bridge continue their existing transactions/dotted updates. Geofence continues a field-only update.
5. Post-write verification asserts operational fields are byte/semantic-equivalent to the pre-read values and pipeline totals match the manifest.

This makes races safe without coordinating schedules. A “read operational fields, merge locally, then set whole document” implementation remains unsafe because it can race after the read. **INFERENCE**.

## 24. Exact impacted-file list

### A. `ireps-pipeline-sales`

| File / function | Current responsibility → impact | Why | Risk |
|---|---|---|---|
| new adapter under `scripts/` | supplier monthly input → canonical monthly outputs/manifests | second ingestion path | HIGH |
| `scripts/04_upload_conlog_monthly_v3.py` validation/upload | Atomic-derived monthly upload → accept governed monthly origin/provider | convergence | HIGH |
| `scripts/05_build_meter_master_v3.py` config/build | one Conlog provider → governed providers | shared builder | MEDIUM |
| `scripts/06_build_sales_all_meters.py` discovery/load/build/manifest | narrow Sales All → additive read model, units/enrichment/provider | consumer parity | HIGH |
| `scripts/07_upload_meter_master_v3.py` validation | Conlog-only → governed provider | Contour linkage | MEDIUM |
| `scripts/08_upload_sales_all_meters.py` validation/write/verify | create-only/resume → additive transactional refresh | recurring loads/ownership | HIGH |
| `scripts/tools/vending-provider/seed_vending_providers.py` provider list | Conlog seed → add Contour | governed identity | LOW |

### B. `ireps-web` Cloud Functions/backend

| File / function | Impact | Risk |
|---|---|---|
| `functions/salesAllMeters/helpers.js` validator | accept additive fields/providers; retain narrow patch | HIGH |
| `functions/geofences/triggers.js` Demo phase | source switch to Sales All | MEDIUM |
| `functions/geofences/salesMembership.js` naming/schema aliases | generalize Demo naming; retain field-only `geofenceRefs` update | MEDIUM |

`functions/index.js` bridge should not need behaviour changes; only tests/import expectations may change.

### C. `ireps-web` Redux/data API

| File | Impact | Risk |
|---|---|---|
| `src/redux/demoSalesApi.js` | collection constant only after parity | HIGH cutover / LOW code change |
| `src/redux/salesTargetedBatchApi.js` | TB Sales source constant | MEDIUM |

### D. Targeted Batch

| File | Impact | Risk |
|---|---|---|
| `functions/targetedBatches/helpers.js` | central source constant and Demo-named helper aliases/validation | HIGH |
| `functions/targetedBatches/callables.js` | no semantic rewrite; verify central switch and schema aliases | MEDIUM |
| `functions/targetedBatches/deleteCallable.js` | central switch; preserve exact `tbRefs` cleanup | MEDIUM |
| `functions/targetedBatches/premiseLink.js` | central switch; preserve transactional history | HIGH |
| `functions/targetedBatches/recordTargetedBatchNoAccessCallable.js` | central switch; preserve full-array transactional update | HIGH |
| `functions/targetedBatches/getTargetedBatchRowsCallable.js` | central switch/join verification | MEDIUM |
| `ireps-mobile/src/redux/targetedBatchApi.js` | direct document listener collection switch | HIGH |

### E. Tests

Update/add pipeline Stage 04–08 offline tests; web `salesAllMeters` validator/bridge tests; `targetedBatchPremiseLink`, creation, deletion, row callable and No Access tests; geofence sales-membership tests; Redux normalizer/stream parity tests; mobile `targetedBatchApi.streaming.test.mjs`. Risk **MEDIUM–HIGH** because these are cutover gates.

### F. `ireps-mobile` only if monthly-without-Atomic accuracy is required

`app/(tabs)/asts/[id]/index.js`, `timeline.js`, and `calendar.js` would need a product-approved monthly fallback/label. No change is required for crash safety. Risk **MEDIUM**.

### G. Tooling/audit scripts

Switch or retire Demo-specific TB reset/repair/read tools and Demo enrichment/deployment tools listed in sections 14–15; add normalized parity and ownership-preservation audit tools. Each must keep explicit project/collection guards. Risk **MEDIUM**.

### H. Investigated files that should not require modification

- Atomic stages `00`, `01`, `02`, `03` for the existing Conlog path.
- Sales Table, Stats charts, Sales Reporting and batch-report UI behaviour/components.
- `functions/index.js` bridge algorithms.
- `functions/targetedBatches/documentFactory.js` workflow shape (its aliases already accept canonical and legacy money/account fields).
- Mobile monthly sales API and Atomic empty-state modal.
- Existing `conlog_*` collection names.

## 25. Tests required before implementation

1. Adapter schema, duplicate, units/cents, provider, optional-Atomic and reconciliation tests.
2. Mixed-provider Stage 05–08 manifest and identity tests.
3. Stage 06 golden fixtures for every field in section 9.
4. Validator acceptance/rejection tests plus proof that patches contain only `master.id`/`master.visibility`.
5. Stage 08 create, refresh, stale-field, missing-field, retry/precondition and unknown-field tests.
6. Concurrency emulator tests: refresh vs bridge; refresh vs TB create/No Access/completion/delete; refresh vs geofence.
7. Demo-vs-Sales-All normalized row deep equality and sorted-list equality for every LM.
8. Sales Table filters/sorts/loading/error snapshots; Stats aggregate equality; Reporting/batch export equality.
9. Complete Targeted Batch lifecycle against Sales All, including mobile listener, No Access and deletion.
10. Monthly-only mobile tests proving empty Atomic queries do not fail and documenting overview metric semantics.

## 26. Migration/cutover gates

1. Govern Contour provider seed and source mapping.
2. Validate adapter and mixed-origin monthly reconciliation.
3. Build expanded Sales All in non-production; pass schema and totals audits.
4. Deploy validator acceptance before expanded documents encounter bridge triggers.
5. Prove Stage 08 operational-field preservation under concurrency.
6. Switch Targeted Batch/geofence writers and readers; run full lifecycle.
7. Achieve normalized parity for all relevant documents/LMs and consumer aggregates.
8. Cut the Sales stream collection constant **last**; monitor listener errors/counts and retain a rollback switch.
9. Retire Demo writers only after no-reader/no-writer audits pass.

## 27. Hidden dependencies discovered

- `geofenceRefs` is an operationally written Sales field and must be preserved.
- Mobile Targeted Batch listens directly to `demo_sales_meters`.
- Geofence creation reads/writes Demo Sales independently of the Sales API and Targeted Batch constants.
- Stage 06 filename identity encodes `from_atomic`, blocking a monthly-origin file even when its row schema is compatible.
- The web normalizer supplies source-name and year-specific defaults; parity must compare normalized results, not merely raw schemas.

## 28. Conflicts with proposed design

No architectural conflict. The only factual correction is that the minimum operational preservation set is not just `master.visibility` and `tbRefs`; it also includes `geofenceRefs`. `master.id` is canonical bridge identity and must also remain protected from commercial refresh. Fields not proven as current consumers (notably tariff, blocked, installation and previous meter data) may still be added as approved supplied fields, but the current code does not establish their exact contract. **CONFIRMED CURRENT BEHAVIOUR**.

## 29. Minimum corrections required

- Generalize governed provider handling downstream, not Atomic-stage controls.
- Introduce a monthly adapter and source-aware manifests.
- Expand Sales All with the compatibility matrix, especially `lmPcode`, monthly units, consumer identity/location/ERF/risk aliases and operational arrays.
- Implement transactional field-mask refresh.
- Expand validator acceptance without widening bridge patch ownership.
- Switch all TB, mobile TB and geofence collection references.
- Require normalized parity before the final API cutover.

## 30. Final recommendation

Proceed with the locked design after the corrections and gates above. Use one monthly convergence contract, one Meter Master builder, one Sales All builder, and the unchanged Sales API interface. Treat Stage 08 concurrency/ownership and normalized parity as release blockers. Do not manufacture Atomic data and do not modify the UI to compensate for an incomplete Sales All read model.

## 31. Evidence index

Key evidence (repository paths are relative to the named repository):

- Pipeline architecture/providers: `scripts/01_prepare_conlog_sales.py:139-143,482-488`; `03_aggregate_monthly_from_atomic_outputs.py:327-391,513-564`; `04_upload_conlog_monthly_v3.py:925-935,1560-1562`; `05_build_meter_master_v3.py:212-215,1013-1029,1046-1089,1303-1318`; `06_build_sales_all_meters.py:44-106,627-652,676-753,786-850`; `07_upload_meter_master_v3.py:448-451`; `08_upload_sales_all_meters.py:72-105,458-523,576-757,930-1019,1089-1103,1216-1243`.
- Provider model: `scripts/tools/vending-provider/seed_vending_providers.py:30-40,120-197,230-249`.
- Protected stream/normalizer: `src/redux/demoSalesApi.js:6,297-434,470-525`.
- Validator/bridge: `functions/salesAllMeters/helpers.js:21-25,59-185,188-214`; `functions/index.js:1466-1510,1619-1648,2601-2642`.
- Targeted Batch: `functions/targetedBatches/helpers.js:7,620-864,1050-1078`; `documentFactory.js:147-304`; `callables.js:504-541,840-841`; `deleteCallable.js:197-233,356-431`; `premiseLink.js:598-840,1122-1300,1437-1638`; `recordTargetedBatchNoAccessCallable.js:307-376`; `src/redux/salesTargetedBatchApi.js:26`; mobile `src/redux/targetedBatchApi.js:493`.
- Geofence operational ownership: `functions/geofences/triggers.js:182-218`; `functions/geofences/salesMembership.js:65-130`.
- Mobile Atomic absence: `src/redux/salesApi.js:56-127,129-190,551-615`; `components/AtomicPurchasesModal.js:35-41,120-167`; `app/(tabs)/asts/[id]/index.js:183-207`; `timeline.js:170-211`; `calendar.js:397-419`.

Search coverage included exact literal and case-insensitive references to `sales-all-meters` and `demo_sales_meters`, plus dynamic collection constants, across production source, tests, tools and local untracked source. Generated reports/backups/package copies were classified but not used as behavioural authority. **CONFIRMED CURRENT BEHAVIOUR**.
