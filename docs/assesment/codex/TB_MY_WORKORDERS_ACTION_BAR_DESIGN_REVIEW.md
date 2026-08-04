# Sales Targeted Batch My Workorders Action Bar Design Review

Review date: 2026-08-04  
Mode: design review only; no implementation performed

## 1. Executive Summary

**Final classification: CHANGE REQUIRED.** The four-control concept is appropriate and the locked row correlation (`tbId -> rowId -> salesDocId -> erfId -> premiseId -> meterId`) should be adopted, but the current implementation cannot safely support it without coordinated mobile and backend work.

Confirmed material findings:

- **CHANGE REQUIRED — row values:** My Workorders currently calculates Premises and ASTs by counting every warehouse premise/meter on the ERF, not from `row.refs.premiseId` and `row.refs.meterId` ([my-workorders.js](C:/dev/ireps-mobile/app/(tabs)/admin/operations/my-workorders.js), lines 1107-1154). This conflicts with the locked per-row rule.
- **CHANGE REQUIRED — actions:** the card has two passive statistics and one ERF button. All three lead through one `handleOpenTargetedBatchRow` action, which ultimately selects the ERF and routes to `/(tabs)/premises`; there are no independent Premise, AST, NA, and ERF intents (lines 2066-2153 and 3204-3285).
- **ACCEPT — geography preparation:** the current LM/ward/workbase checks, ward activation, Warehouse package readiness check, canonical ERF resolution, and fail-closed missing-ERF behavior are a strong reusable base (lines 1164-1266 and 2066-2153).
- **CHANGE REQUIRED — ERF destination:** current Targeted Batch navigation routes to `/(tabs)/premises` (line 1220). The proposed ERF control must route to `/(tabs)/erfs` after setting the exact ERF.
- **CHANGE REQUIRED — rows data boundary:** `getTargetedBatchRows` is currently a direct mobile `onSnapshot` query on `tb_rows`, not a server callable/API. It returns no Sales-derived NA count or correlation status ([targetedBatchApi.js](C:/dev/ireps-mobile/src/redux/targetedBatchApi.js), lines 451-524).
- **CHANGE REQUIRED — No Access ownership:** current Meter Discovery No Access requires a saved premise, writes a `trns/{trnId}` document, and `onNoAccessRecorded` writes the TRN ID onto the premise (`premises/{premiseId}.noAccessTrnIds`). That is an explicit conflict with the locked rule that Sales TB No Access must not write to or be owned by premise/AST documents ([FormMeterDiscovery.js](C:/dev/ireps-mobile/src/features/meters/FormMeterDiscovery.js), lines 873-928; [functions/index.js](C:/dev/ireps-web/functions/index.js), lines 1848-1904 and 3024-3096).
- **CHANGE REQUIRED — Meter Discovery completion:** current `onMeterDiscoveryCallable` has no Sales Targeted Batch context handling and no atomic update of the row, parent, or exact Sales `tbRefs` item (lines 3024-3209). The repository contains Targeted Batch premise-start linkage, but no corresponding Targeted Batch meter-completion implementation.
- **RISK — asynchronous trigger architecture:** the existing TRN-created triggers make related writes after the callable has already returned. They cannot provide the required all-or-nothing invariant across the independent NA record, Sales document, TB row, and TB parent.
- **ACCEPT — component direction:** one `TargetedBatchActionTile`, focused callbacks, and per-tile loading state fit the current file without a broad rewrite.

The recommended design is a dedicated authenticated Sales Targeted Batch No Access callable with a stable client-generated NA/TRN ID and one Firestore transaction. It should create an independent immutable TRN/NA record and update the exact Sales `tbRefs` entry plus first-activity TB state, while never touching premise or AST documents. A server-owned rows endpoint should batch-read Sales documents and return `noAccessCount` plus an explicit integrity status.

## 2. Current Mobile Architecture

### Confirmed behavior

- **ACCEPT:** My Workorders uses GeoContext as the selection authority and WarehouseContext as the ward-scoped data package ([my-workorders.js](C:/dev/ireps-mobile/app/(tabs)/admin/operations/my-workorders.js), lines 925-933).
- **ACCEPT:** changing `selectedWard` clears ERF, premise, and meter unless explicitly supplied; changing `selectedErf` clears premise and meter; changing premise clears meter ([GeoContext.js](C:/dev/ireps-mobile/src/context/GeoContext.js), lines 243-281). Explicitly setting all four fields in one update is safe because the cascade respects keys present in the update.
- **RISK:** navigation preparation is split between a press handler and an effect driven by GeoContext/Warehouse asynchronous state. The pending object contains a full mutable row/bucket snapshot and has no intent; a later refresh can make it stale.
- **RISK:** the effect has no explicit request generation/cancellation guard. A second press can replace the pending action; component unmount or batch selection changes can leave an obsolete preparation in flight. `requestKey` is stored but not checked.

### Proposed fit

**ACCEPT:** replace `pendingTargetedBatchRowOpen` with `pendingTargetedBatchAction` and add `intent`. Retain one shared preparation pipeline, but re-resolve the current row by `rowId` before navigating and verify that the pending request still matches the selected batch and active intent.

## 3. Current Backend Architecture

### Confirmed behavior

- Targeted Batch permanent parents and rows use `tb_uploads` and `tb_rows` ([functions/targetedBatches/helpers.js](C:/dev/ireps-web/functions/targetedBatches/helpers.js), line 6).
- **ACCEPT:** premise creation already has an authenticated, transaction-based Targeted Batch branch. It validates parent/row/Sales/ERF correlation, starts row and parent execution, increments `counts.executionStartedRows` only from `NOT_STARTED`, links `refs.premiseId`, and updates Sales `tbRefs` ([premiseLink.js](C:/dev/ireps-web/functions/targetedBatches/premiseLink.js), lines 650-839).
- **CHANGE REQUIRED:** the Sales match helper currently identifies the candidate primarily by `tbRef.id`, then validates `rowId`; the new NA and completion paths should require an exact unique `id + rowId` match directly (lines 481-537).
- **CHANGE REQUIRED:** `onMeterDiscoveryCallable` authenticates, validates a saved premise, performs non-transactional existence/duplicate checks, and writes one TRN. It does not atomically write Targeted Batch or Sales completion state ([functions/index.js](C:/dev/ireps-web/functions/index.js), lines 3024-3209).
- **RISK:** the generic TRN-created No Access trigger mutates premise metadata and ERF counts after TRN creation (lines 1848-1904). This behavior must remain for normal workflows but must be explicitly bypassed for Sales TB NA.

## 4. Current Targeted Batch Row Card Behaviour

### Confirmed behavior

The card displays Sales meter, account, customer, address, execution status, ERF-wide Premises, ERF-wide ASTs, and a single ERF-labelled button ([my-workorders.js](C:/dev/ireps-mobile/app/(tabs)/admin/operations/my-workorders.js), lines 3204-3285).

- `premiseCount` is the number of all warehouse premises whose `erfId` equals the row ERF.
- `astCount` is the number of all warehouse meters resolved to that ERF.
- No NA count is displayed.
- The whole opening state is keyed only by row ID, so the single button shows the spinner.

### Comparison

- **CHANGE REQUIRED:** `PREMISE` must show `row.refs.premiseId ? 1 : 0`.
- **CHANGE REQUIRED:** `AST` must show `row.refs.meterId ? 1 : 0`.
- **CHANGE REQUIRED:** `NA` must use the API’s Sales-derived count and integrity status.
- **ACCEPT:** `ERF` should use `row.erfNo` as the label.
- **ACCEPT:** State A/B/C/D behavior in the brief is internally consistent.
- **RISK:** State D must be made visually unmistakable; do not reduce it to disabled styling without a linkage-error explanation.

## 5. Current ERF Navigation

### Confirmed behavior

`handleOpenTargetedBatchRow` validates batch/row/ERF, LM/ward scope consistency, active LM workbase, and target ward availability. It stores a pending request and selects the ward (lines 2066-2153). The effect then waits until the active LM/ward and Warehouse ERF package correspond to the requested scope, resolves the ERF by exact ID, overlays the geo-library data, updates GeoContext, and routes to Premises (lines 1164-1266).

### Required design

- **ACCEPT:** retain these validations and `findWarehouseErfById`/`buildTargetedBatchSelectedErf` canonicalization.
- **CHANGE REQUIRED:** for `OPEN_ERF`, set the exact requested state and route to `/(tabs)/erfs`, not `/(tabs)/premises`.
- **ACCEPT:** the expected state is `selectedWard: targetWard`, `selectedErf: canonicalErf`, `selectedPremise: null`, `selectedMeter: null`, `lastSelectionType: "ERF"`.
- **RISK:** confirm the ERFs screen consumes `selectedErf` as its exact-filter key in a focused navigation test; Warehouse selectors already follow exact `selectedErfId` filtering ([warehouseSelectors.js](C:/dev/ireps-mobile/src/context/warehouseSelectors.js), lines 39-45).

## 6. Current Premise Navigation

### Confirmed behavior

The Premises index route is `/(tabs)/premises`. With a selected ERF it filters `all.prems` by exact `erfId` ([premises/index.js](C:/dev/ireps-mobile/app/(tabs)/premises/index.js), lines 43-60). Selecting a premise sets exact ERF and premise in GeoContext (lines 62-74, 105-120).

### Required design

- **ACCEPT:** when `refs.premiseId` is empty, reuse geography preparation, select the exact ERF, clear premise/meter, and route to `/(tabs)/premises`; do not route to `/premises/formPremise`.
- **CHANGE REQUIRED:** when populated, resolve the exact premise ID from the ward Warehouse package, verify its `erfId` equals the row’s canonical `erfId`, set exact ERF/premise, clear meter, and route to `/(tabs)/premises`.
- **CHANGE REQUIRED:** missing or mismatched linked premise must produce “Premise Linkage Error”; never use address, first-on-ERF, or ERF counts.
- **OPEN DECISION:** the “existing premise screen” is currently the filtered Premises list, not a distinct premise details route. Product should confirm whether exact selection in that list is sufficient for this sprint.

## 7. Current Meter Discovery Navigation

### Confirmed behavior

Premises launches discovery through `DiscoveryContext.openMissionDiscovery({ premiseId, premise })` ([premises/index.js](C:/dev/ireps-mobile/app/(tabs)/premises/index.js), lines 105-120; [DiscoveryContext.js](C:/dev/ireps-mobile/src/context/DiscoveryContext.js), lines 12-40). The modal flow eventually uses `/premises/form`, whose component renders `FormMeterDiscovery` ([premises/form.js](C:/dev/ireps-mobile/app/(tabs)/premises/form.js), lines 1-4).

The form receives `premiseId`, `action`, and optional `queueItemId`; it does not receive the proposed TB route parameters ([FormMeterDiscovery.js](C:/dev/ireps-mobile/src/features/meters/FormMeterDiscovery.js), lines 126-149). It requires a real saved premise before online submission (lines 283-333 and 873-928). The payload is a `METER_DISCOVERY` TRN containing `accessData`, AST data on success, media, status, metadata, and service provider (lines 336-357 and 915-995).

### Required design

- **CHANGE REQUIRED:** `START_METER_DISCOVERY` should resolve and select exact ERF/premise, then launch the existing Discovery mission with complete TB context. The effective form route remains `/premises/form`, but the context may be carried in the mission and/or serialized route parameter.
- **CHANGE REQUIRED:** add `sourceModule`, `operationType`, `tbId`, `rowId`, `salesDocId`, `erfId`, `premiseId`, `targetedMeterNo`, `sourceAddress`, and `returnTo` to the route/mission, persisted form payload, and queue item. Current Targeted Batch context normalization contains most fields but calls the target `meterNo`, omits `premiseId` and `returnTo`, and currently reaches premise creation rather than Meter Discovery ([targetedBatchPremiseContext.js](C:/dev/ireps-mobile/src/features/premises/targetedBatchPremiseContext.js), lines 17-123).
- **CHANGE REQUIRED:** backend success must atomically resolve the exact discovered AST ID and preserve `fieldWork.noAccess` while writing canonical completion fields. There are no current canonical Targeted Batch completion outcome codes/labels in executable code; `outcomeCode` and `outcomeLabel` are only preserved as nullable fields in premise-start logic ([premiseLink.js](C:/dev/ireps-web/functions/targetedBatches/premiseLink.js), lines 557-577). **Do not invent codes.** This is an **OPEN DECISION** requiring the existing business owner/canonical contract before implementation.

## 8. Current AST Navigation

### Confirmed behavior

The AST index route is `/(tabs)/asts` ([asts/_layout.js](C:/dev/ireps-mobile/app/(tabs)/asts/_layout.js), lines 44-56). Warehouse filtering prioritizes exact `selectedMeterId`, resolved as `selectedMeter.ast.astData.astId || selectedMeter.id` ([WarehouseContext.js](C:/dev/ireps-mobile/src/context/WarehouseContext.js), lines 108-112; [warehouseSelectors.js](C:/dev/ireps-mobile/src/context/warehouseSelectors.js), lines 72-92).

### Required design

- **ACCEPT:** resolve AST by exact `row.refs.meterId`, verify it belongs to exact linked premise and ERF, set ERF/premise/meter in GeoContext, and route to `/(tabs)/asts`.
- **CHANGE REQUIRED:** never use targeted Sales meter number as the AST lookup key.
- **CHANGE REQUIRED:** if meter exists without premise, fail closed. AST viewing may remain enabled only if the exact AST can be safely resolved and its own premise/ERF linkage validates; all mutation actions remain disabled.
- **CHANGE REQUIRED:** missing AST must show “AST Linkage Error” and must not restart discovery.

## 9. Current No Access Architecture

### Confirmed behavior

There is no independent NA capture screen. `/premises/NaScreen` is read-only history: it requires `premiseId`, queries TRNs by premise, and displays entries with `access.hasAccess === "no"` ([NaScreen.js](C:/dev/ireps-mobile/app/(tabs)/premises/NaScreen.js), lines 19-47 and 93-127).

Capture is the no-access branch of Meter Discovery:

- reason is required and a `noAccessPhoto` is required ([FormMeterDiscovery.js](C:/dev/ireps-mobile/src/features/meters/FormMeterDiscovery.js), lines 400-427);
- it still requires a saved premise (lines 283-333, 873-928);
- the TRN ID is generated client-side once per mounted form as `TRN_MDIS_<timestamp>_<type>_<ward>_<erf>` (lines 49-64 and 273-281);
- authentication metadata is initially client populated, then the callable replaces metadata using `request.auth` (lines 881-888; [functions/index.js](C:/dev/ireps-web/functions/index.js), lines 3170-3188);
- photographs are uploaded before the callable on the online path; offline local `uri` media is retained in the queue ([FormMeterDiscovery.js](C:/dev/ireps-mobile/src/features/meters/FormMeterDiscovery.js), lines 1092-1139);
- the no-access payload has no dedicated GPS field; AST GPS validation exists for successful water/electricity capture, but no-access payload sets `ast: null` and carries no live GPS (lines 460-464, 916-928). **CHANGE REQUIRED.**
- the callable writes `trns/{id}` and returns success for an existing same ID, which provides basic TRN-level idempotency ([functions/index.js](C:/dev/ireps-web/functions/index.js), lines 3098-3109 and 3163-3198);
- `onNoAccessRecorded` then appends the TRN ID to `premises/{premiseId}.noAccessTrnIds` and updates premise/ERF metadata (lines 1848-1904).

### Compatibility judgment

**CHANGE REQUIRED:** the existing form validation/media widgets and queue mechanics can be extended/reused, but the current NA persistence path cannot be reused unchanged. Sales TB NA needs an independent mode/route that does not require premise or AST ownership and a dedicated atomic callable. This is an extension of the existing TRN evidence model, not a second competing schema: the immutable record can remain a `trns` document with a distinct Sales TB origin/context, provided generic premise-linked triggers explicitly ignore that origin.

## 10. Current Sales Targeted Batch Rows API

### Confirmed behavior

There is currently no server rows callable. Mobile streams all rows for a TB directly from `tb_rows` with `where("tbId", "==", tbId)` and optional hard limit ([targetedBatchApi.js](C:/dev/ireps-mobile/src/redux/targetedBatchApi.js), lines 451-524). Normalization exposes refs but does not expose a top-level reliable `salesDocId` or NA fields (lines 284-336). With no limit, all rows are loaded; with a limit there is no cursor/order pagination.

### Proposed enrichment assessment

- **ACCEPT:** collect unique `salesDocId`s, batch-read Sales documents, exact-match `tbId + rowId`, and return count plus integrity state.
- **CHANGE REQUIRED:** use authoritative row `salesDocId` first. Current mobile context derives Sales ID from `raw.salesAllMeterId` or `raw.source.recordId`, which is an unsafe alias fallback ([targetedBatchPremiseContext.js](C:/dev/ireps-mobile/src/features/premises/targetedBatchPremiseContext.js), lines 66-94).
- **ACCEPT:** statuses `OK`, `SALES_DOCUMENT_MISSING`, `TB_REFERENCE_MISSING`, and `FIELDWORK_INVALID` are sufficient for this sprint. Validate `noAccess` is an array when present; absent may mean zero, but malformed must not.
- **ACCEPT:** do not permanently duplicate count on `tb_rows`; Sales remains authoritative.
- **RISK — reads:** Firestore `getAll`/batched document reads are supported server-side, but each unique Sales document remains a billed document read. Chunk reads to platform limits and deduplicate IDs.
- **RISK — response size:** embedding only count/status is cheap; returning Sales history is unnecessary. Large TBs still require real cursor pagination.
- **RISK — consistency:** rows and Sales documents are not a snapshot unless read in one transaction, which is impractical for large lists. Accept read-time consistency for display, then revalidate transactionally on NA submission.
- **CHANGE REQUIRED:** replace or augment the direct snapshot endpoint. Do not merge Sales-derived values into an unbounded client fan-out.

## 11. Design Comparison

| State | Proposed behavior | Review |
|---|---|---|
| A: no premise, no meter | Premise/NA/ERF enabled; AST disabled | **ACCEPT** |
| B: premise, no meter | all four enabled; AST starts discovery | **ACCEPT** |
| C: premise and meter | Premise/AST/ERF enabled; NA history shown, new NA disabled | **ACCEPT** |
| D: meter without premise | fail closed; ERF available; conditional safe AST view | **ACCEPT** |
| Sales link missing/invalid | `NA — / DATA ISSUE`, submission disabled | **ACCEPT** |
| Prior NA attempts | do not complete row; append immutably | **ACCEPT** |
| Successful discovery | completes row and preserves NA history | **ACCEPT**, backend work required |

## 12. Accepted Design Items

- Exact row refs are the navigation authority.
- NA is independent field activity and may occur before a premise exists.
- Meter linkage disables new NA while preserving historical count.
- Exact Sales match requires both TB and row IDs.
- Sales `fieldWork.noAccess` is append-only and is the count authority.
- Explicit integrity states prevent false `NA 0`.
- Shared intent-based geography preparation is preferable to duplicate handlers.
- One small tile component with only the pressed tile loading is appropriate.
- No broad split/rewrite of `my-workorders.js` is justified in this sprint.

## 13. Changes Required

1. Replace ERF-wide counts with row-ref booleans and API NA count/status.
2. Add five intents to one preparation pipeline: `OPEN_ERF`, `OPEN_PREMISE`, `START_METER_DISCOVERY`, `OPEN_AST`, `RECORD_NO_ACCESS`.
3. Add exact premise/AST resolution and cross-link validation.
4. Add a server-owned paginated/enriched Targeted Batch rows endpoint.
5. Add an independent Sales TB NA capture mode with reason, required photo, GPS, authenticated actor, captured time, stable ID, TB/Sales/ERF correlation, and queue preservation.
6. Add a dedicated transactional NA callable. In one transaction: authenticate; validate parent, row, Sales ID, ERF ID, empty meter ref, and exact Sales TB ref; check idempotency; create independent record; append Sales summary; start row/parent once; preserve unrelated data. No premise/AST writes.
7. Exclude `sourceModule === "SALES_TARGETED_BATCH"` NA records from the generic `onNoAccessRecorded` premise mutation.
8. Add Targeted Batch Meter Discovery context through mobile form/queue/callable and implement atomic completion preserving `fieldWork.noAccess`.
9. Refresh rows after backend rejection/success and render linkage-specific failures.

## 14. Open Decisions

- **OPEN DECISION:** canonical Targeted Batch Meter Discovery `outcomeCode` and `outcomeLabel` are not implemented in the inspected code. Define/locate the existing authoritative contract before coding.
- **OPEN DECISION:** choose the independent record discriminator while retaining the existing `trns` collection—recommended `trnType: "NO_ACCESS"` plus `origin.sourceModule: "SALES_TARGETED_BATCH"`, rather than mislabelling it as Meter Discovery.
- **OPEN DECISION:** whether the exact linked premise/AST should merely appear as the sole list item or immediately open a details screen. Current architecture naturally supports exact-filtered index screens.
- **OPEN DECISION:** committed-count-only UI is sufficient. `+1 PENDING` is useful but optional; omit initially unless fieldworkers need explicit offline confirmation.
- **OPEN DECISION:** define capture timestamp policy. Recommended: preserve client `capturedAt` as evidence and store server `recordedAt`; Sales display date/time should derive from captured time under a specified timezone, not device locale ambiguity.

## 15. Risks

- **RISK — array contention:** concurrent attempts update the same Sales `tbRefs` array. A Firestore transaction with retry preserves both unique attempts, but hot documents can contend.
- **RISK — duplicate summary identity:** the requested Sales summary object lacks NA ID. Reliable idempotency cannot be proven from date/time/user alone. Recommended add immutable `id` to each `fieldWork.noAccess` element while retaining required display fields; otherwise maintain a parallel idempotency map/document transactionally. The former is safer and simpler.
- **RISK — trigger escape:** failing to bypass `onNoAccessRecorded` will violate the locked premise non-regression rule even if the new callable itself avoids premise writes.
- **RISK — media atomicity:** Storage upload cannot join a Firestore transaction. Upload under the stable NA ID first, then transact Firestore references; orphan cleanup is a separate operational concern.
- **RISK — client identity/time:** never trust submitted user names as authority. Resolve actor from auth/profile server-side and validate timestamps.
- **RISK — stale row:** meter may be linked while the NA form is open. The transaction must re-read `row.refs.meterId` before creating anything and return a controlled conflict with zero writes.
- **RISK — current dirty worktree:** the web repository already contained many modified/deleted/untracked files before this report. Implementation must isolate its patch and avoid overwriting unrelated work.

## 16. Exact Files Likely to Change

Mobile:

- `C:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js` — tiles, states, callbacks, shared intent preparation, exact resolution, refresh/error handling.
- `C:\dev\ireps-mobile\src\redux\targetedBatchApi.js` — replace/augment direct row stream with enriched endpoint contract and integrity fields.
- `C:\dev\ireps-mobile\src\context\DiscoveryContext.js` — preserve complete TB discovery mission context.
- `C:\dev\ireps-mobile\src\features\meters\FormMeterDiscovery.js` — TB discovery context, queue preservation, completion payload; do not alter normal behavior.
- `C:\dev\ireps-mobile\src\features\premises\targetedBatchPremiseContext.js` — canonical shared context fields/names.
- `C:\dev\ireps-mobile\src\utils\submissionQueue.js` — new NA form type/callable mapping and TB context fields.
- A small new Sales TB NA capture component/route under `C:\dev\ireps-mobile\app\(tabs)\admin\operations\` or `src/features/targetedBatches/`; do not repurpose read-only `premises/NaScreen.js`.

Backend/web repository:

- `C:\dev\ireps-web\functions\index.js` — export/wire new callables; bypass generic premise NA trigger; extend Targeted Batch discovery completion boundary.
- `C:\dev\ireps-web\functions\targetedBatches\premiseLink.js` — reuse validation patterns; preserve `noAccess`; consider extracting exact TB-ref matcher.
- New focused modules under `C:\dev\ireps-web\functions\targetedBatches\` for rows listing and NA transaction rather than expanding `index.js`.
- `C:\dev\ireps-web\functions\test\` — focused rows, NA, concurrency/idempotency, and discovery regression tests.
- Firestore rules/index definitions only if the selected callable/query contract needs them; callable Admin SDK reads do not require client read-rule expansion.

## 17. Recommended Implementation Sequence

1. Lock backend contracts: exact Sales match, integrity statuses, NA record fields/ID, captured-time semantics, and canonical discovery outcome codes.
2. Implement and test the read-only paginated rows enrichment endpoint.
3. Update mobile row normalization and render four tiles with state matrix only; keep actions behind tested callbacks.
4. Refactor existing row geography preparation into the intent pipeline and implement ERF/Premise/AST read navigation.
5. Implement the dedicated NA transaction and trigger exclusion with backend tests.
6. Add the minimal NA mobile capture mode and queue support; test offline retry/idempotency.
7. Extend Meter Discovery context and backend completion transaction, preserving NA history.
8. Run focused mobile state/navigation tests and full non-TB Meter Discovery/premise regression tests.

## 18. Recommended Test Plan

### Rows API

- Absent `noAccess` returns `0`; one/multiple entries return exact lengths.
- Match requires both `tbId` and `rowId`; other `tbRefs` are ignored.
- Missing Sales document -> `SALES_DOCUMENT_MISSING`; missing exact ref -> `TB_REFERENCE_MISSING`; malformed fieldWork/noAccess -> `FIELDWORK_INVALID`.
- Integrity failure never maps to zero and disables NA.
- Listing performs zero writes; unique Sales docs are batch-read once/chunk; read count is asserted.
- Cursor ordering/pagination has no duplicates or omissions and preserves integrity enrichment.

### Mobile card states

- Premise 0 / AST 0 / NA 0 and NA 2.
- Premise 1 / AST 0 / NA 2.
- Premise 1 / AST 1 / NA 2 with NA disabled.
- Meter-without-premise invalid state and conditional exact AST viewing.
- Missing Sales correlation shows `NA —`, `DATA ISSUE`, disabled action.
- Only pressed tile spins; other enabled tiles remain stable.

### Navigation

- ERF opens `/(tabs)/erfs` filtered to exact canonical ERF after correct ward pack is ready.
- Premise 0 opens exact ERF’s `/(tabs)/premises` list without opening creation.
- Premise 1 opens/selects exact linked premise; missing/mismatched premise fails closed.
- AST 0 with premise launches electricity Meter Discovery with every required TB field.
- AST 1 selects exact `refs.meterId` and routes to `/(tabs)/asts`; missing/mismatched AST fails closed.
- NA opens with exact TB/row/Sales/ERF context and no premise/meter requirement.
- Rapid consecutive intents, batch changes, slow ward sync, unmount, stale row refresh, and missing ERF all fail safely.

### NA backend

- Succeeds with no premise and with a linked premise; no premise/AST document changes in either case.
- First unique ID creates once and appends once; retry returns already-recorded with no write.
- Second unique ID appends a second entry; concurrent unique attempts both survive transaction retries.
- Existing meter rejects with zero independent record/Sales/TB writes.
- Wrong TB, row, Sales, or ERF IDs each cause zero writes.
- Exact target `tbRefs` changes only as specified; its `date` stays unchanged; other `tbRefs`, `geofenceRefs`, and unrelated Sales fields are byte/deep equal.
- First NA changes row/parent to `IN_PROGRESS` and increments started count once; subsequent NA does not increment; none completes row.
- Required reason/photo/GPS/auth/captured time are validated server-side as applicable.
- Generic `onNoAccessRecorded` ignores Sales TB origin and normal premise-linked NA still works unchanged.

### Offline and idempotency

- Queue persists stable NA/TRN ID, source module, TB/row/Sales/ERF IDs, reason, media URI/upload result, GPS, actor snapshot, and captured time.
- Retry after timeout uses same ID and produces one record/one Sales entry.
- Editing/resubmitting a queued item does not regenerate the attempt ID.
- Committed count excludes pending entries; optional pending indicator is separately tested if adopted.

### Meter Discovery regression

- Successful TB discovery preserves all previous `fieldWork.noAccess` entries and order.
- It sets exact premise/meter/TRN IDs, discovered meter number, meter match, canonical outcome, timestamps, row completion, and parent counters/status correctly.
- It blocks further NA transactionally.
- Targeted meter number is not used to resolve the created AST.
- Normal premise creation, non-TB Meter Discovery, normal AST navigation, BGO worklists, individual lifecycle TRNs, premise/AST schemas, other Sales refs, geofence refs, and source address remain unchanged.

## 19. Final Recommendation

**CHANGE REQUIRED — proceed only as a staged, contract-first implementation.** Approve the four-tile UX, state matrix, shared geography preparation, Sales-authoritative NA count, and independent immutable NA semantics. Do not implement the UI against the current direct `tb_rows` stream or current premise-owned No Access branch.

The backend transaction boundary must come first: exact correlation, immutable ID, independent record, atomic Sales append/first-activity update, trigger exclusion, and zero premise/AST writes. Then add enriched row reads and mobile intents. Meter Discovery completion is a separate required part of this sprint’s correctness and must preserve NA history, but its canonical outcome code/label must be resolved before coding.
